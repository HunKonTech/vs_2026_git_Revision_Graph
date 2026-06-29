import { t, onLangChange, type MsgKey } from "./i18n.js";
import { getDiffMinimap, onDiffMinimapChange } from "./diffMinimap.js";
import { buildDiffView, attachMinimaps, buildChangeNav, MM_W } from "./diffView.js";
import type { MergePreview, MergePreviewFile, MergeFileStatus, FileDiff } from "@rev-graph/protocol";

/**
 * The "Merge Branch" dialog. Opened from the context menu when the user wants to
 * merge a branch (the one they right-clicked, `source`) into the branch they have
 * checked out (`target`). It shows the source → target route, then a host-computed
 * dry-run preview (which files the merge changes, which conflict, whether it can
 * fast-forward) and an editable, auto-generated merge-commit message.
 *
 * Clicking a file in the preview shows its diff in the right pane using the SAME
 * renderer as the "View changes" dialog (see diffView.ts) — current branch on the
 * left, the merged result on the right; conflicted files include conflict markers.
 *
 * The preview/diff arrive asynchronously from the host:
 *  - `requestMergePreview` → `mergePreview` → setMergePreview(),
 *  - `requestMergeFileDiff` → `mergeFileDiff` → setMergeFileDiff().
 * Confirming calls back into main.ts (onMerge) with the message + fast-forward choice.
 */
export interface MergeDialogContext {
  /** Branch being merged in (right-clicked). */
  source: string;
  /** Branch the merge lands on (current checkout). */
  target: string;
  /** Asked to fetch the merge diff of a file the user selected. */
  onRequestFileDiff: (file: MergePreviewFile) => void;
  /** Confirm: run the merge with this message and fast-forward choice. */
  onMerge: (message: string, noFastForward: boolean) => void;
}

/** Single-letter badge per merge file status (mirrors the changes dialog). */
const STATUS_MARK: Record<MergeFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  conflict: "!",
};
/** Label key per status, for the grouped section headers. */
const STATUS_LABEL: Record<MergeFileStatus, MsgKey> = {
  added: "merge.added",
  modified: "merge.modified",
  deleted: "merge.deleted",
  conflict: "merge.conflict",
};
/** Display order: conflicts first (most important), then add / modify / delete. */
const STATUS_ORDER: MergeFileStatus[] = ["conflict", "added", "modified", "deleted"];

let openOverlay: HTMLElement | null = null;
let langUnsub: (() => void) | null = null;
let minimapUnsub: (() => void) | null = null;
// Tears down the current diff's minimap strips (listeners + DOM); null when none.
let minimapCleanup: (() => void) | null = null;

// Dialog state, module-scoped so the host-message handlers can update it.
let ctx: MergeDialogContext | null = null;
let preview: MergePreview | null = null; // null = still loading
let selected: MergePreviewFile | null = null; // file whose diff is shown
let diff: FileDiff | null = null; // diff for `selected`, null while loading
// The user's edited message, retained across re-renders (language switch).
let messageValue: string | null = null;
let noFastForward = false;
let diffPaneEl: HTMLElement | null = null;

/** Close the merge dialog if open. */
export function closeMergeDialog(): void {
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
  preview = null;
  selected = null;
  diff = null;
  messageValue = null;
  noFastForward = false;
  diffPaneEl = null;
}

/** Open the dialog; the preview arrives later via setMergePreview. */
export function openMergeDialog(context: MergeDialogContext): void {
  closeMergeDialog();
  ctx = context;
  preview = null;
  selected = null;
  diff = null;
  messageValue = null;
  noFastForward = false;

  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  const modal = document.createElement("div");
  modal.className = "settings-modal merge-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  overlay.appendChild(modal);

  function render(): void {
    if (!ctx) return;
    modal.innerHTML = "";

    // ---- Header ----
    const header = el("div", "settings-modal-header");
    header.appendChild(el("span", "settings-modal-title", t("merge.title")));
    const closeBtn = button("settings-close-x", "×", closeMergeDialog);
    closeBtn.setAttribute("aria-label", t("merge.cancel"));
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // ---- Body: preview + file list (left) | diff (right) ----
    const body = el("div", "merge-body");

    const left = el("div", "merge-left");

    // Source → target route.
    left.appendChild(el("div", "settings-section-title", t("merge.route")));
    const route = el("div", "merge-route");
    route.appendChild(branchChip(ctx.source, "source"));
    route.appendChild(el("span", "merge-arrow", "→"));
    route.appendChild(branchChip(ctx.target, "target"));
    left.appendChild(route);

    // Preview status + grouped, clickable file list.
    left.appendChild(renderPreview());

    const diffPane = el("div", "changes-diff merge-diff");
    diffPaneEl = diffPane;
    renderDiff();

    body.append(left, diffPane);
    modal.appendChild(body);

    // ---- Merge-commit message ----
    const footerArea = el("div", "merge-footer-area");
    footerArea.appendChild(el("div", "settings-section-title", t("merge.message")));
    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.className = "settings-input merge-message";
    msgInput.placeholder = t("merge.messagePlaceholder");
    msgInput.value = messageValue ?? preview?.defaultMessage ?? "";
    msgInput.addEventListener("input", () => {
      messageValue = msgInput.value;
    });
    msgInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    footerArea.appendChild(msgInput);
    // When the merge can fast-forward, the message is unused unless --no-ff.
    if (preview?.canFastForward && !noFastForward) {
      footerArea.appendChild(el("div", "merge-hint", t("merge.messageFfHint")));
    }

    // No-fast-forward toggle (only meaningful when a fast-forward is possible).
    if (preview?.canFastForward) {
      const ffRow = document.createElement("label");
      ffRow.className = "merge-checkbox";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = noFastForward;
      cb.addEventListener("change", () => {
        noFastForward = cb.checked;
        render(); // re-render to update the message hint
      });
      ffRow.appendChild(cb);
      const txt = el("div", "merge-checkbox-text");
      txt.appendChild(el("span", "", t("merge.noFastForward")));
      txt.appendChild(el("span", "merge-hint", t("merge.noFastForwardHint")));
      ffRow.appendChild(txt);
      footerArea.appendChild(ffRow);
    }
    modal.appendChild(footerArea);

    // ---- Footer ----
    const footer = el("div", "settings-modal-footer");
    const cancelBtn = button("settings-secondary", t("merge.cancel"), closeMergeDialog);
    const mergeBtn = button("settings-done", t("merge.merge"), submit);
    // Block merging while still loading, or when there is nothing to merge.
    const blocked = preview === null || preview.upToDate || !!preview.error;
    mergeBtn.toggleAttribute("disabled", blocked);
    footer.append(cancelBtn, mergeBtn);
    modal.appendChild(footer);

    function submit(): void {
      if (!ctx || preview === null || preview.upToDate || preview.error) return;
      const message = (messageValue ?? preview.defaultMessage ?? "").trim();
      const noFf = noFastForward;
      const c = ctx;
      closeMergeDialog();
      c.onMerge(message, noFf);
    }
  }

  /** The left-pane preview: loading, error, "up to date", or the file list. */
  function renderPreview(): HTMLElement {
    const wrap = el("div", "merge-preview");
    if (preview === null) {
      wrap.appendChild(el("div", "merge-status", t("merge.loading")));
      return wrap;
    }
    if (preview.error) {
      wrap.appendChild(
        el("div", "merge-status merge-status-error", t("merge.previewError", { message: preview.error })),
      );
      return wrap;
    }
    if (preview.upToDate) {
      wrap.appendChild(el("div", "merge-status", t("merge.upToDate")));
      return wrap;
    }

    // Summary line + fast-forward / conflict notes.
    wrap.appendChild(
      el(
        "div",
        "merge-status",
        t("merge.summary", { files: preview.files.length, conflicts: preview.conflicts.length }),
      ),
    );
    if (preview.canFastForward) {
      wrap.appendChild(el("div", "merge-note", t("merge.fastForward")));
    }
    if (preview.conflicts.length > 0) {
      wrap.appendChild(el("div", "merge-note merge-note-conflict", t("merge.conflictsWarning")));
    }

    if (preview.files.length === 0) {
      wrap.appendChild(el("div", "merge-empty", t("merge.noChanges")));
      return wrap;
    }

    // Grouped, scrollable, clickable file list (conflicts first).
    wrap.appendChild(el("div", "settings-section-title", t("merge.files")));
    const list = el("div", "merge-files");
    for (const status of STATUS_ORDER) {
      const group = preview.files.filter((f) => f.status === status);
      if (group.length === 0) continue;
      list.appendChild(el("div", "merge-files-group", t(STATUS_LABEL[status]) + ` (${group.length})`));
      for (const f of group) {
        const row = el("div", "merge-file");
        row.dataset.status = status;
        if (selected && selected.path === f.path) row.classList.add("selected");
        row.appendChild(el("span", `merge-mark merge-mark-${status}`, STATUS_MARK[status]));
        const name = el("span", "merge-file-name", f.path);
        name.title = f.path;
        row.appendChild(name);
        row.addEventListener("click", () => selectFile(f));
        list.appendChild(row);
      }
    }
    wrap.appendChild(list);
    return wrap;
  }

  /** Select a file: highlight it, show the loading state, and fetch its diff. */
  function selectFile(file: MergePreviewFile): void {
    selected = file;
    diff = null;
    render();
    ctx?.onRequestFileDiff(file);
  }

  /** (Re)draw the right-pane diff from the current `selected`/`diff`. */
  function renderDiff(): void {
    if (!diffPaneEl) return;
    diffPaneEl.innerHTML = "";
    const scroll = el("div", "changes-diff-scroll");
    const showEmpty = (key: MsgKey): void => {
      scroll.appendChild(el("div", "changes-empty", t(key)));
      diffPaneEl!.appendChild(scroll);
    };
    minimapCleanup?.();
    minimapCleanup = null;
    if (!preview || preview.upToDate || preview.error || preview.files.length === 0) {
      return showEmpty("changes.selectFile");
    }
    if (!selected) return showEmpty("changes.selectFile");
    if (!diff) return showEmpty("changes.loading");
    if (diff.binary) return showEmpty("changes.binary");
    if (diff.tooLarge) return showEmpty("changes.tooLarge");

    const minimapOn = getDiffMinimap();
    const { view, blocks, minimaps } = buildDiffView(diff, minimapOn);
    scroll.appendChild(view);
    diffPaneEl.appendChild(scroll);
    minimapCleanup = minimapOn ? attachMinimaps(diffPaneEl, scroll, minimaps) : null;
    if (blocks.length > 1) {
      diffPaneEl.appendChild(buildChangeNav(scroll, blocks, minimapOn ? MM_W + 10 : 14));
    }
  }

  render();
  langUnsub = onLangChange(render);
  // Redraw the diff pane when the minimap setting is toggled in Settings.
  minimapUnsub = onDiffMinimapChange(() => renderDiff());

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeMergeDialog();
  });
  document.body.appendChild(overlay);
  openOverlay = overlay;

  // Expose the renderers so the host-message setters can refresh in place.
  pendingRender = render;
  pendingRenderDiff = renderDiff;
}

let pendingRender: (() => void) | null = null;
let pendingRenderDiff: (() => void) | null = null;

/** Host delivered the merge preview (ignored if it's for a stale source/target). */
export function setMergePreview(incoming: MergePreview): void {
  if (!ctx || ctx.source !== incoming.source || ctx.target !== incoming.target) return;
  preview = incoming;
  // Auto-select the first file so the user immediately sees a diff.
  if (!selected && !incoming.upToDate && !incoming.error && incoming.files.length > 0) {
    const first = orderedFirst(incoming.files);
    if (first) {
      selected = first;
      diff = null;
      pendingRender?.();
      ctx.onRequestFileDiff(first);
      return;
    }
  }
  pendingRender?.();
}

/** Host delivered a merge file diff (ignored unless it matches the current selection). */
export function setMergeFileDiff(incoming: FileDiff): void {
  if (!ctx || !selected || selected.path !== incoming.path) return;
  diff = incoming;
  pendingRenderDiff?.();
}

/** First file in STATUS_ORDER grouping (matches the visual list order). */
function orderedFirst(list: MergePreviewFile[]): MergePreviewFile | null {
  for (const status of STATUS_ORDER) {
    const hit = list.find((f) => f.status === status);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

/* small DOM helpers (mirror newBranchDialog.ts / changesDialog.ts) */
function branchChip(name: string, kind: "source" | "target"): HTMLElement {
  const chip = el("span", `merge-chip merge-chip-${kind}`, name);
  chip.title = name;
  return chip;
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

// Dismiss on Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMergeDialog();
});
