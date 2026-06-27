/**
 * Persisted choice of "main branch" — the branch pinned to the leftmost lane,
 * like the trunk in a TortoiseSVN revision graph.
 *
 * The choice lives in localStorage (like the language setting) so it survives
 * reloads without involving the host. An empty value means "auto" — let the
 * layout fall back to main/master, the current branch, or HEAD.
 */

const STORAGE_KEY = "revGraph.mainBranch";

function load(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

let current: string = load();
const listeners = new Set<() => void>();

/** The configured main branch name, or "" for automatic detection. */
export function getMainBranch(): string {
  return current;
}

/** Set (or clear, with "") the main branch and notify subscribers. */
export function setMainBranch(name: string): void {
  if (name === current) return;
  current = name;
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onMainBranchChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
