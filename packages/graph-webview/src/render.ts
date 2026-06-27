import { computeLayout } from "@rev-graph/graph-core";
import type { PositionedCommit, GraphLayout, LayoutEdge } from "@rev-graph/graph-core";
import type { GraphData, GitRef, ThemeTokens } from "@rev-graph/protocol";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Pixel geometry of the grid. Tuned to resemble the TortoiseSVN graph. */
const LANE_W = 210;
const BOX_W = 170;
/** Height of the fixed text area (sha / summary / author / date). */
const CONTENT_H = 68;
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
  onNodeContextMenu(sha: string, clientX: number, clientY: number): void;
  onNodeDblClick(sha: string): void;
  onNodeClick(commit: PositionedCommit): void;
}

/** Renders a git DAG as connected boxes inside an SVG, with zoom & pan. */
export class GraphView {
  private readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private layout: GraphLayout | null = null;
  /** Pixel height of each row = tallest box on it, indexed by row (level). */
  private rowHeights: number[] = [];
  /** Own pixel height of each commit's box, by sha (grows with its ref count). */
  private readonly ownHeight = new Map<string, number>();
  /** Top Y of each row, indexed by row (cumulative — rows vary in height). */
  private rowTops: number[] = [];
  /** Sha of the currently checked-out commit (HEAD), if known. */
  private head: string | null = null;

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
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("rev-graph-svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    // Prevent accidental text selection when clicking/dragging in the graph.
    (this.svg.style as CSSStyleDeclaration & { userSelect: string }).userSelect = "none";
    this.viewport = document.createElementNS(SVG_NS, "g");
    this.svg.appendChild(this.viewport);
    this.container.appendChild(this.svg);
    this.installPanZoom();
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
    for (const c of this.layout.commits) {
      const h = boxHeight(c);
      this.ownHeight.set(c.sha, h);
      if (h > (this.rowHeights[c.row] ?? 0)) this.rowHeights[c.row] = h;
    }
    this.rowTops = [];
    let y = MARGIN;
    for (let r = 0; r < this.rowHeights.length; r++) {
      this.rowTops[r] = y;
      y += this.rowHeights[r]! + ROW_GAP;
    }
    this.draw();
  }

  getPositionedCommit(sha: string): PositionedCommit | undefined {
    return this.layout?.commits.find((c) => c.sha === sha);
  }

  /** Reset zoom/pan to show the top-left of the graph. */
  resetView(): void {
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
    const cy = this.boxY(e.fromRow) + (this.ownHeight.get(e.fromSha) ?? CONTENT_H);
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
    const isHead = this.head != null && c.sha === this.head;

    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("node", `node-${kind}`);
    if (isHead) g.classList.add("node-current");
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

    // short sha (top-left)
    const sha = document.createElementNS(SVG_NS, "text");
    sha.setAttribute("x", "10");
    sha.setAttribute("y", "14");
    sha.classList.add("node-sha");
    sha.textContent = c.sha.slice(0, 7);
    g.appendChild(sha);

    // summary (clipped)
    const summary = document.createElementNS(SVG_NS, "text");
    summary.setAttribute("x", "10");
    summary.setAttribute("y", "28");
    summary.classList.add("node-summary");
    summary.textContent = truncate(c.summary, 24);
    g.appendChild(summary);

    // author
    const author = document.createElementNS(SVG_NS, "text");
    author.setAttribute("x", "10");
    author.setAttribute("y", "44");
    author.classList.add("node-author");
    author.textContent = truncate(c.author, 22);
    g.appendChild(author);

    // commit date
    const dateEl = document.createElementNS(SVG_NS, "text");
    dateEl.setAttribute("x", "10");
    dateEl.setAttribute("y", "60");
    dateEl.classList.add("node-date");
    dateEl.textContent = formatDate(c.date);
    g.appendChild(dateEl);

    // ref labels listed inside the box, one per row, so all stay visible and
    // none hang off the edge.
    c.refs.forEach((ref, i) => g.appendChild(this.refRow(ref, i)));

    // tooltip
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${c.sha}\n${c.summary}\n${c.author} <${c.authorEmail}>\n${c.date}`;
    g.appendChild(title);

    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this.cb.onNodeContextMenu(c.sha, ev.clientX, ev.clientY);
    });
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.cb.onNodeClick(c);
    });
    g.addEventListener("dblclick", () => this.cb.onNodeDblClick(c.sha));

    return g;
  }

  private refRow(ref: GitRef, index: number): SVGGElement {
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
    const yTop = CONTENT_H + REF_PAD + index * REF_ROW_H;
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

/** Box height = fixed text area plus one row per ref listed inside it. */
function boxHeight(c: PositionedCommit): number {
  return CONTENT_H + (c.refs.length > 0 ? REF_PAD + c.refs.length * REF_ROW_H : 0);
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
