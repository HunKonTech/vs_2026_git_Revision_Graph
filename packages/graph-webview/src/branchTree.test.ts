import { describe, it, expect } from "vitest";
import { buildBranchTree } from "./branchTree.js";

describe("buildBranchTree", () => {
  it("groups branches by their path prefixes", () => {
    const tree = buildBranchTree([
      "Feature/Test",
      "Branches/teszt",
      "Release/vs_code/1.0.0",
      "Release/vsCode/vs_2026/1.0.0",
    ]);

    const top = tree.map((n) => n.name);
    // Folders only at the top level, alphabetical.
    expect(top).toEqual(["Branches", "Feature", "Release"]);
    expect(tree.every((n) => n.isFolder)).toBe(true);

    const release = tree.find((n) => n.name === "Release")!;
    expect(release.children.map((c) => c.name)).toEqual(["vs_code", "vsCode"]);
    expect(release.children.every((c) => c.isFolder)).toBe(true);

    const vsCode = release.children.find((c) => c.name === "vsCode")!;
    expect(vsCode.path).toBe("Release/vsCode");
    expect(vsCode.children.map((c) => c.name)).toEqual(["vs_2026"]);
    expect(vsCode.children[0]!.isFolder).toBe(true);
    expect(vsCode.children[0]!.path).toBe("Release/vsCode/vs_2026");
  });

  it("marks the terminal segment as a non-selectable branch leaf", () => {
    const tree = buildBranchTree(["Feature/Test"]);
    const feature = tree[0]!;
    expect(feature.isFolder).toBe(true);
    const leaf = feature.children[0]!;
    expect(leaf.name).toBe("Test");
    expect(leaf.isFolder).toBe(false);
    expect(leaf.children).toHaveLength(0);
  });

  it("puts top-level branches (no slash) at the root as leaves", () => {
    const tree = buildBranchTree(["main", "develop", "Feature/X"]);
    const main = tree.find((n) => n.name === "main")!;
    expect(main.isFolder).toBe(false);
    // Folder sorts before the two root leaves.
    expect(tree.map((n) => n.name)).toEqual(["Feature", "develop", "main"]);
  });

  it("ignores blank names and a folder wins over a same-named leaf", () => {
    const tree = buildBranchTree(["", "  ", "Release", "Release/1.0.0"]);
    expect(tree.map((n) => n.name)).toEqual(["Release"]);
    const release = tree[0]!;
    expect(release.isFolder).toBe(true);
    expect(release.children.map((c) => c.name)).toEqual(["1.0.0"]);
  });
});
