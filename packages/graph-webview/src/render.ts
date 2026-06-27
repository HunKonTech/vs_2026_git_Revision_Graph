import { computeLayout } from "@rev-graph/graph-core";
import type { PositionedCommit, GraphLayout, LayoutEdge } from "@rev-graph/graph-core";
import type { GraphData, GitRef, ThemeTokens } from "@rev-graph/protocol";
import type { DisplayMode } from "./displayMode.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Pixel geometry of the grid. Tuned to resemble the TortoiseSVN graph. */
const LANE_W = 210;
const BOX_W = 170;
/** Height of the fixed text area (sha / summary / author / date). */
const CONTENT_H = 68;
/** Extra height added at the top of the content area when a branch header is shown. */
const BRANCH_HEADER_H = 18;
/** Height of one ref pill listed inside a box. */
const REF_ROW_H = 17;
/** Padding above the first ref pill inside a box. */
const REF_PAD = 6;
/** Vertical gap between a box's bottom and the next box's top. */
const ROW_GAP = 26;
const MARGIN = 28;

/** Distinct hues per ref kind, echoing the SVN graph (grey trunk, green branch, yellow tag). */
type NodeKind = "head" | "localBranch" | "remoteBranch" | "tag" | "commit";

export interface RenderCallbacks {
  onNodeContextMenu(commit: PositionedCommit, clientX: number, clientY: number): void;
  onNodeDblClick(sha: string): void;
  onNodeClick(commit: PositionedCommit): void;
}

/** Renders a git DAG as connected boxes inside an SVG, with zoom & pan. */
export class GraphView {
  /** Scrolling wrapper around the SVG — owns the scrollbars in classic mode. */
  private readonly scrollEl: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private layout: GraphLayout | null = null;
  /**
   * Display style. "modern" = free pan/zoom canvas; "classic" = fixed-scale,
   * scroll-only canvas with the trunk pinned left (SVN revision graph style).
   */
  private mode: DisplayMode = "modern";
  /** Pixel height of each row = tallest box on it, indexed by row (level). */
  private rowHeights: number[] = [];
  /** Own pixel height of each box, by nodeId (grows with its ref count). */
  private readonly ownHeight = new Map<string, number>();
  /** Top Y of each row, indexed by row (cumulative — rows vary in height). */
  private rowTops: number[] = [];
  /** Sha of the currently checked-out commit (HEAD), if known. */
  private head: string | null = null;
  /** Whether any ref in the current layout is flagged as the current branch. */
  private hasCurrentRef = false;

  // pan/zoom state
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private panning = false;
  private panStartX = 0;
  private panStartY = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly cb: RenderCallbacks,
  ) {
    this.scrollEl = document.createElement("div");
    this.scrollEl.className = "graph-scroll";

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("rev-graph-svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    // Prevent accidental text selection when clicking/dragging in the graph.
    (this.svg.style as CSSStyleDeclaration & { userSelect: string }).userSelect = "none";
    this.viewport = document.createElementNS(SVG_NS, "g");
    this.svg.appendChild(this.viewport);
    this.scrollEl.appendChild(this.svg);
    this.container.appendChild(this.scrollEl);
    this.installPanZoom();
  }

  /** Switch between the modern (free pan/zoom) and classic (scroll-only) modes. */
  setMode(mode: DisplayMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyMode();
  }

  /** Apply the current mode to the DOM: sizing, transform and scroll behaviour. */
  private applyMode(): void {
    if (this.mode === "classic") {
      this.scrollEl.classList.add("classic");
      // No zoom/pan transform: 1 SVG unit == 1 CSS pixel, navigation is scroll.
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.viewport.removeAttribute("transform");
      this.sizeSvgToContent();
      this.scrollEl.scrollLeft = 0;
      this.scrollEl.scrollTop = 0;
    } else {
      this.scrollEl.classList.remove("classic");
      // Back to a viewport-filling canvas driven by the pan/zoom transform.
      this.svg.setAttribute("width", "100%");
      this.svg.setAttribute("height", "100%");
      this.applyTransform();
    }
  }

  /** Size the SVG to the graph's full pixel extent so the wrapper can scroll it. */
  private sizeSvgToContent(): void {
    if (!this.layout) return;
    const w = MARGIN + Math.max(0, this.layout.laneCount - 1) * LANE_W + BOX_W + MARGIN;
    const lastTop = this.rowTops[this.rowTops.length - 1] ?? MARGIN;
    const lastH = this.rowHeights[this.rowHeights.length - 1] ?? CONTENT_H;
    const h = lastTop + lastH + MARGIN;
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(h));
  }

  setTheme(theme: ThemeTokens): void {
    const root = this.container.style;
    root.setProperty("--bg", theme.background);
    root.setProperty("--fg", theme.foreground);
    root.setProperty("--accent", theme.accent);
    root.setProperty("--border", theme.border);
    this.container.dataset.theme = theme.kind;
  }

  setData(data: GraphData, mainBranch?: string): void {
    this.layout = computeLayout(data, { mainBranch });
    this.head = data.head ?? null;
    // Rows are structural levels and several commits may share a row, so a row's
    // height is the tallest box on it (each box is sized to list all its refs).
    this.rowHeights = new Array(this.layout.rowCount).fill(CONTENT_H);
    this.ownHeight.clear();
    this.hasCurrentRef = this.layout.commits.some((c) => c.refs.some((r) => r.isCurrent));
    for (const c of this.layout.commits) {
      const h = boxHeight(c);
      this.ownHeight.set(c.nodeId, h);
      if (h > (this.rowHeights[c.row] ?? 0)) this.rowHeights[c.row] = h;
    }
    this.rowTops = [];
    let y = MARGIN;
    for (let r = 0; r < this.rowHeights.length; r++) {
      this.rowTops[r] = y;
      y += this.rowHeights[r]! + ROW_GAP;
    }
    this.draw();
    // In classic mode the SVG carries its full pixel size so the wrapper scrolls.
    if (this.mode === "classic") this.sizeSvgToContent();
  }

  getPositionedCommit(sha: string): PositionedCommit | undefined {
    return this.layout?.commits.find((c) => c.sha === sha);
  }

  /** Reset the view to the top-left of the graph (the trunk). */
  resetView(): void {
    if (this.mode === "classic") {
      // No zoom in classic mode — just scroll back to the trunk at top-left.
      this.scrollEl.scrollLeft = 0;
      this.scrollEl.scrollTop = 0;
      return;
    }
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();
  }

  private draw(): void {
    while (this.viewport.firstChild) this.viewport.removeChild(this.viewport.firstChild);
    if (!this.layout) return;

    // No viewBox: 1 SVG unit == 1 CSS pixel, so nodes always render at their
    // native size regardless of how many commits there are. Navigation is done
    // via the pan/zoom transform, not by squeezing the whole graph to fit.

    // Edges first so nodes paint on top.
    const edgeLayer = document.createElementNS(SVG_NS, "g");
    edgeLayer.classList.add("edges");
    for (const e of this.layout.edges) {
      edgeLayer.appendChild(this.edgePath(e));
    }
    this.viewport.appendChild(edgeLayer);

    const nodeLayer = document.createElementNS(SVG_NS, "g");
    nodeLayer.classList.add("nodes");
    for (const c of this.layout.commits) nodeLayer.appendChild(this.nodeBox(c));
    this.viewport.appendChild(nodeLayer);
  }

  private boxX(lane: number): number {
    return MARGIN + lane * LANE_W;
  }
  private boxY(row: number): number {
    return this.rowTops[row] ?? MARGIN;
  }

  private edgePath(e: LayoutEdge): SVGPathElement {
    const cx = this.boxX(e.fromLane) + BOX_W / 2;
    // Child bottom uses the child's own box height (rows can hold several boxes).
    const cy = this.boxY(e.fromRow) + (this.ownHeight.get(e.fromId) ?? CONTENT_H);
    const px = this.boxX(e.toLane) + BOX_W / 2;
    const py = this.boxY(e.toRow); // parent top
    const isMerge = e.isMerge;
    const midY = (cy + py) / 2;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${cx} ${cy} C ${cx} ${midY}, ${px} ${midY}, ${px} ${py}`);
    path.classList.add("edge");
    if (isMerge) path.classList.add("edge-merge");
    return path;
  }

  private nodeBox(c: PositionedCommit): SVGGElement {
    const x = this.boxX(c.lane);
    const y = this.boxY(c.row);
    const h = boxHeight(c); // this box's own height (a row may hold taller boxes)
    const kind = nodeKind(c);
    // The HEAD marker belongs on the node carrying the current branch; when the
    // checkout is detached (no current ref anywhere) it falls back to the commit
    // whose sha is HEAD. This keeps it off the real commit when a freshly created
    // current branch has been split into its own phantom node.
    const isHead =
      this.head != null &&
      c.sha === this.head &&
      (c.refs.some((r) => r.isCurrent) || !this.hasCurrentRef);

    if (c.phantom) return this.phantomBox(c, x, y, h, kind, isHead);

    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("node", `node-${kind}`);
    if (isHead) g.classList.add("node-current");
    // Fetched-but-not-pulled commits: stay in their lane, flagged by colour.
    if (c.remoteOnly) g.classList.add("node-remote-only");
    g.dataset.sha = c.sha;
    g.setAttribute("transform", `translate(${x} ${y})`);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", String(BOX_W));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "6");
    rect.classList.add("node-rect");
    g.appendChild(rect);

    // Mark the commit the working tree is currently on (HEAD), even when it is
    // detached and no branch chip points at it.
    if (isHead) {
      const bar = document.createElementNS(SVG_NS, "rect");
      bar.setAttribute("x", "-7");
      bar.setAttribute("y", "0");
      bar.setAttribute("width", "4");
      bar.setAttribute("height", String(h));
      bar.setAttribute("rx", "2");
      bar.classList.add("current-head-bar");
      g.appendChild(bar);

      const marker = document.createElementNS(SVG_NS, "text");
      marker.setAttribute("x", "-12");
      marker.setAttribute("y", String(h / 2 + 4));
      marker.setAttribute("text-anchor", "end");
      marker.classList.add("current-head-marker");
      marker.textContent = "▶";
      const mTitle = document.createElementNS(SVG_NS, "title");
      mTitle.textContent = "HEAD — current checkout";
      marker.appendChild(mTitle);
      g.appendChild(marker);
    }

    // branch name header (top of box, only when a branch ref points here)
    const branch = primaryBranch(c);
    const dy = branch ? BRANCH_HEADER_H : 0;
    if (branch) {
      const branchEl = document.createElementNS(SVG_NS, "text");
      branchEl.setAttribute("x", "10");
      branchEl.setAttribute("y", "13");
      branchEl.classList.add("node-branch");
      branchEl.textContent = truncate(branch, 24);
      g.appendChild(branchEl);

      const sep = document.createElementNS(SVG_NS, "line");
      sep.setAttribute("x1", "0");
      sep.setAttribute("y1", String(dy));
      sep.setAttribute("x2", String(BOX_W));
      sep.setAttribute("y2", String(dy));
      sep.classList.add("node-branch-sep");
      g.appendChild(sep);
    }

    // short sha (top-left)
    const sha = document.createElementNS(SVG_NS, "text");
    sha.setAttribute("x", "10");
    sha.setAttribute("y", String(14 + dy));
    sha.classList.add("node-sha");
    sha.textContent = c.sha.slice(0, 7);
    g.appendChild(sha);

    // summary (clipped)
    const summary = document.createElementNS(SVG_NS, "text");
    summary.setAttribute("x", "10");
    summary.setAttribute("y", String(28 + dy));
    summary.classList.add("node-summary");
    summary.textContent = truncate(c.summary, 24);
    g.appendChild(summary);

    // author
    const author = document.createElementNS(SVG_NS, "text");
    author.setAttribute("x", "10");
    author.setAttribute("y", String(44 + dy));
    author.classList.add("node-author");
    author.textContent = truncate(c.author, 22);
    g.appendChild(author);

    // commit date
    const dateEl = document.createElementNS(SVG_NS, "text");
    dateEl.setAttribute("x", "10");
    dateEl.setAttribute("y", String(60 + dy));
    dateEl.classList.add("node-date");
    dateEl.textContent = formatDate(c.date);
    g.appendChild(dateEl);

    // ref labels listed inside the box, one per row, so all stay visible and
    // none hang off the edge.
    c.refs.forEach((ref, i) => g.appendChild(this.refRow(ref, i, CONTENT_H + dy)));

    // tooltip
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${c.sha}\n${c.summary}\n${c.author} <${c.authorEmail}>\n${c.date}`;
    g.appendChild(title);

    this.wireNodeEvents(g, c);
    return g;
  }

  /**
   * Compact box for a phantom node: a branch with no commits of its own, drawn
   * one lane right of (and branching up from) the commit it shares. Shows just
   * the branch header and its ref chip(s) — no sha/summary/author/date, since
   * those belong to the real commit it points at.
   */
  private phantomBox(
    c: PositionedCommit,
    x: number,
    y: number,
    h: number,
    kind: NodeKind,
    isHead: boolean,
  ): SVGGElement {
    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("node", "node-phantom", `node-${kind}`);
    if (isHead) g.classList.add("node-current");
    g.dataset.sha = c.sha;
    g.setAttribute("transform", `translate(${x} ${y})`);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", String(BOX_W));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "6");
    rect.classList.add("node-rect");
    g.appendChild(rect);

    if (c.branch) {
      const branchEl = document.createElementNS(SVG_NS, "text");
      branchEl.setAttribute("x", "10");
      branchEl.setAttribute("y", "13");
      branchEl.classList.add("node-branch");
      branchEl.textContent = truncate(c.branch, 24);
      g.appendChild(branchEl);
    }

    c.refs.forEach((ref, i) => g.appendChild(this.refRow(ref, i, BRANCH_HEADER_H)));

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${c.branch ?? ""}\n${c.sha}`;
    g.appendChild(title);

    this.wireNodeEvents(g, c);
    return g;
  }

  /** Attach the shared context-menu / click / double-click handlers to a node. */
  private wireNodeEvents(g: SVGGElement, c: PositionedCommit): void {
    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this.cb.onNodeContextMenu(c, ev.clientX, ev.clientY);
    });
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.cb.onNodeClick(c);
    });
    g.addEventListener("dblclick", () => this.cb.onNodeDblClick(c.sha));
  }

  private refRow(ref: GitRef, index: number, baseY: number): SVGGElement {
    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("ref-chip", `ref-${ref.type}`);
    const label = ref.type === "head" ? "HEAD" : ref.name;

    // Pills sit inside the box; width is clamped so the pill never overflows the
    // box, and the label is truncated to whatever fits that width.
    const sideMargin = 10;
    const maxW = BOX_W - sideMargin * 2;
    const innerChars = Math.max(3, Math.floor((maxW - 12) / 6.2));
    const text = truncate(label, innerChars);
    const w = Math.min(maxW, 12 + text.length * 6.2);
    const yTop = baseY + REF_PAD + index * REF_ROW_H;
    g.setAttribute("transform", `translate(${sideMargin} ${yTop})`);

    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("width", String(w));
    r.setAttribute("height", "14");
    r.setAttribute("rx", "7");
    r.classList.add("chip-rect");
    if (ref.isCurrent) r.classList.add("chip-current");
    g.appendChild(r);

    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", "6");
    t.setAttribute("y", "11");
    t.classList.add("chip-text");
    t.textContent = text;
    g.appendChild(t);

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = label;
    g.appendChild(title);
    return g;
  }

  /* ----------------------------- pan & zoom ----------------------------- */

  private installPanZoom(): void {
    this.svg.addEventListener("wheel", (e) => {
      // Classic mode has no zoom; let the wrapper scroll natively.
      if (this.mode === "classic") return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = clamp(this.scale * factor, 0.05, 4);
      // zoom toward cursor
      const rect = this.svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.tx = mx - (mx - this.tx) * (next / this.scale);
      this.ty = my - (my - this.ty) * (next / this.scale);
      this.scale = next;
      this.applyTransform();
    });

    this.svg.addEventListener("mousedown", (e) => {
      if (this.mode === "classic") return; // scroll-only navigation, no drag-pan
      if (e.button !== 0) return;
      if ((e.target as Element).closest(".node")) return; // let nodes handle their own clicks
      this.panning = true;
      this.panStartX = e.clientX - this.tx;
      this.panStartY = e.clientY - this.ty;
      this.svg.classList.add("panning");
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.panning) return;
      this.tx = e.clientX - this.panStartX;
      this.ty = e.clientY - this.panStartY;
      this.applyTransform();
    });
    window.addEventListener("mouseup", () => {
      this.panning = false;
      this.svg.classList.remove("panning");
    });
  }

  private applyTransform(): void {
    this.viewport.setAttribute(
      "transform",
      `translate(${this.tx} ${this.ty}) scale(${this.scale})`,
    );
  }
}

/**
 * Branch name shown at the top of the box. Comes from the layout (the branch
 * owning the commit's column), so it appears on *every* commit in the column,
 * not only at the tip where a ref points.
 */
function primaryBranch(c: PositionedCommit): string | null {
  return c.branch;
}

/** Box height = branch header (if any) + fixed text area + one row per ref. */
function boxHeight(c: PositionedCommit): number {
  const refsH = c.refs.length > 0 ? REF_PAD + c.refs.length * REF_ROW_H : 0;
  // Phantom nodes carry only a header + chips; no commit text area.
  if (c.phantom) return BRANCH_HEADER_H + refsH + REF_PAD;
  const dy = primaryBranch(c) ? BRANCH_HEADER_H : 0;
  return CONTENT_H + dy + refsH;
}

function nodeKind(c: PositionedCommit): NodeKind {
  if (c.refs.some((r) => r.type === "head" || r.isCurrent)) return "head";
  if (c.refs.some((r) => r.type === "localBranch")) return "localBranch";
  if (c.refs.some((r) => r.type === "remoteBranch")) return "remoteBranch";
  if (c.refs.some((r) => r.type === "tag")) return "tag";
  return "commit";
}

function formatDate(isoDate: string): string {
  // "2026-06-26T10:30:00+02:00" → "2026-06-26 10:30:00"
  return isoDate ? isoDate.slice(0, 19).replace("T", " ") : "";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
