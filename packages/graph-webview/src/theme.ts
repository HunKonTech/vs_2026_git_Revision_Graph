/**
 * Persisted choice of colour theme.
 *
 *  - ""      — follow the host IDE's theme (the default; the host pushes its
 *              palette via the `setTheme` message).
 *  - "light" — force the light palette regardless of the host.
 *  - "dark"  — force the dark palette regardless of the host.
 *
 * Like the other webview settings the choice lives in localStorage, so it
 * survives reloads without involving the host. main.ts resolves the effective
 * palette (override or host) and applies it to the document.
 */

import type { ThemeTokens } from "@rev-graph/protocol";

export type ThemeChoice = "" | "light" | "dark";

/** Built-in light palette, used when the user forces "light". */
export const LIGHT_THEME: ThemeTokens = {
  kind: "light",
  background: "#ffffff",
  foreground: "#1f1f1f",
  accent: "#0e639c",
  border: "#c8c8c8",
};

/** Built-in dark palette, used when the user forces "dark". */
export const DARK_THEME: ThemeTokens = {
  kind: "dark",
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  accent: "#0e639c",
  border: "#3c3c3c",
};

const STORAGE_KEY = "revGraph.theme";

function load(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* localStorage may be unavailable; fall back to "follow host". */
  }
  return "";
}

let current: ThemeChoice = load();
const listeners = new Set<() => void>();

/** The theme override, or "" to follow the host. */
export function getThemeChoice(): ThemeChoice {
  return current;
}

/** Set (or clear, with "") the theme override, persist it, and notify subscribers. */
export function setThemeChoice(choice: ThemeChoice): void {
  if (choice === current) return;
  current = choice;
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, choice);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
