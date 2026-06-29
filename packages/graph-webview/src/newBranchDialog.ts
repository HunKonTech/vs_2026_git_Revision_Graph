import { t, onLangChange } from "./i18n.js";
import { buildBranchTree, type BranchTreeNode } from "./branchTree.js";

/** What the dialog needs to know, and what to do when the user confirms. */
export interface NewBranchContext {
  /** Full sha the branch will start from. */
  sha: string;
  /** Names of refs sitting on that commit, for the "starting from" line. */
  startRefs: string[];
  /** Existing branch names (remote prefixes already stripped) for the tree. */
  branchNames: string[];
  /** Called with the chosen full branch name and whether to check it out. */
  onCreate: (name: string, checkout: boolean) => void;
}

// Whitespace + the characters git refuses in ref names. Mirrors the regex in
// vscode/src/branch.ts and vs/NewBranchDialog.xaml.cs.
const INVALID = /[\s~^:?*\[\\]/;

/** True when `name` is a valid git branch name. */
function isValidBranchName(name: string): boolean {
  const v = name.trim();
  if (!v) return false;
  if (INVALID.test(v)) return false;
  if (v.startsWith("-") || v.endsWith("/") || v.endsWith(".lock")) return false;
  if (v.includes("//") || v.includes("..")) return false;
  return true;
}

let openOverlay: HTMLElement | null = null;
let langUnsub: (() => void) | null = null;

/** Close the new-branch dialog if open. */
export function closeNewBranchDialog(): void {
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
 * Open the TortoiseSVN-style "Create Branch" dialog: a folder-tree location
 * picker (folders selectable, branches shown for context), the start point, a
 * branch-name field with live git-rule validation, and a checkout checkbox.
 */
export function openNewBranchDialog(ctx: NewBranchContext): void {
  closeNewBranchDialog();

  // Dialog state, closed over by the builders below.
  let selectedFolder = ""; // "" = repository root (no prefix)
  let checkout = true;

  // Existing full branch names, for the "already exists" duplicate check.
  const existing = new Set(ctx.branchNames.map((n) => n.trim()).filter(Boolean));

  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  const modal = document.createElement("div");
  modal.className = "settings-modal newbranch-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  overlay.appendChild(modal);

  // Re-render the whole modal so a mid-dialog language switch relabels it while
  // preserving the user's current selection/input.
  let nameValue = "";
  function render(): void {
    modal.innerHTML = "";

    // ---- Header ----
    const header = el("div", "settings-modal-header");
    header.appendChild(el("span", "settings-modal-title", t("newBranch.title")));
    const closeBtn = button("settings-close-x", "×", closeNewBranchDialog);
    closeBtn.setAttribute("aria-label", t("newBranch.cancel"));
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // ---- Body ----
    const body = el("div", "settings-modal-body");

    // Start point.
    const shortSha = ctx.sha.slice(0, 7);
    const startText =
      t("newBranch.startPoint", { sha: shortSha }) +
      (ctx.startRefs.length ? "  " + t("newBranch.startPointOn", { refs: ctx.startRefs.join(", ") }) : "");
    body.appendChild(el("div", "newbranch-startpoint", startText));

    // Location (folder tree).
    body.appendChild(el("div", "settings-section-title", t("newBranch.location")));
    const treeBox = el("div", "newbranch-tree");
    treeBox.appendChild(folderRow(t("newBranch.locationRoot"), "", 0));
    for (const node of buildBranchTree(ctx.branchNames)) renderNode(node, treeBox, 1);
    body.appendChild(treeBox);

    // Branch name.
    body.appendChild(el("div", "settings-section-title", t("newBranch.name")));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "settings-input newbranch-name";
    nameInput.placeholder = t("newBranch.namePlaceholder");
    nameInput.value = nameValue;
    body.appendChild(nameInput);

    const fullNameLine = el("div", "newbranch-fullname");
    const invalidLine = el("div", "newbranch-invalid", t("newBranch.invalid"));
    const existsLine = el("div", "newbranch-invalid", t("newBranch.exists"));
    body.appendChild(fullNameLine);
    body.appendChild(invalidLine);
    body.appendChild(existsLine);

    // Checkout checkbox.
    const checkoutRow = document.createElement("label");
    checkoutRow.className = "newbranch-checkout";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checkout;
    checkoutRow.appendChild(cb);
    checkoutRow.appendChild(el("span", "", t("newBranch.checkout")));
    body.appendChild(checkoutRow);

    modal.appendChild(body);

    // ---- Footer ----
    const footer = el("div", "settings-modal-footer");
    const cancelBtn = button("settings-secondary", t("newBranch.cancel"), closeNewBranchDialog);
    const createBtn = button("settings-done", t("newBranch.create"), submit);
    footer.append(cancelBtn, createBtn);
    modal.appendChild(footer);

    // ---- Behaviour ----
    function fullName(): string {
      const n = nameInput.value.trim();
      return selectedFolder && n ? `${selectedFolder}/${n}` : n;
    }
    function refreshValidity(): void {
      const full = fullName();
      const has = nameInput.value.trim().length > 0;
      const validName = has && isValidBranchName(full);
      const duplicate = has && existing.has(full);
      const valid = validName && !duplicate;
      fullNameLine.textContent = full ? t("newBranch.fullName", { name: full }) : "";
      // Invalid characters and "already exists" are mutually exclusive messages —
      // a duplicate is by definition a syntactically valid name.
      invalidLine.classList.toggle("visible", has && !validName);
      existsLine.classList.toggle("visible", duplicate);
      nameInput.classList.toggle("error", has && !valid);
      // Mark the matching branch leaf in the tree red so it's clear which one clashes.
      treeBox.querySelectorAll(".newbranch-leaf.clash").forEach((r) => r.classList.remove("clash"));
      if (duplicate) {
        const clash = treeBox.querySelector(`.newbranch-leaf[data-path="${cssEscape(full)}"]`);
        clash?.classList.add("clash");
      }
      createBtn.toggleAttribute("disabled", !valid);
    }
    function submit(): void {
      const full = fullName();
      if (!isValidBranchName(full) || existing.has(full)) return;
      const co = cb.checked;
      closeNewBranchDialog();
      ctx.onCreate(full, co);
    }

    cb.addEventListener("change", () => (checkout = cb.checked));
    nameInput.addEventListener("input", () => {
      nameValue = nameInput.value;
      refreshValidity();
    });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    // Tree selection (event-delegated so it survives re-render). Folders set the
    // location prefix; branch leaves additionally fill the name with that branch's
    // own name — which then trips the "already exists" check.
    treeBox.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const folder = target.closest(".newbranch-folder") as HTMLElement | null;
      const leaf = target.closest(".newbranch-leaf") as HTMLElement | null;
      if (folder) {
        selectedFolder = folder.dataset.path ?? "";
      } else if (leaf) {
        const path = leaf.dataset.path ?? "";
        const slash = path.lastIndexOf("/");
        selectedFolder = slash >= 0 ? path.slice(0, slash) : "";
        nameValue = slash >= 0 ? path.slice(slash + 1) : path;
        nameInput.value = nameValue;
      } else {
        return;
      }
      treeBox.querySelectorAll(".selected").forEach((r) => r.classList.remove("selected"));
      (folder ?? leaf)!.classList.add("selected");
      refreshValidity();
    });

    // Restore the selection highlight after a re-render (folder, or a leaf whose
    // path equals the current full name).
    const selFolder = treeBox.querySelector(`.newbranch-folder[data-path="${cssEscape(selectedFolder)}"]`);
    selFolder?.classList.add("selected");
    const selLeaf = treeBox.querySelector(`.newbranch-leaf[data-path="${cssEscape(fullName())}"]`);
    selLeaf?.classList.add("selected");

    refreshValidity();
    setTimeout(() => nameInput.focus(), 0);
  }

  render();
  langUnsub = onLangChange(render);

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeNewBranchDialog();
  });
  document.body.appendChild(overlay);
  openOverlay = overlay;
}

/** Render a tree node (and its children) into a container at the given depth. */
function renderNode(node: BranchTreeNode, container: HTMLElement, depth: number): void {
  if (node.isFolder) {
    container.appendChild(folderRow(node.name, node.path, depth));
    for (const child of node.children) renderNode(child, container, depth + 1);
  } else {
    container.appendChild(leafRow(node.name, node.path, depth));
  }
}

function folderRow(label: string, path: string, depth: number): HTMLElement {
  const row = el("div", "newbranch-folder", "");
  row.dataset.path = path;
  row.style.paddingLeft = `${6 + depth * 16}px`;
  row.appendChild(el("span", "newbranch-folder-icon", "📁"));
  row.appendChild(el("span", "newbranch-folder-label", label));
  return row;
}

function leafRow(label: string, path: string, depth: number): HTMLElement {
  const row = el("div", "newbranch-leaf", "");
  row.dataset.path = path;
  row.style.paddingLeft = `${6 + depth * 16}px`;
  row.appendChild(el("span", "newbranch-leaf-icon", "⎇"));
  row.appendChild(el("span", "newbranch-leaf-label", label));
  return row;
}

/* small DOM helpers */
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
/** Escape a string for use inside a CSS attribute selector. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

// Dismiss on Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNewBranchDialog();
});
