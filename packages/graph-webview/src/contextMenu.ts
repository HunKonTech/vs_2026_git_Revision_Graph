export interface MenuItem {
  label: string;
  action: () => void;
  separatorBefore?: boolean;
}

let openMenu: HTMLElement | null = null;

/** Close any open context menu. */
export function closeContextMenu(): void {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

/** Show a lightweight DOM context menu at the given client coordinates. */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";

  for (const item of items) {
    if (item.separatorBefore) {
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      menu.appendChild(sep);
    }
    const el = document.createElement("div");
    el.className = "ctx-item";
    el.textContent = item.label;
    el.addEventListener("click", () => {
      closeContextMenu();
      item.action();
    });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  // Keep the menu on-screen.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 4);
  const top = Math.min(y, window.innerHeight - rect.height - 4);
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;
  openMenu = menu;
}

// Dismiss on outside click / Escape / scroll.
window.addEventListener("mousedown", (e) => {
  if (openMenu && !(e.target as Element).closest(".ctx-menu")) closeContextMenu();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeContextMenu();
});
