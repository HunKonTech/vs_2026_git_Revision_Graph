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
  "toolbar.jumpHead": string;
  "toolbar.reset": string;
  "toolbar.settings": string;
  "details.header": string;
  "details.close": string;
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
  "settings.theme": string;
  "settings.themeLight": string;
  "settings.themeDark": string;
  "settings.themeLightHint": string;
  "settings.themeDarkHint": string;
  "settings.mainBranch": string;
  "settings.mainBranchAuto": string;
  "settings.mainBranchSearch": string;
  "settings.mainBranchNoMatch": string;
  "settings.display": string;
  "settings.displayModern": string;
  "settings.displayClassic": string;
  "settings.displayModernHint": string;
  "settings.displayClassicHint": string;
  "settings.sectionGeneral": string;
  "settings.sectionGraph": string;
  "settings.sectionChanges": string;
  "settings.diffMinimap": string;
  "settings.diffMinimapOn": string;
  "settings.diffMinimapOff": string;
  "settings.diffMinimapOnHint": string;
  "settings.diffMinimapOffHint": string;
  "settings.svnBranchDialog": string;
  "settings.svnBranchDialogHint": string;
  "settings.branchDialog": string;
  "settings.branchDialogSvnTitle": string;
  "settings.branchDialogNativeVscode": string;
  "settings.branchDialogNativeVs": string;
  "settings.branchDialogNativeHint": string;
  "settings.close": string;
  "settings.done": string;
  "legend.title": string;
  "legend.head": string;
  "legend.local": string;
  "legend.remote": string;
  "legend.remoteOnly": string;
  "legend.tag": string;
  "legend.commit": string;
  "legend.stash": string;
  "menu.jumpHead": string;
  "menu.resetView": string;
  "menu.createBranch": string;
  "menu.checkout": string;
  "menu.copySha": string;
  "menu.deleteBranch": string;
  "menu.pushBranch": string;
  "menu.renameBranch": string;
  "menu.renameCommit": string;
  "menu.undoCommit": string;
  "menu.viewChanges": string;
  "changes.title": string;
  "changes.files": string;
  "changes.added": string;
  "changes.modified": string;
  "changes.deleted": string;
  "changes.renamed": string;
  "changes.noChanges": string;
  "changes.loading": string;
  "changes.selectFile": string;
  "changes.original": string;
  "changes.changed": string;
  "changes.binary": string;
  "changes.tooLarge": string;
  "changes.renamedFrom": string;
  "changes.close": string;
  "changes.prevChange": string;
  "changes.nextChange": string;
  "menu.stashApply": string;
  "menu.stashPop": string;
  "menu.stashDrop": string;
  "newBranch.title": string;
  "newBranch.startPoint": string;
  "newBranch.startPointOn": string;
  "newBranch.location": string;
  "newBranch.locationRoot": string;
  "newBranch.name": string;
  "newBranch.namePlaceholder": string;
  "newBranch.fullName": string;
  "newBranch.invalid": string;
  "newBranch.checkout": string;
  "newBranch.create": string;
  "newBranch.cancel": string;
  "status.loading": string;
  "status.summary": string;
  "status.branchCreated": string;
  "status.error": string;
  "status.opFailed": string;
  "status.fetching": string;
  "status.pulling": string;
  "status.pushing": string;
  "status.syncing": string;
  "status.noHead": string;
  "status.undoing": string;
  "status.commitUndone": string;
  "status.undoConflict": string;
  "status.stashApplying": string;
  "status.stashPopping": string;
  "status.stashDropping": string;
  "status.stashApplied": string;
  "status.stashPopped": string;
  "status.stashDropped": string;
  "status.stashConflict": string;
};

const DICTS: Record<Lang, Dict> = {
  en: {
    "toolbar.refresh": "⟳ Refresh",
    "toolbar.fetch": "⤓ Fetch",
    "toolbar.pull": "⇩ Pull",
    "toolbar.push": "⇧ Push",
    "toolbar.sync": "⇅ Sync",
    "toolbar.jumpHead": "⌖ Go to checkout",
    "toolbar.reset": "⤢ Reset view",
    "toolbar.settings": "⚙ Settings",
    "details.header": "Commit Details",
    "details.close": "Close",
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
    "settings.theme": "Theme",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.themeLightHint": "Light background, dark text.",
    "settings.themeDarkHint": "Dark background, light text.",
    "settings.mainBranch": "Main branch",
    "settings.mainBranchAuto": "Automatic",
    "settings.mainBranchSearch": "Search branches…",
    "settings.mainBranchNoMatch": "No matching branches",
    "settings.display": "Display style",
    "settings.displayModern": "Modern",
    "settings.displayClassic": "Classic",
    "settings.displayModernHint": "Free canvas — drag to pan, scroll to zoom.",
    "settings.displayClassicHint": "Fixed canvas — trunk pinned left, no zoom, scroll only (like the SVN revision graph).",
    "settings.sectionGeneral": "General",
    "settings.sectionGraph": "Graph",
    "settings.sectionChanges": "Changes view",
    "settings.diffMinimap": "Diff minimap",
    "settings.diffMinimapOn": "Shown",
    "settings.diffMinimapOff": "Hidden",
    "settings.diffMinimapOnHint": "Show a VS Code-style overview strip beside the diff — drag it to scroll; change markers included.",
    "settings.diffMinimapOffHint": "No overview strip — scroll the diff normally.",
    "settings.svnBranchDialog": "SVN-style branch dialog",
    "settings.svnBranchDialogHint":
      "Show a folder-tree picker when creating a branch (instead of a simple prompt).",
    "settings.branchDialog": "Branch dialog",
    "settings.branchDialogSvnTitle": "SVN-style",
    "settings.branchDialogNativeVscode": "VS Code style",
    "settings.branchDialogNativeVs": "Visual Studio style",
    "settings.branchDialogNativeHint": "Your IDE's built-in branch prompt.",
    "settings.close": "Close",
    "settings.done": "Done",
    "legend.title": "Legend",
    "legend.head": "HEAD / current branch",
    "legend.local": "Local branch",
    "legend.remote": "Remote branch",
    "legend.remoteOnly": "Only in the cloud (not pulled)",
    "legend.tag": "Tag (version)",
    "legend.commit": "Commit",
    "legend.stash": "Stash (shelved work)",
    "menu.jumpHead": "⌖ Go to checkout",
    "menu.resetView": "⤢ Reset view",
    "menu.createBranch": "Create branch from here…",
    "menu.checkout": "Checkout this commit",
    "menu.copySha": "Copy commit SHA",
    "menu.pushBranch": 'Push branch "{name}"',
    "menu.renameBranch": 'Rename branch "{name}"…',
    "menu.deleteBranch": 'Delete branch "{name}"…',
    "menu.renameCommit": "Rename commit message…",
    "menu.undoCommit": "Undo commit (keep changes)…",
    "menu.viewChanges": "View changes…",
    "changes.title": "Changes in {sha}",
    "changes.files": "Files",
    "changes.added": "Added",
    "changes.modified": "Modified",
    "changes.deleted": "Deleted",
    "changes.renamed": "Renamed",
    "changes.noChanges": "This commit changes no files.",
    "changes.loading": "Loading diff…",
    "changes.selectFile": "Select a file to see its changes.",
    "changes.original": "Original",
    "changes.changed": "This commit",
    "changes.binary": "Binary file — no text diff to show.",
    "changes.tooLarge": "File is too large to diff.",
    "changes.renamedFrom": "Renamed from {path}",
    "changes.close": "Close",
    "changes.prevChange": "Previous change",
    "changes.nextChange": "Next change",
    "menu.stashApply": "Apply stash",
    "menu.stashPop": "Pop stash (apply & remove)",
    "menu.stashDrop": "Drop stash…",
    "newBranch.title": "Create Branch",
    "newBranch.startPoint": "New branch starting from {sha}",
    "newBranch.startPointOn": "on {refs}",
    "newBranch.location": "Location",
    "newBranch.locationRoot": "(root)",
    "newBranch.name": "Branch name",
    "newBranch.namePlaceholder": "my-branch",
    "newBranch.fullName": "Full name: {name}",
    "newBranch.invalid": "Invalid branch name",
    "newBranch.checkout": "Checkout branch after creation",
    "newBranch.create": "Create",
    "newBranch.cancel": "Cancel",
    "status.loading": "Loading graph…",
    "status.summary": "{repo}Showing {commits} commits, {refs} refs",
    "status.branchCreated": 'Created branch "{name}" at {sha}',
    "status.error": "Error: {message}",
    "status.opFailed": "Operation failed",
    "status.fetching": "Fetching…",
    "status.pulling": "Pulling…",
    "status.pushing": "Pushing…",
    "status.syncing": "Syncing…",
    "status.noHead": "No current checkout found in the graph.",
    "status.undoing": "Undoing commit…",
    "status.commitUndone": "Commit undone — changes are back in the working tree.",
    "status.undoConflict": "Undo hit conflicts — resolve them in the editor, then continue.",
    "status.stashApplying": "Applying stash…",
    "status.stashPopping": "Popping stash…",
    "status.stashDropping": "Dropping stash…",
    "status.stashApplied": "Stash applied.",
    "status.stashPopped": "Stash popped.",
    "status.stashDropped": "Stash dropped.",
    "status.stashConflict": "Stash conflicts — resolve them in the editor.",
  },
  hu: {
    "toolbar.refresh": "⟳ Frissítés",
    "toolbar.fetch": "⤓ Fetch",
    "toolbar.pull": "⇩ Pull",
    "toolbar.push": "⇧ Push",
    "toolbar.sync": "⇅ Szinkron",
    "toolbar.jumpHead": "⌖ Ugrás a checkout-ra",
    "toolbar.reset": "⤢ Nézet visszaállítása",
    "toolbar.settings": "⚙ Beállítások",
    "details.header": "Commit részletei",
    "details.close": "Bezárás",
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
    "settings.theme": "Téma",
    "settings.themeLight": "Világos",
    "settings.themeDark": "Sötét",
    "settings.themeLightHint": "Világos háttér, sötét szöveg.",
    "settings.themeDarkHint": "Sötét háttér, világos szöveg.",
    "settings.mainBranch": "Fő ág",
    "settings.mainBranchAuto": "Automatikus",
    "settings.mainBranchSearch": "Ágak keresése…",
    "settings.mainBranchNoMatch": "Nincs találat",
    "settings.display": "Megjelenítés stílusa",
    "settings.displayModern": "Modern",
    "settings.displayClassic": "Klasszikus",
    "settings.displayModernHint": "Szabad vászon — húzással mozgatható, görgővel nagyítható.",
    "settings.displayClassicHint": "Rögzített vászon — a fő ág balra rögzítve, nincs nagyítás, csak görgetés (mint az SVN revision graph).",
    "settings.sectionGeneral": "Általános",
    "settings.sectionGraph": "Gráf",
    "settings.sectionChanges": "Változások nézet",
    "settings.diffMinimap": "Diff minitérkép",
    "settings.diffMinimapOn": "Látható",
    "settings.diffMinimapOff": "Rejtett",
    "settings.diffMinimapOnHint": "VS Code-stílusú áttekintő sáv a diff mellett — húzva görgethető; a változásokat is jelöli.",
    "settings.diffMinimapOffHint": "Nincs áttekintő sáv — a diff hagyományosan görgethető.",
    "settings.svnBranchDialog": "SVN-stílusú branch ablak",
    "settings.svnBranchDialogHint":
      "Branch létrehozásakor mappafa-választó jelenjen meg (egyszerű beírás helyett).",
    "settings.branchDialog": "Branch ablak",
    "settings.branchDialogSvnTitle": "SVN-stílus",
    "settings.branchDialogNativeVscode": "VS Code stílus",
    "settings.branchDialogNativeVs": "Visual Studio stílus",
    "settings.branchDialogNativeHint": "Az IDE beépített branch ablaka.",
    "settings.close": "Bezárás",
    "settings.done": "Kész",
    "legend.title": "Jelmagyarázat",
    "legend.head": "HEAD / aktuális branch",
    "legend.local": "Lokális branch",
    "legend.remote": "Távoli branch (remote)",
    "legend.remoteOnly": "Csak a felhőben (nincs pull-olva)",
    "legend.tag": "Tag (verzió)",
    "legend.commit": "Commit",
    "legend.stash": "Stash (félretett munka)",
    "menu.jumpHead": "⌖ Ugrás a checkout-ra",
    "menu.resetView": "⤢ Nézet visszaállítása",
    "menu.createBranch": "Branch létrehozása innen…",
    "menu.checkout": "Checkout erre a commitra",
    "menu.copySha": "Commit SHA másolása",
    "menu.pushBranch": '"{name}" branch pusholása',
    "menu.renameBranch": '"{name}" branch átnevezése…',
    "menu.deleteBranch": '"{name}" branch törlése…',
    "menu.renameCommit": "Commit üzenet átnevezése…",
    "menu.undoCommit": "Commit visszavonása (változások megtartása)…",
    "menu.viewChanges": "Változások megtekintése…",
    "changes.title": "Változások — {sha}",
    "changes.files": "Fájlok",
    "changes.added": "Hozzáadva",
    "changes.modified": "Módosítva",
    "changes.deleted": "Törölve",
    "changes.renamed": "Átnevezve",
    "changes.noChanges": "Ez a commit nem módosít fájlokat.",
    "changes.loading": "Diff betöltése…",
    "changes.selectFile": "Válassz egy fájlt a változások megtekintéséhez.",
    "changes.original": "Eredeti",
    "changes.changed": "Ebben a commitban",
    "changes.binary": "Bináris fájl — nincs szöveges diff.",
    "changes.tooLarge": "A fájl túl nagy a diff megjelenítéséhez.",
    "changes.renamedFrom": "Átnevezve innen: {path}",
    "changes.close": "Bezárás",
    "changes.prevChange": "Előző változás",
    "changes.nextChange": "Következő változás",
    "menu.stashApply": "Stash alkalmazása",
    "menu.stashPop": "Stash kivétele (alkalmaz és töröl)",
    "menu.stashDrop": "Stash eldobása…",
    "newBranch.title": "Branch létrehozása",
    "newBranch.startPoint": "Új branch innen indul: {sha}",
    "newBranch.startPointOn": "({refs})",
    "newBranch.location": "Hely",
    "newBranch.locationRoot": "(gyökér)",
    "newBranch.name": "Branch neve",
    "newBranch.namePlaceholder": "uj-branch",
    "newBranch.fullName": "Teljes név: {name}",
    "newBranch.invalid": "Érvénytelen branch név",
    "newBranch.checkout": "Checkout a branch-re létrehozás után",
    "newBranch.create": "Létrehozás",
    "newBranch.cancel": "Mégse",
    "status.loading": "Gráf betöltése…",
    "status.summary": "{repo}{commits} commit, {refs} ref látható",
    "status.branchCreated": '"{name}" branch létrehozva itt: {sha}',
    "status.error": "Hiba: {message}",
    "status.opFailed": "A művelet sikertelen",
    "status.fetching": "Fetch folyamatban…",
    "status.pulling": "Pull folyamatban…",
    "status.pushing": "Push folyamatban…",
    "status.syncing": "Szinkronizálás…",
    "status.noHead": "Nincs aktuális checkout a gráfban.",
    "status.undoing": "Commit visszavonása…",
    "status.commitUndone": "Commit visszavonva — a változások visszakerültek a working tree-be.",
    "status.undoConflict": "A visszavonás konfliktusba ütközött — oldd fel a szerkesztőben, majd folytasd.",
    "status.stashApplying": "Stash alkalmazása…",
    "status.stashPopping": "Stash kivétele…",
    "status.stashDropping": "Stash eldobása…",
    "status.stashApplied": "Stash alkalmazva.",
    "status.stashPopped": "Stash kivéve.",
    "status.stashDropped": "Stash eldobva.",
    "status.stashConflict": "Stash konfliktus — oldd fel a szerkesztőben.",
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
