import { t } from "./i18n.js";
import { computeLineDiff, type DiffRow } from "@rev-graph/graph-core";
import type { FileDiff } from "@rev-graph/protocol";

/**
 * The side-by-side file-diff renderer, shared by the "View changes" dialog and
 * the merge dialog so both show file changes the exact same way (added files as a
 * single new-content column, deleted files a single old column, everything else a
 * two-column diff) with the optional VS Code-style minimap and change navigator.
 *
 * Extracted from changesDialog.ts unchanged so there is a single diff view, not
 * one per caller.
 */

/** Minimap gutter width in px — must match `.diff-minimap` width in style.css. */
export const MM_W = 56;

type CellKind = "ctx" | "add" | "del" | "empty";

/** One row of the minimap overview, mirroring one rendered diff row on one side. */
interface MiniRow {
  kind: CellKind;
  /** The line's text — drawn as little word blocks so the strip looks like code. */
  text: string;
}
/** A minimap overview for one side of the diff (the old/left or new/right column). */
interface MinimapSpec {
  side: "left" | "right";
  rows: MiniRow[];
}

/** A rendered diff plus the anchor element starting each change block. */
export interface DiffView {
  view: HTMLElement;
  /** First DOM cell of each change block (a run of consecutive changed lines). */
  blocks: HTMLElement[];
  /** Minimap overviews to draw beside the diff (empty when the minimap is off). */
  minimaps: MinimapSpec[];
}

/**
 * Build the diff view. Added files show one column of new content, deleted files
 * one column of old content, everything else a two-column side-by-side diff.
 *
 * When `minimap` is on, each content column reserves a gutter column (so the
 * overview strip never covers code) and a {@link MinimapSpec} is produced for it:
 * both sides for a modification, only the new (right) side for an addition, only
 * the old (left) side for a deletion.
 */
export function buildDiffView(d: FileDiff, minimap: boolean): DiffView {
  if (d.status === "added") return singleColumn(d.newText, "add", "changes.changed", minimap);
  if (d.status === "deleted") return singleColumn(d.oldText, "del", "changes.original", minimap);
  return sideBySide(computeLineDiff(d.oldText, d.newText), minimap);
}

/** Append a fixed-width gutter cell reserving room for a minimap strip. */
function spacerCell(anchor?: "mid" | "end"): HTMLElement {
  const c = el("div", "diff-spacer");
  if (anchor) c.classList.add(`diff-mm-anchor-${anchor}`);
  return c;
}

/** A one-sided view (added → new only, deleted → old only). */
function singleColumn(
  text: string,
  kind: "add" | "del",
  headerKey: "changes.original" | "changes.changed",
  minimap: boolean,
): DiffView {
  const wrap = el("div", "diff-grid diff-grid-single");
  if (minimap) {
    wrap.classList.add("has-minimap");
    wrap.style.setProperty("--mm-w", `${MM_W}px`);
  }
  wrap.appendChild(headerCell(t(headerKey), 2));
  if (minimap) wrap.appendChild(spacerCell("end"));
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  // Every line is a change here, so the whole file is a single contiguous block.
  const blocks: HTMLElement[] = [];
  const mini: MiniRow[] = [];
  lines.forEach((line, i) => {
    const num = numCell(i + 1, kind);
    if (i === 0) blocks.push(num);
    wrap.appendChild(num);
    wrap.appendChild(codeCell(line, kind));
    if (minimap) wrap.appendChild(spacerCell());
    mini.push({ kind, text: line });
  });
  // Addition → new (right) strip; deletion → old (left) strip.
  const minimaps = minimap ? [{ side: kind === "add" ? "right" : "left", rows: mini } as MinimapSpec] : [];
  return { view: wrap, blocks, minimaps };
}

/** A two-column side-by-side view aligned by computeLineDiff. */
function sideBySide(rows: DiffRow[], minimap: boolean): DiffView {
  const wrap = el("div", "diff-grid diff-grid-split");
  if (minimap) {
    wrap.classList.add("has-minimap");
    wrap.style.setProperty("--mm-w", `${MM_W}px`);
  }
  wrap.appendChild(headerCell(t("changes.original"), 2));
  if (minimap) wrap.appendChild(spacerCell("mid"));
  wrap.appendChild(headerCell(t("changes.changed"), 2));
  if (minimap) wrap.appendChild(spacerCell("end"));
  const blocks: HTMLElement[] = [];
  const leftMini: MiniRow[] = [];
  const rightMini: MiniRow[] = [];
  let inBlock = false; // are we inside a run of consecutive changed lines?
  for (const row of rows) {
    const isChange = row.kind !== "context";
    const leftKind = row.kind === "del" || row.kind === "change" ? "del" : row.kind === "context" ? "ctx" : "empty";
    const rightKind = row.kind === "add" || row.kind === "change" ? "add" : row.kind === "context" ? "ctx" : "empty";
    // The leftmost cell of this row, used as the scroll anchor for a new block.
    const anchor = row.left ? numCell(row.left.num, leftKind) : fillerCell();
    wrap.appendChild(anchor);
    wrap.appendChild(row.left ? codeCell(row.left.text, leftKind) : fillerCell());
    if (minimap) wrap.appendChild(spacerCell());
    if (row.right) {
      wrap.appendChild(numCell(row.right.num, rightKind));
      wrap.appendChild(codeCell(row.right.text, rightKind));
    } else {
      wrap.appendChild(fillerCell());
      wrap.appendChild(fillerCell());
    }
    if (minimap) wrap.appendChild(spacerCell());
    if (isChange && !inBlock) blocks.push(anchor); // first row of a new block
    inBlock = isChange;
    leftMini.push({ kind: leftKind, text: row.left?.text ?? "" });
    rightMini.push({ kind: rightKind, text: row.right?.text ?? "" });
  }
  const minimaps: MinimapSpec[] = minimap
    ? [
        { side: "left", rows: leftMini },
        { side: "right", rows: rightMini },
      ]
    : [];
  return { view: wrap, blocks, minimaps };
}

/**
 * Attach the minimap overview strips to the diff pane. Each strip is a miniature
 * of the whole file (faint line bars, added lines green / removed lines red),
 * pinned full-height over its gutter column. A viewport box tracks what's
 * visible and follows the diff as it scrolls; grabbing and dragging the strip
 * scrolls the diff. Returns a cleanup that removes the strips and listeners.
 */
export function attachMinimaps(pane: HTMLElement, scroll: HTMLElement, specs: MinimapSpec[]): () => void {
  if (specs.length === 0) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const twoSided = specs.length > 1;
  // Target minimap px per source line (kept small so the strip reads like code,
  // never a stack of fat blocks). Lines wider than this many columns are clipped.
  const MM_ROW = 4;
  const MM_COLS = 48;

  const built = specs.map((spec) => {
    const container = el("div", "diff-minimap");
    container.dataset.side = spec.side;
    const canvas = document.createElement("canvas");
    canvas.className = "diff-minimap-canvas";
    const viewport = el("div", "diff-minimap-viewport");
    container.append(canvas, viewport);
    pane.appendChild(container);
    return { spec, container, canvas, viewport };
  });

  // Shared scroll→minimap geometry, recomputed on every (re)layout. `scale` is
  // minimap px per *content* px, capped so the whole file always fits the strip
  // (so short files stay compact at the top, exactly like the VS Code minimap).
  let scale = 0;
  let headerH = 0;
  let realRowH = 1;
  const recompute = (): void => {
    const header = scroll.querySelector(".diff-header") as HTMLElement | null;
    headerH = header ? header.offsetHeight : 0;
    const numRows = built[0] ? built[0].spec.rows.length : 0;
    const scrollH = scroll.scrollHeight || 1;
    realRowH = numRows > 0 ? (scrollH - headerH) / numRows : scrollH;
    const paneH = pane.clientHeight || 1;
    scale = Math.min(MM_ROW / Math.max(realRowH, 1), paneH / scrollH);
  };

  const updateViewport = (b: (typeof built)[number]): void => {
    // The visible window [scrollTop, scrollTop+clientHeight] in minimap px.
    b.viewport.style.top = `${scroll.scrollTop * scale}px`;
    b.viewport.style.height = `${Math.max(14, scroll.clientHeight * scale)}px`;
  };

  const draw = (b: (typeof built)[number]): void => {
    const w = b.container.clientWidth;
    const h = b.container.clientHeight;
    const cx = b.canvas.getContext("2d");
    if (!cx || w === 0 || h === 0) return;
    b.canvas.width = Math.round(w * dpr);
    b.canvas.height = Math.round(h * dpr);
    b.canvas.style.width = `${w}px`;
    b.canvas.style.height = `${h}px`;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, w, h);
    const rows = b.spec.rows;
    if (rows.length === 0) return;
    const miniRowH = realRowH * scale; // minimap px per line
    const barH = Math.max(1, miniRowH * 0.78);
    const charW = (w - 6) / MM_COLS;
    rows.forEach((r, i) => {
      if (r.kind === "empty") return;
      const y = (headerH + i * realRowH) * scale; // line's top, in minimap px
      if (r.kind === "add" || r.kind === "del") {
        cx.fillStyle = r.kind === "add" ? "rgba(46,160,67,0.16)" : "rgba(248,81,73,0.16)";
        cx.fillRect(0, y, w, Math.max(miniRowH, 1.4));
      }
      cx.fillStyle =
        r.kind === "add" ? "rgba(46,160,67,0.95)" : r.kind === "del" ? "rgba(248,81,73,0.95)" : "rgba(150,150,150,0.5)";
      // Draw each run of non-space characters as a little block, so indentation
      // and word shapes show — the minimap then mirrors the real code layout.
      const text = r.text;
      const n = Math.min(text.length, 240);
      const top = y + (miniRowH - barH) / 2;
      let col = 0;
      let runStart = -1;
      for (let k = 0; k <= n; k++) {
        const ch = k < n ? text[k]! : " ";
        const isWord = ch !== " " && ch !== "\t";
        if (isWord && runStart < 0) runStart = col;
        if (!isWord && runStart >= 0) {
          const x = 3 + Math.min(runStart, MM_COLS) * charW;
          const ww = Math.max(charW * 0.6, (Math.min(col, MM_COLS) - runStart) * charW);
          cx.fillRect(x, top, Math.min(ww, w - 3 - x), barH);
          runStart = -1;
        }
        col += ch === "\t" ? 4 : 1;
        if (col > MM_COLS) break;
      }
    });
  };

  const anchorLeft = (sel: string): number | null => {
    const a = scroll.querySelector(sel);
    if (!a) return null;
    return (a as HTMLElement).getBoundingClientRect().left - pane.getBoundingClientRect().left;
  };

  const layout = (): void => {
    const h = pane.clientHeight;
    const midLeft = twoSided ? anchorLeft(".diff-mm-anchor-mid") : null;
    recompute();
    for (const b of built) {
      b.container.style.height = `${h}px`;
      if (twoSided && b.spec.side === "left" && midLeft != null) {
        b.container.style.left = `${midLeft}px`;
        b.container.style.right = "";
      } else {
        b.container.style.right = "0px";
        b.container.style.left = "";
      }
      draw(b);
      updateViewport(b);
    }
  };

  const onScroll = (): void => {
    for (const b of built) updateViewport(b);
  };
  scroll.addEventListener("scroll", onScroll, { passive: true });

  // Grab-and-drag: clicking or dragging anywhere on a strip centers the diff's
  // visible window on that point, so the strip behaves like a scrollbar thumb.
  for (const b of built) {
    const scrollToY = (clientY: number): void => {
      const rect = b.container.getBoundingClientRect();
      const ch = scroll.clientHeight;
      const contentY = scale > 0 ? (clientY - rect.top) / scale : 0; // minimap px → content px
      const target = contentY - ch / 2;
      scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - ch, target));
      onScroll(); // move the box immediately rather than waiting for the scroll event
    };
    let dragging = false;
    b.container.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      b.container.setPointerCapture(e.pointerId);
      scrollToY(e.clientY);
    });
    b.container.addEventListener("pointermove", (e) => {
      if (dragging) scrollToY(e.clientY);
    });
    const end = (e: PointerEvent): void => {
      dragging = false;
      try {
        b.container.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }
    };
    b.container.addEventListener("pointerup", end);
    b.container.addEventListener("pointercancel", end);
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(pane);
  // Lay out immediately — reading geometry forces a reflow, so this works even
  // when requestAnimationFrame is throttled (e.g. a backgrounded tab). The rAF
  // pass re-runs once after paint in case line wrapping or fonts shift heights.
  layout();
  requestAnimationFrame(layout);

  return () => {
    ro.disconnect();
    scroll.removeEventListener("scroll", onScroll);
    for (const b of built) b.container.remove();
  };
}

/**
 * Build the floating "previous / next change" navigator pinned to the top-right
 * of the diff pane. Clicking an arrow scrolls the diff so the target block sits
 * just below the sticky column headers; a counter shows position (e.g. 2 / 7).
 */
export function buildChangeNav(scroll: HTMLElement, blocks: HTMLElement[], rightPx: number): HTMLElement {
  let index = -1; // nothing focused yet; first ▼ press lands on block 0
  const nav = el("div", "changes-nav");
  nav.style.right = `${rightPx}px`;
  const counter = el("span", "changes-nav-count");

  const sync = (): void => {
    counter.textContent = `${Math.max(index, 0) + 1} / ${blocks.length}`;
  };
  const go = (i: number): void => {
    index = Math.max(0, Math.min(blocks.length - 1, i));
    const block = blocks[index]!;
    const blockTop = block.getBoundingClientRect().top;
    const scrollTop = scroll.getBoundingClientRect().top;
    // 48px clears the sticky "Original | This commit" header row.
    scroll.scrollTo({ top: scroll.scrollTop + (blockTop - scrollTop) - 48, behavior: "smooth" });
    sync();
  };

  const prev = button("changes-nav-btn", "▲", () => go(index <= 0 ? blocks.length - 1 : index - 1));
  prev.setAttribute("aria-label", t("changes.prevChange"));
  prev.title = t("changes.prevChange");
  const next = button("changes-nav-btn", "▼", () => go(index >= blocks.length - 1 ? 0 : index + 1));
  next.setAttribute("aria-label", t("changes.nextChange"));
  next.title = t("changes.nextChange");

  nav.append(prev, counter, next);
  sync();
  return nav;
}

function headerCell(text: string, span: number): HTMLElement {
  const c = el("div", "diff-header", text);
  c.style.gridColumn = `span ${span}`;
  return c;
}
function numCell(num: number, kind: CellKind): HTMLElement {
  return el("div", `diff-num diff-${kind}`, String(num));
}
function codeCell(text: string, kind: CellKind): HTMLElement {
  // Render an empty line as a non-breaking space so the row keeps its height.
  return el("div", `diff-code diff-${kind}`, text === "" ? " " : text);
}
function fillerCell(): HTMLElement {
  return el("div", "diff-num diff-empty");
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
