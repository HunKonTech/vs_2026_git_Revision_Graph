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
  /**
   * Unique key for this node. Equals `sha` for real commits; phantom nodes (a
   * branch that has no commits of its own yet) reuse their anchor's sha but get
   * a distinct id so heights/edges don't collide with the real commit.
   */
  nodeId: string;
  /**
   * Branch name that owns this commit's column, or null when unlabeled. Shown as
   * the box header on *every* commit in the column, not only at the tip.
   */
  branch: string | null;
  /**
   * True for a synthetic node standing in for a branch with no commits of its
   * own (it points at the same commit as the branch it was created from).
   */
  phantom?: boolean;
  /**
   * True when the commit lives only on a remote: reachable from a remote-tracking
   * branch but from no local branch or HEAD. These are fetched-but-not-pulled
   * commits ("only in the cloud"). They stay in their branch's lane (no rightward
   * shift) and the renderer flags them by colour instead.
   */
  remoteOnly: boolean;
  /**
   * True when the commit exists locally (reachable from a local branch or HEAD)
   * but has not been pushed to any remote. Only such commits may be undone — the
   * menu uses this to gate the "Undo commit" entry.
   */
  unpushed: boolean;
  /** True for a synthetic node representing a git stash entry. */
  stash?: boolean;
  /** For stash nodes: the `stash@{N}` stack index. */
  stashIndex?: number;
}

/** A connection from a child commit down to one of its parents. */
export interface LayoutEdge {
  fromSha: string;
  toSha: string;
  /** Node ids of the endpoints (differ from the shas only for phantom nodes). */
  fromId: string;
  toId: string;
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  /** True when this is the second-or-later parent of a merge commit. */
  isMerge: boolean;
  /** True for the connector from a stash node back to its base commit. */
  isStash?: boolean;
  /**
   * True for the connector from a freshly-created branch (a phantom node with no
   * commits of its own) back to the commit it forked from. The renderer draws it
   * sprouting from the *right side* of the fork commit rather than its top.
   */
  isBranch?: boolean;
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
 *  - Other branches are packed into the leftmost free lane (>= 1) via interval
 *    scheduling: two branches share a lane when their commit rows don't overlap,
 *    and a branch is pushed one lane further right only when it would actually
 *    collide with one already there. Earlier branches are placed first so they
 *    tend to sit further left.
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
    /** Row span the column's commits occupy (filled in phase 2). */
    minRow: number;
    maxRow: number;
    /** Commit that seeded the column (its tip). Empty for phantom columns. */
    seed: string;
    /** Branch name owning this column, or null when it is unlabeled. */
    branch: string | null;
  }
  const columns: Column[] = [];
  const colOf = new Map<string, number>();

  const main = resolveMain(data, options.mainBranch);
  // When the trunk's remote-tracking branch is ahead of the local tip (fetched
  // but not pulled), seed the trunk column from that remote tip so the un-pulled
  // commits continue the trunk lane instead of forking off to the right. Only a
  // fast-forward ahead on the same first-parent line qualifies, so a genuinely
  // diverged remote still gets its own column.
  const mainAnchor = main.sha != null && present.has(main.sha) ? main.sha : undefined;
  const mainColSha =
    mainAnchor !== undefined
      ? aheadTip(mainAnchor, main.name, data, genOf, bySha, present)
      : undefined;

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
    // The main column is always labeled with the main branch, even when another
    // (e.g. the current) branch shares its tip; every other column takes the
    // highest-priority branch ref sitting on its seed.
    const branch =
      seed === mainColSha
        ? main.name ?? pickBranchName(refsBySha.get(seed))
        : pickBranchName(refsBySha.get(seed));
    columns[col] = {
      id: col,
      tipGen: seedGen,
      baseGen: seedGen,
      forkParent: null,
      minRow: 0,
      maxRow: 0,
      seed,
      branch,
    };
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

  // ---- Phase 1b: phantom columns for branches with no commits of their own. --
  // A freshly created branch points at a commit that already belongs to another
  // branch's column (e.g. a new branch off `main`), so it never seeds a column of
  // its own — its target is already claimed. This holds whether it sits on the
  // column's tip OR on an interior/older commit. Rather than pile its chip inside
  // the owning branch's box (which would, for the current branch, tint that whole
  // box), we give it a small synthetic node one lane to the right, branching off
  // the shared commit, exactly where TortoiseSVN shows a branch copy.
  interface Phantom {
    branch: string;
    refs: GitRef[];
    anchorSha: string;
    anchorGen: number;
  }
  const phantoms: Phantom[] = [];
  const extraRefs = new Set<GitRef>();
  for (const ref of data.refs) {
    if (ref.type !== "localBranch") continue; // only local branches split off
    const sha = ref.targetSha;
    if (!present.has(sha)) continue;
    const col = colOf.get(sha);
    if (col === undefined) continue;
    const owner = columns[col]!;
    // Split any local branch that does not own its column — it has no commits of
    // its own, so it is just a label on another branch's commit. This covers both
    // a branch sharing the column's tip and one sitting on an interior/older
    // commit. The branch that actually owns the column keeps its commits in place.
    if (owner.branch === ref.name) continue;
    extraRefs.add(ref);
    const phRefs: GitRef[] = [ref];
    // The symbolic HEAD ref sits on the current branch's commit. When that branch
    // is split into a phantom, the HEAD ref would otherwise stay on the column
    // owner and wrongly paint *that* box as the current checkout — so two boxes
    // (owner + phantom) both read as HEAD. Move it onto the phantom so only the
    // real current branch is marked.
    if (ref.isCurrent) {
      const headRef = (refsBySha.get(sha) ?? []).find((r) => r.type === "head");
      if (headRef) {
        extraRefs.add(headRef);
        phRefs.push(headRef);
      }
    }
    phantoms.push({ branch: ref.name, refs: phRefs, anchorSha: sha, anchorGen: genOf.get(sha) ?? 0 });
  }

  // Phantoms sit one generation above their anchor, which can extend the grid.
  let effMaxGen = maxGen;
  for (const ph of phantoms) effMaxGen = Math.max(effMaxGen, ph.anchorGen + 1);
  // Level 0 is the top (highest generation). Generations are contiguous, so a
  // commit's level is just its distance from the top.
  const levelOf = (sha: string): number => effMaxGen - (genOf.get(sha) ?? 0);

  // ---- Phase 2: assign lanes with column compaction. ----
  // Each column's commits occupy a contiguous row span (tip = highest
  // generation = topmost row; base = lowest = bottommost).
  for (const col of columns) {
    col.minRow = effMaxGen - col.tipGen;
    col.maxRow = effMaxGen - col.baseGen;
  }
  // Order columns by creation point so earlier branches are placed first (and
  // therefore tend to land further left); topmost tip breaks ties.
  const byCreation = (a: number, b: number) =>
    columns[a]!.baseGen - columns[b]!.baseGen || columns[a]!.minRow - columns[b]!.minRow;

  const laneOf = new Map<number, number>();
  // laneSpans[lane] holds the [minRow, maxRow] intervals already placed there.
  const laneSpans: Array<Array<[number, number]>> = [];
  const place = (id: number, startLane: number): void => {
    const lo = columns[id]!.minRow;
    const hi = columns[id]!.maxRow;
    let lane = startLane;
    for (;;) {
      const span = laneSpans[lane] ?? (laneSpans[lane] = []);
      // Free when this column's row span touches none already in the lane.
      if (span.every(([a, b]) => hi < a || lo > b)) {
        span.push([lo, hi]);
        laneOf.set(id, lane);
        return;
      }
      lane++; // collision — try the next lane to the right
    }
  };

  // The trunk owns lane 0; everything else is packed into lanes >= 1.
  let primary = mainColSha !== undefined ? colOf.get(mainColSha) : undefined;
  if (primary === undefined && columns.length > 0) {
    primary = columns
      .map((c) => c.id)
      .sort((a, b) => columns[a]!.minRow - columns[b]!.minRow || byCreation(a, b))[0];
  }
  if (primary !== undefined) place(primary, 0);
  for (const id of columns
    .map((c) => c.id)
    .filter((id) => id !== primary)
    .sort(byCreation)) {
    place(id, 1);
  }

  // Phantom columns are placed last, always one lane to the right of their
  // anchor so a new branch never lands left of the branch it came from.
  interface PlacedPhantom {
    ph: Phantom;
    lane: number;
    row: number;
  }
  const placedPhantoms: PlacedPhantom[] = [];
  for (const ph of phantoms) {
    const anchorCol = colOf.get(ph.anchorSha)!;
    const anchorLane = laneOf.get(anchorCol) ?? 0;
    const row = effMaxGen - (ph.anchorGen + 1);
    const id = columns.length;
    columns[id] = {
      id,
      tipGen: ph.anchorGen + 1,
      baseGen: ph.anchorGen + 1,
      forkParent: anchorCol,
      minRow: row,
      maxRow: row,
      seed: "",
      branch: ph.branch,
    };
    place(id, anchorLane + 1);
    placedPhantoms.push({ ph, lane: laneOf.get(id)!, row });
  }

  // ---- Phase 3: position commits (row = structural level) and build edges. ----
  // Commits reachable only from a remote-tracking branch (not from any local
  // branch or HEAD) are "in the cloud only" — fetched but not pulled. Marked so
  // the renderer can tint them without shifting them out of their lane.
  const localReach = reachableFrom(
    [
      ...data.refs.filter((r) => r.type === "localBranch").map((r) => r.targetSha),
      ...(data.head != null ? [data.head] : []),
    ],
    bySha,
    present,
  );
  const remoteReach = reachableFrom(
    data.refs.filter((r) => r.type === "remoteBranch").map((r) => r.targetSha),
    bySha,
    present,
  );
  const isRemoteOnly = (sha: string): boolean => remoteReach.has(sha) && !localReach.has(sha);
  // Unpushed = present locally (local branch or HEAD) but on no remote branch.
  const isUnpushed = (sha: string): boolean => localReach.has(sha) && !remoteReach.has(sha);

  const positioned: PositionedCommit[] = [];
  const posBySha = new Map<string, PositionedCommit>();
  let maxLane = 0;

  commits.forEach((commit) => {
    const col = colOf.get(commit.sha)!;
    const lane = laneOf.get(col) ?? 0;
    // Refs split off onto a phantom are dropped here so they show only there.
    const refs = (refsBySha.get(commit.sha) ?? []).filter((r) => !extraRefs.has(r));
    const pc: PositionedCommit = {
      ...commit,
      row: levelOf(commit.sha),
      lane,
      refs,
      nodeId: commit.sha,
      branch: columns[col]!.branch,
      remoteOnly: isRemoteOnly(commit.sha),
      unpushed: isUnpushed(commit.sha),
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
        fromId: c.nodeId,
        toId: parent.nodeId,
        fromRow: c.row,
        fromLane: c.lane,
        toRow: parent.row,
        toLane: parent.lane,
        isMerge: index > 0,
      });
    });
  }

  // Append phantom nodes and the edge linking each back to its shared commit.
  for (const { ph, lane, row } of placedPhantoms) {
    const anchor = posBySha.get(ph.anchorSha)!;
    const nodeId = `${ph.anchorSha}@${ph.branch}`;
    positioned.push({
      ...anchor,
      refs: ph.refs,
      row,
      lane,
      nodeId,
      branch: ph.branch,
      phantom: true,
    });
    if (lane > maxLane) maxLane = lane;
    edges.push({
      fromSha: anchor.sha,
      toSha: anchor.sha,
      fromId: nodeId,
      toId: anchor.nodeId,
      fromRow: row,
      fromLane: lane,
      toRow: anchor.row,
      toLane: anchor.lane,
      isMerge: false,
      isBranch: true,
    });
  }

  // ---- Phase 4: stash entries placed just right of their own row. ----
  // Each stash sits at its base commit's row, joined by a connector to the commit
  // it was created from. Rather than reserving a column right of the *entire*
  // graph (which strands the stash far to the right when its row is nearly empty),
  // a stash hugs the rightmost real content on its own row, leaving one empty
  // gutter lane for the connector. Stashes sharing a row spill further right so
  // their boxes never overlap.
  const stashes = data.stashes ?? [];
  if (stashes.length > 0) {
    // Rightmost lane actually occupied at each row, from commit/phantom boxes and
    // from any edge running vertically through that row. Lets a stash sit beside
    // the content on its row instead of beside the whole graph.
    const rowMaxLane = new Map<number, number>();
    const bump = (row: number, lane: number) => {
      const cur = rowMaxLane.get(row);
      if (cur === undefined || lane > cur) rowMaxLane.set(row, lane);
    };
    for (const pc of positioned) bump(pc.row, pc.lane);
    for (const e of edges) {
      const lo = Math.min(e.fromRow, e.toRow);
      const hi = Math.max(e.fromRow, e.toRow);
      for (let r = lo; r <= hi; r++) {
        bump(r, e.fromLane);
        bump(r, e.toLane);
      }
    }
    // Stash lanes already taken on each row, so multiple stashes on one row spill.
    const stashUsed = new Map<number, Set<number>>();
    for (const s of stashes) {
      const base = posBySha.get(s.baseSha);
      const row = base ? base.row : 0;
      // One empty gutter lane past the rightmost content on this row (never left
      // of the base commit itself).
      const occupied = Math.max(rowMaxLane.get(row) ?? 0, base ? base.lane : 0);
      let lane = occupied + 2;
      let used = stashUsed.get(row);
      if (!used) {
        used = new Set();
        stashUsed.set(row, used);
      }
      while (used.has(lane)) lane++;
      used.add(lane);
      const nodeId = `stash@{${s.index}}`;
      positioned.push({
        sha: s.sha,
        parents: base ? [s.baseSha] : [],
        summary: s.message,
        author: "",
        authorEmail: "",
        date: s.date,
        row,
        lane,
        refs: [],
        nodeId,
        branch: `stash@{${s.index}}`,
        remoteOnly: false,
        unpushed: false,
        stash: true,
        stashIndex: s.index,
      });
      if (lane > maxLane) maxLane = lane;
      if (base) {
        edges.push({
          fromSha: s.sha,
          toSha: base.sha,
          fromId: nodeId,
          toId: base.nodeId,
          fromRow: row,
          fromLane: lane,
          toRow: base.row,
          toLane: base.lane,
          isMerge: false,
          isStash: true,
        });
      }
    }
  }

  return {
    commits: positioned,
    edges,
    laneCount: maxLane + 1,
    // Rows are structural levels (0..effMaxGen), several commits may share one.
    rowCount: commits.length > 0 ? effMaxGen + 1 : 0,
  };
}

/**
 * Resolve the commit (and branch name) that anchors the trunk (leftmost lane).
 * Preference order: the explicitly configured main branch, then main/master,
 * then the current branch, then HEAD. `name` is undefined when the trunk could
 * only be pinned by sha (e.g. a detached HEAD with no branch).
 */
function resolveMain(
  data: GraphData,
  mainBranch: string | undefined,
): { sha?: string; name?: string } {
  if (mainBranch) {
    const ref = data.refs.find(
      (r) => (r.type === "localBranch" || r.type === "remoteBranch") && r.name === mainBranch,
    );
    if (ref) return { sha: ref.targetSha, name: ref.name };
  }

  const mm = data.refs.find(
    (r) => r.type === "localBranch" && (r.name === "main" || r.name === "master"),
  );
  if (mm) return { sha: mm.targetSha, name: mm.name };

  const current = data.refs.find((r) => r.isCurrent);
  if (current) return { sha: current.targetSha, name: current.type !== "head" ? current.name : undefined };

  return { sha: data.head ?? undefined };
}

/**
 * Highest-priority branch name among the refs sitting on one commit: the current
 * branch, then any local branch, then any remote branch. Null when none point
 * here. Mirrors the renderer's box-header preference.
 */
function pickBranchName(refs: GitRef[] | undefined): string | null {
  if (!refs) return null;
  // Do NOT give isCurrent priority: a newly-created branch that shares a tip with
  // a pre-existing branch would steal the column, demoting the older branch to a
  // phantom at an arbitrary row. First local branch in refs order wins; the
  // checked-out branch correctly becomes a phantom with HEAD moved onto it (the
  // phantom logic at Phase 1b handles that case already).
  const local = refs.find((r) => r.type === "localBranch");
  if (local) return local.name;
  const remote = refs.find((r) => r.type === "remoteBranch");
  if (remote) return remote.name;
  return null;
}

/**
 * If the trunk branch named `branchName` has a remote-tracking counterpart that
 * is *ahead* of `anchor` on the same first-parent line — fetched but not yet
 * pulled — return that remote tip so the un-pulled commits extend the trunk lane
 * instead of forking right. Returns `anchor` unchanged when there is no such
 * fast-forward (no remote, behind, or genuinely diverged).
 */
function aheadTip(
  anchor: string,
  branchName: string | undefined,
  data: GraphData,
  genOf: Map<string, number>,
  bySha: Map<string, GitCommit>,
  present: Set<string>,
): string {
  if (branchName === undefined) return anchor;
  const anchorGen = genOf.get(anchor) ?? 0;
  const candidates = data.refs
    .filter(
      (r) =>
        (r.type === "localBranch" || r.type === "remoteBranch") &&
        present.has(r.targetSha) &&
        logicalBranchName(r) === branchName &&
        (genOf.get(r.targetSha) ?? 0) > anchorGen,
    )
    .map((r) => r.targetSha)
    .sort((a, b) => (genOf.get(b) ?? 0) - (genOf.get(a) ?? 0));
  for (const tip of candidates) {
    if (firstParentReaches(tip, anchor, bySha, present)) return tip;
  }
  return anchor;
}

/** Branch name without its remote prefix: "origin/main" -> "main", "main" -> "main". */
function logicalBranchName(ref: GitRef): string {
  if (ref.type === "remoteBranch") {
    if (ref.remote && ref.name.startsWith(ref.remote + "/")) {
      return ref.name.slice(ref.remote.length + 1);
    }
    const slash = ref.name.indexOf("/");
    if (slash >= 0) return ref.name.slice(slash + 1);
  }
  return ref.name;
}

/** True when walking first parents from `from` reaches `target` (in view). */
function firstParentReaches(
  from: string,
  target: string,
  bySha: Map<string, GitCommit>,
  present: Set<string>,
): boolean {
  let cur: string | undefined = from;
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === target) return true;
    seen.add(cur);
    cur = bySha.get(cur)?.parents.filter((p) => present.has(p))[0];
  }
  return false;
}

/** Set of in-view commits reachable from any of `tips`, walking all parents. */
function reachableFrom(
  tips: string[],
  bySha: Map<string, GitCommit>,
  present: Set<string>,
): Set<string> {
  const seen = new Set<string>();
  const stack = tips.filter((t) => present.has(t));
  while (stack.length > 0) {
    const sha = stack.pop()!;
    if (seen.has(sha)) continue;
    seen.add(sha);
    for (const p of bySha.get(sha)?.parents ?? []) {
      if (present.has(p) && !seen.has(p)) stack.push(p);
    }
  }
  return seen;
}
