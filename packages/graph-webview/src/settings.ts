import { LANGUAGES, getLang, setLang, t } from "./i18n.js";
import { getMainBranch, setMainBranch } from "./mainBranch.js";
import { DISPLAY_MODES, getDisplayMode, setDisplayMode, type DisplayMode } from "./displayMode.js";

/** Context the settings dialog needs from the app. */
export interface SettingsContext {
  /** Branch names available to pick as the main branch (trunk). */
  branches: string[];
}

let openOverlay: HTMLElement | null = null;

/** Close the settings dialog if open. */
export function closeSettings(): void {
  if (openOverlay) {
    openOverlay.remove();
    openOverlay = null;
  }
}

/**
 * Toggle the settings modal — a centered dialog over a dimming backdrop. Holds
 * the general (language) and graph (main branch, display style) options.
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

  // General section: language.
  const general = section(t("settings.sectionGeneral"));
  general.appendChild(languageRow());
  body.appendChild(general);

  // Graph section: main branch + display style.
  const graph = section(t("settings.sectionGraph"));
  graph.appendChild(mainBranchRow(ctx));
  graph.appendChild(displayModeRow());
  body.appendChild(graph);

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

  // Clicking the dimmed backdrop (but not the modal) closes the dialog.
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeSettings();
  });

  overlay.appendChild(modal);
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

function mainBranchRow(ctx: SettingsContext): HTMLElement {
  const { row, control } = labeledRow(t("settings.mainBranch"));
  const select = document.createElement("select");
  select.className = "settings-select";

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = t("settings.mainBranchAuto");
  select.appendChild(auto);

  const chosen = getMainBranch();
  let chosenSeen = false;
  for (const name of ctx.branches) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === chosen) {
      opt.selected = true;
      chosenSeen = true;
    }
    select.appendChild(opt);
  }
  // Keep a stored choice visible even if it is not in the current ref list.
  if (chosen && !chosenSeen) {
    const opt = document.createElement("option");
    opt.value = chosen;
    opt.textContent = chosen;
    opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => setMainBranch(select.value));
  control.appendChild(select);
  return row;
}

/** Hint text shown under the display-style selector for the chosen mode. */
function displayHint(mode: DisplayMode): string {
  return mode === "classic" ? t("settings.displayClassicHint") : t("settings.displayModernHint");
}

function displayModeRow(): HTMLElement {
  const { row, control } = labeledRow(t("settings.display"));
  row.classList.add("settings-row-stacked");

  const select = document.createElement("select");
  select.className = "settings-select";
  for (const mode of DISPLAY_MODES) {
    const opt = document.createElement("option");
    opt.value = mode;
    opt.textContent = mode === "classic" ? t("settings.displayClassic") : t("settings.displayModern");
    if (mode === getDisplayMode()) opt.selected = true;
    select.appendChild(opt);
  }
  control.appendChild(select);

  const hint = document.createElement("div");
  hint.className = "settings-hint";
  hint.textContent = displayHint(getDisplayMode());
  row.appendChild(hint);

  select.addEventListener("change", () => {
    const mode = select.value as DisplayMode;
    setDisplayMode(mode);
    hint.textContent = displayHint(mode);
  });
  return row;
}

// Dismiss on Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
});
