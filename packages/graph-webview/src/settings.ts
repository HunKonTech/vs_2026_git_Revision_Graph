import { LANGUAGES, getLang, setLang, t } from "./i18n.js";
import { getMainBranch, setMainBranch } from "./mainBranch.js";

/** Context the settings panel needs from the app. */
export interface SettingsContext {
  /** Branch names available to pick as the main branch (trunk). */
  branches: string[];
}

let openPanel: HTMLElement | null = null;

/** Close the settings panel if open. */
export function closeSettings(): void {
  if (openPanel) {
    openPanel.remove();
    openPanel = null;
  }
}

/**
 * Toggle a small settings popover anchored near the toolbar. Currently holds
 * the language picker; structured so more options can be added later.
 */
export function toggleSettings(anchor: HTMLElement, ctx: SettingsContext): void {
  if (openPanel) {
    closeSettings();
    return;
  }

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const header = document.createElement("div");
  header.className = "settings-header";
  header.textContent = t("settings.title");
  panel.appendChild(header);

  // Language row.
  const row = document.createElement("label");
  row.className = "settings-row";

  const label = document.createElement("span");
  label.textContent = t("settings.language");
  row.appendChild(label);

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
  row.appendChild(select);
  panel.appendChild(row);

  // Main branch (trunk) row — pins the chosen branch to the leftmost lane.
  const branchRow = document.createElement("label");
  branchRow.className = "settings-row";

  const branchLabel = document.createElement("span");
  branchLabel.textContent = t("settings.mainBranch");
  branchRow.appendChild(branchLabel);

  const branchSelect = document.createElement("select");
  branchSelect.className = "settings-select";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = t("settings.mainBranchAuto");
  branchSelect.appendChild(auto);
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
    branchSelect.appendChild(opt);
  }
  // Keep a stored choice visible even if it is not in the current ref list.
  if (chosen && !chosenSeen) {
    const opt = document.createElement("option");
    opt.value = chosen;
    opt.textContent = chosen;
    opt.selected = true;
    branchSelect.appendChild(opt);
  }
  branchSelect.addEventListener("change", () => setMainBranch(branchSelect.value));
  branchRow.appendChild(branchSelect);
  panel.appendChild(branchRow);

  // Anchor below the toolbar, aligned to the toolbar's left edge.
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.left = `${rect.left + 8}px`;

  document.body.appendChild(panel);
  openPanel = panel;
}

// Dismiss on outside click / Escape.
window.addEventListener("mousedown", (e) => {
  const target = e.target as Element;
  if (openPanel && !target.closest(".settings-panel") && !target.closest('[data-act="settings"]')) {
    closeSettings();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
});
