import { LANGUAGES, getLang, setLang, t } from "./i18n.js";

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
export function toggleSettings(anchor: HTMLElement): void {
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
