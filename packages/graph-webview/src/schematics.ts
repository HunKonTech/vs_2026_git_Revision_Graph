/**
 * Schematic SVG previews of the various dialog / display styles, used by the
 * settings dialog's clickable "image cards".
 *
 * Single source of truth: this module is DOM-free (pure string building), so it
 * is consumed two ways from the *same* code:
 *   1. The settings UI inlines these SVGs as the card previews (see settings.ts).
 *   2. The build emits standalone `.svg` files from {@link ALL_SCHEMATICS}
 *      (see graph-webview/build.mjs), copied into both hosts.
 * Because both paths render from here, the pictures always follow the code: when
 * a dialog's structure changes you update the schematic here and every preview —
 * inline and on disk — regenerates on the next build.
 *
 * To keep the SVN-style preview honest, its folder tree is produced by the real
 * {@link buildBranchTree} algorithm (the same one the actual New Branch dialog
 * uses), not a hand-drawn list — so a change to that grouping logic is reflected
 * in the picture automatically.
 *
 * Colors use `var(--token, fallback)` so the SVG themes itself when inlined in
 * the webview, and still renders with sane defaults as a standalone file.
 */

import { buildBranchTree, type BranchTreeNode } from "./branchTree.js";

/** Theme tokens, with standalone fallbacks, referenced by every schematic. */
const C = {
  bg: "var(--bg, #1e1e1e)",
  fg: "var(--fg, #d4d4d4)",
  border: "var(--border, #3c3c3c)",
  accent: "var(--accent, #0e639c)",
  // A muted fill for inert surfaces (inputs, scrollbars) — semi-transparent so
  // it reads on both light and dark themes.
  muted: "rgba(128,128,128,0.18)",
  faint: "rgba(128,128,128,0.10)",
};

const W = 300;
const H = 190;

/** Open an SVG with the shared viewBox and a rounded panel background. */
function open(): string {
  return (
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" ` +
    `preserveAspectRatio="xMidYMid meet" font-family="system-ui, sans-serif">` +
    rect(0, 0, W, H, { fill: C.bg, stroke: C.border, r: 8 })
  );
}
function close(): string {
  return `</svg>`;
}

interface RectOpts {
  fill?: string;
  stroke?: string;
  r?: number;
  dashed?: boolean;
  sw?: number;
}
function rect(x: number, y: number, w: number, h: number, o: RectOpts = {}): string {
  const fill = o.fill ?? "none";
  const stroke = o.stroke ?? "none";
  const r = o.r ?? 0;
  const dash = o.dashed ? ` stroke-dasharray="3 3"` : "";
  const sw = o.stroke ? ` stroke-width="${o.sw ?? 1}"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"${sw}${dash}/>`;
}

interface TextOpts {
  size?: number;
  weight?: number;
  opacity?: number;
  anchor?: "start" | "middle" | "end";
  fill?: string;
}
function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const size = o.size ?? 9;
  const weight = o.weight ?? 400;
  const opacity = o.opacity ?? 1;
  const anchor = o.anchor ?? "start";
  const fill = o.fill ?? C.fg;
  return (
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" ` +
    `fill="${fill}" opacity="${opacity}" text-anchor="${anchor}">${escapeXml(s)}</text>`
  );
}
function line(x1: number, y1: number, x2: number, y2: number, o: { dashed?: boolean; sw?: number; stroke?: string } = {}): string {
  const dash = o.dashed ? ` stroke-dasharray="4 3"` : "";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke ?? C.fg}" stroke-width="${o.sw ?? 1}"${dash}/>`;
}
function circle(cx: number, cy: number, r: number, o: { fill?: string; stroke?: string; sw?: number } = {}): string {
  const sw = o.stroke ? ` stroke-width="${o.sw ?? 1}"` : "";
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill ?? "none"}" stroke="${o.stroke ?? "none"}"${sw}/>`;
}
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** A small window chrome: title-bar with a title and three caption dots. */
function windowChrome(title: string): string {
  return (
    rect(8, 8, W - 16, 22, { fill: C.faint, r: 4 }) +
    text(16, 23, title, { size: 10, weight: 600 }) +
    circle(W - 18, 19, 3, { stroke: C.border, sw: 1 })
  );
}

/** A labelled text-input box. */
function field(x: number, y: number, w: number, label: string, placeholder?: string): string {
  let out = text(x, y - 3, label, { size: 8, opacity: 0.6 });
  out += rect(x, y, w, 16, { fill: C.muted, stroke: C.border, r: 3 });
  if (placeholder) out += text(x + 6, y + 11, placeholder, { size: 8, opacity: 0.55 });
  return out;
}

/** A button pill (filled = primary). */
function button(x: number, y: number, w: number, label: string, primary = false): string {
  return (
    rect(x, y, w, 16, { fill: primary ? C.accent : C.muted, stroke: primary ? "none" : C.border, r: 4 }) +
    text(x + w / 2, y + 11, label, { size: 8, anchor: "middle", fill: primary ? "#fff" : C.fg })
  );
}

// ---------------------------------------------------------------------------
// SVN-style "Create Branch" dialog — mirrors newBranchDialog.ts: a start-point
// line, a Location folder tree, a name field, and a checkout row + buttons.
// The tree is built by the real buildBranchTree() so it tracks that algorithm.
// ---------------------------------------------------------------------------
function svnTreeRows(): string {
  // A representative branch set; rendered through the real grouping algorithm.
  const sample = ["feature/login", "feature/signup", "release/1.0"];
  const flat: { label: string; depth: number; folder: boolean }[] = [
    { label: "(root)", depth: 0, folder: true },
  ];
  const walk = (nodes: BranchTreeNode[], depth: number): void => {
    for (const n of nodes) {
      flat.push({ label: n.name, depth, folder: n.isFolder });
      if (n.isFolder) walk(n.children, depth + 1);
    }
  };
  walk(buildBranchTree(sample), 1);

  let out = "";
  let y = 70;
  // Only as many rows as fit the tree box.
  for (const row of flat.slice(0, 5)) {
    const x = 20 + row.depth * 12;
    const selected = row.label === "feature";
    if (selected) out += rect(16, y - 9, W - 32 - 8, 13, { fill: C.accent, r: 2 });
    const icon = row.folder ? "▸" : "⎇";
    out += text(x, y, icon, { size: 8, opacity: row.folder ? 0.9 : 0.5, fill: selected ? "#fff" : C.fg });
    out += text(x + 11, y, row.label, { size: 8, opacity: row.folder ? 1 : 0.5, fill: selected ? "#fff" : C.fg });
    y += 14;
  }
  return out;
}

export function svnDialogSchematic(): string {
  let s = open();
  s += windowChrome("Create Branch");
  s += text(16, 46, "New branch from a1b2c3d", { size: 8, opacity: 0.7 });
  s += text(16, 60, "Location", { size: 8, weight: 600, opacity: 0.7 });
  s += rect(12, 50, W - 24, 78, { stroke: C.border, r: 4 });
  s += svnTreeRows();
  s += field(16, 144, W - 32, "Branch name", "my-branch");
  s += button(W - 70, 168, 58, "Create", true);
  s += button(W - 134, 168, 58, "Cancel");
  return s + close();
}

// ---------------------------------------------------------------------------
// VS Code native — the Quick Input box: a single input pinned near the top of
// the window with a prompt line beneath it.
// ---------------------------------------------------------------------------
export function vscodeDialogSchematic(): string {
  let s = open();
  // Editor backdrop hint.
  s += rect(8, 8, W - 16, H - 16, { fill: C.faint, r: 4 });
  // Centered quick-input dropped from the top.
  const qx = 40;
  const qw = W - 80;
  s += rect(qx, 26, qw, 40, { fill: C.bg, stroke: C.accent, r: 4, sw: 1 });
  s += rect(qx + 8, 36, qw - 16, 16, { fill: C.muted, stroke: C.border, r: 3 });
  s += text(qx + 14, 47, "my-branch", { size: 8 });
  s += text(qx + 8, 62, "Branch name (Press Enter to confirm)", { size: 7, opacity: 0.6 });
  // Caret-ish blinking bar.
  s += line(qx + 14 + 46, 41, qx + 14 + 46, 49, { stroke: C.fg, sw: 1 });
  s += text(W / 2, H - 14, "VS Code input box", { size: 8, anchor: "middle", opacity: 0.5 });
  return s + close();
}

// ---------------------------------------------------------------------------
// Visual Studio native — the "Create a new branch" modal: name field, a
// "Based on" dropdown, a checkout checkbox, and Create/Cancel buttons.
// ---------------------------------------------------------------------------
export function vsDialogSchematic(): string {
  let s = open();
  s += windowChrome("Create a new branch");
  s += field(16, 52, W - 32, "Branch name", "my-branch");
  // "Based on" dropdown.
  s += text(16, 84, "Based on", { size: 8, opacity: 0.6 });
  s += rect(16, 88, W - 32, 16, { fill: C.muted, stroke: C.border, r: 3 });
  s += text(22, 99, "main", { size: 8 });
  s += text(W - 26, 99, "▾", { size: 8, opacity: 0.7 });
  // Checkout checkbox.
  s += rect(16, 116, 10, 10, { fill: C.accent, r: 2 });
  s += text(19, 124, "✓", { size: 8, fill: "#fff" });
  s += text(32, 124, "Checkout branch", { size: 8, opacity: 0.8 });
  s += button(W - 70, 160, 58, "Create", true);
  s += button(W - 134, 160, 58, "Cancel");
  return s + close();
}

/** The native-host preview for whichever IDE is embedding the webview. */
export function nativeDialogSchematic(host: "vscode" | "vs" | "browser"): string {
  return host === "vs" ? vsDialogSchematic() : vscodeDialogSchematic();
}

// ---------------------------------------------------------------------------
// Display style — modern (free canvas) vs classic (fixed, trunk-left, scroll).
// ---------------------------------------------------------------------------

/** Draw a little branch node box. */
function gnode(x: number, y: number, accent = false): string {
  return rect(x, y, 22, 11, { fill: accent ? C.accent : C.muted, stroke: accent ? "none" : C.border, r: 2 });
}

export function modernGraphSchematic(): string {
  let s = open();
  s += rect(8, 8, W - 16, H - 16, { fill: C.faint, r: 4 });
  // Scattered, free-floating nodes connected by curved edges.
  const trunk: [number, number][] = [
    [40, 30],
    [70, 64],
    [110, 100],
    [150, 140],
  ];
  for (let i = 0; i < trunk.length - 1; i++) {
    const [x1, y1] = trunk[i]!;
    const [x2, y2] = trunk[i + 1]!;
    s += line(x1 + 11, y1 + 11, x2 + 11, y2, { stroke: C.fg, sw: 1 });
  }
  // A side branch peeling off.
  s += line(81, 75, 200, 56, { stroke: C.fg, sw: 1 });
  s += line(121, 111, 230, 120, { stroke: C.fg, sw: 1 });
  for (const [x, y] of trunk) s += gnode(x, y, true);
  s += gnode(190, 50);
  s += gnode(224, 114);
  // Pan hand + zoom hint.
  s += text(16, H - 16, "✋ drag to pan", { size: 8, opacity: 0.7 });
  s += text(W - 16, H - 16, "scroll = zoom 🔍", { size: 8, anchor: "end", opacity: 0.7 });
  return s + close();
}

export function classicGraphSchematic(): string {
  let s = open();
  s += rect(8, 8, W - 16, H - 16, { fill: C.faint, r: 4 });
  // Trunk pinned to the left column, branches in fixed columns to the right.
  const colX = [24, 92, 160];
  // Trunk nodes down the left column.
  const trunkYs = [26, 56, 86, 116, 146];
  for (let i = 0; i < trunkYs.length - 1; i++) {
    s += line(colX[0]! + 11, trunkYs[i]! + 11, colX[0]! + 11, trunkYs[i + 1]!, { stroke: C.fg, sw: 1 });
  }
  for (const y of trunkYs) s += gnode(colX[0]!, y, true);
  // A branch in column 2.
  s += line(colX[0]! + 22, 61, colX[1]!, 73, { stroke: C.fg, sw: 1 });
  s += line(colX[1]! + 11, 84, colX[1]! + 11, 114, { stroke: C.fg, sw: 1 });
  s += gnode(colX[1]!, 78);
  s += gnode(colX[1]!, 114);
  // A branch in column 3.
  s += line(colX[1]! + 22, 83, colX[2]!, 96, { stroke: C.fg, sw: 1 });
  s += gnode(colX[2]!, 101);
  // Scrollbars: right (vertical) and bottom (horizontal), the only navigation.
  s += rect(W - 18, 12, 8, H - 40, { fill: C.muted, r: 4 });
  s += rect(W - 17, 40, 6, 40, { fill: C.border, r: 3 });
  s += rect(12, H - 18, W - 40, 8, { fill: C.muted, r: 4 });
  s += rect(20, H - 17, 50, 6, { fill: C.border, r: 3 });
  s += text(16, H - 26, "trunk pinned left · scroll only", { size: 8, opacity: 0.7 });
  return s + close();
}

/**
 * Every schematic by id, for the build-time `.svg` emitter. The native dialog is
 * emitted in both IDE flavours so each host can ship its own file if needed.
 */
export const ALL_SCHEMATICS: { id: string; svg: () => string }[] = [
  { id: "branch-dialog-svn", svg: svnDialogSchematic },
  { id: "branch-dialog-vscode", svg: vscodeDialogSchematic },
  { id: "branch-dialog-vs", svg: vsDialogSchematic },
  { id: "display-modern", svg: modernGraphSchematic },
  { id: "display-classic", svg: classicGraphSchematic },
];
