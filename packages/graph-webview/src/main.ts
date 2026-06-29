import { createHostBridge } from "./host-bridge.js";
import { GraphView } from "./render.js";
import { showContextMenu, closeContextMenu, type MenuItem } from "./contextMenu.js";
import { toggleSettings } from "./settings.js";
import { openNewBranchDialog, closeNewBranchDialog } from "./newBranchDialog.js";
import {
  openChangesDialog,
  closeChangesDialog,
  setChangesFiles,
  setFileDiff,
} from "./changesDialog.js";
import { openMergeDialog, closeMergeDialog, setMergePreview } from "./mergeDialog.js";
import { getBranchDialogMode } from "./branchDialogMode.js";
import { getMainBranch, onMainBranchChange } from "./mainBranch.js";
import { getDisplayMode, onDisplayModeChange } from "./displayMode.js";
import { getThemeChoice, onThemeChange, LIGHT_THEME, DARK_THEME } from "./theme.js";
import { t, onLangChange, type MsgKey } from "./i18n.js";
import type { GraphData, ThemeTokens, OpKind, OpResult } from "@rev-graph/protocol";
import type { PositionedCommit } from "@rev-graph/graph-core";
import "./style.css";

const DEFAULT_THEME: ThemeTokens = {
  kind: "dark",
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  accent: "#0e639c",
  border: "#3c3c3c",
};

function boot(): void {
  const root = document.getElementById("app") ?? document.body;

  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";

  // The current status is held as a closure so it can be re-rendered in the
  // active language whenever the user switches languages.
  let statusFn: () => string = () => t("status.loading");
  function renderStatus(fn: () => string): void {
    statusFn = fn;
    statusBar.textContent = statusFn();
  }
  renderStatus(statusFn);

  const canvas = document.createElement("div");
  canvas.className = "graph-canvas";
  canvas.style.position = "relative";
  const legend = buildLegend();
  canvas.appendChild(legend);

  const detailsPanel = buildDetailsPanel();
  // Sha of the currently checked-out commit, kept so the details panel can flag
  // the commit the working tree is on.
  let currentHead: string | null = null;
  // Last graph payload, retained so the view can be re-laid-out when the main
  // branch selection changes without a host round-trip.
  let lastData: GraphData | null = null;

  const mainContent = document.createElement("div");
  mainContent.className = "main-content";
  mainContent.appendChild(canvas);
  mainContent.appendChild(detailsPanel);

  root.appendChild(mainContent);
  root.appendChild(statusBar);

  const bridge = createHostBridge();

  const view = new GraphView(canvas, {
    onNodeContextMenu(commit, x, y) {
      // Stash nodes get their own apply/pop/drop menu.
      if (commit.stash && commit.stashIndex != null) {
        const index = commit.stashIndex;
        showContextMenu(x, y, [
          {
            label: t("menu.stashApply"),
            action: () => {
              renderStatus(() => t("status.stashApplying"));
              bridge.post({ type: "stashApply", index });
            },
          },
          {
            label: t("menu.stashPop"),
            action: () => {
              renderStatus(() => t("status.stashPopping"));
              bridge.post({ type: "stashPop", index });
            },
          },
          {
            label: t("menu.stashDrop"),
            separatorBefore: true,
            action: () => {
              renderStatus(() => t("status.stashDropping"));
              bridge.post({ type: "stashDrop", index });
            },
          },
        ]);
        return;
      }

      const sha = commit.sha;
      const localBranches = commit.refs.filter((r) => r.type === "localBranch");
      const allRefs = lastData?.refs ?? [];

      const items: MenuItem[] = [
        {
          label: t("menu.createBranch"),
          action: () => startCreateBranch(sha, commit.refs),
        },
        {
          label: t("menu.checkout"),
          action: () => bridge.post({ type: "checkout", sha, ref: boxBranchRef(commit) }),
        },
      ];

      // View the files this commit changed (skip phantom branch placeholders,
      // which carry no commit of their own).
      if (!commit.phantom) {
        items.push({
          label: t("menu.viewChanges"),
          action: () => startViewChanges(sha),
        });
      }

      // Rename is only offered for local (unpushed) commits, and never on phantom
      // branch placeholders (which carry no real commit of their own).
      if (commit.unpushed && !commit.phantom) {
        items.push({
          label: t("menu.renameCommit"),
          action: () => bridge.post({ type: "renameCommit", sha }),
        });
      }

      // Undo is only offered for local (unpushed) commits, and never on phantom
      // branch placeholders (which carry no real commit of their own).
      if (commit.unpushed && !commit.phantom) {
        items.push({
          label: t("menu.undoCommit"),
          action: () => {
            renderStatus(() => t("status.undoing"));
            bridge.post({ type: "undoCommit", sha });
          },
        });
      }

      items.push({
        label: t("menu.copySha"),
        separatorBefore: true,
        action: () => bridge.post({ type: "copySha", sha }),
      });

      // One push/delete entry per local branch that points at this commit.
      // "Push" is offered only when the branch has no remote counterpart yet.
      localBranches.forEach((ref, i) => {
        const hasRemote = allRefs.some(
          (r) => r.type === "remoteBranch" && r.name.endsWith("/" + ref.name),
        );
        if (!hasRemote) {
          items.push({
            label: t("menu.pushBranch", { name: ref.name }),
            separatorBefore: i === 0,
            action: () => bridge.post({ type: "pushBranch", name: ref.name }),
          });
        }
        items.push({
          label: t("menu.renameBranch", { name: ref.name }),
          separatorBefore: i === 0 && hasRemote,
          action: () => bridge.post({ type: "renameBranch", name: ref.name }),
        });
        items.push({
          label: t("menu.deleteBranch", { name: ref.name }),
          action: () => bridge.post({ type: "deleteBranch", name: ref.name }),
        });
      });

      showContextMenu(x, y, items);
    },
    onNodeDblClick(commit) {
      bridge.post({ type: "checkout", sha: commit.sha, ref: boxBranchRef(commit) });
    },
    onNodeClick(commit) {
      showCommitDetails(detailsPanel, commit, currentHead);
      // Highlight the path from the root to the selected commit/branch. Stash
      // nodes aren't part of the commit ancestry, so they just clear it.
      view.selectPath(commit.stash ? null : commit.sha);
    },
    onCanvasContextMenu(x, y) {
      // Background menu (right-click off any box): jump to the checkout, reset
      // the view, and the remote ops also offered on the toolbar.
      showContextMenu(x, y, [
        { label: t("menu.jumpHead"), action: goToCheckout },
        {
          label: t("menu.resetView"),
          separatorBefore: true,
          action: () => view.resetView(),
        },
        {
          label: t("toolbar.fetch"),
          separatorBefore: true,
          action: () => {
            renderStatus(() => t("status.fetching"));
            bridge.post({ type: "fetch" });
          },
        },
        {
          label: t("toolbar.pull"),
          action: () => {
            renderStatus(() => t("status.pulling"));
            bridge.post({ type: "pull" });
          },
        },
        {
          label: t("toolbar.sync"),
          action: () => {
            renderStatus(() => t("status.syncing"));
            bridge.post({ type: "sync" });
          },
        },
      ]);
    },
  });

  // Bring the currently checked-out branch/commit into view (toolbar + menu).
  function goToCheckout(): void {
    if (!view.jumpToHead()) renderStatus(() => t("status.noHead"));
  }

  // Effective theme = the user's override (light/dark), or the host's theme when
  // set to "follow host". Applied both to the graph view and to :root so the
  // settings dialog and other body-level UI re-theme together.
  let hostTheme: ThemeTokens = DEFAULT_THEME;
  function effectiveTheme(): ThemeTokens {
    const c = getThemeChoice();
    if (c === "light") return LIGHT_THEME;
    if (c === "dark") return DARK_THEME;
    return hostTheme;
  }
  function applyTheme(): void {
    const tk = effectiveTheme();
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--bg", tk.background);
    rootStyle.setProperty("--fg", tk.foreground);
    rootStyle.setProperty("--accent", tk.accent);
    rootStyle.setProperty("--border", tk.border);
    document.documentElement.dataset.theme = tk.kind;
    view.setTheme(tk);
  }

  applyTheme();
  onThemeChange(applyTheme);
  view.setMode(getDisplayMode());

  bridge.onMessage((msg) => {
    switch (msg.type) {
      case "setData":
        renderData(msg.data);
        break;
      case "setTheme":
        hostTheme = msg.theme;
        applyTheme();
        break;
      case "branchCreated": {
        const name = msg.name;
        const sha = msg.sha.slice(0, 7);
        renderStatus(() => t("status.branchCreated", { name, sha }));
        bridge.post({ type: "requestRefresh" });
        break;
      }
      case "opResult": {
        if (msg.result === "error") {
          const message = msg.detail ?? t("status.opFailed");
          renderStatus(() => t("status.error", { message }));
        } else {
          const key = opResultKey(msg.op, msg.result);
          renderStatus(() => t(key));
        }
        // The host refreshes the graph itself after the op; nothing to request.
        break;
      }
      case "commitChanges":
        setChangesFiles(msg.sha, msg.files);
        break;
      case "fileDiff":
        setFileDiff(msg.diff);
        break;
      case "error": {
        const message = msg.message;
        renderStatus(() => t("status.error", { message }));
        break;
      }
    }
  });

  // Open the changes dialog for a commit and ask the host for its file list. The
  // dialog then requests each file's diff lazily as the user selects it.
  function startViewChanges(sha: string): void {
    openChangesDialog({
      sha,
      onRequestFile: (file) =>
        bridge.post({
          type: "requestFileDiff",
          sha,
          path: file.path,
          status: file.status,
          oldPath: file.oldPath,
        }),
    });
    bridge.post({ type: "requestCommitChanges", sha });
  }

  function renderData(data: GraphData): void {
    closeContextMenu();
    closeNewBranchDialog();
    closeChangesDialog();
    detailsPanel.dataset.hidden = "";
    currentHead = data.head ?? null;
    lastData = data;
    view.setData(data, getMainBranch());
    renderStatus(() =>
      t("status.summary", {
        repo: data.repoName ? `${data.repoName} — ` : "",
        commits: data.commits.length,
        refs: data.refs.length,
      }),
    );
  }

  // The branch a given box represents, so a checkout targets *that* branch
  // rather than resolving by the shared commit (several branches can point at
  // the same commit — resolving by sha would silently pick the wrong one).
  // Prefers a local branch matching the box's lane, then any local branch, then
  // a remote branch; returns undefined for a plain commit so the host falls back
  // to sha-based resolution.
  function boxBranchRef(c: PositionedCommit): string | undefined {
    const local =
      c.refs.find((r) => r.type === "localBranch" && r.name === c.branch) ??
      c.refs.find((r) => r.type === "localBranch");
    if (local) return local.name;
    const remote =
      c.refs.find((r) => r.type === "remoteBranch" && r.name === c.branch) ??
      c.refs.find((r) => r.type === "remoteBranch");
    return remote?.name;
  }

  // Branch names (local + remote) available for the "main branch" picker.
  function branchNames(): string[] {
    if (!lastData) return [];
    return lastData.refs
      .filter((r) => r.type === "localBranch" || r.type === "remoteBranch")
      .map((r) => r.name);
  }

  // Branch names for the New Branch folder tree: local names as-is, remote names
  // with their remote prefix (e.g. "origin/") stripped, de-duplicated.
  function treeBranchNames(): string[] {
    if (!lastData) return [];
    const set = new Set<string>();
    for (const r of lastData.refs) {
      if (r.type === "localBranch") set.add(r.name);
      else if (r.type === "remoteBranch") {
        const slash = r.name.indexOf("/");
        if (slash > 0 && slash < r.name.length - 1) set.add(r.name.slice(slash + 1));
      }
    }
    return [...set];
  }

  // Begin branch creation from a commit: the SVN-style webview dialog when
  // enabled, otherwise defer to the host's own native prompt.
  function startCreateBranch(sha: string, refs: GraphData["refs"]): void {
    if (!getBranchDialogMode()) {
      bridge.post({ type: "createBranch", sha });
      return;
    }
    openNewBranchDialog({
      sha,
      startRefs: refs.filter((r) => r.type !== "head").map((r) => r.name),
      branchNames: treeBranchNames(),
      onCreate: (name, checkout) => bridge.post({ type: "createBranch", sha, name, checkout }),
    });
  }

  // Re-lay-out the existing data when the user changes the main branch.
  onMainBranchChange(() => {
    if (lastData) view.setData(lastData, getMainBranch());
  });

  // Switch the canvas between the modern and classic navigation styles.
  onDisplayModeChange(() => view.setMode(getDisplayMode()));

  // Toolbar: refresh + remote ops (fetch/pull/push/sync) + reset view + settings.
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const refreshBtn = makeButton("refresh", "toolbar.refresh");
  const fetchBtn = makeButton("fetch", "toolbar.fetch");
  const pullBtn = makeButton("pull", "toolbar.pull");
  const pushBtn = makeButton("push", "toolbar.push");
  const syncBtn = makeButton("sync", "toolbar.sync");
  const jumpBtn = makeButton("jumpHead", "toolbar.jumpHead");
  const resetBtn = makeButton("reset", "toolbar.reset");
  const settingsBtn = makeButton("settings", "toolbar.settings");
  toolbar.append(refreshBtn, fetchBtn, pullBtn, pushBtn, syncBtn, jumpBtn, resetBtn, settingsBtn);
  toolbar.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "refresh") bridge.post({ type: "requestRefresh" });
    if (act === "fetch") {
      renderStatus(() => t("status.fetching"));
      bridge.post({ type: "fetch" });
    }
    if (act === "pull") {
      renderStatus(() => t("status.pulling"));
      bridge.post({ type: "pull" });
    }
    if (act === "push") {
      renderStatus(() => t("status.pushing"));
      bridge.post({ type: "push" });
    }
    if (act === "sync") {
      renderStatus(() => t("status.syncing"));
      bridge.post({ type: "sync" });
    }
    if (act === "jumpHead") goToCheckout();
    if (act === "reset") view.resetView();
    if (act === "settings") toggleSettings({ branches: branchNames() });
  });
  root.insertBefore(toolbar, mainContent);

  // Re-render all static text when the language changes. The settings and
  // new-branch dialogs re-render themselves in place (they stay open); only the
  // transient context menu is dismissed.
  onLangChange(() => {
    closeContextMenu();
    refreshBtn.textContent = t("toolbar.refresh");
    fetchBtn.textContent = t("toolbar.fetch");
    pullBtn.textContent = t("toolbar.pull");
    pushBtn.textContent = t("toolbar.push");
    syncBtn.textContent = t("toolbar.sync");
    jumpBtn.textContent = t("toolbar.jumpHead");
    resetBtn.textContent = t("toolbar.reset");
    settingsBtn.textContent = t("toolbar.settings");
    relabelLegend(legend);
    statusBar.textContent = statusFn();
  });

  bridge.post({ type: "ready" });
}

/** Map an undo/stash op outcome to its localized status-line key. */
function opResultKey(op: OpKind, result: Exclude<OpResult, "error">): MsgKey {
  if (result === "conflict") {
    return op === "undo" ? "status.undoConflict" : "status.stashConflict";
  }
  switch (op) {
    case "undo":
      return "status.commitUndone";
    case "stashApply":
      return "status.stashApplied";
    case "stashPop":
      return "status.stashPopped";
    case "stashDrop":
      return "status.stashDropped";
  }
}

function makeButton(act: string, key: MsgKey): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.dataset.act = act;
  btn.textContent = t(key);
  return btn;
}

/** Legend rows: swatch class + i18n key for the label. */
const LEGEND_ITEMS: { cls: string; key: MsgKey }[] = [
  { cls: "head", key: "legend.head" },
  { cls: "local", key: "legend.local" },
  { cls: "remote", key: "legend.remote" },
  { cls: "remote-only", key: "legend.remoteOnly" },
  { cls: "tag", key: "legend.tag" },
  { cls: "commit", key: "legend.commit" },
  { cls: "stash", key: "legend.stash" },
];

function buildLegend(): HTMLElement {
  const legend = document.createElement("div");
  legend.className = "legend";

  const header = document.createElement("div");
  header.className = "legend-header";
  header.innerHTML = `<span class="legend-title"></span><span class="legend-toggle">▲</span>`;
  legend.appendChild(header);

  const body = document.createElement("div");
  body.className = "legend-body";
  for (const { cls } of LEGEND_ITEMS) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<span class="legend-swatch ${cls}"></span><span class="legend-label"></span>`;
    body.appendChild(row);
  }
  legend.appendChild(body);

  header.addEventListener("click", () => {
    const collapsed = legend.hasAttribute("data-collapsed");
    if (collapsed) {
      legend.removeAttribute("data-collapsed");
      (header.querySelector(".legend-toggle") as HTMLElement).textContent = "▲";
    } else {
      legend.setAttribute("data-collapsed", "");
      (header.querySelector(".legend-toggle") as HTMLElement).textContent = "▼";
    }
  });

  relabelLegend(legend);
  return legend;
}

/** Fill (or refresh) the legend's text in the active language. */
function relabelLegend(legend: HTMLElement): void {
  const title = legend.querySelector(".legend-title");
  if (title) title.textContent = t("legend.title");
  const labels = legend.querySelectorAll(".legend-label");
  LEGEND_ITEMS.forEach((item, i) => {
    const el = labels[i];
    if (el) el.textContent = t(item.key);
  });
}

function buildDetailsPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "details-panel";
  panel.dataset.hidden = "";
  return panel;
}

function showCommitDetails(
  panel: HTMLElement,
  commit: PositionedCommit,
  currentHead: string | null,
): void {
  delete panel.dataset.hidden;
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "details-header";
  const title = document.createElement("span");
  title.className = "details-title";
  title.textContent = t("details.header");
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.className = "settings-close-x";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", t("details.close"));
  closeBtn.addEventListener("click", () => {
    panel.dataset.hidden = "";
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  addDetailRow(panel, t("details.sha"), commit.sha, "details-sha");
  addDetailRow(panel, t("details.shortSha"), commit.sha.slice(0, 7), "details-shortsha");
  addDetailRow(panel, t("details.message"), commit.summary, "details-message");
  addDetailRow(panel, t("details.author"), `${commit.author} <${commit.authorEmail}>`);
  addDetailRow(panel, t("details.date"), formatDetailDate(commit.date));

  // Flag the commit the working tree is currently checked out on.
  if (currentHead && commit.sha === currentHead) {
    const section = document.createElement("div");
    section.className = "details-section";
    const lbl = document.createElement("div");
    lbl.className = "details-label";
    lbl.textContent = t("details.location");
    section.appendChild(lbl);
    const badge = document.createElement("span");
    badge.className = "details-current";
    badge.textContent = t("details.currentHead");
    section.appendChild(badge);
    panel.appendChild(section);
  }

  if (commit.refs.length > 0) {
    const section = document.createElement("div");
    section.className = "details-section";
    const lbl = document.createElement("div");
    lbl.className = "details-label";
    lbl.textContent = t("details.labels");
    section.appendChild(lbl);
    const chips = document.createElement("div");
    chips.className = "details-chips";
    for (const ref of commit.refs) {
      const chip = document.createElement("span");
      chip.className = `details-chip details-chip-${ref.type}`;
      if (ref.isCurrent) chip.classList.add("details-chip-current");
      chip.textContent = ref.type === "head" ? "HEAD" : ref.name;
      chips.appendChild(chip);
    }
    section.appendChild(chips);
    panel.appendChild(section);
  }
}

function addDetailRow(panel: HTMLElement, label: string, value: string, extraClass?: string): void {
  const section = document.createElement("div");
  section.className = "details-section";
  const lbl = document.createElement("div");
  lbl.className = "details-label";
  lbl.textContent = label;
  const val = document.createElement("div");
  val.className = extraClass ? `details-value ${extraClass}` : "details-value";
  val.textContent = value;
  section.appendChild(lbl);
  section.appendChild(val);
  panel.appendChild(section);
}

function formatDetailDate(isoDate: string): string {
  if (!isoDate) return "";
  return isoDate.slice(0, 19).replace("T", " ");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
