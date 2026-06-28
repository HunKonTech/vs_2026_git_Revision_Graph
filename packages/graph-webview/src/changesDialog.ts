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

/** Order the status groups appear in the file list. */
const STATUS_ORDER: DiffFileStatus[] = ["added", "modified", "renamed", "deleted"];
const STATUS_LABEL: Record<DiffFileStatus, "changes.added" | "changes.modified" | "changes.deleted" | "changes.renamed"> = {
  added: "changes.added",
  modified: "changes.modified",
  deleted: "changes.deleted",
  renamed: "changes.renamed",
};
/** Single-letter badge per status. */
const STATUS_MARK: Record<DiffFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

let openOverlay: HTMLElement | null = null;
let langUnsub: (() => void) | null = null;

// Dialog state, module-scoped so the host-message handlers can update it.
let ctx: ChangesDialogContext | null = null;
let files: CommitChangeFile[] | null = null; // null = still loading
let selected: CommitChangeFile | null = null;
let diff: FileDiff | null = null; // diff for `selected`, null while loading
let listEl: HTMLElement | null = null;
let diffPaneEl: HTMLElement | null = null;

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
    list.appendChild(el("div", "settings-section-title", t("changes.files")));
    listEl = el("div", "changes-list-scroll");
    list.appendChild(listEl);
    renderList();

    const diffPane = el("div", "changes-diff");
    diffPaneEl = diffPane;
    renderDiff();

    body.append(list, diffPane);
    modal.appendChild(body);
  }

  /** (Re)draw the left-pane file list from the current `files`/`selected`. */
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
    for (const status of STATUS_ORDER) {
      const group = files.filter((f) => f.status === status);
      if (group.length === 0) continue;
      listEl.appendChild(el("div", "changes-group-label", t(STATUS_LABEL[status])));
      for (const file of group) listEl.appendChild(fileRow(file));
    }
  }

  /** One clickable file row with a status marker. */
  function fileRow(file: CommitChangeFile): HTMLElement {
    const row = el("div", "changes-file");
    row.dataset.status = file.status;
    if (selected && selected.path === file.path && selected.status === file.status) {
      row.classList.add("selected");
    }
    const mark = el("span", `changes-mark changes-mark-${file.status}`, STATUS_MARK[file.status]);
    const name = el("span", "changes-file-name", file.path);
    name.title = file.oldPath ? t("changes.renamedFrom", { path: file.oldPath }) : file.path;
    row.append(mark, name);
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
    if (!selected) {
      diffPaneEl.appendChild(el("div", "changes-empty", t("changes.selectFile")));
      return;
    }
    if (!diff) {
      diffPaneEl.appendChild(el("div", "changes-empty", t("changes.loading")));
      return;
    }
    if (diff.binary) {
      diffPaneEl.appendChild(el("div", "changes-empty", t("changes.binary")));
      return;
    }
    if (diff.tooLarge) {
      diffPaneEl.appendChild(el("div", "changes-empty", t("changes.tooLarge")));
      return;
    }
    diffPaneEl.appendChild(buildDiffView(diff));
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

/**
 * Build the diff view. Added files show one column of new content, deleted files
 * one column of old content, everything else a two-column side-by-side diff.
 */
function buildDiffView(d: FileDiff): HTMLElement {
  if (d.status === "added") return singleColumn(d.newText, "add", "changes.changed");
  if (d.status === "deleted") return singleColumn(d.oldText, "del", "changes.original");
  return sideBySide(computeLineDiff(d.oldText, d.newText));
}

/** A one-sided view (added → new only, deleted → old only). */
function singleColumn(text: string, kind: "add" | "del", headerKey: "changes.original" | "changes.changed"): HTMLElement {
  const wrap = el("div", "diff-grid diff-grid-single");
  wrap.appendChild(headerCell(t(headerKey), 2));
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  lines.forEach((line, i) => {
    wrap.appendChild(numCell(i + 1, kind));
    wrap.appendChild(codeCell(line, kind));
  });
  return wrap;
}

/** A two-column side-by-side view aligned by computeLineDiff. */
function sideBySide(rows: DiffRow[]): HTMLElement {
  const wrap = el("div", "diff-grid diff-grid-split");
  wrap.appendChild(headerCell(t("changes.original"), 2));
  wrap.appendChild(headerCell(t("changes.changed"), 2));
  for (const row of rows) {
    const leftKind = row.kind === "del" || row.kind === "change" ? "del" : row.kind === "context" ? "ctx" : "empty";
    const rightKind = row.kind === "add" || row.kind === "change" ? "add" : row.kind === "context" ? "ctx" : "empty";
    if (row.left) {
      wrap.appendChild(numCell(row.left.num, leftKind));
      wrap.appendChild(codeCell(row.left.text, leftKind));
    } else {
      wrap.appendChild(fillerCell());
      wrap.appendChild(fillerCell());
    }
    if (row.right) {
      wrap.appendChild(numCell(row.right.num, rightKind));
      wrap.appendChild(codeCell(row.right.text, rightKind));
    } else {
      wrap.appendChild(fillerCell());
      wrap.appendChild(fillerCell());
    }
  }
  return wrap;
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
