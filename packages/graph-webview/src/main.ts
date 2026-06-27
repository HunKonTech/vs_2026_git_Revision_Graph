import { createHostBridge } from "./host-bridge.js";
import { GraphView } from "./render.js";
import { showContextMenu, closeContextMenu } from "./contextMenu.js";
import { toggleSettings, closeSettings } from "./settings.js";
import { t, onLangChange, type MsgKey } from "./i18n.js";
import type { GraphData, ThemeTokens } from "@rev-graph/protocol";
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

  root.appendChild(canvas);
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
  });

  view.setTheme(DEFAULT_THEME);

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
    view.setData(data);
    renderStatus(() =>
      t("status.summary", {
        repo: data.repoName ? `${data.repoName} — ` : "",
        commits: data.commits.length,
        refs: data.refs.length,
      }),
    );
  }

  // Toolbar: refresh + reset view + settings.
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const refreshBtn = makeButton("refresh", "toolbar.refresh");
  const resetBtn = makeButton("reset", "toolbar.reset");
  const settingsBtn = makeButton("settings", "toolbar.settings");
  toolbar.append(refreshBtn, resetBtn, settingsBtn);
  toolbar.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "refresh") bridge.post({ type: "requestRefresh" });
    if (act === "reset") view.resetView();
    if (act === "settings") toggleSettings(toolbar);
  });
  root.insertBefore(toolbar, canvas);

  // Re-render all static text when the language changes.
  onLangChange(() => {
    closeSettings();
    closeContextMenu();
    refreshBtn.textContent = t("toolbar.refresh");
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
