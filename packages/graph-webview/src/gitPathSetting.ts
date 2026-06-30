export type GitMode = "builtin" | "custom";

const STORAGE_MODE = "revGraph.gitMode";
const STORAGE_PATH = "revGraph.customGitPath";

function read(): { mode: GitMode; path: string } {
  try {
    return {
      mode: localStorage.getItem(STORAGE_MODE) === "custom" ? "custom" : "builtin",
      path: localStorage.getItem(STORAGE_PATH) ?? "",
    };
  } catch {
    return { mode: "builtin", path: "" };
  }
}

let state = read();
const listeners = new Set<() => void>();

export function getGitMode(): GitMode {
  return state.mode;
}

export function getCustomGitPath(): string {
  return state.path;
}

/** Update the git source and persist it; notifies subscribers. */
export function setGitSource(mode: GitMode, path: string): void {
  state = { mode, path };
  try {
    localStorage.setItem(STORAGE_MODE, mode);
    localStorage.setItem(STORAGE_PATH, path);
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to git source changes; returns an unsubscribe function. */
export function onGitSourceChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Called by main.ts when the host replies to a `browseGitPath` request with
 * the path the user picked in the OS file-picker. Switches the mode to
 * "custom", persists the new path, and fires change listeners so the settings
 * input updates itself in real-time.
 */
export function receiveGitPathFromBrowse(path: string): void {
  setGitSource("custom", path);
}
