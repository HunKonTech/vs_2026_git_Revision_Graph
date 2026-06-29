import { t, onLangChange } from "./i18n.js";
import { computeLineDiff, type DiffRow } from "@rev-graph/graph-core";
import type { CommitChangeFile, DiffFileStatus, FileDiff } from "@rev-graph/protocol";

/**
 * The TortoiseSVN-style "Show changes" dialog: the left pane lists the files a
 * commit touched, grouped and marked by status (added / modified / deleted /
 * renamed); the right pane shows the selected file's diff. Modified files render
 * side-by-side (original | this commit); added files show only the new content,
 * deleted files only the old content.
 *
 * The dialog is data-driven by two host messages handled in main.ts:
 *  - `commitChanges` → setChangesFiles() fills the file list,
 *  - `fileDiff`      → setFileDiff() fills the right pane.
 * Selecting a file calls back into main.ts (onRequestFile) to fetch its diff.
 */
export interface ChangesDialogContext {
  /** Full sha whose changes are shown. */
  sha: string;
  /** Asked to fetch the diff of a file the user selected. */
  onRequestFile: (file: CommitChangeFile) => void;
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
  /** The path segment shown on this row (e.g. "graph-webview"). */
  name: string;
  /** Full slash-joined path from the repo root. */
  path: string;
  isFolder: boolean;
  /** The change entry, on file leaves only. */
  file?: CommitChangeFile;
  children: FileTreeNode[];
}

/**
 * Build a folder tree from the flat list of changed files, the way a file
 * explorer (or Fork) groups them: "packages/graph-webview/harness/x.js"
 * contributes the folders packages → graph-webview → harness and the file leaf.
 */
function buildFileTree(files: CommitChangeFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", isFolder: true, children: [] };
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
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
    parent.children.push({ name: leaf, path: file.path, isFolder: false, file, children: [] });
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

/** A neutral folder glyph (tinted via CSS). */
const FOLDER_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M1.5 3h4l1.2 1.6h7.8a.5.5 0 0 1 .5.5v8.4a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 1.5 3z"/></svg>';
/** A document glyph with a folded corner (tinted per file type via CSS). */
const FILE_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M9.5 1H3.5a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5L9.5 1z"/>' +
  '<path fill="rgba(0,0,0,0.35)" d="M9.5 1L13 5H10a.5.5 0 0 1-.5-.5V1z"/></svg>';

/** Map a file name to a type category, used to tint its icon (Fork-style). */
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

// Dialog state, module-scoped so the host-message handlers can update it.
let ctx: ChangesDialogContext | null = null;
let files: CommitChangeFile[] | null = null; // null = still loading
let selected: CommitChangeFile | null = null;
let diff: FileDiff | null = null; // diff for `selected`, null while loading
let listEl: HTMLElement | null = null;
let diffPaneEl: HTMLElement | null = null;
// Folders the user collapsed (by full path); folders start expanded.
let collapsed = new Set<string>();
// User-dragged width of the file-list pane, in px (null = CSS default).
let listWidth: number | null = null;

/** Close the changes dialog if open. */
export function closeChangesDialog(): void {
  if (openOverlay) {
    openOverlay.remove();
    openOverlay = null;
  }
  if (langUnsub) {
    langUnsub();
    langUnsub = null;
  }
  ctx = null;
  files = null;
  selected = null;
  diff = null;
  listEl = null;
  diffPaneEl = null;
  collapsed = new Set();
  listWidth = null;
}

/** Open the dialog for a commit; the file list arrives later via setChangesFiles. */
export function openChangesDialog(context: ChangesDialogContext): void {
  closeChangesDialog();
  ctx = context;
  files = null;
  selected = null;
  diff = null;

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
    list.appendChild(el("div", "settings-section-title", t("changes.files")));
    listEl = el("div", "changes-list-scroll");
    list.appendChild(listEl);
    renderList();

    // Drag handle: lets the user widen the file list when paths are deep.
    const resizer = el("div", "changes-resizer");
    attachResizer(resizer, list);

    const diffPane = el("div", "changes-diff");
    diffPaneEl = diffPane;
    renderDiff();

    body.append(list, resizer, diffPane);
    modal.appendChild(body);
  }

  /** Wire the splitter so dragging it resizes the file-list pane. */
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

  /** (Re)draw the left-pane file tree from the current `files`/`selected`. */
  function renderList(): void {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (files === null) {
      listEl.appendChild(el("div", "changes-empty", t("changes.loading")));
      return;
    }
    if (files.length === 0) {
      listEl.appendChild(el("div", "changes-empty", t("changes.noChanges")));
      return;
    }
    const tree = el("div", "changes-tree");
    for (const node of buildFileTree(files)) renderNode(node, tree, 0);
    listEl.appendChild(tree);
  }

  /** Render a tree node (and, for expanded folders, its children) at `depth`. */
  function renderNode(node: FileTreeNode, container: HTMLElement, depth: number): void {
    if (node.isFolder) {
      container.appendChild(folderRow(node, depth));
      if (!collapsed.has(node.path)) {
        for (const child of node.children) renderNode(child, container, depth + 1);
      }
    } else if (node.file) {
      container.appendChild(fileRow(node.file, node.name, depth));
    }
  }

  /** A folder row: chevron + folder icon + name, click to collapse/expand. */
  function folderRow(node: FileTreeNode, depth: number): HTMLElement {
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

  /** A clickable file row: type icon + name + status marker. */
  function fileRow(file: CommitChangeFile, label: string, depth: number): HTMLElement {
    const row = el("div", "changes-file");
    row.dataset.status = file.status;
    row.style.paddingLeft = `${6 + depth * 14}px`;
    if (selected && selected.path === file.path && selected.status === file.status) {
      row.classList.add("selected");
    }
    const icon = el("span", `changes-icon changes-icon-${fileCategory(label)}`);
    icon.innerHTML = FILE_SVG;
    const name = el("span", "changes-file-name", label);
    name.title = file.oldPath ? t("changes.renamedFrom", { path: file.oldPath }) : file.path;
    const mark = el("span", `changes-mark changes-mark-${file.status}`, STATUS_MARK[file.status]);
    row.append(icon, name, mark);
    row.addEventListener("click", () => selectFile(file));
    return row;
  }

  /** Select a file: highlight it, show the loading state, and fetch its diff. */
  function selectFile(file: CommitChangeFile): void {
    selected = file;
    diff = null;
    renderList();
    renderDiff();
    ctx?.onRequestFile(file);
  }

  /** (Re)draw the right-pane diff from the current `selected`/`diff`. */
  function renderDiff(): void {
    if (!diffPaneEl) return;
    diffPaneEl.innerHTML = "";
    // The diff content always lives in its own scroll container so the change
    // navigator (below) can stay pinned over it instead of scrolling away.
    const scroll = el("div", "changes-diff-scroll");
    const showEmpty = (key: Parameters<typeof t>[0]): void => {
      scroll.appendChild(el("div", "changes-empty", t(key)));
      diffPaneEl!.appendChild(scroll);
    };
    if (!selected) return showEmpty("changes.selectFile");
    if (!diff) return showEmpty("changes.loading");
    if (diff.binary) return showEmpty("changes.binary");
    if (diff.tooLarge) return showEmpty("changes.tooLarge");

    const { view, blocks } = buildDiffView(diff);
    scroll.appendChild(view);
    // Two arrows that step between change blocks (a run of consecutive changed
    // lines counts as one). Only worth showing when there's more than one.
    if (blocks.length > 1) diffPaneEl.appendChild(buildChangeNav(scroll, blocks));
    diffPaneEl.appendChild(scroll);
  }

  render();
  langUnsub = onLangChange(render);

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeChangesDialog();
  });
  document.body.appendChild(overlay);
  openOverlay = overlay;

  // Expose the renderers to the module-level setters via closure capture.
  pendingRenderList = renderList;
  pendingRenderDiff = renderDiff;
}

// The active render callbacks, captured on open so host messages can refresh the
// panes without re-opening the dialog.
let pendingRenderList: (() => void) | null = null;
let pendingRenderDiff: (() => void) | null = null;

/** Host delivered the file list for a commit (ignored if it's a stale sha). */
export function setChangesFiles(sha: string, incoming: CommitChangeFile[]): void {
  if (!ctx || ctx.sha !== sha) return;
  files = incoming;
  pendingRenderList?.();
  // Auto-select the first file so the user immediately sees a diff.
  if (incoming.length > 0 && !selected) {
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

/** Host delivered a file diff (ignored unless it matches the current selection). */
export function setFileDiff(incoming: FileDiff): void {
  if (!ctx || ctx.sha !== incoming.sha) return;
  if (!selected || selected.path !== incoming.path) return;
  diff = incoming;
  pendingRenderDiff?.();
}

/** First file in STATUS_ORDER grouping (matches the visual list order). */
function orderedFirst(list: CommitChangeFile[]): CommitChangeFile | null {
  for (const status of STATUS_ORDER) {
    const hit = list.find((f) => f.status === status);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

/** A rendered diff plus the anchor element starting each change block. */
interface DiffView {
  view: HTMLElement;
  /** First DOM cell of each change block (a run of consecutive changed lines). */
  blocks: HTMLElement[];
}

/**
 * Build the diff view. Added files show one column of new content, deleted files
 * one column of old content, everything else a two-column side-by-side diff.
 */
function buildDiffView(d: FileDiff): DiffView {
  if (d.status === "added") return singleColumn(d.newText, "add", "changes.changed");
  if (d.status === "deleted") return singleColumn(d.oldText, "del", "changes.original");
  return sideBySide(computeLineDiff(d.oldText, d.newText));
}

/** A one-sided view (added → new only, deleted → old only). */
function singleColumn(text: string, kind: "add" | "del", headerKey: "changes.original" | "changes.changed"): DiffView {
  const wrap = el("div", "diff-grid diff-grid-single");
  wrap.appendChild(headerCell(t(headerKey), 2));
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  // Every line is a change here, so the whole file is a single contiguous block.
  const blocks: HTMLElement[] = [];
  lines.forEach((line, i) => {
    const num = numCell(i + 1, kind);
    if (i === 0) blocks.push(num);
    wrap.appendChild(num);
    wrap.appendChild(codeCell(line, kind));
  });
  return { view: wrap, blocks };
}

/** A two-column side-by-side view aligned by computeLineDiff. */
function sideBySide(rows: DiffRow[]): DiffView {
  const wrap = el("div", "diff-grid diff-grid-split");
  wrap.appendChild(headerCell(t("changes.original"), 2));
  wrap.appendChild(headerCell(t("changes.changed"), 2));
  const blocks: HTMLElement[] = [];
  let inBlock = false; // are we inside a run of consecutive changed lines?
  for (const row of rows) {
    const isChange = row.kind !== "context";
    const leftKind = row.kind === "del" || row.kind === "change" ? "del" : row.kind === "context" ? "ctx" : "empty";
    const rightKind = row.kind === "add" || row.kind === "change" ? "add" : row.kind === "context" ? "ctx" : "empty";
    // The leftmost cell of this row, used as the scroll anchor for a new block.
    const anchor = row.left ? numCell(row.left.num, leftKind) : fillerCell();
    wrap.appendChild(anchor);
    wrap.appendChild(row.left ? codeCell(row.left.text, leftKind) : fillerCell());
    if (row.right) {
      wrap.appendChild(numCell(row.right.num, rightKind));
      wrap.appendChild(codeCell(row.right.text, rightKind));
    } else {
      wrap.appendChild(fillerCell());
      wrap.appendChild(fillerCell());
    }
    if (isChange && !inBlock) blocks.push(anchor); // first row of a new block
    inBlock = isChange;
  }
  return { view: wrap, blocks };
}

/**
 * Build the floating "previous / next change" navigator pinned to the top-right
 * of the diff pane. Clicking an arrow scrolls the diff so the target block sits
 * just below the sticky column headers; a counter shows position (e.g. 2 / 7).
 */
function buildChangeNav(scroll: HTMLElement, blocks: HTMLElement[]): HTMLElement {
  let index = -1; // nothing focused yet; first ▼ press lands on block 0
  const nav = el("div", "changes-nav");
  const counter = el("span", "changes-nav-count");

  const sync = (): void => {
    counter.textContent = `${Math.max(index, 0) + 1} / ${blocks.length}`;
  };
  const go = (i: number): void => {
    index = Math.max(0, Math.min(blocks.length - 1, i));
    const block = blocks[index]!;
    const blockTop = block.getBoundingClientRect().top;
    const scrollTop = scroll.getBoundingClientRect().top;
    // 48px clears the sticky "Original | This commit" header row.
    scroll.scrollTo({ top: scroll.scrollTop + (blockTop - scrollTop) - 48, behavior: "smooth" });
    sync();
  };

  const prev = button("changes-nav-btn", "▲", () => go(index <= 0 ? blocks.length - 1 : index - 1));
  prev.setAttribute("aria-label", t("changes.prevChange"));
  prev.title = t("changes.prevChange");
  const next = button("changes-nav-btn", "▼", () => go(index >= blocks.length - 1 ? 0 : index + 1));
  next.setAttribute("aria-label", t("changes.nextChange"));
  next.title = t("changes.nextChange");

  nav.append(prev, counter, next);
  sync();
  return nav;
}

type CellKind = "ctx" | "add" | "del" | "empty";

function headerCell(text: string, span: number): HTMLElement {
  const c = el("div", "diff-header", text);
  c.style.gridColumn = `span ${span}`;
  return c;
}
function numCell(num: number, kind: CellKind): HTMLElement {
  return el("div", `diff-num diff-${kind}`, String(num));
}
function codeCell(text: string, kind: CellKind): HTMLElement {
  // Render an empty line as a non-breaking space so the row keeps its height.
  return el("div", `diff-code diff-${kind}`, text === "" ? " " : text);
}
function fillerCell(): HTMLElement {
  return el("div", "diff-num diff-empty");
}

/* small DOM helpers (mirrors newBranchDialog.ts) */
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

// Dismiss on Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChangesDialog();
});
