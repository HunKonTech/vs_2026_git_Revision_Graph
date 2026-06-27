/**
 * Persisted choice of graph *display style*.
 *
 *  - "modern"  — the free-form canvas: pan by dragging anywhere, zoom with the
 *    wheel, nodes float wherever you push them.
 *  - "classic" — a TortoiseSVN-style fixed canvas: the trunk is pinned to the
 *    left, there is no zoom (one fixed scale) and navigation is scroll-only
 *    (vertical + horizontal scrollbars), the way the SVN revision graph moves.
 *
 * The choice lives in localStorage (like the language and main-branch settings)
 * so it survives reloads without involving the host.
 */

export type DisplayMode = "modern" | "classic";

export const DEFAULT_MODE: DisplayMode = "modern";

/** Display modes offered in the settings dialog, in display order. */
export const DISPLAY_MODES: DisplayMode[] = ["modern", "classic"];

const STORAGE_KEY = "revGraph.displayMode";

function load(): DisplayMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "modern" || v === "classic") return v;
  } catch {
    /* localStorage may be unavailable; fall back to the default. */
  }
  return DEFAULT_MODE;
}

let current: DisplayMode = load();
const listeners = new Set<() => void>();

/** The active display mode. */
export function getDisplayMode(): DisplayMode {
  return current;
}

/** Switch display mode, persist it, and notify subscribers so the view re-renders. */
export function setDisplayMode(mode: DisplayMode): void {
  if (mode === current) return;
  current = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onDisplayModeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
