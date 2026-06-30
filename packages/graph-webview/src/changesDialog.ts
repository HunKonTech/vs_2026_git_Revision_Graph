import { t, onLangChange } from "./i18n.js";
import { getDiffMinimap, onDiffMinimapChange } from "./diffMinimap.js";
import { buildDiffView, attachMinimaps, buildChangeNav, MM_W } from "./diffView.js";
import type { CommitChangeFile, DiffFileStatus, FileDiff } from "@rev-graph/protocol";

/**
 * The TortoiseSVN-style "Show changes" dialog: the left pane lists the files a
 * commit touched with two tabs:
 *  - "Changed": only the files this commit modified (grouped by status)
 *  - "All Files": every file in the commit's tree, with changed ones still marked
 * The right pane shows the selected file's diff (for changed files) or its raw
 * content (for unchanged files).
 *
 * The dialog is data-driven by host messages handled in main.ts:
 *  - `commitChanges`   → setChangesFiles() fills the changed-files list,
 *  - `commitTree`      → setCommitTree() fills the all-files list,
 *  - `fileDiff`        → setFileDiff() fills the right pane for a changed file,
 *  - `fileContent`     → setFileContent() fills the right pane for an unchanged file.
 * Selecting a changed file calls back into main.ts (onRequestFile).
 * Selecting an unchanged file calls back (onRequestFileContent).
 */
export interface ChangesDialogContext {
  sha: string;
  onRequestFile: (file: CommitChangeFile) => void;
  onRequestFileContent: (path: string) => void;
}

/** Status priority used to pick the auto-selected first file. */
const STATUS_ORDER: DiffFileStatus[] = ["added", "modified", "renamed", "deleted"];
/** Single-letter badge per status. */
const STATUS_MARK: Record<DiffFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/** A node in the file tree: either a folder (with children) or a file leaf. */
interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  /** The change entry, on changed file leaves only. */
  file?: CommitChangeFile;
  children: FileTreeNode[];
}

/**
 * Build a folder tree from a flat list of file paths. Changed files carry their
 * CommitChangeFile; unchanged files have no `file` property.
 */
function buildFileTree(
  paths: string[],
  changedByPath: Map<string, CommitChangeFile>,
): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", isFolder: true, children: [] };
  for (const filePath of paths) {
    const segments = filePath.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let parent = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const path = parent.path ? `${parent.path}/${seg}` : seg;
      let folder = parent.children.find((c) => c.isFolder && c.name === seg);
      if (!folder) {
        folder = { name: seg, path, isFolder: true, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
    const leaf = segments[segments.length - 1]!;
    parent.children.push({
      name: leaf,
      path: filePath,
      isFolder: false,
      file: changedByPath.get(filePath),
      children: [],
    });
  }
  sortTree(root);
  return root.children;
}

/** Sort folders before files, each alphabetically (case-insensitive), in place. */
function sortTree(node: FileTreeNode): void {
  node.children.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const child of node.children) sortTree(child);
}

const FOLDER_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M1.5 3h4l1.2 1.6h7.8a.5.5 0 0 1 .5.5v8.4a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 1.5 3z"/></svg>';
const FILE_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M9.5 1H3.5a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5L9.5 1z"/>' +
  '<path fill="rgba(0,0,0,0.35)" d="M9.5 1L13 5H10a.5.5 0 0 1-.5-.5V1z"/></svg>';

function fileCategory(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["js", "mjs", "cjs", "jsx"].includes(ext)) return "js";
  if (["ts", "tsx"].includes(ext)) return "ts";
  if (ext === "json") return "json";
  if (["md", "markdown"].includes(ext)) return "md";
  if (["css", "scss", "less"].includes(ext)) return "css";
  if (["html", "htm"].includes(ext)) return "html";
  if (ext === "cs") return "cs";
  if (["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"].includes(ext)) return "img";
  return "default";
}

let openOverlay: HTMLElement | null = null;
let langUnsub: (() => void) | null = null;
let minimapUnsub: (() => void) | null = null;
let minimapCleanup: (() => void) | null = null;

// Dialog state, module-scoped so host-message handlers can update it.
let ctx: ChangesDialogContext | null = null;
/** Changed files (null = still loading). */
let files: CommitChangeFile[] | null = null;
/** All paths in the commit's tree (null = not yet requested/received). */
let allPaths: string[] | null = null;
/** Active tab. */
let activeTab: "changed" | "all" = "changed";
/** Selected changed file (drives the diff pane). */
let selected: CommitChangeFile | null = null;
/** Selected unchanged file path (drives the content pane). */
let selectedPath: string | null = null;
/** Diff for the selected changed file. */
let diff: FileDiff | null = null;
/** Content for the selected unchanged file. */
interface FileContentState {
  text: string;
  binary?: boolean;
  tooLarge?: boolean;
}
let fileContent: FileContentState | null = null;
let listEl: HTMLElement | null = null;
let diffPaneEl: HTMLElement | null = null;
let collapsed = new Set<string>();
let listWidth: number | null = null;

export function closeChangesDialog(): void {
  if (openOverlay) {
    openOverlay.remove();
    openOverlay = null;
  }
  if (langUnsub) { langUnsub(); langUnsub = null; }
  if (minimapUnsub) { minimapUnsub(); minimapUnsub = null; }
  minimapCleanup?.();
  minimapCleanup = null;
  ctx = null;
  files = null;
  allPaths = null;
  activeTab = "changed";
  selected = null;
  selectedPath = null;
  diff = null;
  fileContent = null;
  listEl = null;
  diffPaneEl = null;
  collapsed = new Set();
  listWidth = null;
}

export function openChangesDialog(context: ChangesDialogContext): void {
  closeChangesDialog();
  ctx = context;

  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  const modal = document.createElement("div");
  modal.className = "settings-modal changes-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  overlay.appendChild(modal);

  function render(): void {
    if (!ctx) return;
    modal.innerHTML = "";

    // ---- Header ----
    const header = el("div", "settings-modal-header");
    header.appendChild(el("span", "settings-modal-title", t("changes.title", { sha: ctx.sha.slice(0, 7) })));
    const closeBtn = button("settings-close-x", "×", closeChangesDialog);
    closeBtn.setAttribute("aria-label", t("changes.close"));
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // ---- Body: file list (left) + diff (right) ----
    const body = el("div", "changes-body");

    const list = el("div", "changes-list");
    if (listWidth != null) list.style.flexBasis = `${listWidth}px`;

    // Tabs row
    const tabs = el("div", "changes-tabs");
    const changedCount = files !== null ? files.length : null;
    const changedLabel =
      changedCount !== null
        ? `${t("changes.tabChanged")} (${changedCount})`
        : t("changes.tabChanged");
    const tabChanged = button(
      "changes-tab" + (activeTab === "changed" ? " changes-tab-active" : ""),
      changedLabel,
      () => {
        if (activeTab === "changed") return;
        activeTab = "changed";
        selectedPath = null;
        fileContent = null;
        renderList();
        renderDiff();
        renderTabs();
      },
    );
    const tabAll = button(
      "changes-tab" + (activeTab === "all" ? " changes-tab-active" : ""),
      t("changes.tabAll"),
      () => {
        if (activeTab === "all") return;
        activeTab = "all";
        selected = null;
        diff = null;
        renderList();
        renderDiff();
        renderTabs();
      },
    );
    tabs.append(tabChanged, tabAll);
    list.appendChild(tabs);

    listEl = el("div", "changes-list-scroll");
    list.appendChild(listEl);
    renderList();

    const resizer = el("div", "changes-resizer");
    attachResizer(resizer, list);

    const diffPane = el("div", "changes-diff");
    diffPaneEl = diffPane;
    renderDiff();

    body.append(list, resizer, diffPane);
    modal.appendChild(body);

    // Keep a reference to the tabs container so renderTabs() can update it.
    currentTabsEl = tabs;
    currentTabChangedBtn = tabChanged;
    currentTabAllBtn = tabAll;
  }

  function attachResizer(handle: HTMLElement, list: HTMLElement): void {
    handle.addEventListener("mousedown", (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startW = list.getBoundingClientRect().width;
      const onMove = (move: MouseEvent): void => {
        const next = Math.max(140, Math.min(640, startW + (move.clientX - startX)));
        listWidth = next;
        list.style.flexBasis = `${next}px`;
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  function renderList(): void {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (activeTab === "changed") {
      renderChangedTab();
    } else {
      renderAllTab();
    }
  }

  function renderChangedTab(): void {
    if (!listEl) return;
    if (files === null) {
      listEl.appendChild(el("div", "changes-empty", t("changes.loading")));
      return;
    }
    if (files.length === 0) {
      listEl.appendChild(el("div", "changes-empty", t("changes.noChanges")));
      return;
    }
    // Build tree from changed files only.
    const changedByPath = new Map<string, CommitChangeFile>(files.map((f) => [f.path, f]));
    const tree = el("div", "changes-tree");
    for (const node of buildFileTree(files.map((f) => f.path), changedByPath))
      renderNode(node, tree, 0, true);
    listEl.appendChild(tree);
  }

  function renderAllTab(): void {
    if (!listEl) return;
    if (allPaths === null) {
      listEl.appendChild(el("div", "changes-empty", t("changes.loading")));
      return;
    }
    const changedByPath = new Map<string, CommitChangeFile>(
      (files ?? []).map((f) => [f.path, f]),
    );
    const tree = el("div", "changes-tree");
    for (const node of buildFileTree(allPaths, changedByPath))
      renderNode(node, tree, 0, false);
    listEl.appendChild(tree);
  }

  function renderNode(
    node: FileTreeNode,
    container: HTMLElement,
    depth: number,
    changedOnly: boolean,
  ): void {
    if (node.isFolder) {
      container.appendChild(folderRow(node, depth, changedOnly));
      if (!collapsed.has(node.path)) {
        for (const child of node.children)
          renderNode(child, container, depth + 1, changedOnly);
      }
    } else {
      if (node.file) {
        container.appendChild(fileRow(node.file, node.name, depth));
      } else {
        container.appendChild(staticFileRow(node.path, node.name, depth));
      }
    }
  }

  function folderRow(node: FileTreeNode, depth: number, changedOnly: boolean): HTMLElement {
    const row = el("div", "changes-folder");
    row.style.paddingLeft = `${6 + depth * 14}px`;
    const isCollapsed = collapsed.has(node.path);
    row.appendChild(el("span", "changes-chevron", isCollapsed ? "▸" : "▾"));
    const icon = el("span", "changes-icon changes-icon-folder");
    icon.innerHTML = FOLDER_SVG;
    row.appendChild(icon);
    row.appendChild(el("span", "changes-folder-name", node.name));
    row.addEventListener("click", () => {
      if (collapsed.has(node.path)) collapsed.delete(node.path);
      else collapsed.add(node.path);
      renderList();
    });
    return row;
  }

  function fileRow(file: CommitChangeFile, label: string, depth: number): HTMLElement {
    const row = el("div", "changes-file");
    row.dataset.status = file.status;
    row.style.paddingLeft = `${6 + depth * 14}px`;
    const isSelected =
      selectedPath === null &&
      selected &&
      selected.path === file.path &&
      selected.status === file.status;
    if (isSelected) row.classList.add("selected");
    const icon = el("span", `changes-icon changes-icon-${fileCategory(label)}`);
    icon.innerHTML = FILE_SVG;
    const name = el("span", "changes-file-name", label);
    name.title = file.oldPath ? t("changes.renamedFrom", { path: file.oldPath }) : file.path;
    const mark = el("span", `changes-mark changes-mark-${file.status}`, STATUS_MARK[file.status]);
    row.append(icon, name, mark);
    row.addEventListener("click", () => selectChangedFile(file));
    return row;
  }

  /** A row for a file that exists in the tree but was NOT changed by this commit. */
  function staticFileRow(filePath: string, label: string, depth: number): HTMLElement {
    const row = el("div", "changes-file changes-file-static");
    row.style.paddingLeft = `${6 + depth * 14}px`;
    if (selectedPath === filePath) row.classList.add("selected");
    const icon = el("span", `changes-icon changes-icon-${fileCategory(label)}`);
    icon.innerHTML = FILE_SVG;
    const name = el("span", "changes-file-name", label);
    name.title = filePath;
    row.append(icon, name);
    row.addEventListener("click", () => selectUnchangedFile(filePath));
    return row;
  }

  function selectChangedFile(file: CommitChangeFile): void {
    selected = file;
    selectedPath = null;
    fileContent = null;
    diff = null;
    renderList();
    renderDiff();
    ctx?.onRequestFile(file);
  }

  function selectUnchangedFile(path: string): void {
    selectedPath = path;
    selected = null;
    diff = null;
    fileContent = null;
    renderList();
    renderDiff();
    ctx?.onRequestFileContent(path);
  }

  function renderDiff(): void {
    if (!diffPaneEl) return;
    diffPaneEl.innerHTML = "";
    const scroll = el("div", "changes-diff-scroll");
    const showEmpty = (key: Parameters<typeof t>[0]): void => {
      scroll.appendChild(el("div", "changes-empty", t(key)));
      diffPaneEl!.appendChild(scroll);
    };

    if (selectedPath !== null) {
      // Viewing an unchanged file — show its raw content.
      if (!fileContent) return showEmpty("changes.loading");
      if (fileContent.binary) return showEmpty("changes.binary");
      if (fileContent.tooLarge) return showEmpty("changes.tooLarge");
      scroll.appendChild(buildContentView(selectedPath, fileContent.text));
      diffPaneEl.appendChild(scroll);
      return;
    }

    if (!selected) return showEmpty("changes.selectFile");
    if (!diff) return showEmpty("changes.loading");
    if (diff.binary) return showEmpty("changes.binary");
    if (diff.tooLarge) return showEmpty("changes.tooLarge");

    const minimapOn = getDiffMinimap();
    const { view, blocks, minimaps } = buildDiffView(diff, minimapOn);
    scroll.appendChild(view);
    diffPaneEl.appendChild(scroll);
    minimapCleanup?.();
    minimapCleanup = minimapOn ? attachMinimaps(diffPaneEl, scroll, minimaps) : null;
    if (blocks.length > 1) {
      diffPaneEl.appendChild(buildChangeNav(scroll, blocks, minimapOn ? MM_W + 10 : 14));
    }
  }

  render();
  langUnsub = onLangChange(render);
  minimapUnsub = onDiffMinimapChange(() => renderDiff());

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeChangesDialog();
  });
  document.body.appendChild(overlay);
  openOverlay = overlay;

  pendingRenderList = renderList;
  pendingRenderDiff = renderDiff;
  pendingRenderTabs = renderTabs;
}

// References to the tab buttons, updated by render() so renderTabs() can update
// them without re-building the entire dialog.
let currentTabsEl: HTMLElement | null = null;
let currentTabChangedBtn: HTMLButtonElement | null = null;
let currentTabAllBtn: HTMLButtonElement | null = null;

/** Update only the tab button labels/states without re-rendering the whole dialog. */
function renderTabs(): void {
  if (!currentTabChangedBtn || !currentTabAllBtn) return;
  const changedCount = files !== null ? files.length : null;
  const changedLabel =
    changedCount !== null
      ? `${t("changes.tabChanged")} (${changedCount})`
      : t("changes.tabChanged");
  currentTabChangedBtn.textContent = changedLabel;
  currentTabChangedBtn.className =
    "changes-tab" + (activeTab === "changed" ? " changes-tab-active" : "");
  currentTabAllBtn.textContent = t("changes.tabAll");
  currentTabAllBtn.className =
    "changes-tab" + (activeTab === "all" ? " changes-tab-active" : "");
}

let pendingRenderList: (() => void) | null = null;
let pendingRenderDiff: (() => void) | null = null;
let pendingRenderTabs: (() => void) | null = null;

export function setChangesFiles(sha: string, incoming: CommitChangeFile[]): void {
  if (!ctx || ctx.sha !== sha) return;
  files = incoming;
  pendingRenderTabs?.();
  if (activeTab === "changed") pendingRenderList?.();
  // Auto-select the first changed file so the user immediately sees a diff.
  if (incoming.length > 0 && !selected && !selectedPath) {
    const first = orderedFirst(incoming);
    if (first) {
      selected = first;
      diff = null;
      pendingRenderList?.();
      pendingRenderDiff?.();
      ctx.onRequestFile(first);
    }
  }
}

export function setCommitTree(sha: string, paths: string[]): void {
  if (!ctx || ctx.sha !== sha) return;
  allPaths = paths;
  if (activeTab === "all") pendingRenderList?.();
}

export function setFileDiff(incoming: FileDiff): void {
  if (!ctx || ctx.sha !== incoming.sha) return;
  if (!selected || selected.path !== incoming.path) return;
  diff = incoming;
  pendingRenderDiff?.();
}

export function setFileContent(
  sha: string,
  path: string,
  text: string,
  binary?: boolean,
  tooLarge?: boolean,
): void {
  if (!ctx || ctx.sha !== sha) return;
  if (selectedPath !== path) return;
  fileContent = { text, binary, tooLarge };
  pendingRenderDiff?.();
}

function orderedFirst(list: CommitChangeFile[]): CommitChangeFile | null {
  for (const status of STATUS_ORDER) {
    const hit = list.find((f) => f.status === status);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

/**
 * A simple single-column file-content viewer using the same diff grid CSS,
 * but with neutral (no red/green) line styling — for unchanged files.
 */
function buildContentView(filePath: string, text: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "diff-grid diff-grid-single";
  const hdr = document.createElement("div");
  hdr.className = "diff-header";
  hdr.style.gridColumn = "span 2";
  hdr.textContent = filePath;
  wrap.appendChild(hdr);
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const numEl = document.createElement("div");
    numEl.className = "diff-num diff-ctx";
    numEl.textContent = String(i + 1);
    wrap.appendChild(numEl);
    const codeEl = document.createElement("div");
    codeEl.className = "diff-code diff-ctx";
    codeEl.textContent = lines[i] || " ";
    wrap.appendChild(codeEl);
  }
  return wrap;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChangesDialog();
});
