/**
 * Persisted choice of *how branches are created* from the graph's context menu.
 *
 *  - true  — show the SVN-style "Create Branch" dialog (folder tree picker,
 *    start point, checkout option) rendered in the webview.
 *  - false — fall back to the host's own native prompt (a simple input box).
 *
 * The choice lives in localStorage (like the language and display-mode settings)
 * so it survives reloads without involving the host. Defaults to on, since the
 * SVN-style dialog is the headline feature users come here for.
 */

export const DEFAULT_SVN_BRANCH_DIALOG = true;

const STORAGE_KEY = "revGraph.svnBranchDialog";

function load(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* localStorage may be unavailable; fall back to the default. */
  }
  return DEFAULT_SVN_BRANCH_DIALOG;
}

let current: boolean = load();
const listeners = new Set<() => void>();

/** Whether the SVN-style branch dialog is enabled. */
export function getBranchDialogMode(): boolean {
  return current;
}

/** Enable/disable the SVN-style dialog, persist it, and notify subscribers. */
export function setBranchDialogMode(enabled: boolean): void {
  if (enabled === current) return;
  current = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onBranchDialogModeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
