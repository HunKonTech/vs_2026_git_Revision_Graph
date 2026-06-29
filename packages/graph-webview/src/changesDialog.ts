import { t, onLangChange } from "./i18n.js";
import { getDiffMinimap, onDiffMinimapChange } from "./diffMinimap.js";
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
let minimapUnsub: (() => void) | null = null;
// Tears down the current diff's minimap strips (listeners + DOM); null when none.
let minimapCleanup: (() => void) | null = null;

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
  if (minimapUnsub) {
    minimapUnsub();
    minimapUnsub = null;
  }
  minimapCleanup?.();
  minimapCleanup = null;
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

    const minimapOn = getDiffMinimap();
    const { view, blocks, minimaps } = buildDiffView(diff, minimapOn);
    scroll.appendChild(view);
    diffPaneEl.appendChild(scroll);
    // Overview strips (must come after the scroll container is in the DOM so they
    // can measure their gutter columns). Tear down any from a previous render.
    minimapCleanup?.();
    minimapCleanup = minimapOn ? attachMinimaps(diffPaneEl, scroll, minimaps) : null;
    // Two arrows that step between change blocks (a run of consecutive changed
    // lines counts as one). Only worth showing when there's more than one. Nudge
    // them left of the minimap gutter so they don't sit on top of it.
    if (blocks.length > 1) {
      diffPaneEl.appendChild(buildChangeNav(scroll, blocks, minimapOn ? MM_W + 10 : 14));
    }
  }

  render();
  langUnsub = onLangChange(render);
  // Redraw the diff pane when the minimap setting is toggled in Settings.
  minimapUnsub = onDiffMinimapChange(() => renderDiff());

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

/** Minimap gutter width in px — must match `.diff-minimap` width in style.css. */
const MM_W = 56;

/** One row of the minimap overview, mirroring one rendered diff row on one side. */
interface MiniRow {
  kind: CellKind;
  /** The line's text — drawn as little word blocks so the strip looks like code. */
  text: string;
}
/** A minimap overview for one side of the diff (the old/left or new/right column). */
interface MinimapSpec {
  side: "left" | "right";
  rows: MiniRow[];
}

/** A rendered diff plus the anchor element starting each change block. */
interface DiffView {
  view: HTMLElement;
  /** First DOM cell of each change block (a run of consecutive changed lines). */
  blocks: HTMLElement[];
  /** Minimap overviews to draw beside the diff (empty when the minimap is off). */
  minimaps: MinimapSpec[];
}

/**
 * Build the diff view. Added files show one column of new content, deleted files
 * one column of old content, everything else a two-column side-by-side diff.
 *
 * When `minimap` is on, each content column reserves a gutter column (so the
 * overview strip never covers code) and a {@link MinimapSpec} is produced for it:
 * both sides for a modification, only the new (right) side for an addition, only
 * the old (left) side for a deletion.
 */
function buildDiffView(d: FileDiff, minimap: boolean): DiffView {
  if (d.status === "added") return singleColumn(d.newText, "add", "changes.changed", minimap);
  if (d.status === "deleted") return singleColumn(d.oldText, "del", "changes.original", minimap);
  return sideBySide(computeLineDiff(d.oldText, d.newText), minimap);
}

/** Append a fixed-width gutter cell reserving room for a minimap strip. */
function spacerCell(anchor?: "mid" | "end"): HTMLElement {
  const c = el("div", "diff-spacer");
  if (anchor) c.classList.add(`diff-mm-anchor-${anchor}`);
  return c;
}

/** A one-sided view (added → new only, deleted → old only). */
function singleColumn(
  text: string,
  kind: "add" | "del",
  headerKey: "changes.original" | "changes.changed",
  minimap: boolean,
): DiffView {
  const wrap = el("div", "diff-grid diff-grid-single");
  if (minimap) {
    wrap.classList.add("has-minimap");
    wrap.style.setProperty("--mm-w", `${MM_W}px`);
  }
  wrap.appendChild(headerCell(t(headerKey), 2));
  if (minimap) wrap.appendChild(spacerCell("end"));
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  // Every line is a change here, so the whole file is a single contiguous block.
  const blocks: HTMLElement[] = [];
  const mini: MiniRow[] = [];
  lines.forEach((line, i) => {
    const num = numCell(i + 1, kind);
    if (i === 0) blocks.push(num);
    wrap.appendChild(num);
    wrap.appendChild(codeCell(line, kind));
    if (minimap) wrap.appendChild(spacerCell());
    mini.push({ kind, text: line });
  });
  // Addition → new (right) strip; deletion → old (left) strip.
  const minimaps = minimap ? [{ side: kind === "add" ? "right" : "left", rows: mini } as MinimapSpec] : [];
  return { view: wrap, blocks, minimaps };
}

/** A two-column side-by-side view aligned by computeLineDiff. */
function sideBySide(rows: DiffRow[], minimap: boolean): DiffView {
  const wrap = el("div", "diff-grid diff-grid-split");
  if (minimap) {
    wrap.classList.add("has-minimap");
    wrap.style.setProperty("--mm-w", `${MM_W}px`);
  }
  wrap.appendChild(headerCell(t("changes.original"), 2));
  if (minimap) wrap.appendChild(spacerCell("mid"));
  wrap.appendChild(headerCell(t("changes.changed"), 2));
  if (minimap) wrap.appendChild(spacerCell("end"));
  const blocks: HTMLElement[] = [];
  const leftMini: MiniRow[] = [];
  const rightMini: MiniRow[] = [];
  let inBlock = false; // are we inside a run of consecutive changed lines?
  for (const row of rows) {
    const isChange = row.kind !== "context";
    const leftKind = row.kind === "del" || row.kind === "change" ? "del" : row.kind === "context" ? "ctx" : "empty";
    const rightKind = row.kind === "add" || row.kind === "change" ? "add" : row.kind === "context" ? "ctx" : "empty";
    // The leftmost cell of this row, used as the scroll anchor for a new block.
    const anchor = row.left ? numCell(row.left.num, leftKind) : fillerCell();
    wrap.appendChild(anchor);
    wrap.appendChild(row.left ? codeCell(row.left.text, leftKind) : fillerCell());
    if (minimap) wrap.appendChild(spacerCell());
    if (row.right) {
      wrap.appendChild(numCell(row.right.num, rightKind));
      wrap.appendChild(codeCell(row.right.text, rightKind));
    } else {
      wrap.appendChild(fillerCell());
      wrap.appendChild(fillerCell());
    }
    if (minimap) wrap.appendChild(spacerCell());
    if (isChange && !inBlock) blocks.push(anchor); // first row of a new block
    inBlock = isChange;
    leftMini.push({ kind: leftKind, text: row.left?.text ?? "" });
    rightMini.push({ kind: rightKind, text: row.right?.text ?? "" });
  }
  const minimaps: MinimapSpec[] = minimap
    ? [
        { side: "left", rows: leftMini },
        { side: "right", rows: rightMini },
      ]
    : [];
  return { view: wrap, blocks, minimaps };
}

/**
 * Attach the minimap overview strips to the diff pane. Each strip is a miniature
 * of the whole file (faint line bars, added lines green / removed lines red),
 * pinned full-height over its gutter column. A viewport box tracks what's
 * visible and follows the diff as it scrolls; grabbing and dragging the strip
 * scrolls the diff. Returns a cleanup that removes the strips and listeners.
 */
function attachMinimaps(pane: HTMLElement, scroll: HTMLElement, specs: MinimapSpec[]): () => void {
  if (specs.length === 0) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const twoSided = specs.length > 1;
  // Target minimap px per source line (kept small so the strip reads like code,
  // never a stack of fat blocks). Lines wider than this many columns are clipped.
  const MM_ROW = 4;
  const MM_COLS = 48;

  const built = specs.map((spec) => {
    const container = el("div", "diff-minimap");
    container.dataset.side = spec.side;
    const canvas = document.createElement("canvas");
    canvas.className = "diff-minimap-canvas";
    const viewport = el("div", "diff-minimap-viewport");
    container.append(canvas, viewport);
    pane.appendChild(container);
    return { spec, container, canvas, viewport };
  });

  // Shared scroll→minimap geometry, recomputed on every (re)layout. `scale` is
  // minimap px per *content* px, capped so the whole file always fits the strip
  // (so short files stay compact at the top, exactly like the VS Code minimap).
  let scale = 0;
  let headerH = 0;
  let realRowH = 1;
  const recompute = (): void => {
    const header = scroll.querySelector(".diff-header") as HTMLElement | null;
    headerH = header ? header.offsetHeight : 0;
    const numRows = built[0] ? built[0].spec.rows.length : 0;
    const scrollH = scroll.scrollHeight || 1;
    realRowH = numRows > 0 ? (scrollH - headerH) / numRows : scrollH;
    const paneH = pane.clientHeight || 1;
    scale = Math.min(MM_ROW / Math.max(realRowH, 1), paneH / scrollH);
  };

  const updateViewport = (b: (typeof built)[number]): void => {
    // The visible window [scrollTop, scrollTop+clientHeight] in minimap px.
    b.viewport.style.top = `${scroll.scrollTop * scale}px`;
    b.viewport.style.height = `${Math.max(14, scroll.clientHeight * scale)}px`;
  };

  const draw = (b: (typeof built)[number]): void => {
    const w = b.container.clientWidth;
    const h = b.container.clientHeight;
    const cx = b.canvas.getContext("2d");
    if (!cx || w === 0 || h === 0) return;
    b.canvas.width = Math.round(w * dpr);
    b.canvas.height = Math.round(h * dpr);
    b.canvas.style.width = `${w}px`;
    b.canvas.style.height = `${h}px`;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, w, h);
    const rows = b.spec.rows;
    if (rows.length === 0) return;
    const miniRowH = realRowH * scale; // minimap px per line
    const barH = Math.max(1, miniRowH * 0.78);
    const charW = (w - 6) / MM_COLS;
    rows.forEach((r, i) => {
      if (r.kind === "empty") return;
      const y = (headerH + i * realRowH) * scale; // line's top, in minimap px
      if (r.kind === "add" || r.kind === "del") {
        cx.fillStyle = r.kind === "add" ? "rgba(46,160,67,0.16)" : "rgba(248,81,73,0.16)";
        cx.fillRect(0, y, w, Math.max(miniRowH, 1.4));
      }
      cx.fillStyle =
        r.kind === "add" ? "rgba(46,160,67,0.95)" : r.kind === "del" ? "rgba(248,81,73,0.95)" : "rgba(150,150,150,0.5)";
      // Draw each run of non-space characters as a little block, so indentation
      // and word shapes show — the minimap then mirrors the real code layout.
      const text = r.text;
      const n = Math.min(text.length, 240);
      const top = y + (miniRowH - barH) / 2;
      let col = 0;
      let runStart = -1;
      for (let k = 0; k <= n; k++) {
        const ch = k < n ? text[k]! : " ";
        const isWord = ch !== " " && ch !== "\t";
        if (isWord && runStart < 0) runStart = col;
        if (!isWord && runStart >= 0) {
          const x = 3 + Math.min(runStart, MM_COLS) * charW;
          const ww = Math.max(charW * 0.6, (Math.min(col, MM_COLS) - runStart) * charW);
          cx.fillRect(x, top, Math.min(ww, w - 3 - x), barH);
          runStart = -1;
        }
        col += ch === "\t" ? 4 : 1;
        if (col > MM_COLS) break;
      }
    });
  };

  const anchorLeft = (sel: string): number | null => {
    const a = scroll.querySelector(sel);
    if (!a) return null;
    return (a as HTMLElement).getBoundingClientRect().left - pane.getBoundingClientRect().left;
  };

  const layout = (): void => {
    const h = pane.clientHeight;
    const midLeft = twoSided ? anchorLeft(".diff-mm-anchor-mid") : null;
    recompute();
    for (const b of built) {
      b.container.style.height = `${h}px`;
      if (twoSided && b.spec.side === "left" && midLeft != null) {
        b.container.style.left = `${midLeft}px`;
        b.container.style.right = "";
      } else {
        b.container.style.right = "0px";
        b.container.style.left = "";
      }
      draw(b);
      updateViewport(b);
    }
  };

  const onScroll = (): void => {
    for (const b of built) updateViewport(b);
  };
  scroll.addEventListener("scroll", onScroll, { passive: true });

  // Grab-and-drag: clicking or dragging anywhere on a strip centers the diff's
  // visible window on that point, so the strip behaves like a scrollbar thumb.
  for (const b of built) {
    const scrollToY = (clientY: number): void => {
      const rect = b.container.getBoundingClientRect();
      const ch = scroll.clientHeight;
      const contentY = scale > 0 ? (clientY - rect.top) / scale : 0; // minimap px → content px
      const target = contentY - ch / 2;
      scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - ch, target));
      onScroll(); // move the box immediately rather than waiting for the scroll event
    };
    let dragging = false;
    b.container.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      b.container.setPointerCapture(e.pointerId);
      scrollToY(e.clientY);
    });
    b.container.addEventListener("pointermove", (e) => {
      if (dragging) scrollToY(e.clientY);
    });
    const end = (e: PointerEvent): void => {
      dragging = false;
      try {
        b.container.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }
    };
    b.container.addEventListener("pointerup", end);
    b.container.addEventListener("pointercancel", end);
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(pane);
  // Lay out immediately — reading geometry forces a reflow, so this works even
  // when requestAnimationFrame is throttled (e.g. a backgrounded tab). The rAF
  // pass re-runs once after paint in case line wrapping or fonts shift heights.
  layout();
  requestAnimationFrame(layout);

  return () => {
    ro.disconnect();
    scroll.removeEventListener("scroll", onScroll);
    for (const b of built) b.container.remove();
  };
}

/**
 * Build the floating "previous / next change" navigator pinned to the top-right
 * of the diff pane. Clicking an arrow scrolls the diff so the target block sits
 * just below the sticky column headers; a counter shows position (e.g. 2 / 7).
 */
function buildChangeNav(scroll: HTMLElement, blocks: HTMLElement[], rightPx: number): HTMLElement {
  let index = -1; // nothing focused yet; first ▼ press lands on block 0
  const nav = el("div", "changes-nav");
  nav.style.right = `${rightPx}px`;
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
