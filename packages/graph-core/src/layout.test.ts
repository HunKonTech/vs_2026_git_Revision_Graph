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

  it("anchors a side branch at its fork level instead of the top", () => {
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
    // S1 is the newest commit but, by structure, sits one row above its fork
    // (T1) — the same level as T2 — not at the top.
    expect(at("S1").row).toBeGreaterThan(0);
    expect(at("S1").row).toBe(at("T2").row);
    expect(at("S1").lane).toBeGreaterThan(at("T2").lane);
  });

  it("keeps a merge back to the trunk a single row jump", () => {
    // A is root; main and a side branch each add one commit, then merge.
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
    const merge = layout.edges.find((e) => e.isMerge)!;
    expect(merge.toSha).toBe("C1");
    expect(merge.toRow - merge.fromRow).toBe(1); // exactly one level
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
});
