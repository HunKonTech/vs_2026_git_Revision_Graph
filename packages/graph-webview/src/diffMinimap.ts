/**
 * Persisted on/off choice for the diff *minimap* — the VS Code-style overview
 * strip drawn down the side of the file-changes view. It shows the whole file in
 * miniature (with change markers) and a draggable viewport box you can grab to
 * scroll the diff.
 *
 * The choice lives in localStorage (like the language and display-mode settings)
 * so it survives reloads without involving the host. Off by default.
 */

export const DEFAULT_DIFF_MINIMAP = false;

const STORAGE_KEY = "revGraph.diffMinimap";

function load(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "on") return true;
    if (v === "off") return false;
  } catch {
    /* localStorage may be unavailable; fall back to the default. */
  }
  return DEFAULT_DIFF_MINIMAP;
}

let current = load();
const listeners = new Set<() => void>();

/** Whether the diff minimap is enabled. */
export function getDiffMinimap(): boolean {
  return current;
}

/** Toggle the minimap, persist it, and notify subscribers so the diff redraws. */
export function setDiffMinimap(on: boolean): void {
  if (on === current) return;
  current = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onDiffMinimapChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
