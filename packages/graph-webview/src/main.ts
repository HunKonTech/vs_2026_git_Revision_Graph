import { createHostBridge } from "./host-bridge.js";
import { GraphView } from "./render.js";
import { showContextMenu, closeContextMenu } from "./contextMenu.js";
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
  statusBar.textContent = "Loading graph…";

  const canvas = document.createElement("div");
  canvas.className = "graph-canvas";
  canvas.style.position = "relative";
  canvas.appendChild(buildLegend());

  root.appendChild(canvas);
  root.appendChild(statusBar);

  const bridge = createHostBridge();

  const view = new GraphView(canvas, {
    onNodeContextMenu(sha, x, y) {
      showContextMenu(x, y, [
        {
          label: "Create branch from here…",
          action: () => bridge.post({ type: "createBranch", sha }),
        },
        {
          label: "Checkout this commit",
          action: () => bridge.post({ type: "checkout", sha }),
        },
        {
          label: "Copy commit SHA",
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
      case "branchCreated":
        statusBar.textContent = `Created branch "${msg.name}" at ${msg.sha.slice(0, 7)}`;
        bridge.post({ type: "requestRefresh" });
        break;
      case "error":
        statusBar.textContent = `Error: ${msg.message}`;
        break;
    }
  });

  function renderData(data: GraphData): void {
    closeContextMenu();
    view.setData(data);
    const repo = data.repoName ? `${data.repoName} — ` : "";
    statusBar.textContent = `${repo}Showing ${data.commits.length} commits, ${data.refs.length} refs`;
  }

  // Toolbar: refresh + reset view.
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.innerHTML = `
    <button data-act="refresh" title="Refresh">⟳ Refresh</button>
    <button data-act="reset" title="Reset zoom & position">⤢ Reset view</button>`;
  toolbar.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "refresh") bridge.post({ type: "requestRefresh" });
    if (act === "reset") view.resetView();
  });
  root.insertBefore(toolbar, canvas);

  bridge.post({ type: "ready" });
}

function buildLegend(): HTMLElement {
  const items: { cls: string; label: string }[] = [
    { cls: "head",   label: "HEAD / aktuális branch" },
    { cls: "local",  label: "Lokális branch" },
    { cls: "remote", label: "Távoli branch (remote)" },
    { cls: "tag",    label: "Tag (verzió)" },
    { cls: "commit", label: "Commit" },
  ];

  const legend = document.createElement("div");
  legend.className = "legend";

  const header = document.createElement("div");
  header.className = "legend-header";
  header.innerHTML = `<span>Jelmagyarázat</span><span class="legend-toggle">▲</span>`;
  legend.appendChild(header);

  const body = document.createElement("div");
  body.className = "legend-body";
  for (const { cls, label } of items) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<span class="legend-swatch ${cls}"></span><span>${label}</span>`;
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

  return legend;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
