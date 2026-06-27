import type { GitCommit, GitRef, GraphData } from "@rev-graph/protocol";

/** A commit with its computed grid position. */
export interface PositionedCommit extends GitCommit {
  /**
   * Vertical position as a structural level (0 = topmost). Derived from the
   * commit's generation (depth from the root), not its timestamp, so commits on
   * different branches may share a row.
   */
  row: number;
  /** Horizontal lane (column), 0-based from the left. */
  lane: number;
  /** Refs that point directly at this commit (branches, tags, HEAD). */
  refs: GitRef[];
}

/** A connection from a child commit down to one of its parents. */
export interface LayoutEdge {
  fromSha: string;
  toSha: string;
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  /** True when this is the second-or-later parent of a merge commit. */
  isMerge: boolean;
}

export interface GraphLayout {
  commits: PositionedCommit[];
  edges: LayoutEdge[];
  /** Number of lanes the widest part of the graph uses (>= 1). */
  laneCount: number;
  /** Number of rows (== commits.length). */
  rowCount: number;
}

export interface LayoutOptions {
  /**
   * Name of the branch to pin to the leftmost lane — the SVN "trunk".
   * Matched against local/remote branch ref names. When omitted, the layout
   * falls back to main/master, then the current branch, then HEAD.
   */
  mainBranch?: string;
}

/**
 * Assign each commit a (row, lane) using a TortoiseSVN-style *branch column*
 * layout rather than the classic git lane algorithm.
 *
 * The model:
 *  - Commits are grouped into columns along their first-parent chains, so each
 *    branch line owns one column (its "trunk").
 *  - The chosen main branch is pinned to the leftmost lane (lane 0), the way
 *    TortoiseSVN keeps the trunk on the left.
 *  - Every other branch is laid out to the *right* of the branch it forked
 *    from: a column's lane is always greater than the lane of the column it
 *    diverged from, and children are placed in a depth-first order so a whole
 *    branch subtree stays contiguous and to the right of its origin.
 *
 * The input `commits` must already be in display order — newest first
 * (`git log --date-order` style), so a child always appears above its parents.
 * Commits whose parents are not present keep dangling edges dropped.
 */
export function computeLayout(data: GraphData, options: LayoutOptions = {}): GraphLayout {
  const commits = data.commits;
  const present = new Set(commits.map((c) => c.sha));
  const bySha = new Map<string, GitCommit>(commits.map((c) => [c.sha, c]));
  const rowOf = new Map<string, number>();
  commits.forEach((c, i) => rowOf.set(c.sha, i));

  // ---- Phase 0: structural generation (longest path from a root). ----
  // A commit's row comes from its generation, NOT its timestamp: a branch is
  // anchored to the commit it forked from and steps up from there, so a fresh
  // commit on a side branch sits next to its origin instead of jumping to the
  // top just because it is the newest. Computed with an iterative post-order DFS
  // (memoized) so it is independent of input ordering and safe on deep history.
  const genOf = new Map<string, number>();
  let maxGen = 0;
  for (const start of commits) {
    if (genOf.has(start.sha)) continue;
    const stack: string[] = [start.sha];
    while (stack.length > 0) {
      const sha = stack[stack.length - 1]!;
      if (genOf.has(sha)) {
        stack.pop();
        continue;
      }
      let ready = true;
      let g = 0;
      for (const p of bySha.get(sha)!.parents) {
        if (!present.has(p)) continue;
        const pg = genOf.get(p);
        if (pg === undefined) {
          stack.push(p); // resolve the parent first
          ready = false;
        } else if (pg + 1 > g) {
          g = pg + 1;
        }
      }
      if (ready) {
        genOf.set(sha, g);
        if (g > maxGen) maxGen = g;
        stack.pop();
      }
    }
  }
  // Level 0 is the top (highest generation). Generations are contiguous
  // (a commit at gen g has an in-view parent at gen g-1), so every level is used.
  const levelOf = (sha: string): number => maxGen - (genOf.get(sha) ?? 0);

  // refs grouped by the commit they point at, so render can label nodes.
  const refsBySha = new Map<string, GitRef[]>();
  for (const ref of data.refs) {
    const list = refsBySha.get(ref.targetSha);
    if (list) list.push(ref);
    else refsBySha.set(ref.targetSha, [ref]);
  }

  // ---- Phase 1: group commits into columns along first-parent chains. ----
  // Chains are claimed in *priority order* — the main branch first, then other
  // branch tips (newest first), then anything still unclaimed — so the trunk
  // owns the shared base commits instead of whichever tip happens to be newest.
  interface Column {
    id: number;
    /** Generation of the column's tip (its newest commit). */
    tipGen: number;
    /** Generation of the column's base (oldest commit) — the branch creation point. */
    baseGen: number;
    /** Column this one diverged from, or null when it is an independent root. */
    forkParent: number | null;
  }
  const columns: Column[] = [];
  const colOf = new Map<string, number>();

  const mainTip = resolveMainTipSha(data, options.mainBranch);
  const mainColSha = mainTip != null && present.has(mainTip) ? mainTip : undefined;

  const seeds: string[] = [];
  const pushSeed = (sha: string | null | undefined): void => {
    if (sha != null && present.has(sha)) seeds.push(sha);
  };
  pushSeed(mainColSha);
  const refTips = [...new Set(data.refs.map((r) => r.targetSha))].filter((s) => present.has(s));
  refTips.sort((a, b) => rowOf.get(a)! - rowOf.get(b)!);
  for (const s of refTips) pushSeed(s);
  for (const c of commits) pushSeed(c.sha); // cover merge-only / dangling lines

  let nextCol = 0;
  for (const seed of seeds) {
    if (colOf.has(seed)) continue;
    const col = nextCol++;
    const seedGen = genOf.get(seed) ?? 0;
    columns[col] = { id: col, tipGen: seedGen, baseGen: seedGen, forkParent: null };
    let cur: string | undefined = seed;
    while (cur !== undefined) {
      colOf.set(cur, col);
      columns[col]!.baseGen = genOf.get(cur) ?? 0; // last claimed = oldest so far
      const parents: string[] = bySha.get(cur)!.parents.filter((p) => present.has(p));
      const first: string | undefined = parents[0];
      if (first === undefined) break; // root, or first parent out of view
      if (colOf.has(first)) {
        // First parent already belongs to another column: fork point.
        columns[col]!.forkParent = colOf.get(first)!;
        break;
      }
      cur = first; // keep claiming straight down the first-parent chain
    }
  }

  // ---- Phase 2: order columns left-to-right (main first, children right). ----
  const children = new Map<number, number[]>();
  for (const col of columns) {
    if (col.forkParent !== null) {
      const arr = children.get(col.forkParent) ?? [];
      arr.push(col.id);
      children.set(col.forkParent, arr);
    }
  }
  // Newer tip first (higher generation) — used to order independent roots.
  const byTip = (a: number, b: number) => columns[b]!.tipGen - columns[a]!.tipGen;
  // Sibling branches are ordered by creation point: the branch created earlier
  // (its base/fork point is at a lower generation) goes to the left, matching
  // how TortoiseSVN orders copy columns.
  const byCreation = (a: number, b: number) =>
    columns[a]!.baseGen - columns[b]!.baseGen || byTip(a, b);

  const laneOf = new Map<number, number>();
  let nextLane = 0;
  const visit = (id: number): void => {
    if (laneOf.has(id)) return;
    laneOf.set(id, nextLane++);
    const kids = (children.get(id) ?? []).slice().sort(byCreation);
    for (const k of kids) visit(k);
  };

  // Pin the main branch's column to lane 0, then lay out its sub-branches, then
  // any remaining columns (other roots / disconnected history) topmost-first.
  const mainCol = mainColSha !== undefined ? colOf.get(mainColSha) : undefined;
  if (mainCol !== undefined) visit(mainCol);
  for (const id of columns.map((c) => c.id).sort(byTip)) visit(id);

  // ---- Phase 3: position commits (row = structural level) and build edges. ----
  const positioned: PositionedCommit[] = [];
  const posBySha = new Map<string, PositionedCommit>();
  let maxLane = 0;

  commits.forEach((commit) => {
    const lane = laneOf.get(colOf.get(commit.sha)!) ?? 0;
    const pc: PositionedCommit = {
      ...commit,
      row: levelOf(commit.sha),
      lane,
      refs: refsBySha.get(commit.sha) ?? [],
    };
    positioned.push(pc);
    posBySha.set(commit.sha, pc);
    if (lane > maxLane) maxLane = lane;
  });

  const edges: LayoutEdge[] = [];
  for (const c of positioned) {
    c.parents.forEach((p, index) => {
      const parent = posBySha.get(p);
      if (!parent) return; // parent out of view
      edges.push({
        fromSha: c.sha,
        toSha: p,
        fromRow: c.row,
        fromLane: c.lane,
        toRow: parent.row,
        toLane: parent.lane,
        isMerge: index > 0,
      });
    });
  }

  return {
    commits: positioned,
    edges,
    laneCount: maxLane + 1,
    // Rows are structural levels (0..maxGen), several commits may share one.
    rowCount: commits.length > 0 ? maxGen + 1 : 0,
  };
}

/**
 * Pick the commit sha that anchors the trunk (leftmost lane). Preference order:
 * the explicitly configured main branch, then main/master, then the current
 * branch, then HEAD. Returns undefined when none can be determined.
 */
function resolveMainTipSha(data: GraphData, mainBranch: string | undefined): string | undefined {
  if (mainBranch) {
    const ref = data.refs.find(
      (r) => (r.type === "localBranch" || r.type === "remoteBranch") && r.name === mainBranch,
    );
    if (ref) return ref.targetSha;
  }

  const mm = data.refs.find(
    (r) => r.type === "localBranch" && (r.name === "main" || r.name === "master"),
  );
  if (mm) return mm.targetSha;

  const current = data.refs.find((r) => r.isCurrent);
  if (current) return current.targetSha;

  return data.head ?? undefined;
}
