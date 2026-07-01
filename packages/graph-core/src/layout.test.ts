import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout.js";
import type { GitCommit, GraphData } from "@rev-graph/protocol";

/** Build a commit with sensible defaults; `parents` listed first-parent-first. */
function commit(sha: string, parents: string[] = []): GitCommit {
  return {
    sha,
    parents,
    summary: `commit ${sha}`,
    author: "Test",
    authorEmail: "test@example.com",
    date: "2026-01-01T00:00:00Z",
  };
}

function data(commits: GitCommit[], extra?: Partial<GraphData>): GraphData {
  return { commits, refs: [], head: commits[0]?.sha ?? null, ...extra };
}

describe("computeLayout", () => {
  it("places a linear history in a single lane", () => {
    // C -> B -> A  (newest first)
    const layout = computeLayout(data([commit("C", ["B"]), commit("B", ["A"]), commit("A")]));
    expect(layout.laneCount).toBe(1);
    expect(layout.commits.map((c) => c.lane)).toEqual([0, 0, 0]);
    expect(layout.commits.map((c) => c.row)).toEqual([0, 1, 2]);
    expect(layout.edges).toHaveLength(2);
  });

  it("gives a side branch its own lane and merges back", () => {
    //   M (merge of D and B2)
    //   |\
    //   D B2
    //   | /
    //   B
    //   |
    //   A
    const layout = computeLayout(
      data([
        commit("M", ["D", "B2"]),
        commit("D", ["B"]),
        commit("B2", ["B"]),
        commit("B", ["A"]),
        commit("A"),
      ]),
    );
    // The merge needs at least two lanes.
    expect(layout.laneCount).toBeGreaterThanOrEqual(2);
    // The merge edge (second parent) is flagged.
    const mergeEdges = layout.edges.filter((e) => e.isMerge);
    expect(mergeEdges).toHaveLength(1);
    expect(mergeEdges[0]!.fromSha).toBe("M");
    expect(mergeEdges[0]!.toSha).toBe("B2");
    // D and B2 occupy different lanes.
    const d = layout.commits.find((c) => c.sha === "D")!;
    const b2 = layout.commits.find((c) => c.sha === "B2")!;
    expect(d.lane).not.toBe(b2.lane);
  });

  it("keeps two independent tips (e.g. local + remote) in separate lanes", () => {
    // Two roots, no shared history.
    const layout = computeLayout(
      data([commit("X1", ["X0"]), commit("Y1", ["Y0"]), commit("X0"), commit("Y0")]),
    );
    expect(layout.laneCount).toBeGreaterThanOrEqual(2);
  });

  it("drops edges to parents that are out of view", () => {
    const layout = computeLayout(data([commit("C", ["B"])])); // B not in input
    expect(layout.edges).toHaveLength(0);
    expect(layout.commits).toHaveLength(1);
  });

  it("pins the configured main branch to the leftmost lane", () => {
    //   F (feature tip)        M (main tip)
    //   |                      |
    //   E                      C
    //    \                    /
    //     B ------------------
    //     |
    //     A
    // feature (F,E) forks from B; main (M,C) continues the trunk.
    const layout = computeLayout(
      data(
        [
          commit("F", ["E"]),
          commit("M", ["C"]),
          commit("E", ["B"]),
          commit("C", ["B"]),
          commit("B", ["A"]),
          commit("A"),
        ],
        {
          refs: [
            { name: "feature", type: "localBranch", targetSha: "F" },
            { name: "main", type: "localBranch", targetSha: "M", isCurrent: true },
          ],
          head: "M",
        },
      ),
      { mainBranch: "main" },
    );
    const lane = (sha: string) => layout.commits.find((c) => c.sha === sha)!.lane;
    // The main line sits in lane 0; the feature column is to its right.
    expect(lane("M")).toBe(0);
    expect(lane("C")).toBe(0);
    expect(lane("B")).toBe(0);
    expect(lane("A")).toBe(0);
    expect(lane("F")).toBeGreaterThan(0);
    expect(lane("E")).toBeGreaterThan(0);
  });

  it("places a branch to the right of the branch it forks from", () => {
    // main: D -> C -> B -> A ; feature off B: F -> E -> B
    const layout = computeLayout(
      data(
        [
          commit("F", ["E"]),
          commit("D", ["C"]),
          commit("E", ["B"]),
          commit("C", ["B"]),
          commit("B", ["A"]),
          commit("A"),
        ],
        {
          refs: [
            { name: "feature", type: "localBranch", targetSha: "F" },
            { name: "main", type: "localBranch", targetSha: "D", isCurrent: true },
          ],
          head: "D",
        },
      ),
      { mainBranch: "main" },
    );
    const lane = (sha: string) => layout.commits.find((c) => c.sha === sha)!.lane;
    // Feature's column is strictly to the right of main's column.
    expect(lane("F")).toBeGreaterThan(lane("D"));
    expect(lane("E")).toBeGreaterThan(lane("B"));
  });

  it("packs overlapping sibling branches into separate lanes, earlier on the left", () => {
    // trunk T4..T0. branchA (A2,A1) off T1 ; branchB (B2,B1) off T2 — their rows
    // overlap, so they cannot share a lane; the earlier branch (A) goes left.
    const layout = computeLayout(
      data(
        [
          commit("B2", ["B1"]),
          commit("A2", ["A1"]),
          commit("B1", ["T2"]),
          commit("A1", ["T1"]),
          commit("T4", ["T3"]),
          commit("T3", ["T2"]),
          commit("T2", ["T1"]),
          commit("T1", ["T0"]),
          commit("T0"),
        ],
        {
          refs: [
            { name: "main", type: "localBranch", targetSha: "T4", isCurrent: true },
            { name: "branchA", type: "localBranch", targetSha: "A2" },
            { name: "branchB", type: "localBranch", targetSha: "B2" },
          ],
          head: "T4",
        },
      ),
      { mainBranch: "main" },
    );
    const lane = (sha: string) => layout.commits.find((c) => c.sha === sha)!.lane;
    expect(lane("T4")).toBe(0); // trunk left
    expect(lane("A1")).toBeGreaterThan(0);
    expect(lane("A1")).toBeLessThan(lane("B1")); // earlier branch further left
  });

  it("compacts non-overlapping branches into the same lane", () => {
    // feature (F2,F1) lives high, side (S1) low — they never share a row, so
    // both reuse the first free lane instead of each reserving its own.
    const layout = computeLayout(
      data(
        [
          commit("F2", ["F1"]),
          commit("F1", ["T3"]),
          commit("S1", ["T1"]),
          commit("T4", ["T3"]),
          commit("T3", ["T2"]),
          commit("T2", ["T1"]),
          commit("T1", ["T0"]),
          commit("T0"),
        ],
        {
          refs: [
            { name: "main", type: "localBranch", targetSha: "T4", isCurrent: true },
            { name: "feature", type: "localBranch", targetSha: "F2" },
            { name: "side", type: "localBranch", targetSha: "S1" },
          ],
          head: "T4",
        },
      ),
      { mainBranch: "main" },
    );
    const lane = (sha: string) => layout.commits.find((c) => c.sha === sha)!.lane;
    expect(lane("T4")).toBe(0);
    expect(lane("F1")).toBe(1);
    expect(lane("S1")).toBe(1); // reused the same lane — no overlap, no gap
    expect(layout.laneCount).toBe(2); // only two columns total
  });

  it("aligns a dangling side branch with its fork commit's row", () => {
    // trunk T4..T0 ; a single newer side commit S1 forked from old T1.
    const layout = computeLayout(
      data(
        [
          commit("S1", ["T1"]),
          commit("T4", ["T3"]),
          commit("T3", ["T2"]),
          commit("T2", ["T1"]),
          commit("T1", ["T0"]),
          commit("T0"),
        ],
        {
          refs: [
            { name: "main", type: "localBranch", targetSha: "T4", isCurrent: true },
            { name: "side", type: "localBranch", targetSha: "S1" },
          ],
          head: "T4",
        },
      ),
      { mainBranch: "main" },
    );
    const at = (sha: string) => layout.commits.find((c) => c.sha === sha)!;
    expect(at("T4").row).toBe(0); // trunk tip at the top
    // S1 is a dangling side branch (never merged back), so it is pulled down to
    // sit beside the commit it forked from (T1) — same row, one lane right — with
    // its connector sprouting from T1's side rather than entering the top.
    expect(at("S1").row).toBe(at("T1").row);
    expect(at("S1").lane).toBeGreaterThan(at("T1").lane);
    const fork = layout.edges.find((e) => e.fromSha === "S1" && e.toSha === "T1")!;
    expect(fork.isBranch).toBe(true);
    expect(fork.fromRow).toBe(fork.toRow); // horizontal side sprout
  });

  it("merges a branch back from the row of its fork commit", () => {
    // A is root; main adds B1 then merges C1 (a 1-commit branch forked from A).
    const layout = computeLayout(
      data(
        [commit("M", ["B1", "C1"]), commit("B1", ["A"]), commit("C1", ["A"]), commit("A")],
        {
          refs: [{ name: "main", type: "localBranch", targetSha: "M", isCurrent: true }],
          head: "M",
        },
      ),
      { mainBranch: "main" },
    );
    const at = (sha: string) => layout.commits.find((c) => c.sha === sha)!;
    const merge = layout.edges.find((e) => e.isMerge)!;
    expect(merge.toSha).toBe("C1");
    // C1 aligns with its fork commit A (branch-beside-fork), so the merge from M
    // spans the whole gap from A's row up to M — not a single level.
    expect(at("C1").row).toBe(at("A").row);
    expect(merge.toRow).toBe(at("C1").row);
    expect(merge.fromRow).toBe(at("M").row);
  });

  it("labels every commit in a column with its owning branch", () => {
    // main: C -> B -> A ; the branch name should show on B and A too, not just C.
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [{ name: "main", type: "localBranch", targetSha: "C", isCurrent: true }],
        head: "C",
      }),
      { mainBranch: "main" },
    );
    const branchOf = (sha: string) => layout.commits.find((c) => c.sha === sha)!.branch;
    expect(branchOf("C")).toBe("main");
    expect(branchOf("B")).toBe("main");
    expect(branchOf("A")).toBe("main");
  });

  it("splits a brand-new branch (no own commits) into its own lane", () => {
    // `feature` was just created off main's tip C — both refs point at C.
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "C" },
          { name: "feature", type: "localBranch", targetSha: "C", isCurrent: true },
        ],
        head: "C",
      }),
      { mainBranch: "main" },
    );
    // A phantom node carries `feature`, to the right of main's lane.
    const phantom = layout.commits.find((c) => c.phantom)!;
    expect(phantom).toBeDefined();
    expect(phantom.branch).toBe("feature");
    expect(phantom.sha).toBe("C"); // points at the shared commit
    const mainTip = layout.commits.find((c) => c.sha === "C" && !c.phantom)!;
    expect(phantom.lane).toBeGreaterThan(mainTip.lane);
    // The feature chip moved off main's box onto the phantom.
    expect(mainTip.refs.map((r) => r.name)).not.toContain("feature");
    expect(phantom.refs.map((r) => r.name)).toContain("feature");
    // An edge connects the phantom back to the shared commit.
    expect(layout.edges.some((e) => e.fromId === phantom.nodeId && e.toSha === "C")).toBe(true);
  });

  it("keeps a pre-existing branch as column owner when a new checked-out branch shares its tip", () => {
    // `release` was just created from `feature`'s tip C and checked out.
    // `feature` already owned C (it has its own commit there) — `release` must be
    // the phantom, not `feature`, even though `release` is isCurrent.
    // `main` is at B so it doesn't claim C; `feature` seeds the column for C.
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "B" },
          { name: "feature", type: "localBranch", targetSha: "C" },
          { name: "release", type: "localBranch", targetSha: "C", isCurrent: true },
          { name: "head", type: "head", targetSha: "C" },
        ],
        head: "C",
      }),
      { mainBranch: "main" },
    );
    const phantom = layout.commits.find((c) => c.phantom)!;
    expect(phantom).toBeDefined();
    // The new branch is the phantom; the pre-existing branch keeps its column.
    expect(phantom.branch).toBe("release");
    const featureTip = layout.commits.find((c) => c.sha === "C" && !c.phantom)!;
    expect(featureTip.branch).toBe("feature");
    // HEAD travels with the checked-out branch (release) onto its phantom.
    expect(featureTip.refs.some((r) => r.type === "head")).toBe(false);
    expect(phantom.refs.some((r) => r.type === "head")).toBe(true);
    expect(phantom.refs.map((r) => r.name)).toContain("release");
    expect(featureTip.refs.map((r) => r.name)).toContain("feature");
    expect(featureTip.refs.map((r) => r.name)).not.toContain("release");
  });

  it("moves the symbolic HEAD ref onto the current branch's phantom, not the owner", () => {
    // HEAD is on `feature` (current), which shares main's tip C. The symbolic
    // head-type ref also sits on C. It must travel with the phantom so only the
    // real current branch box reads as HEAD — main must NOT also look checked-out.
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "C" },
          { name: "feature", type: "localBranch", targetSha: "C", isCurrent: true },
          { name: "head", type: "head", targetSha: "C" },
        ],
        head: "C",
      }),
      { mainBranch: "main" },
    );
    const phantom = layout.commits.find((c) => c.phantom)!;
    const mainTip = layout.commits.find((c) => c.sha === "C" && !c.phantom)!;
    // HEAD chip rides with the current branch, off main's box.
    expect(mainTip.refs.some((r) => r.type === "head")).toBe(false);
    expect(phantom.refs.some((r) => r.type === "head")).toBe(true);
  });

  it("splits a brand-new branch created on an interior commit into its own lane", () => {
    // `feature` was just created on main's *older* commit B (not the tip C) —
    // it has no commits of its own, so it must split off rather than tint B.
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "C", isCurrent: false },
          { name: "feature", type: "localBranch", targetSha: "B", isCurrent: true },
        ],
        head: "B",
      }),
      { mainBranch: "main" },
    );
    const phantom = layout.commits.find((c) => c.phantom)!;
    expect(phantom).toBeDefined();
    expect(phantom.branch).toBe("feature");
    expect(phantom.sha).toBe("B"); // points at the interior commit it was made from
    const realB = layout.commits.find((c) => c.sha === "B" && !c.phantom)!;
    expect(phantom.lane).toBeGreaterThan(realB.lane); // one lane to the right
    // The feature chip moved off main's interior box onto the phantom.
    expect(realB.refs.map((r) => r.name)).not.toContain("feature");
    expect(phantom.refs.map((r) => r.name)).toContain("feature");
    // B stays owned by main's column (its commits don't move).
    expect(realB.branch).toBe("main");
    expect(realB.lane).toBe(0);
    // An edge connects the phantom back to the interior commit.
    expect(layout.edges.some((e) => e.fromId === phantom.nodeId && e.toSha === "B")).toBe(true);
  });

  it("keeps a remote-tracking branch behind its local branch as an in-box chip", () => {
    // origin/main sits on an older commit; it must NOT become a phantom lane.
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "C", isCurrent: true },
          { name: "origin/main", type: "remoteBranch", targetSha: "B", remote: "origin" },
        ],
        head: "C",
      }),
      { mainBranch: "main" },
    );
    expect(layout.commits.some((c) => c.phantom)).toBe(false);
    const b = layout.commits.find((c) => c.sha === "B")!;
    expect(b.refs.map((r) => r.name)).toContain("origin/main");
  });

  it("attaches refs to the commit they point at", () => {
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "C", isCurrent: true },
          { name: "origin/main", type: "remoteBranch", targetSha: "B", remote: "origin" },
        ],
        head: "C",
      }),
    );
    const c = layout.commits.find((x) => x.sha === "C")!;
    const b = layout.commits.find((x) => x.sha === "B")!;
    expect(c.refs.map((r) => r.name)).toContain("main");
    expect(b.refs.map((r) => r.name)).toContain("origin/main");
  });

  it("keeps fetched-but-not-pulled commits in the trunk lane, flagged remote-only", () => {
    // origin/main is two commits ahead of local main (fetch ran, no pull):
    //   R2 (origin/main) -> R1 -> M (main, current) -> A
    const layout = computeLayout(
      data([commit("R2", ["R1"]), commit("R1", ["M"]), commit("M", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "M", isCurrent: true },
          { name: "origin/main", type: "remoteBranch", targetSha: "R2", remote: "origin" },
        ],
        head: "M",
      }),
      { mainBranch: "main" },
    );
    const at = (sha: string) => layout.commits.find((c) => c.sha === sha)!;
    // Un-pulled commits continue the trunk lane instead of forking right.
    expect(at("R2").lane).toBe(0);
    expect(at("R1").lane).toBe(0);
    expect(at("M").lane).toBe(0);
    expect(at("A").lane).toBe(0);
    expect(layout.laneCount).toBe(1);
    // ...and they are marked as living only in the cloud.
    expect(at("R2").remoteOnly).toBe(true);
    expect(at("R1").remoteOnly).toBe(true);
    expect(at("M").remoteOnly).toBe(false);
    expect(at("A").remoteOnly).toBe(false);
  });

  it("still forks a genuinely diverged remote into its own lane", () => {
    // Both built on A but on different lines — origin/main is NOT a fast-forward
    // of local main, so it must keep its own column.
    //   M (main)   R2 (origin/main) -> R1
    //        \      /
    //           A
    const layout = computeLayout(
      data([commit("R2", ["R1"]), commit("R1", ["A"]), commit("M", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "M", isCurrent: true },
          { name: "origin/main", type: "remoteBranch", targetSha: "R2", remote: "origin" },
        ],
        head: "M",
      }),
      { mainBranch: "main" },
    );
    const at = (sha: string) => layout.commits.find((c) => c.sha === sha)!;
    expect(at("M").lane).toBe(0); // local trunk stays left
    expect(at("R2").lane).toBeGreaterThan(0); // diverged remote forks right
    expect(at("R2").remoteOnly).toBe(true); // and is still cloud-only
  });

  it("flags local-only commits as unpushed (and pushed ones as not)", () => {
    // origin/main is at A; local main has advanced to C past it.
    //   C (main, current) -> B -> A (origin/main)
    const layout = computeLayout(
      data([commit("C", ["B"]), commit("B", ["A"]), commit("A")], {
        refs: [
          { name: "main", type: "localBranch", targetSha: "C", isCurrent: true },
          { name: "origin/main", type: "remoteBranch", targetSha: "A", remote: "origin" },
        ],
        head: "C",
      }),
      { mainBranch: "main" },
    );
    const at = (sha: string) => layout.commits.find((c) => c.sha === sha)!;
    expect(at("C").unpushed).toBe(true); // local-only, not on the remote
    expect(at("B").unpushed).toBe(true);
    expect(at("A").unpushed).toBe(false); // reachable from origin/main → pushed
  });

  it("places stashes in a lane right of the graph, linked to their base", () => {
    //   B (main, current) -> A   + one stash created from A
    const layout = computeLayout(
      data([commit("B", ["A"]), commit("A")], {
        refs: [{ name: "main", type: "localBranch", targetSha: "B", isCurrent: true }],
        head: "B",
        stashes: [
          { index: 0, sha: "S0", baseSha: "A", message: "WIP on main", date: "2026-01-01T00:00:00Z" },
        ],
      }),
      { mainBranch: "main" },
    );
    const stash = layout.commits.find((c) => c.stash)!;
    expect(stash.stashIndex).toBe(0);
    const base = layout.commits.find((c) => c.sha === "A")!;
    expect(stash.row).toBe(base.row); // sits at its base commit's row
    expect(stash.lane).toBeGreaterThan(base.lane); // in a column to the right
    // A connector edge ties the stash back to the commit it came from.
    const link = layout.edges.find((e) => e.isStash)!;
    expect(link.fromId).toBe("stash@{0}");
    expect(link.toSha).toBe("A");
  });

  it("hugs the content on the stash's own row, not the width of the whole graph", () => {
    // Branches x and y fan out near the top (lanes >= 1), then the trunk runs
    // down alone to A. A stash based on A sits just right of the trunk on its
    // own (near-empty) row — not stranded past the widest row above it.
    const layout = computeLayout(
      data(
        [
          commit("X", ["T1"]),
          commit("Y", ["T1"]),
          commit("T1", ["T2"]),
          commit("T2", ["A"]),
          commit("A"),
        ],
        {
          refs: [
            { name: "main", type: "localBranch", targetSha: "T1", isCurrent: true },
            { name: "x", type: "localBranch", targetSha: "X" },
            { name: "y", type: "localBranch", targetSha: "Y" },
          ],
          head: "T1",
          stashes: [
            { index: 0, sha: "S0", baseSha: "A", message: "WIP", date: "2026-01-01T00:00:00Z" },
          ],
        },
      ),
      { mainBranch: "main" },
    );
    const stash = layout.commits.find((c) => c.stash)!;
    const base = layout.commits.find((c) => c.sha === "A")!;
    expect(stash.row).toBe(base.row);
    // One gutter lane right of the only content on A's row (the trunk).
    expect(stash.lane).toBe(base.lane + 2);
    // The graph is wider higher up; the old "right of the whole graph" rule
    // would have placed the stash at maxNonStashLane + 2.
    const maxNonStash = Math.max(...layout.commits.filter((c) => !c.stash).map((c) => c.lane));
    expect(maxNonStash).toBeGreaterThanOrEqual(2);
    expect(stash.lane).toBeLessThan(maxNonStash + 2);
  });
});
