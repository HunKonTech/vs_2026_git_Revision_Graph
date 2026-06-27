/**
 * Lightweight in-webview localization.
 *
 * The UI ships in English by default; the user can switch language from the
 * settings panel. The choice is persisted in localStorage (available in both
 * the VS Code / Visual Studio webviews and the dev browser harness), so it
 * survives reloads without involving the host.
 */

export type Lang = "en" | "hu";

export const DEFAULT_LANG: Lang = "en";

/** Languages offered in the settings dropdown, in display order. */
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hu", label: "Magyar" },
];

/** All user-facing strings. `{n}` style placeholders are filled by t(). */
type Dict = {
  "toolbar.refresh": string;
  "toolbar.fetch": string;
  "toolbar.pull": string;
  "toolbar.push": string;
  "toolbar.sync": string;
  "toolbar.reset": string;
  "toolbar.settings": string;
  "details.header": string;
  "details.sha": string;
  "details.shortSha": string;
  "details.message": string;
  "details.author": string;
  "details.date": string;
  "details.labels": string;
  "details.location": string;
  "details.currentHead": string;
  "settings.title": string;
  "settings.language": string;
  "settings.close": string;
  "legend.title": string;
  "legend.head": string;
  "legend.local": string;
  "legend.remote": string;
  "legend.tag": string;
  "legend.commit": string;
  "menu.createBranch": string;
  "menu.checkout": string;
  "menu.copySha": string;
  "status.loading": string;
  "status.summary": string;
  "status.branchCreated": string;
  "status.error": string;
  "status.fetching": string;
  "status.pulling": string;
  "status.pushing": string;
  "status.syncing": string;
};

const DICTS: Record<Lang, Dict> = {
  en: {
    "toolbar.refresh": "⟳ Refresh",
    "toolbar.fetch": "⤓ Fetch",
    "toolbar.pull": "⇩ Pull",
    "toolbar.push": "⇧ Push",
    "toolbar.sync": "⇅ Sync",
    "toolbar.reset": "⤢ Reset view",
    "toolbar.settings": "⚙ Settings",
    "details.header": "Commit Details",
    "details.sha": "SHA",
    "details.shortSha": "Short SHA",
    "details.message": "Message",
    "details.author": "Author",
    "details.date": "Date",
    "details.labels": "Labels",
    "details.location": "Location",
    "details.currentHead": "HEAD — current checkout",
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.close": "Close",
    "legend.title": "Legend",
    "legend.head": "HEAD / current branch",
    "legend.local": "Local branch",
    "legend.remote": "Remote branch",
    "legend.tag": "Tag (version)",
    "legend.commit": "Commit",
    "menu.createBranch": "Create branch from here…",
    "menu.checkout": "Checkout this commit",
    "menu.copySha": "Copy commit SHA",
    "status.loading": "Loading graph…",
    "status.summary": "{repo}Showing {commits} commits, {refs} refs",
    "status.branchCreated": 'Created branch "{name}" at {sha}',
    "status.error": "Error: {message}",
    "status.fetching": "Fetching…",
    "status.pulling": "Pulling…",
    "status.pushing": "Pushing…",
    "status.syncing": "Syncing…",
  },
  hu: {
    "toolbar.refresh": "⟳ Frissítés",
    "toolbar.fetch": "⤓ Fetch",
    "toolbar.pull": "⇩ Pull",
    "toolbar.push": "⇧ Push",
    "toolbar.sync": "⇅ Szinkron",
    "toolbar.reset": "⤢ Nézet visszaállítása",
    "toolbar.settings": "⚙ Beállítások",
    "details.header": "Commit részletei",
    "details.sha": "SHA",
    "details.shortSha": "Rövid SHA",
    "details.message": "Üzenet",
    "details.author": "Szerző",
    "details.date": "Dátum",
    "details.labels": "Címkék",
    "details.location": "Elhelyezkedés",
    "details.currentHead": "HEAD — itt áll a kód",
    "settings.title": "Beállítások",
    "settings.language": "Nyelv",
    "settings.close": "Bezárás",
    "legend.title": "Jelmagyarázat",
    "legend.head": "HEAD / aktuális branch",
    "legend.local": "Lokális branch",
    "legend.remote": "Távoli branch (remote)",
    "legend.tag": "Tag (verzió)",
    "legend.commit": "Commit",
    "menu.createBranch": "Branch létrehozása innen…",
    "menu.checkout": "Checkout erre a commitra",
    "menu.copySha": "Commit SHA másolása",
    "status.loading": "Gráf betöltése…",
    "status.summary": "{repo}{commits} commit, {refs} ref látható",
    "status.branchCreated": '"{name}" branch létrehozva itt: {sha}',
    "status.error": "Hiba: {message}",
    "status.fetching": "Fetch folyamatban…",
    "status.pulling": "Pull folyamatban…",
    "status.pushing": "Push folyamatban…",
    "status.syncing": "Szinkronizálás…",
  },
};

export type MsgKey = keyof Dict;

const STORAGE_KEY = "revGraph.lang";

function load(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "hu") return v;
  } catch {
    /* localStorage may be unavailable; fall back to the default. */
  }
  return DEFAULT_LANG;
}

let current: Lang = load();
const listeners = new Set<() => void>();

/** The active language. */
export function getLang(): Lang {
  return current;
}

/** Switch language, persist it, and notify subscribers so the UI re-renders. */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((l) => l());
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Translate a key in the active language, interpolating `{placeholders}`. */
export function t(key: MsgKey, params?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? DICTS[DEFAULT_LANG][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
