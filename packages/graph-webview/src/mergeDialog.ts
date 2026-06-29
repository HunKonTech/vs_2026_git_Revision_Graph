import { t, onLangChange, type MsgKey } from "./i18n.js";
import type { MergePreview, MergeFileStatus } from "@rev-graph/protocol";

/**
 * The "Merge Branch" dialog. Opened from the context menu when the user wants to
 * merge a branch (the one they right-clicked, `source`) into the branch they have
 * checked out (`target`). It shows the source → target route, then a host-computed
 * dry-run preview (which files the merge changes, which conflict, whether it can
 * fast-forward) and an editable, auto-generated merge-commit message.
 *
 * The preview arrives asynchronously from the host:
 *  - `requestMergePreview` is posted by main.ts when the dialog opens,
 *  - the host replies `mergePreview` → setMergePreview() fills the body.
 * Confirming calls back into main.ts (onMerge) with the message + fast-forward choice.
 */
export interface MergeDialogContext {
  /** Branch being merged in (right-clicked). */
  source: string;
  /** Branch the merge lands on (current checkout). */
  target: string;
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

// Dialog state, module-scoped so the host-message handler can update it.
let ctx: MergeDialogContext | null = null;
let preview: MergePreview | null = null; // null = still loading
// The user's edited message, retained across re-renders (language switch).
let messageValue: string | null = null;
let noFastForward = false;

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
  ctx = null;
  preview = null;
  messageValue = null;
  noFastForward = false;
}

/** Open the dialog; the preview arrives later via setMergePreview. */
export function openMergeDialog(context: MergeDialogContext): void {
  closeMergeDialog();
  ctx = context;
  preview = null;
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

    // ---- Body ----
    const body = el("div", "settings-modal-body");

    // Source → target route.
    body.appendChild(el("div", "settings-section-title", t("merge.route")));
    const route = el("div", "merge-route");
    route.appendChild(branchChip(ctx.source, "source"));
    route.appendChild(el("span", "merge-arrow", "→"));
    route.appendChild(branchChip(ctx.target, "target"));
    body.appendChild(route);

    // Preview area (loading → result).
    body.appendChild(renderPreview());

    // Merge-commit message.
    body.appendChild(el("div", "settings-section-title", t("merge.message")));
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
    body.appendChild(msgInput);
    // When the merge can fast-forward, the message is unused unless --no-ff.
    if (preview?.canFastForward && !noFastForward) {
      body.appendChild(el("div", "merge-hint", t("merge.messageFfHint")));
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
      body.appendChild(ffRow);
    }

    modal.appendChild(body);

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

  /** The preview block: loading spinner, error, "up to date", or the file list. */
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

    // Grouped, scrollable file list (conflicts first).
    const list = el("div", "merge-files");
    for (const status of STATUS_ORDER) {
      const group = preview.files.filter((f) => f.status === status);
      if (group.length === 0) continue;
      list.appendChild(el("div", "merge-files-group", t(STATUS_LABEL[status]) + ` (${group.length})`));
      for (const f of group) {
        const row = el("div", "merge-file");
        row.dataset.status = status;
        row.appendChild(el("span", `merge-mark merge-mark-${status}`, STATUS_MARK[status]));
        const name = el("span", "merge-file-name", f.path);
        name.title = f.path;
        row.appendChild(name);
        list.appendChild(row);
      }
    }
    wrap.appendChild(list);
    return wrap;
  }

  render();
  langUnsub = onLangChange(render);

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeMergeDialog();
  });
  document.body.appendChild(overlay);
  openOverlay = overlay;

  // Expose the renderer so setMergePreview can refresh the body in place.
  pendingRender = render;
}

let pendingRender: (() => void) | null = null;

/** Host delivered the merge preview (ignored if it's for a stale source/target). */
export function setMergePreview(incoming: MergePreview): void {
  if (!ctx || ctx.source !== incoming.source || ctx.target !== incoming.target) return;
  preview = incoming;
  pendingRender?.();
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
