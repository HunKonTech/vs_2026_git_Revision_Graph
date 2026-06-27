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
