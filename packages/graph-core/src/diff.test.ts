import { describe, it, expect } from "vitest";
import { computeLineDiff } from "./diff.js";

describe("computeLineDiff", () => {
  it("treats an empty old file as all additions (right side only)", () => {
    const rows = computeLineDiff("", "a\nb\n");
    expect(rows.every((r) => r.kind === "add")).toBe(true);
    expect(rows.map((r) => r.left)).toEqual([null, null]);
    expect(rows.map((r) => r.right?.text)).toEqual(["a", "b"]);
    expect(rows.map((r) => r.right?.num)).toEqual([1, 2]);
  });

  it("treats an empty new file as all deletions (left side only)", () => {
    const rows = computeLineDiff("a\nb\n", "");
    expect(rows.every((r) => r.kind === "del")).toBe(true);
    expect(rows.map((r) => r.right)).toEqual([null, null]);
    expect(rows.map((r) => r.left?.text)).toEqual(["a", "b"]);
  });

  it("reports identical files as all context rows", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "context")).toBe(true);
    expect(rows.map((r) => [r.left?.num, r.right?.num])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("pairs a replaced line into a single change row", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nB\nc");
    expect(rows.map((r) => r.kind)).toEqual(["context", "change", "context"]);
    const change = rows[1]!;
    expect(change.left?.text).toBe("b");
    expect(change.right?.text).toBe("B");
    expect(change.left?.num).toBe(2);
    expect(change.right?.num).toBe(2);
  });

  it("keeps a pure insertion on the right with correct numbering", () => {
    const rows = computeLineDiff("a\nc", "a\nb\nc");
    expect(rows.map((r) => r.kind)).toEqual(["context", "add", "context"]);
    expect(rows[1]!.right?.text).toBe("b");
    expect(rows[1]!.right?.num).toBe(2);
    expect(rows[2]!.left?.num).toBe(2);
    expect(rows[2]!.right?.num).toBe(3);
  });

  it("keeps a pure deletion on the left", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nc");
    expect(rows.map((r) => r.kind)).toEqual(["context", "del", "context"]);
    expect(rows[1]!.left?.text).toBe("b");
    expect(rows[1]!.right).toBeNull();
  });

  it("ignores a trailing newline difference", () => {
    const rows = computeLineDiff("a\nb", "a\nb\n");
    expect(rows.every((r) => r.kind === "context")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("splits a block edit into paired changes plus extra adds/dels", () => {
    // Two lines removed, three added between unchanged anchors.
    const rows = computeLineDiff("a\nx\ny\nz", "a\nP\nQ\nR\nS");
    expect(rows[0]!.kind).toBe("context");
    const tail = rows.slice(1);
    // 3 replaced (x→P, y→Q, z→R) paired as changes, then S as an extra add.
    expect(tail.map((r) => r.kind)).toEqual(["change", "change", "change", "add"]);
    expect(tail[3]!.right?.text).toBe("S");
    expect(tail[3]!.left).toBeNull();
  });
});
