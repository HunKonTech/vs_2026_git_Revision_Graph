/**
 * Pure line-level diff for the side-by-side commit-changes view.
 *
 * Given the old and new text of a file, produces a list of aligned rows so the
 * renderer can draw two columns (original | changed) line by line. This lives in
 * graph-core (no DOM) so it can be unit-tested and reused by every host's webview
 * without each host re-implementing diffing — the hosts only fetch the raw text.
 */

/** One side of a diff row: the 1-based line number and its text. */
export interface DiffLine {
  num: number;
  text: string;
}

/**
 * The role of a row in the side-by-side view:
 *  - "context": unchanged line, present on both sides;
 *  - "add": a line only in the new file (right side only);
 *  - "del": a line only in the old file (left side only);
 *  - "change": a replaced line, paired old↔new on the same row.
 */
export type DiffRowKind = "context" | "add" | "del" | "change";

/** A single side-by-side row. `left`/`right` are null when that side is empty. */
export interface DiffRow {
  kind: DiffRowKind;
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Split text into lines, treating "" as zero lines and ignoring a final newline. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline yields a spurious empty final element — drop it so a file
  // ending in "\n" isn't reported as having an extra blank line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Compute the aligned side-by-side rows for two file versions.
 *
 * Uses a classic LCS (longest common subsequence) over lines to find the
 * unchanged anchors, then walks the two sequences: matched lines become
 * "context" rows, and each run of deletions/additions between anchors is paired
 * up into "change" rows (extra deletions → left-only "del", extra additions →
 * right-only "add").
 */
export function computeLineDiff(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // LCS length table: lcs[i][j] = LCS length of a[i..], b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  // Pending unmatched runs, flushed (paired) whenever we hit a matched line.
  let delRun: DiffLine[] = [];
  let addRun: DiffLine[] = [];
  const flush = (): void => {
    const pairs = Math.min(delRun.length, addRun.length);
    for (let k = 0; k < pairs; k++) {
      rows.push({ kind: "change", left: delRun[k]!, right: addRun[k]! });
    }
    for (let k = pairs; k < delRun.length; k++) {
      rows.push({ kind: "del", left: delRun[k]!, right: null });
    }
    for (let k = pairs; k < addRun.length; k++) {
      rows.push({ kind: "add", left: null, right: addRun[k]! });
    }
    delRun = [];
    addRun = [];
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      rows.push({ kind: "context", left: { num: i + 1, text: a[i]! }, right: { num: j + 1, text: b[j]! } });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      delRun.push({ num: i + 1, text: a[i]! });
      i++;
    } else {
      addRun.push({ num: j + 1, text: b[j]! });
      j++;
    }
  }
  while (i < n) delRun.push({ num: i + 1, text: a[i++]! });
  while (j < m) addRun.push({ num: j + 1, text: b[j++]! });
  flush();

  return rows;
}
