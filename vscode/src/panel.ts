import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost, ThemeTokens, DiffFileStatus } from "@rev-graph/protocol";
import {
  readGraphData,
  checkoutCli,
  checkoutTrackingCli,
  resolveCheckoutTarget,
  fetchCli,
  pullCli,
  pushCli,
  pushBranchCli,
  renameBranchCli,
  deleteBranchCli,
  currentBranchCli,
  resolveBranchBaseTarget,
  isCommitPushedCli,
  rewordCommitCli,
  commitSummaryCli,
  undoCommitCli,
  stashApplyCli,
  stashPopCli,
  stashDropCli,
  readCommitChanges,
  readFileDiff,
  computeMergePreview,
  mergeCli,
} from "./gitData";
import { resolveRepository, getGitApi } from "./repo";
import { createBranchFromCommit } from "./branch";

/** Singleton webview panel hosting the shared graph renderer. */
export class GraphPanel {
  private static current: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /** Debounce timer coalescing bursts of repo changes into one refresh. */
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  static show(context: vscode.ExtensionContext): void {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal();
      void GraphPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "revGraph",
      "Revision Graph",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );
    GraphPanel.current = new GraphPanel(panel, context);
  }

  static refreshActive(): void {
    void GraphPanel.current?.refresh();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.html();

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHost) => this.onMessage(msg),
      undefined,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Re-push theme when the IDE theme changes.
    vscode.window.onDidChangeActiveColorTheme(
      () => this.post({ type: "setTheme", theme: themeTokens() }),
      undefined,
      this.disposables,
    );

    // Keep the graph live: refresh whenever any repository's state changes
    // (commit, checkout, branch, fetch/pull/push …), like the SVN graph does.
    void this.setupAutoRefresh();
  }

  /** Subscribe to git repository state changes for automatic refresh. */
  private async setupAutoRefresh(): Promise<void> {
    const api = await getGitApi();
    if (!api) return;
    const watch = (repo: { state: { onDidChange(cb: () => void): { dispose(): void } } }) => {
      this.disposables.push(repo.state.onDidChange(() => this.scheduleRefresh()));
    };
    for (const repo of api.repositories) watch(repo);
    this.disposables.push(api.onDidOpenRepository((repo) => watch(repo)));
  }

  /** Coalesce rapid change bursts into a single refresh shortly after. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 400);
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({ type: "setTheme", theme: themeTokens() });
        await this.refresh();
        break;
      case "requestRefresh":
        await this.refresh();
        break;
      case "createBranch":
        await this.handleCreateBranch(msg.sha, msg.name, msg.checkout);
        break;
      case "deleteBranch":
        await this.handleDeleteBranch(msg.name);
        break;
      case "renameBranch":
        await this.handleRenameBranch(msg.name);
        break;
      case "renameCommit":
        await this.handleRenameCommit(msg.sha);
        break;
      case "undoCommit":
        await this.handleUndoCommit(msg.sha);
        break;
      case "stashApply":
        await this.handleStash("stashApply", msg.index);
        break;
      case "stashPop":
        await this.handleStash("stashPop", msg.index);
        break;
      case "stashDrop":
        await this.handleStash("stashDrop", msg.index);
        break;
      case "checkout":
        await this.handleCheckout(msg.sha, msg.ref);
        break;
      case "copySha":
        await vscode.env.clipboard.writeText(msg.sha);
        void vscode.window.showInformationMessage(`Copied ${msg.sha.slice(0, 10)}`);
        break;
      case "requestCommitChanges":
        await this.handleCommitChanges(msg.sha);
        break;
      case "requestFileDiff":
        await this.handleFileDiff(msg.sha, msg.path, msg.status, msg.oldPath);
        break;
      case "requestMergePreview":
        await this.handleMergePreview(msg.source);
        break;
      case "merge":
        await this.handleMerge(msg.source, msg.message, msg.noFastForward ?? false);
        break;
      case "fetch":
        await this.runRemoteOp("Fetch", fetchCli);
        break;
      case "pull":
        await this.runRemoteOp("Pull", pullCli);
        break;
      case "push":
        await this.runRemoteOp("Push", pushCli);
        break;
      case "pushBranch":
        await this.runRemoteOp(`Push "${msg.name}"`, (root) => pushBranchCli(root, msg.name));
        break;
      case "sync":
        // Sync = pull then push, the common "sync changes" gesture.
        await this.runRemoteOp("Sync", async (root) => {
          await pullCli(root);
          await pushCli(root);
        });
        break;
    }
  }

  /** Run a remote git operation with progress, then refresh the graph. */
  private async runRemoteOp(
    label: string,
    op: (repoRoot: string) => Promise<void>,
  ): Promise<void> {
    const repo = await resolveRepository();
    if (!repo) {
      this.post({ type: "error", message: "No Git repository found in this workspace." });
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `${label}…`, cancellable: false },
        () => op(repo.rootUri.fsPath),
      );
      void vscode.window.showInformationMessage(`${label} completed.`);
    } catch (err) {
      this.post({ type: "error", message: `${label} failed: ${String(err)}` });
      void vscode.window.showErrorMessage(`${label} failed: ${String(err)}`);
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const repo = await resolveRepository();
    if (!repo) {
      this.post({ type: "error", message: "No Git repository found in this workspace." });
      return;
    }
    try {
      const max = vscode.workspace.getConfiguration("revGraph").get<number>("maxCommits", 1000);
      const data = await readGraphData(repo.rootUri.fsPath, max);
      this.post({ type: "setData", data });
    } catch (err) {
      this.post({ type: "error", message: `Failed to read git history: ${String(err)}` });
    }
  }

  private async handleCreateBranch(
    sha: string,
    name?: string,
    checkout?: boolean,
  ): Promise<void> {
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      // When the webview's SVN-style dialog already supplied a name, create
      // directly; otherwise fall back to the native prompts.
      const prepared = name ? { name, checkout: checkout ?? true } : undefined;
      const created = await createBranchFromCommit(repo, repo.rootUri.fsPath, sha, prepared);
      if (created) {
        this.post({ type: "branchCreated", name: created, sha });
        void vscode.window.showInformationMessage(`Created branch "${created}" from ${sha.slice(0, 7)}`);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Create branch failed: ${String(err)}`);
    }
  }

  private async handleDeleteBranch(name: string): Promise<void> {
    if (!name) return;
    const repo = await resolveRepository();
    if (!repo) return;
    const root = repo.rootUri.fsPath;

    const confirm = await vscode.window.showWarningMessage(
      `Delete branch "${name}"?`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return;

    // A branch checked out in this worktree can't be deleted — git refuses with
    // "used by worktree". Move HEAD to where the branch was started from first:
    // the main branch when it forked directly off main, otherwise the branch it
    // diverged from.
    try {
      const current = await currentBranchCli(root);
      if (current && current === name) {
        const target = await resolveBranchBaseTarget(root, name);
        if (!target || target === name) {
          void vscode.window.showErrorMessage(
            `Cannot delete "${name}": it is checked out and no other branch to switch to was found.`,
          );
          return;
        }
        await checkoutCli(root, target);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Delete branch failed: ${String(err)}`);
      return;
    }

    try {
      await deleteBranchCli(root, name, false);
    } catch (err) {
      // -d refuses to drop a branch that isn't fully merged; offer a force delete.
      const force = await vscode.window.showWarningMessage(
        `Branch "${name}" is not fully merged. Delete anyway? This cannot be undone.`,
        { modal: true },
        "Force delete",
      );
      if (force !== "Force delete") return;
      try {
        await deleteBranchCli(root, name, true);
      } catch (err2) {
        void vscode.window.showErrorMessage(`Delete branch failed: ${String(err2)}`);
        return;
      }
    }
    void vscode.window.showInformationMessage(`Deleted branch "${name}".`);
    await this.refresh();
  }

  private async handleRenameBranch(name: string): Promise<void> {
    if (!name) return;
    const repo = await resolveRepository();
    if (!repo) return;
    const root = repo.rootUri.fsPath;

    const newName = await vscode.window.showInputBox({
      title: `Rename branch "${name}"`,
      prompt: "Enter the new branch name",
      value: name,
      validateInput: (v) => (v.trim() ? undefined : "Branch name is required"),
    });
    if (newName === undefined) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) return;

    try {
      await renameBranchCli(root, name, trimmed);
    } catch (err) {
      void vscode.window.showErrorMessage(`Rename branch failed: ${String(err)}`);
      return;
    }
    void vscode.window.showInformationMessage(`Renamed branch "${name}" to "${trimmed}".`);
    await this.refresh();
  }

  private async handleRenameCommit(sha: string): Promise<void> {
    if (!sha) return;
    const repo = await resolveRepository();
    if (!repo) return;
    const root = repo.rootUri.fsPath;

    // Only local (unpushed) commits may be reworded — rewriting a pushed commit
    // would diverge from the remote.
    if (await isCommitPushedCli(root, sha)) {
      void vscode.window.showWarningMessage(
        "This commit has already been pushed, so its message can't be rewritten safely.",
      );
      return;
    }

    const current = await commitSummaryCli(root, sha);
    const message = await vscode.window.showInputBox({
      title: `Rename commit ${sha.slice(0, 7)}`,
      prompt: "Enter the new commit message",
      value: current,
      validateInput: (v) => (v.trim() ? undefined : "Commit message is required"),
    });
    if (message === undefined) return;
    const trimmed = message.trim();
    if (!trimmed || trimmed === current) return;

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Renaming commit…", cancellable: false },
        () => rewordCommitCli(root, sha, trimmed),
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Rename commit failed: ${String(err)}`);
      return;
    }
    await this.refresh();
  }

  private async handleCheckout(sha: string | undefined, ref?: string): Promise<void> {
    const treeish = sha ?? ref;
    if (!treeish) return;
    const repo = await resolveRepository();
    if (!repo) return;
    const root = repo.rootUri.fsPath;
    try {
      // Resolve a branch to switch to instead of detaching HEAD on a commit —
      // crucially, a remote-only branch becomes a new local tracking branch.
      // `ref` names the exact branch the user clicked, so when several branches
      // share a commit we switch to the right one instead of guessing by sha.
      const target = await resolveCheckoutTarget(root, treeish, ref);
      if (target.track) {
        await checkoutTrackingCli(root, target.ref, target.track);
      } else {
        await repo.checkout(target.ref).catch(() => checkoutCli(root, target.ref));
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Checkout failed: ${String(err)}`);
    }
    await this.refresh();
  }

  /**
   * Undo a local commit: its changes return to the working tree and it vanishes
   * from history. Refuses pushed commits (the webview already hides the entry for
   * them; this guards the rare race). On conflict, reveals the SCM view so the
   * user can resolve it with the built-in merge editor.
   */
  private async handleUndoCommit(sha: string): Promise<void> {
    if (!sha) return;
    const repo = await resolveRepository();
    if (!repo) return;
    const root = repo.rootUri.fsPath;

    if (await isCommitPushedCli(root, sha)) {
      this.post({ type: "opResult", op: "undo", result: "error" });
      return;
    }
    try {
      const result = await undoCommitCli(root, sha);
      this.post({ type: "opResult", op: "undo", result });
      if (result === "conflict") await revealConflicts();
    } catch (err) {
      this.post({ type: "opResult", op: "undo", result: "error", detail: String(err) });
    }
    await this.refresh();
  }

  /** Apply / pop / drop a stash, reporting the outcome for a localized status. */
  private async handleStash(
    op: "stashApply" | "stashPop" | "stashDrop",
    index: number,
  ): Promise<void> {
    const repo = await resolveRepository();
    if (!repo) return;
    const root = repo.rootUri.fsPath;
    try {
      let result: "ok" | "conflict" = "ok";
      if (op === "stashApply") result = await stashApplyCli(root, index);
      else if (op === "stashPop") result = await stashPopCli(root, index);
      else await stashDropCli(root, index);
      this.post({ type: "opResult", op, result });
      if (result === "conflict") await revealConflicts();
    } catch (err) {
      this.post({ type: "opResult", op, result: "error", detail: String(err) });
    }
    await this.refresh();
  }

  /** Send the webview the list of files a commit changed (for the changes dialog). */
  private async handleCommitChanges(sha: string): Promise<void> {
    if (!sha) return;
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      const files = await readCommitChanges(repo.rootUri.fsPath, sha);
      this.post({ type: "commitChanges", sha, files });
    } catch (err) {
      this.post({ type: "error", message: `Failed to read commit changes: ${String(err)}` });
    }
  }

  /** Send the webview the before/after text of one changed file. */
  private async handleFileDiff(
    sha: string,
    path: string,
    status: DiffFileStatus,
    oldPath?: string,
  ): Promise<void> {
    if (!sha || !path) return;
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      const diff = await readFileDiff(repo.rootUri.fsPath, sha, path, status, oldPath);
      this.post({ type: "fileDiff", diff });
    } catch (err) {
      this.post({ type: "error", message: `Failed to read file diff: ${String(err)}` });
    }
  }

  /** Compute and send a dry-run preview of merging `source` into the current branch. */
  private async handleMergePreview(source: string): Promise<void> {
    if (!source) return;
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      const preview = await computeMergePreview(repo.rootUri.fsPath, source);
      this.post({ type: "mergePreview", preview });
    } catch (err) {
      this.post({ type: "error", message: `Failed to preview merge: ${String(err)}` });
    }
  }

  /**
   * Merge `source` into the current branch. Reports the outcome for a localized
   * status line; on conflict, reveals the Source Control view so the user resolves
   * it with the built-in merge editor (the merge is left in progress).
   */
  private async handleMerge(
    source: string,
    message: string | undefined,
    noFastForward: boolean,
  ): Promise<void> {
    if (!source) return;
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Merging "${source}"…`, cancellable: false },
        () => mergeCli(repo.rootUri.fsPath, source, message, noFastForward),
      );
      this.post({ type: "opResult", op: "merge", result });
      if (result === "conflict") await revealConflicts();
    } catch (err) {
      this.post({ type: "opResult", op: "merge", result: "error", detail: String(err) });
    }
    await this.refresh();
  }

  private post(msg: HostToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", file));
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${media("main.css")}" />
    <title>Revision Graph</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${media("main.js")}"></script>
  </body>
</html>`;
  }

  private dispose(): void {
    GraphPanel.current = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

/**
 * Surface conflicts after an undo/stash op so the user can resolve them with the
 * IDE's built-in tooling: focus the Source Control view, which lists the merge
 * conflicts and offers the merge editor for each file.
 */
async function revealConflicts(): Promise<void> {
  await Promise.resolve(vscode.commands.executeCommand("workbench.view.scm")).then(
    undefined,
    () => {},
  );
}

/** Map the current VS Code theme to the webview's theme tokens. */
function themeTokens(): ThemeTokens {
  const k = vscode.window.activeColorTheme.kind;
  const dark = k === vscode.ColorThemeKind.Dark;
  const hc = k === vscode.ColorThemeKind.HighContrast || k === vscode.ColorThemeKind.HighContrastLight;
  return {
    kind: hc ? "highContrast" : dark ? "dark" : "light",
    background: dark ? "#1e1e1e" : "#ffffff",
    foreground: dark ? "#d4d4d4" : "#1e1e1e",
    accent: "#0e639c",
    border: dark ? "#3c3c3c" : "#d0d0d0",
  };
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
