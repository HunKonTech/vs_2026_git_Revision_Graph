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
export type OpKind = "undo" | "stashApply" | "stashPop" | "stashDrop";

/** Outcome of an op: clean success, a conflict left for the IDE resolver, or a failure. */
export type OpResult = "ok" | "conflict" | "error";

export type HostToWebview =
  | { type: "setData"; data: GraphData }
  | { type: "setTheme"; theme: ThemeTokens }
  | { type: "branchCreated"; name: string; sha: string }
  // Outcome of an undo/stash op. The webview localizes (op, result); `detail`
  // carries the raw git error text for the "error" case.
  | { type: "opResult"; op: OpKind; result: OpResult; detail?: string }
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
  // Reword a local (unpushed) commit's message. The host prompts for the new
  // text and rewrites the commit silently.
  | { type: "renameCommit"; sha: string }
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
  | { type: "sync" };

/** Type guard helper used by hosts when handling untyped postMessage data. */
export function isWebviewToHost(value: unknown): value is WebviewToHost {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
