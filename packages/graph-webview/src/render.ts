import { computeLayout } from "@rev-graph/graph-core";
import type { PositionedCommit, GraphLayout } from "@rev-graph/graph-core";
import type { GraphData, GitRef, ThemeTokens } from "@rev-graph/protocol";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Pixel geometry of the grid. Tuned to resemble the TortoiseSVN graph. */
const LANE_W = 210;
const ROW_H = 74;
const BOX_W = 170;
const BOX_H = 52;
const MARGIN = 28;

/** Distinct hues per ref kind, echoing the SVN graph (grey trunk, green branch, yellow tag). */
type NodeKind = "head" | "localBranch" | "remoteBranch" | "tag" | "commit";

export interface RenderCallbacks {
  onNodeContextMenu(sha: string, clientX: number, clientY: number): void;
  onNodeDblClick(sha: string): void;
}

/** Renders a git DAG as connected boxes inside an SVG, with zoom & pan. */
export class GraphView {
  private readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private layout: GraphLayout | null = null;

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

  setData(data: GraphData): void {
    this.layout = computeLayout(data);
    this.draw();
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

    const width = MARGIN * 2 + this.layout.laneCount * LANE_W;
    const height = MARGIN * 2 + this.layout.rowCount * ROW_H;
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Edges first so nodes paint on top.
    const edgeLayer = document.createElementNS(SVG_NS, "g");
    edgeLayer.classList.add("edges");
    for (const e of this.layout.edges) {
      edgeLayer.appendChild(this.edgePath(e.fromRow, e.fromLane, e.toRow, e.toLane, e.isMerge));
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
    return MARGIN + row * ROW_H;
  }

  private edgePath(
    fromRow: number,
    fromLane: number,
    toRow: number,
    toLane: number,
    isMerge: boolean,
  ): SVGPathElement {
    const cx = this.boxX(fromLane) + BOX_W / 2;
    const cy = this.boxY(fromRow) + BOX_H; // child bottom
    const px = this.boxX(toLane) + BOX_W / 2;
    const py = this.boxY(toRow); // parent top
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
    const kind = nodeKind(c);

    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("node", `node-${kind}`);
    g.dataset.sha = c.sha;
    g.setAttribute("transform", `translate(${x} ${y})`);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", String(BOX_W));
    rect.setAttribute("height", String(BOX_H));
    rect.setAttribute("rx", "6");
    rect.classList.add("node-rect");
    g.appendChild(rect);

    // short sha (top-left)
    const sha = document.createElementNS(SVG_NS, "text");
    sha.setAttribute("x", "10");
    sha.setAttribute("y", "18");
    sha.classList.add("node-sha");
    sha.textContent = c.sha.slice(0, 7);
    g.appendChild(sha);

    // summary (clipped)
    const summary = document.createElementNS(SVG_NS, "text");
    summary.setAttribute("x", "10");
    summary.setAttribute("y", "36");
    summary.classList.add("node-summary");
    summary.textContent = truncate(c.summary, 24);
    g.appendChild(summary);

    // ref chips stacked above the box
    c.refs.forEach((ref, i) => g.appendChild(this.refChip(ref, i)));

    // tooltip
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${c.sha}\n${c.summary}\n${c.author} <${c.authorEmail}>\n${c.date}`;
    g.appendChild(title);

    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this.cb.onNodeContextMenu(c.sha, ev.clientX, ev.clientY);
    });
    g.addEventListener("dblclick", () => this.cb.onNodeDblClick(c.sha));

    return g;
  }

  private refChip(ref: GitRef, index: number): SVGGElement {
    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("ref-chip", `ref-${ref.type}`);
    const label = ref.type === "head" ? "HEAD" : ref.name;
    const w = Math.min(BOX_W, 14 + label.length * 6.2);
    const yOff = -22 - index * 18;
    g.setAttribute("transform", `translate(0 ${yOff})`);

    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("width", String(w));
    r.setAttribute("height", "16");
    r.setAttribute("rx", "8");
    r.classList.add("chip-rect");
    if (ref.isCurrent) r.classList.add("chip-current");
    g.appendChild(r);

    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", "7");
    t.setAttribute("y", "12");
    t.classList.add("chip-text");
    t.textContent = truncate(label, 22);
    g.appendChild(t);
    return g;
  }

  /* ----------------------------- pan & zoom ----------------------------- */

  private installPanZoom(): void {
    this.svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = clamp(this.scale * factor, 0.15, 3);
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

function nodeKind(c: PositionedCommit): NodeKind {
  if (c.refs.some((r) => r.type === "head" || r.isCurrent)) return "head";
  if (c.refs.some((r) => r.type === "localBranch")) return "localBranch";
  if (c.refs.some((r) => r.type === "remoteBranch")) return "remoteBranch";
  if (c.refs.some((r) => r.type === "tag")) return "tag";
  return "commit";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
