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
  // Connector lines between commit boxes.
  edge: "rgba(128,128,128,0.65)",
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
// Display style — both modes render the SAME branch-column grid (computeLayout):
// the trunk pinned to the leftmost lane, side branches in lanes to the right,
// landscape commit cards (branch header + text) stacked by generation and joined
// by orthogonal elbow edges. The modes differ only in navigation, so the cards
// are identical and only the surrounding chrome changes:
//   modern  — a free canvas (pan + zoom affordances, no scrollbars)
//   classic — a fixed canvas pinned top-left, navigated by scrollbars
// Card geometry echoes the real renderer's grid (BOX_W 170 / LANE_W 210).
// ---------------------------------------------------------------------------

const CW = 82; // card width
const CH = 34; // card height (~2:1 landscape, like the real boxes)
const LANE = 104; // column pitch (card + gutter)
const ROW = 46; // row pitch (card + vertical gap)

/** A commit card: a header strip carrying the branch name + two faint text lines. */
function commitCard(x: number, y: number, label: string, accent = false): string {
  let s = rect(x, y, CW, CH, { fill: C.bg, stroke: accent ? C.accent : C.border, r: 3, sw: accent ? 1.4 : 1 });
  // Accent cards get a thin left bar, echoing the HEAD marker on the current box.
  if (accent) s += rect(x - 3, y + 4, 2, CH - 8, { fill: C.accent, r: 1 });
  // Header strip (the branch name sits here in the real box).
  s += rect(x + 1, y + 1, CW - 2, 11, { fill: accent ? "rgba(14,99,156,0.30)" : C.muted, r: 2 });
  s += text(x + 6, y + 9, label, { size: 7, weight: 600, opacity: 0.9 });
  // Two faint "text" lines (sha / summary).
  s += rect(x + 6, y + 18, CW - 26, 3, { fill: C.muted });
  s += rect(x + 6, y + 25, CW - 40, 3, { fill: C.muted });
  return s;
}

/** A straight vertical connector between two stacked cards in one column. */
function vEdge(cx: number, y1: number, y2: number): string {
  return line(cx, y1, cx, y2, { stroke: C.edge, sw: 1.2 });
}

/** An orthogonal polyline edge (the elbow routing a branch back to the trunk). */
function elbow(pts: [number, number][]): string {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]![0]} ${pts[i]![1]}`;
  return `<path d="${d}" fill="none" stroke="${C.edge}" stroke-width="1.2"/>`;
}

/**
 * The shared graph: a three-commit trunk column at (ox,oy) with a two-commit
 * side branch one lane to its right, forking back into the trunk's bottom commit
 * via an elbow — exactly the grid both display modes lay out.
 */
function graphBoxes(ox: number, oy: number): string {
  const TX = ox;
  const BX = ox + LANE;
  const y0 = oy;
  const y1 = oy + ROW;
  const y2 = oy + 2 * ROW;
  const tcx = TX + CW / 2;
  const bcx = BX + CW / 2;

  let s = "";
  // Edges first so the cards paint over their ends.
  s += vEdge(tcx, y0 + CH, y1); // trunk: card 0 -> card 1
  s += vEdge(tcx, y1 + CH, y2); // trunk: card 1 -> card 2
  s += vEdge(bcx, y0 + CH, y1); // branch: card 0 -> card 1
  // Fork: branch's lower card down through the row gap, across a gutter, into the
  // trunk's bottom card — the orthogonal corridor routing the renderer uses.
  const g1 = y1 + CH + 6;
  const g2 = y2 - 6;
  const xCorr = BX - 11;
  s += elbow([
    [bcx, y1 + CH],
    [bcx, g1],
    [xCorr, g1],
    [xCorr, g2],
    [tcx, g2],
    [tcx, y2],
  ]);

  // Cards: trunk (lane 0) with its tip accented like the current branch; the
  // side branch one lane right.
  s += commitCard(TX, y0, "main", true);
  s += commitCard(TX, y1, "main");
  s += commitCard(TX, y2, "main");
  s += commitCard(BX, y0, "feature");
  s += commitCard(BX, y1, "feature");
  return s;
}

/**
 * A prominent 4-way move badge — one self-contained icon showing the canvas can
 * be dragged in every direction (the modern mode's pan affordance).
 */
function panBadge(cx: number, cy: number): string {
  const a = 15; // arrow arm length
  const h = 4.5; // arrowhead half-width
  const R = a + 8; // badge half-size
  const stroke = `stroke="${C.fg}" stroke-width="1.8" stroke-linecap="round"`;
  const tri = `fill="${C.fg}"`;
  return (
    `<g>` +
    rect(cx - R, cy - R, R * 2, R * 2, { fill: C.faint, stroke: C.border, r: 9 }) +
    `<g opacity="0.9">` +
    `<line x1="${cx - a}" y1="${cy}" x2="${cx + a}" y2="${cy}" ${stroke}/>` +
    `<line x1="${cx}" y1="${cy - a}" x2="${cx}" y2="${cy + a}" ${stroke}/>` +
    `<polygon points="${cx - a - 2},${cy} ${cx - a + 5},${cy - h} ${cx - a + 5},${cy + h}" ${tri}/>` +
    `<polygon points="${cx + a + 2},${cy} ${cx + a - 5},${cy - h} ${cx + a - 5},${cy + h}" ${tri}/>` +
    `<polygon points="${cx},${cy - a - 2} ${cx - h},${cy - a + 5} ${cx + h},${cy - a + 5}" ${tri}/>` +
    `<polygon points="${cx},${cy + a + 2} ${cx - h},${cy + a - 5} ${cx + h},${cy + a - 5}" ${tri}/>` +
    `</g></g>`
  );
}

/**
 * A mouse with its scroll wheel and a downward chevron trail — the classic
 * mode's only navigation: roll the wheel to scroll down through the graph.
 */
function mouseScrollIcon(cx: number, cy: number): string {
  const bw = 18;
  const bh = 28;
  const stroke = `stroke="${C.fg}" stroke-width="1.5" fill="none"`;
  const top = cy - bh / 2;
  let s = `<g opacity="0.85">`;
  // Mouse body.
  s += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${bh}" rx="${bw / 2}" ${stroke}/>`;
  // Scroll wheel.
  s += `<line x1="${cx}" y1="${top + 5}" x2="${cx}" y2="${top + 11}" stroke="${C.accent}" stroke-width="2.4" stroke-linecap="round"/>`;
  // Downward chevrons: "scroll down".
  const dy = cy + bh / 2 + 6;
  s += `<polyline points="${cx - 5},${dy} ${cx},${dy + 5} ${cx + 5},${dy}" ${stroke} stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<polyline points="${cx - 5},${dy + 6} ${cx},${dy + 11} ${cx + 5},${dy + 6}" ${stroke} stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`;
  s += `</g>`;
  return s;
}

/** A magnifier with a + — the zoom affordance of the free canvas. */
function zoomIcon(cx: number, cy: number): string {
  const r = 8;
  const stroke = `stroke="${C.fg}" stroke-width="1.5" fill="none"`;
  return (
    `<g opacity="0.75">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" ${stroke}/>` +
    `<line x1="${cx + r - 1}" y1="${cy + r - 1}" x2="${cx + r + 5}" y2="${cy + r + 5}" ${stroke} stroke-linecap="round"/>` +
    `<line x1="${cx - 3.5}" y1="${cy}" x2="${cx + 3.5}" y2="${cy}" ${stroke}/>` +
    `<line x1="${cx}" y1="${cy - 3.5}" x2="${cx}" y2="${cy + 3.5}" ${stroke}/>` +
    `</g>`
  );
}

export function modernGraphSchematic(): string {
  let s = open();
  s += rect(8, 8, W - 16, H - 16, { fill: C.faint, r: 4 });
  // The graph floats with padding (free canvas, not pinned to a corner).
  s += graphBoxes(30, 26);
  // One prominent 4-way badge (drag in any direction) + the zoom affordance.
  s += panBadge(256, 74);
  s += zoomIcon(256, 134);
  return s + close();
}

export function classicGraphSchematic(): string {
  let s = open();
  s += rect(8, 8, W - 16, H - 16, { fill: C.faint, r: 4 });
  // The trunk is pinned to the top-left corner; navigation is by scrollbars only.
  s += graphBoxes(16, 16);
  // Mouse-wheel hint: roll down to scroll the graph (classic's only navigation).
  s += mouseScrollIcon(250, 60);
  // Vertical scrollbar (right) + horizontal scrollbar (bottom).
  s += rect(W - 16, 12, 7, H - 34, { fill: C.muted, r: 3 });
  s += rect(W - 15, 28, 5, 52, { fill: C.border, r: 2 });
  s += rect(12, H - 16, W - 32, 7, { fill: C.muted, r: 3 });
  s += rect(18, H - 15, 78, 5, { fill: C.border, r: 2 });
  return s + close();
}

// ---------------------------------------------------------------------------
// Colour theme — light vs dark. Unlike the other schematics these depict the
// *actual* theme palette, so they use fixed colours (not the var() tokens of the
// current theme) and always show light-on-light / dark-on-dark with a sun / moon.
// ---------------------------------------------------------------------------
function themeSchematic(dark: boolean): string {
  const bg = dark ? "#1e1e1e" : "#ffffff";
  const panel = dark ? "#2a2a2b" : "#f3f3f3";
  const border = dark ? "#3c3c3c" : "#d0d0d0";
  const lineCol = dark ? "rgba(212,212,212,0.30)" : "rgba(31,31,31,0.22)";
  const accent = "#0e639c";

  let s =
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" ` +
    `preserveAspectRatio="xMidYMid meet" font-family="system-ui, sans-serif">`;
  s += rect(0, 0, W, H, { fill: bg, stroke: border, r: 8 });
  // A little app window: title bar + a few text lines.
  s += rect(14, 16, W - 28, 22, { fill: panel, r: 4 });
  s += rect(22, 24, 70, 6, { fill: lineCol, r: 3 });
  for (let i = 0; i < 4; i++) {
    const y = 56 + i * 20;
    s += rect(22, y, W - 110, 7, { fill: lineCol, r: 3 });
    s += rect(22, y + 9, W - 150, 5, { fill: lineCol, r: 3 });
  }
  // Accent dot, so the swatch shows where the accent colour lands.
  s += circle(W - 30, 27, 4, { fill: accent });

  // Sun (light) / moon (dark), top-right of the content area.
  const ix = W - 44;
  const iy = 84;
  if (dark) {
    s += circle(ix, iy, 11, { fill: "#cfd6e6" });
    s += circle(ix + 5, iy - 3, 9, { fill: bg }); // bite out a crescent
  } else {
    s += circle(ix, iy, 8, { fill: "#e6a700" });
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      const x1 = ix + Math.cos(ang) * 11;
      const y1 = iy + Math.sin(ang) * 11;
      const x2 = ix + Math.cos(ang) * 15;
      const y2 = iy + Math.sin(ang) * 15;
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e6a700" stroke-width="2" stroke-linecap="round"/>`;
    }
  }
  return s + close();
}

export function lightThemeSchematic(): string {
  return themeSchematic(false);
}
export function darkThemeSchematic(): string {
  return themeSchematic(true);
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
  { id: "theme-light", svg: lightThemeSchematic },
  { id: "theme-dark", svg: darkThemeSchematic },
];
