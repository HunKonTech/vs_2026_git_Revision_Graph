import { LANGUAGES, getLang, setLang, t, onLangChange } from "./i18n.js";
import { getMainBranch, setMainBranch } from "./mainBranch.js";
import { getDisplayMode, setDisplayMode, type DisplayMode } from "./displayMode.js";
import { getBranchDialogMode, setBranchDialogMode } from "./branchDialogMode.js";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "./theme.js";
import { getDiffMinimap, setDiffMinimap } from "./diffMinimap.js";
import { detectHost } from "./host.js";
import {
  svnDialogSchematic,
  nativeDialogSchematic,
  modernGraphSchematic,
  classicGraphSchematic,
  lightThemeSchematic,
  darkThemeSchematic,
  diffMinimapOnSchematic,
  diffMinimapOffSchematic,
} from "./schematics.js";

/** Context the settings dialog needs from the app. */
export interface SettingsContext {
  /** Branch names available to pick as the main branch (trunk). */
  branches: string[];
}

let openOverlay: HTMLElement | null = null;
let langUnsub: (() => void) | null = null;

/** Close the settings dialog if open. */
export function closeSettings(): void {
  if (openOverlay) {
    openOverlay.remove();
    openOverlay = null;
  }
  if (langUnsub) {
    langUnsub();
    langUnsub = null;
  }
}

/**
 * Toggle the settings modal — a centered dialog over a dimming backdrop. Holds
 * the general (language, branch-dialog style) and graph (main branch, display
 * style) options.
 */
export function toggleSettings(ctx: SettingsContext): void {
  if (openOverlay) {
    closeSettings();
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";

  const modal = document.createElement("div");
  modal.className = "settings-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  overlay.appendChild(modal);

  // Rebuild the modal's content; called again on a language switch so the dialog
  // relabels itself in place instead of closing.
  function render(): void {
    modal.innerHTML = "";

    // ---- Header: title + close (×) ----
    const header = document.createElement("div");
    header.className = "settings-modal-header";

    const title = document.createElement("span");
    title.className = "settings-modal-title";
    title.textContent = t("settings.title");
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "settings-close-x";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", t("settings.close"));
    closeBtn.addEventListener("click", closeSettings);
    header.appendChild(closeBtn);

    modal.appendChild(header);

    // ---- Body ----
    const body = document.createElement("div");
    body.className = "settings-modal-body";

    // General section: language + colour theme + SVN-style branch dialog.
    const general = section(t("settings.sectionGeneral"));
    general.appendChild(languageRow());
    general.appendChild(themeRow());
    general.appendChild(branchDialogRow());
    body.appendChild(general);

    // Graph section: main branch + display style.
    const graph = section(t("settings.sectionGraph"));
    graph.appendChild(mainBranchRow(ctx));
    graph.appendChild(displayModeRow());
    body.appendChild(graph);

    // Changes-view section: the diff minimap toggle.
    const changes = section(t("settings.sectionChanges"));
    changes.appendChild(diffMinimapRow());
    body.appendChild(changes);

    modal.appendChild(body);

    // ---- Footer: Done ----
    const footer = document.createElement("div");
    footer.className = "settings-modal-footer";
    const doneBtn = document.createElement("button");
    doneBtn.className = "settings-done";
    doneBtn.type = "button";
    doneBtn.textContent = t("settings.done");
    doneBtn.addEventListener("click", closeSettings);
    footer.appendChild(doneBtn);
    modal.appendChild(footer);
  }

  render();
  // Re-render in place when the language changes (instead of closing the dialog).
  langUnsub = onLangChange(render);

  // Clicking the dimmed backdrop (but not the modal) closes the dialog.
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeSettings();
  });

  document.body.appendChild(overlay);
  openOverlay = overlay;
}

/** A titled group of rows inside the dialog body. */
function section(titleText: string): HTMLElement {
  const sec = document.createElement("div");
  sec.className = "settings-section";
  const head = document.createElement("div");
  head.className = "settings-section-title";
  head.textContent = titleText;
  sec.appendChild(head);
  return sec;
}

function labeledRow(labelText: string): { row: HTMLElement; control: HTMLElement } {
  const row = document.createElement("label");
  row.className = "settings-row";
  const label = document.createElement("span");
  label.className = "settings-row-label";
  label.textContent = labelText;
  row.appendChild(label);
  const control = document.createElement("div");
  control.className = "settings-row-control";
  row.appendChild(control);
  return { row, control };
}

function languageRow(): HTMLElement {
  const { row, control } = labeledRow(t("settings.language"));
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const { code, label: name } of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    if (code === getLang()) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => setLang(select.value as never));
  control.appendChild(select);
  return row;
}

/**
 * Branch-dialog style picker: two clickable schematic cards — the SVN-style
 * folder-tree dialog vs the embedding IDE's own native branch prompt. The
 * native card's preview and label follow the detected host (VS Code / Visual
 * Studio); in the dev harness it shows the VS Code style.
 */
function branchDialogRow(): HTMLElement {
  const row = stackedRow(t("settings.branchDialog"));
  const host = detectHost();
  const nativeTitle =
    host === "vs" ? t("settings.branchDialogNativeVs") : t("settings.branchDialogNativeVscode");
  const cards: CardDef[] = [
    {
      key: "svn",
      title: t("settings.branchDialogSvnTitle"),
      caption: t("settings.svnBranchDialogHint"),
      svg: svnDialogSchematic(),
    },
    {
      key: "native",
      title: nativeTitle,
      caption: t("settings.branchDialogNativeHint"),
      svg: nativeDialogSchematic(host),
    },
  ];
  const selected = getBranchDialogMode() ? "svn" : "native";
  row.appendChild(cardGroup(cards, selected, (key) => setBranchDialogMode(key === "svn")));
  return row;
}

/**
 * Colour-theme picker: two clickable schematic cards — light vs dark. The
 * selected card reflects the effective theme (the override, or the host's theme
 * when set to follow the IDE), read from the applied `data-theme` on :root.
 */
function themeRow(): HTMLElement {
  const row = stackedRow(t("settings.theme"));
  const effective =
    getThemeChoice() || (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const cards: CardDef[] = [
    {
      key: "light",
      title: t("settings.themeLight"),
      caption: t("settings.themeLightHint"),
      svg: lightThemeSchematic(),
    },
    {
      key: "dark",
      title: t("settings.themeDark"),
      caption: t("settings.themeDarkHint"),
      svg: darkThemeSchematic(),
    },
  ];
  row.appendChild(cardGroup(cards, effective, (key) => setThemeChoice(key as ThemeChoice)));
  return row;
}

/** Main-branch picker: a combobox whose dropdown filters branches via a search box. */
function mainBranchRow(ctx: SettingsContext): HTMLElement {
  const row = stackedRow(t("settings.mainBranch"));

  // Options: "Automatic" first, then every branch; keep a stored choice visible
  // even if it is no longer in the current ref list.
  const chosen = getMainBranch();
  const options: { value: string; label: string }[] = [
    { value: "", label: t("settings.mainBranchAuto") },
    ...ctx.branches.map((name) => ({ value: name, label: name })),
  ];
  if (chosen && !ctx.branches.includes(chosen)) options.push({ value: chosen, label: chosen });
  const labelOf = (v: string) =>
    options.find((o) => o.value === v)?.label ?? t("settings.mainBranchAuto");

  const combo = document.createElement("div");
  combo.className = "settings-combo";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "settings-combo-trigger";
  const valueEl = document.createElement("span");
  valueEl.className = "settings-combo-value";
  valueEl.textContent = labelOf(chosen);
  const caret = document.createElement("span");
  caret.className = "settings-combo-caret";
  caret.textContent = "▾";
  trigger.append(valueEl, caret);
  combo.appendChild(trigger);

  const panel = document.createElement("div");
  panel.className = "settings-combo-panel";
  panel.hidden = true;
  const search = document.createElement("input");
  search.type = "text";
  search.className = "settings-input settings-combo-search";
  search.placeholder = t("settings.mainBranchSearch");
  const list = document.createElement("div");
  list.className = "settings-combo-list";
  panel.append(search, list);
  combo.appendChild(panel);

  let open = false;
  const onOutside = (e: MouseEvent): void => {
    if (!combo.contains(e.target as Node)) closePanel();
  };
  function openPanel(): void {
    open = true;
    panel.hidden = false;
    search.value = "";
    renderList("");
    document.addEventListener("mousedown", onOutside, true);
    setTimeout(() => search.focus(), 0);
  }
  function closePanel(): void {
    if (!open) return;
    open = false;
    panel.hidden = true;
    document.removeEventListener("mousedown", onOutside, true);
  }
  function renderList(filter: string): void {
    list.innerHTML = "";
    const f = filter.trim().toLowerCase();
    const matches = f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-combo-empty";
      empty.textContent = t("settings.mainBranchNoMatch");
      list.appendChild(empty);
      return;
    }
    for (const o of matches) {
      const item = document.createElement("div");
      item.className = "settings-combo-item";
      if (o.value === getMainBranch()) item.classList.add("selected");
      item.textContent = o.label;
      item.addEventListener("click", () => {
        setMainBranch(o.value);
        valueEl.textContent = labelOf(o.value);
        closePanel();
      });
      list.appendChild(item);
    }
  }

  trigger.addEventListener("click", () => (open ? closePanel() : openPanel()));
  search.addEventListener("input", () => renderList(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePanel();
      trigger.focus();
    }
  });

  row.appendChild(combo);
  return row;
}

/**
 * Display-style picker: two clickable schematic cards — the modern free canvas
 * vs the classic SVN-style fixed canvas — each captioned with how to navigate it.
 */
function displayModeRow(): HTMLElement {
  const row = stackedRow(t("settings.display"));
  const cards: CardDef[] = [
    {
      key: "modern",
      title: t("settings.displayModern"),
      caption: t("settings.displayModernHint"),
      svg: modernGraphSchematic(),
    },
    {
      key: "classic",
      title: t("settings.displayClassic"),
      caption: t("settings.displayClassicHint"),
      svg: classicGraphSchematic(),
    },
  ];
  row.appendChild(cardGroup(cards, getDisplayMode(), (key) => setDisplayMode(key as DisplayMode)));
  return row;
}

/**
 * Diff-minimap picker: two clickable schematic cards — overview strip shown vs
 * hidden. Mirrors the VS Code editor minimap, drawn beside the file diff.
 */
function diffMinimapRow(): HTMLElement {
  const row = stackedRow(t("settings.diffMinimap"));
  const cards: CardDef[] = [
    {
      key: "on",
      title: t("settings.diffMinimapOn"),
      caption: t("settings.diffMinimapOnHint"),
      svg: diffMinimapOnSchematic(),
    },
    {
      key: "off",
      title: t("settings.diffMinimapOff"),
      caption: t("settings.diffMinimapOffHint"),
      svg: diffMinimapOffSchematic(),
    },
  ];
  row.appendChild(cardGroup(cards, getDiffMinimap() ? "on" : "off", (key) => setDiffMinimap(key === "on")));
  return row;
}

/** A stacked settings row with a heading label, ready for full-width content. */
function stackedRow(labelText: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row settings-row-stacked";
  const label = document.createElement("div");
  label.className = "settings-row-label";
  label.textContent = labelText;
  row.appendChild(label);
  return row;
}

/** One option in a {@link cardGroup}: a schematic preview + title + caption. */
interface CardDef {
  key: string;
  title: string;
  caption: string;
  /** Inline SVG markup for the preview. */
  svg: string;
}

/**
 * A row of clickable image cards (a radio group rendered as pictures). The
 * selected card is highlighted; clicking one selects it and invokes `onSelect`.
 */
function cardGroup(cards: CardDef[], selectedKey: string, onSelect: (key: string) => void): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "settings-cards";
  for (const c of cards) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "settings-card";
    card.dataset.key = c.key;
    if (c.key === selectedKey) card.classList.add("selected");

    const pic = document.createElement("div");
    pic.className = "settings-card-pic";
    pic.innerHTML = c.svg;
    card.appendChild(pic);

    const title = document.createElement("div");
    title.className = "settings-card-title";
    title.textContent = c.title;
    card.appendChild(title);

    const cap = document.createElement("div");
    cap.className = "settings-card-cap";
    cap.textContent = c.caption;
    card.appendChild(cap);

    card.addEventListener("click", () => {
      grid.querySelectorAll(".settings-card.selected").forEach((e) => e.classList.remove("selected"));
      card.classList.add("selected");
      onSelect(c.key);
    });
    grid.appendChild(card);
  }
  return grid;
}

// Dismiss on Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
});
