/**
 * Shared host <-> webview message contracts.
 *
 * The same protocol is implemented by both hosts:
 *  - the VS Code extension (TypeScript), and
 *  - the Visual Studio VSIX (C#, mirrored by hand).
 *
 * Keep this file the single source of truth. The C# side mirrors these shapes.
 */

/** Kind of git reference pointing at a commit. */
export type RefType = "localBranch" | "remoteBranch" | "tag" | "head";

/** A single git reference (branch / tag / HEAD). */
export interface GitRef {
  /** Full short name, e.g. "main", "origin/main", "v1.2.3". */
  name: string;
  type: RefType;
  /** Commit sha this ref points at. */
  targetSha: string;
  /** For remote branches: the remote name, e.g. "origin". */
  remote?: string;
  /** True when this ref is the currently checked-out branch. */
  isCurrent?: boolean;
}

/** A single commit node in the DAG. */
export interface GitCommit {
  sha: string;
  /** Parent shas in order (first parent first). Empty for root commits. */
  parents: string[];
  summary: string;
  author: string;
  authorEmail: string;
  /** ISO-8601 commit date. */
  date: string;
}

/** A single git stash entry (`stash@{N}`). */
export interface StashEntry {
  /** Stack position N in `stash@{N}` (0 = most recent). */
  index: number;
  /** The stash commit's sha. */
  sha: string;
  /** Subject line of the stash (e.g. "WIP on main: 1a2b3c msg"). */
  message: string;
  /** Sha of the commit the stash was created from (its first parent). */
  baseSha: string;
  /** ISO-8601 date the stash was created. */
  date: string;
}

/** How a file changed in a commit, relative to its first parent. */
export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

/** One file changed by a commit (the left-pane list in the changes dialog). */
export interface CommitChangeFile {
  /** Path as of this commit (the new path for renames). */
  path: string;
  /** For renames: the path the file had in the parent. */
  oldPath?: string;
  status: DiffFileStatus;
}

/**
 * The before/after content of a single changed file, for the side-by-side diff.
 * `oldText` is empty for added files, `newText` empty for deleted files. When the
 * file is binary or too large to diff, the host sets the matching flag and leaves
 * the text empty.
 */
export interface FileDiff {
  sha: string;
  path: string;
  status: DiffFileStatus;
  /** Content in the parent commit (empty for added files). */
  oldText: string;
  /** Content in this commit (empty for deleted files). */
  newText: string;
  /** True when git reports the file as binary — no text diff is shown. */
  binary?: boolean;
  /** True when the file exceeded the host's diff size cap. */
  tooLarge?: boolean;
}

/** How a file is affected by a (still hypothetical) merge. */
export type MergeFileStatus = "added" | "modified" | "deleted" | "conflict";

/** One file the merge would change, for the merge preview list. */
export interface MergePreviewFile {
  path: string;
  status: MergeFileStatus;
}

/**
 * A dry-run preview of merging `source` into `target` (the current branch),
 * computed by the host without touching the working tree (`git merge-tree`).
 */
export interface MergePreview {
  /** Branch being merged in (the one the user right-clicked). */
  source: string;
  /** Branch the merge lands on (the current checkout). */
  target: string;
  /** `source` is already contained in `target` — nothing to merge. */
  upToDate: boolean;
  /** The merge can fast-forward (no merge commit required). */
  canFastForward: boolean;
  /** Files the merge would change, relative to `target`. */
  files: MergePreviewFile[];
  /** Paths git reports as conflicting (also flagged inside `files`). */
  conflicts: string[];
  /** Auto-generated default merge-commit message (the user may edit it). */
  defaultMessage: string;
  /** Set when the preview couldn't be computed (detached HEAD, old git, …). */
  error?: string;
}

/** The full graph payload sent from host to webview. */
export interface GraphData {
  commits: GitCommit[];
  refs: GitRef[];
  /** Sha of HEAD, or null in a detached/empty state. */
  head: string | null;
  /** Short label for the repo (folder name) shown in the status bar. */
  repoName?: string;
  /** Stash entries, drawn in their own column linked back to their base commit. */
  stashes?: StashEntry[];
  /** The git log command that produced this data, shown in the status bar. */
  gitCommand?: string;
}

/** Theme tokens forwarded from the host so the webview matches the IDE. */
export interface ThemeTokens {
  kind: "light" | "dark" | "highContrast";
  background: string;
  foreground: string;
  /** Accent / selection color. */
  accent: string;
  /** Subtle border/line color. */
  border: string;
}

/* ------------------------------------------------------------------ */
/* host -> webview                                                     */
/* ------------------------------------------------------------------ */

/** Operations whose outcome the host reports back for a localized status line. */
export type OpKind = "undo" | "stashApply" | "stashPop" | "stashDrop" | "merge";

/** Outcome of an op: clean success, a conflict left for the IDE resolver, or a failure. */
export type OpResult = "ok" | "conflict" | "error";

export type HostToWebview =
  | { type: "setData"; data: GraphData }
  | { type: "setTheme"; theme: ThemeTokens }
  | { type: "branchCreated"; name: string; sha: string }
  // Outcome of an undo/stash op. The webview localizes (op, result); `detail`
  // carries the raw git error text for the "error" case.
  | { type: "opResult"; op: OpKind; result: OpResult; detail?: string }
  // The list of files a commit changed (answers `requestCommitChanges`).
  | { type: "commitChanges"; sha: string; files: CommitChangeFile[] }
  // All file paths present in the commit's tree (answers `requestCommitTree`).
  | { type: "commitTree"; sha: string; paths: string[] }
  // The before/after content of one file (answers `requestFileDiff`).
  | { type: "fileDiff"; diff: FileDiff }
  // Raw content of one file at a commit (answers `requestFileContent`).
  | { type: "fileContent"; sha: string; path: string; text: string; binary?: boolean; tooLarge?: boolean }
  // A dry-run merge preview (answers `requestMergePreview`).
  | { type: "mergePreview"; preview: MergePreview }
  // The before/after content of one file the merge would change (answers
  // `requestMergeFileDiff`). Reuses FileDiff so the shared diff view renders it.
  | { type: "mergeFileDiff"; diff: FileDiff }
  | { type: "error"; message: string };

/* ------------------------------------------------------------------ */
/* webview -> host                                                     */
/* ------------------------------------------------------------------ */

export type WebviewToHost =
  | { type: "ready" }
  | { type: "requestRefresh" }
  // `name`/`checkout` are sent when the webview's SVN-style dialog already
  // collected them; when absent the host shows its own native prompt.
  | { type: "createBranch"; sha: string; name?: string; checkout?: boolean }
  | { type: "deleteBranch"; name: string }
  | { type: "renameBranch"; name: string }
  // Reword a local (unpushed) commit's message. The host prompts for the new
  // text and rewrites the commit silently.
  | { type: "renameCommit"; sha: string }
  // Ask the host for the list of files a commit changed (vs its first parent).
  | { type: "requestCommitChanges"; sha: string }
  // Ask the host for all file paths present in the commit's tree.
  | { type: "requestCommitTree"; sha: string }
  // Ask the host for the before/after content of one changed file.
  | { type: "requestFileDiff"; sha: string; path: string; status: DiffFileStatus; oldPath?: string }
  // Ask the host for the raw content of one file at a commit (for unchanged files).
  | { type: "requestFileContent"; sha: string; path: string }
  // Ask the host for a dry-run preview of merging `source` into the current branch.
  | { type: "requestMergePreview"; source: string }
  // Ask the host for the before/after content of one file the merge would change
  // (current branch vs the merged result; conflicted files include conflict markers).
  | { type: "requestMergeFileDiff"; source: string; path: string; status: MergeFileStatus }
  // Merge `source` into the current branch. `message` is the (editable) merge-commit
  // message; `noFastForward` forces a merge commit even when a fast-forward is possible.
  | { type: "merge"; source: string; message?: string; noFastForward?: boolean }
  // Undo a *local* (unpushed) commit, returning its changes to the working tree
  // as unstaged edits. Leaves no trace in history (reset / rebase-drop, not a
  // revert commit). Deeper commits may conflict → resolved in the IDE.
  | { type: "undoCommit"; sha: string }
  | { type: "stashApply"; index: number }
  | { type: "stashPop"; index: number }
  | { type: "stashDrop"; index: number }
  | { type: "checkout"; sha?: string; ref?: string }
  | { type: "copySha"; sha: string }
  | { type: "fetch" }
  | { type: "pull" }
  | { type: "push" }
  | { type: "pushBranch"; name: string }
  | { type: "sync" }
  // Override the git binary path. `null` = revert to the IDE's built-in git.
  | { type: "setGitPath"; path: string | null };

/** Type guard helper used by hosts when handling untyped postMessage data. */
export function isWebviewToHost(value: unknown): value is WebviewToHost {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
