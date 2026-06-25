import type { GitCommit, GitRef, GraphData } from "@rev-graph/protocol";

/** A commit with its computed grid position. */
export interface PositionedCommit extends GitCommit {
  /** Vertical position (0 = topmost / newest). */
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

/**
 * Assign each commit a (row, lane) using the standard git-graph lane algorithm,
 * producing the column-per-branch look of the TortoiseSVN revision graph.
 *
 * The input `commits` must already be in display order — newest first
 * (`git log --date-order` style), so that a child always appears above its
 * parents. Lanes are reserved by children for their parents; the first parent
 * continues the child's lane, additional (merge) parents claim new lanes.
 *
 * Commits whose parents are not present in the input keep dangling edges
 * dropped (parent out of view) — only in-view relationships are drawn.
 */
export function computeLayout(data: GraphData): GraphLayout {
  const commits = data.commits;
  const present = new Set(commits.map((c) => c.sha));

  // refs grouped by the commit they point at, so render can label nodes.
  const refsBySha = new Map<string, GitRef[]>();
  for (const ref of data.refs) {
    const list = refsBySha.get(ref.targetSha);
    if (list) list.push(ref);
    else refsBySha.set(ref.targetSha, [ref]);
  }

  const positioned: PositionedCommit[] = [];
  const posBySha = new Map<string, PositionedCommit>();

  // lanes[i] = sha reserved to next appear in lane i, or null when the lane is free.
  const lanes: (string | null)[] = [];
  let maxLane = 0;

  const firstFreeLane = (): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  commits.forEach((commit, row) => {
    // Which lanes were reserved for this commit by already-placed children?
    const reserving: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.sha) reserving.push(i);
    }

    let lane: number;
    if (reserving.length > 0) {
      // Arrive in the leftmost reserving lane; the rest merge in and end here.
      lane = reserving[0]!;
      for (let k = 1; k < reserving.length; k++) lanes[reserving[k]!] = null;
    } else {
      // A tip with no in-view children: start a fresh lane.
      lane = firstFreeLane();
    }

    const pc: PositionedCommit = {
      ...commit,
      row,
      lane,
      refs: refsBySha.get(commit.sha) ?? [],
    };
    positioned.push(pc);
    posBySha.set(commit.sha, pc);
    if (lane > maxLane) maxLane = lane;

    // Continue lanes downward for parents that are in view.
    const parents = commit.parents.filter((p) => present.has(p));
    if (parents.length === 0) {
      lanes[lane] = null;
    } else {
      const first = parents[0]!;
      const firstExisting = lanes.indexOf(first);
      if (firstExisting >= 0 && firstExisting !== lane) {
        // First parent already flows in another lane — this lane ends here.
        lanes[lane] = null;
      } else {
        lanes[lane] = first;
      }
      for (let k = 1; k < parents.length; k++) {
        const p = parents[k]!;
        if (!lanes.includes(p)) {
          const newLane = firstFreeLane();
          lanes[newLane] = p;
          if (newLane > maxLane) maxLane = newLane;
        }
      }
    }
  });

  // Second pass: build edges now that every commit has a final position.
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
    rowCount: positioned.length,
  };
}
