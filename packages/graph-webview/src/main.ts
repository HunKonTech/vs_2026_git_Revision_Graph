import { createHostBridge } from "./host-bridge.js";
import { GraphView } from "./render.js";
import { showContextMenu, closeContextMenu } from "./contextMenu.js";
import { toggleSettings, closeSettings } from "./settings.js";
import { getMainBranch, onMainBranchChange } from "./mainBranch.js";
import { getDisplayMode, onDisplayModeChange } from "./displayMode.js";
import { t, onLangChange, type MsgKey } from "./i18n.js";
import type { GraphData, ThemeTokens } from "@rev-graph/protocol";
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
    onNodeContextMenu(sha, x, y) {
      showContextMenu(x, y, [
        {
          label: t("menu.createBranch"),
          action: () => bridge.post({ type: "createBranch", sha }),
        },
        {
          label: t("menu.checkout"),
          action: () => bridge.post({ type: "checkout", sha }),
        },
        {
          label: t("menu.copySha"),
          separatorBefore: true,
          action: () => bridge.post({ type: "copySha", sha }),
        },
      ]);
    },
    onNodeDblClick(sha) {
      bridge.post({ type: "checkout", sha });
    },
    onNodeClick(commit) {
      showCommitDetails(detailsPanel, commit, currentHead);
    },
  });

  view.setTheme(DEFAULT_THEME);
  view.setMode(getDisplayMode());

  bridge.onMessage((msg) => {
    switch (msg.type) {
      case "setData":
        renderData(msg.data);
        break;
      case "setTheme":
        view.setTheme(msg.theme);
        break;
      case "branchCreated": {
        const name = msg.name;
        const sha = msg.sha.slice(0, 7);
        renderStatus(() => t("status.branchCreated", { name, sha }));
        bridge.post({ type: "requestRefresh" });
        break;
      }
      case "error": {
        const message = msg.message;
        renderStatus(() => t("status.error", { message }));
        break;
      }
    }
  });

  function renderData(data: GraphData): void {
    closeContextMenu();
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

  // Branch names (local + remote) available for the "main branch" picker.
  function branchNames(): string[] {
    if (!lastData) return [];
    return lastData.refs
      .filter((r) => r.type === "localBranch" || r.type === "remoteBranch")
      .map((r) => r.name);
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
  const resetBtn = makeButton("reset", "toolbar.reset");
  const settingsBtn = makeButton("settings", "toolbar.settings");
  toolbar.append(refreshBtn, fetchBtn, pullBtn, pushBtn, syncBtn, resetBtn, settingsBtn);
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
    if (act === "reset") view.resetView();
    if (act === "settings") toggleSettings({ branches: branchNames() });
  });
  root.insertBefore(toolbar, mainContent);

  // Re-render all static text when the language changes.
  onLangChange(() => {
    closeSettings();
    closeContextMenu();
    refreshBtn.textContent = t("toolbar.refresh");
    fetchBtn.textContent = t("toolbar.fetch");
    pullBtn.textContent = t("toolbar.pull");
    pushBtn.textContent = t("toolbar.push");
    syncBtn.textContent = t("toolbar.sync");
    resetBtn.textContent = t("toolbar.reset");
    settingsBtn.textContent = t("toolbar.settings");
    relabelLegend(legend);
    statusBar.textContent = statusFn();
  });

  bridge.post({ type: "ready" });
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
  { cls: "tag", key: "legend.tag" },
  { cls: "commit", key: "legend.commit" },
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
  header.textContent = t("details.header");
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
