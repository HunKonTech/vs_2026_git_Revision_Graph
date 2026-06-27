import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost, ThemeTokens } from "@rev-graph/protocol";
import { readGraphData, checkoutCli, fetchCli, pullCli, pushCli } from "./gitData";
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
        await this.handleCreateBranch(msg.sha);
        break;
      case "checkout":
        await this.handleCheckout(msg.sha ?? msg.ref);
        break;
      case "copySha":
        await vscode.env.clipboard.writeText(msg.sha);
        void vscode.window.showInformationMessage(`Copied ${msg.sha.slice(0, 10)}`);
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

  private async handleCreateBranch(sha: string): Promise<void> {
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      const name = await createBranchFromCommit(repo, repo.rootUri.fsPath, sha);
      if (name) {
        this.post({ type: "branchCreated", name, sha });
        void vscode.window.showInformationMessage(`Created branch "${name}" from ${sha.slice(0, 7)}`);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Create branch failed: ${String(err)}`);
    }
  }

  private async handleCheckout(treeish: string | undefined): Promise<void> {
    if (!treeish) return;
    const repo = await resolveRepository();
    if (!repo) return;
    try {
      await repo.checkout(treeish);
    } catch {
      await checkoutCli(repo.rootUri.fsPath, treeish).catch((err) =>
        vscode.window.showErrorMessage(`Checkout failed: ${String(err)}`),
      );
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
