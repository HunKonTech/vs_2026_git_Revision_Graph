import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import type {
  GraphData,
  GitCommit,
  GitRef,
  RefType,
  StashEntry,
  CommitChangeFile,
  DiffFileStatus,
  FileDiff,
  MergePreview,
  MergePreviewFile,
  MergeFileStatus,
} from "@rev-graph/protocol";

const run = promisify(execFile);

const FS = "\x1f"; // field separator
const RS = "\x1e"; // record separator

// The git binary to invoke. Defaults to "git" on PATH, but is overridden with
// the path the built-in VS Code Git extension resolved (see setGitPath) so the
// user never has to install or configure git separately.
let gitPath = "git";

/** Point all git invocations at the binary the host's Git extension resolved. */
export function setGitPath(path: string | undefined): void {
  if (path && path.trim()) gitPath = path;
}

/** Run a git command in `cwd` and return stdout. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run(gitPath, args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Run a git command in `cwd` with extra environment, return stdout. */
async function gitEnv(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await run(gitPath, args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/**
 * Run a git command and return its stdout *and* exit code, without throwing on a
 * non-zero exit. Needed for commands like `git merge-tree`, which exit 1 to signal
 * conflicts while still printing their useful result to stdout.
 */
async function gitCapture(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await run(gitPath, args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; code?: number };
    return { stdout: typeof e.stdout === "string" ? e.stdout : "", code: typeof e.code === "number" ? e.code : 1 };
  }
}

/** Read the full graph (commits + refs, local & remote) for a repo. */
export async function readGraphData(repoRoot: string, maxCommits: number): Promise<GraphData> {
  const [logOut, refsOut, headSha, stashes] = await Promise.all([
    git(repoRoot, [
      "log",
      // Keep the stash's internal commits (the stash commit itself and its index
      // snapshot) out of the DAG — they are surfaced separately as stash nodes.
      // `--exclude` must precede `--all` to take effect.
      "--exclude=refs/stash",
      "--all",
      // Topological order keeps each branch's commits contiguous instead of
      // interleaving branches by timestamp — the SVN revision-graph behaviour,
      // where structure (not commit time) drives vertical placement.
      "--topo-order",
      `--max-count=${maxCommits}`,
      `--pretty=format:%H${FS}%P${FS}%s${FS}%an${FS}%ae${FS}%aI${RS}`,
    ]),
    git(repoRoot, [
      "for-each-ref",
      `--format=%(refname)${FS}%(objectname)${FS}%(*objectname)${FS}%(HEAD)`,
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]),
    git(repoRoot, ["rev-parse", "HEAD"]).catch(() => ""),
    readStashes(repoRoot),
  ]);

  const commits = parseCommits(logOut);
  const refs = parseRefs(refsOut);
  const head = headSha.trim() || null;

  return { commits, refs, head, repoName: path.basename(repoRoot), stashes };
}

/** Read the stash stack, each entry tied to the commit it was created from. */
export async function readStashes(repoRoot: string): Promise<StashEntry[]> {
  const out = await git(repoRoot, [
    "stash",
    "list",
    `--format=%gd${FS}%H${FS}%P${FS}%gs${FS}%cI`,
  ]).catch(() => "");
  const stashes: StashEntry[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [gd, sha, parents, message, date] = line.split(FS);
    if (!sha) continue;
    const m = gd?.match(/stash@\{(\d+)\}/);
    const index = m ? Number(m[1]) : stashes.length;
    // A stash commit's first parent is the commit HEAD was on when it was made.
    const baseSha = parents ? (parents.split(" ").filter(Boolean)[0] ?? "") : "";
    stashes.push({ index, sha, baseSha, message: message ?? "", date: date ?? "" });
  }
  return stashes;
}

function parseCommits(out: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const rec of out.split(RS)) {
    const line = rec.replace(/^\n/, "");
    if (!line.trim()) continue;
    const [sha, parents, summary, author, authorEmail, date] = line.split(FS);
    if (!sha) continue;
    commits.push({
      sha,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      summary: summary ?? "",
      author: author ?? "",
      authorEmail: authorEmail ?? "",
      date: date ?? "",
    });
  }
  return commits;
}

function parseRefs(out: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [refname, objectname, derefObject, headMark] = line.split(FS);
    if (!refname || !objectname) continue;

    // Annotated tags: prefer the dereferenced commit the tag points to.
    const targetSha = derefObject && derefObject.length > 0 ? derefObject : objectname;
    const isCurrent = headMark === "*";

    if (refname.startsWith("refs/heads/")) {
      refs.push({
        name: refname.slice("refs/heads/".length),
        type: "localBranch",
        targetSha,
        isCurrent,
      });
    } else if (refname.startsWith("refs/remotes/")) {
      const short = refname.slice("refs/remotes/".length);
      if (short.endsWith("/HEAD")) continue; // skip the symbolic origin/HEAD
      const remote = short.split("/")[0];
      refs.push({ name: short, type: "remoteBranch", targetSha, remote });
    } else if (refname.startsWith("refs/tags/")) {
      refs.push({ name: refname.slice("refs/tags/".length), type: "tag", targetSha });
    } else {
      refs.push({ name: refname, type: "localBranch" as RefType, targetSha });
    }
  }
  return refs;
}

/** Create a branch from a commit using the git CLI (fallback path). */
export async function createBranchCli(
  repoRoot: string,
  name: string,
  sha: string,
  checkout: boolean,
): Promise<void> {
  if (checkout) {
    await git(repoRoot, ["checkout", "-b", name, sha]);
  } else {
    await git(repoRoot, ["branch", name, sha]);
  }
}

/** Checkout a commit/ref using the git CLI (fallback path). */
export async function checkoutCli(repoRoot: string, treeish: string): Promise<void> {
  await git(repoRoot, ["checkout", treeish]);
}

/** Where a checkout of a given commit should actually land. */
export interface CheckoutTarget {
  /** The branch name to switch to (or the bare sha for a detached checkout). */
  ref: string;
  /** When set, create a local branch tracking this remote ref (e.g. "origin/x"). */
  track?: string;
}

/**
 * Decide the best checkout target for a commit so we don't needlessly detach HEAD:
 *  - prefer a local branch that points at the commit;
 *  - else, if only a remote branch points at it, create a local tracking branch;
 *  - else, fall back to the bare commit (intentional detached HEAD).
 */
export async function resolveCheckoutTarget(
  repoRoot: string,
  sha: string,
  preferredRef?: string,
): Promise<CheckoutTarget> {
  // When the caller named the exact branch the user clicked, honour it directly
  // so commits shared by several branches don't get resolved to the wrong one.
  if (preferredRef) {
    const localHit = await git(repoRoot, ["branch", "--list", preferredRef]).catch(() => "");
    if (localHit.trim()) return { ref: preferredRef };
    const remoteHit = await git(repoRoot, ["branch", "-r", "--list", preferredRef]).catch(() => "");
    if (remoteHit.trim()) {
      const localName = preferredRef.split("/").slice(1).join("/");
      return { ref: localName, track: preferredRef };
    }
  }

  const local = await git(repoRoot, [
    "branch",
    "--points-at",
    sha,
    "--format=%(refname:short)",
  ]).catch(() => "");
  const locals = local
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (locals.length > 0) return { ref: locals[0]! };

  const remote = await git(repoRoot, [
    "branch",
    "-r",
    "--points-at",
    sha,
    "--format=%(refname:lstrip=2)",
  ]).catch(() => "");
  const remotes = remote
    .split("\n")
    .map((s) => s.trim())
    .filter((r) => r && !r.endsWith("/HEAD"));
  if (remotes.length > 0) {
    const remoteRef = remotes[0]!; // e.g. "origin/feature"
    const slashAt = remoteRef.indexOf("/");
    if (slashAt > 0) {
      const localName = remoteRef.slice(slashAt + 1);
      return { ref: localName, track: remoteRef };
    }
  }

  return { ref: sha };
}

/**
 * Create a local branch tracking a remote branch and switch to it. Falls back to
 * a plain checkout if a local branch of that name already exists.
 */
export async function checkoutTrackingCli(
  repoRoot: string,
  localName: string,
  remoteRef: string,
): Promise<void> {
  await git(repoRoot, ["checkout", "-b", localName, "--track", remoteRef]).catch(() =>
    git(repoRoot, ["checkout", localName]),
  );
}

/** Fetch all remotes (and prune deleted remote branches). */
export async function fetchCli(repoRoot: string): Promise<void> {
  await git(repoRoot, ["fetch", "--all", "--prune"]);
}

/** Pull the current branch from its upstream. */
export async function pullCli(repoRoot: string): Promise<void> {
  await git(repoRoot, ["pull"]);
}

/** Push the current branch to its upstream. */
export async function pushCli(repoRoot: string): Promise<void> {
  await git(repoRoot, ["push"]);
}

/** Push a specific local branch to origin and set up tracking. */
export async function pushBranchCli(repoRoot: string, branchName: string): Promise<void> {
  await git(repoRoot, ["push", "--set-upstream", "origin", branchName]);
}

/** Rename a local branch. */
export async function renameBranchCli(repoRoot: string, oldName: string, newName: string): Promise<void> {
  await git(repoRoot, ["branch", "-m", oldName, newName]);
}

/** Delete a local branch. `force` uses -D (drops the merged-state safety check). */
export async function deleteBranchCli(
  repoRoot: string,
  name: string,
  force: boolean,
): Promise<void> {
  await git(repoRoot, ["branch", force ? "-D" : "-d", name]);
}

/** The branch HEAD currently points at, or "" when HEAD is detached. */
export async function currentBranchCli(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")).trim();
}

/** Whether a local branch of exactly this name exists. */
async function localBranchExists(repoRoot: string, name: string): Promise<boolean> {
  return git(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])
    .then(() => true)
    .catch(() => false);
}

/**
 * The repo's main branch name — the remote's default (origin/HEAD) if a matching
 * local branch exists, else local `main`, else local `master`. "" when none found.
 */
export async function resolveMainBranchCli(repoRoot: string): Promise<string> {
  const sym = (
    await git(repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")
  ).trim();
  if (sym) {
    const slash = sym.indexOf("/");
    const localName = slash >= 0 ? sym.slice(slash + 1) : sym;
    if (localName && (await localBranchExists(repoRoot, localName))) return localName;
  }
  for (const cand of ["main", "master"]) {
    if (await localBranchExists(repoRoot, cand)) return cand;
  }
  return "";
}

/**
 * Where HEAD should land when the currently checked-out branch `branch` is about
 * to be deleted (you can't delete the branch a worktree has checked out):
 *  - if `branch` forked directly off the main branch → the main branch (its tip);
 *  - if it forked off another branch → that branch;
 *  - else fall back to main, or a bare fork-point sha for a detached checkout.
 * Returns a branch name (preferred) or a bare sha, or "" when nothing suitable.
 */
export async function resolveBranchBaseTarget(repoRoot: string, branch: string): Promise<string> {
  const main = await resolveMainBranchCli(repoRoot);

  // Every other local branch (everything except the one being deleted).
  const others = (
    await git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).catch(() => "")
  )
    .split("\n")
    .map((s) => s.trim())
    .filter((b) => b && b !== branch);

  // Fork point = parent of the oldest commit unique to `branch`. With no unique
  // commits the branch tip is shared, so the tip itself is the base.
  const unique = (
    await git(repoRoot, ["rev-list", branch, ...others.map((b) => `^${b}`)]).catch(() => "")
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  let forkSha = "";
  if (unique.length === 0) {
    forkSha = (await git(repoRoot, ["rev-parse", branch]).catch(() => "")).trim();
  } else {
    const oldest = unique[unique.length - 1]!;
    forkSha = (await git(repoRoot, ["rev-parse", `${oldest}^`]).catch(() => "")).trim();
  }

  if (forkSha) {
    const candidates = (
      await git(repoRoot, ["branch", "--contains", forkSha, "--format=%(refname:short)"]).catch(
        () => "",
      )
    )
      .split("\n")
      .map((s) => s.trim())
      .filter((b) => b && b !== branch);
    // Forked directly off main → prefer main; otherwise the branch it diverged from.
    if (main && candidates.includes(main)) return main;
    if (candidates.length > 0) return candidates[0]!;
  }

  if (main && main !== branch) return main;
  return forkSha;
}

/**
 * Whether a commit is reachable from any remote branch — i.e. already pushed.
 * Used to refuse rewording a commit that other people may already have.
 */
export async function isCommitPushedCli(repoRoot: string, sha: string): Promise<boolean> {
  const out = await git(repoRoot, ["branch", "-r", "--contains", sha]).catch(() => "");
  return out
    .split("\n")
    .map((s) => s.trim())
    .some((s) => s && !s.endsWith("/HEAD"));
}

/** The full HEAD sha, or "" when detached/empty. */
export async function headShaCli(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ["rev-parse", "HEAD"]).catch(() => "")).trim();
}

/** Outcome of an operation that can leave conflicts for the IDE to resolve. */
export type OpOutcome = "ok" | "conflict";

/** True when a rebase is paused mid-flight (e.g. stopped on a conflict). */
async function isRebaseInProgress(repoRoot: string): Promise<boolean> {
  const gitDir = (await git(repoRoot, ["rev-parse", "--git-dir"]).catch(() => "")).trim();
  if (!gitDir) return false;
  const base = path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);
  for (const d of ["rebase-merge", "rebase-apply"]) {
    try {
      await fs.access(path.join(base, d));
      return true;
    } catch {
      /* not present — try the next marker */
    }
  }
  return false;
}

/** True when the working tree has unmerged (conflicted) paths. */
async function hasUnmergedPaths(repoRoot: string): Promise<boolean> {
  const out = await git(repoRoot, ["ls-files", "-u"]).catch(() => "");
  return out.trim().length > 0;
}

/**
 * Undo a *local* commit, returning its changes to the working tree as unstaged
 * edits — and leaving no trace in history (no revert commit).
 *
 *  - HEAD commit: `git reset --mixed HEAD~1` — the tip's changes reappear as
 *    unstaged edits; existing working-tree changes are preserved. Never conflicts.
 *  - older local commit: a scripted, non-interactive rebase that *drops* just
 *    that commit (newer commits are kept). `--autostash` shelves any working-tree
 *    changes across the rebase. May conflict — in which case the rebase is left
 *    paused so the user can resolve it with the IDE's merge editor.
 */
export async function undoCommitCli(repoRoot: string, sha: string): Promise<OpOutcome> {
  const head = await headShaCli(repoRoot);
  const isHead = !!head && (head === sha || head.startsWith(sha) || sha.startsWith(head));
  if (isHead) {
    await git(repoRoot, ["reset", "--mixed", "HEAD~1"]);
    return "ok";
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "revgraph-undo-"));
  try {
    const seqHelper = path.join(tmp, "seq.js");
    await fs.writeFile(seqHelper, DROP_SEQ_EDITOR_JS, "utf8");
    const node = process.execPath;
    const env: NodeJS.ProcessEnv = {
      ELECTRON_RUN_AS_NODE: "1",
      GIT_SEQUENCE_EDITOR: `"${node}" "${seqHelper}"`,
      GIT_DROP_TARGET: sha,
    };
    try {
      await gitEnv(repoRoot, ["rebase", "-i", "--autostash", `${sha}^`], env);
      return "ok";
    } catch (err) {
      // A conflict leaves a rebase paused; report it so the host can surface the
      // merge editor. Re-throw anything that isn't a conflict.
      if (await isRebaseInProgress(repoRoot)) return "conflict";
      throw err;
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Marks exactly the target commit as "drop" in the rebase todo list.
const DROP_SEQ_EDITOR_JS = `
const fs = require('fs');
const file = process.argv[2];
const target = process.env.GIT_DROP_TARGET || '';
const lines = fs.readFileSync(file, 'utf8').split('\\n');
let done = false;
const out = lines.map((line) => {
  if (done) return line;
  const m = line.match(/^(pick|p)\\s+([0-9a-f]+)\\s/i);
  if (m && (target.startsWith(m[2]) || m[2].startsWith(target))) {
    done = true;
    return line.replace(/^(pick|p)\\b/i, 'drop');
  }
  return line;
});
fs.writeFileSync(file, out.join('\\n'));
`;

/** Apply a stash onto the working tree, keeping the stash entry. May conflict. */
export async function stashApplyCli(repoRoot: string, index: number): Promise<OpOutcome> {
  try {
    await git(repoRoot, ["stash", "apply", `stash@{${index}}`]);
    return "ok";
  } catch (err) {
    if (await hasUnmergedPaths(repoRoot)) return "conflict";
    throw err;
  }
}

/** Apply a stash and drop it on success. On conflict git keeps the entry. */
export async function stashPopCli(repoRoot: string, index: number): Promise<OpOutcome> {
  try {
    await git(repoRoot, ["stash", "pop", `stash@{${index}}`]);
    return "ok";
  } catch (err) {
    if (await hasUnmergedPaths(repoRoot)) return "conflict";
    throw err;
  }
}

/** Delete a stash entry without applying it. */
export async function stashDropCli(repoRoot: string, index: number): Promise<void> {
  await git(repoRoot, ["stash", "drop", `stash@{${index}}`]);
}

/* ------------------------------------------------------------------ */
/* merge                                                               */
/* ------------------------------------------------------------------ */

/** True when commit `a` is an ancestor of commit `b` (so b already contains a). */
async function isAncestor(repoRoot: string, a: string, b: string): Promise<boolean> {
  const { code } = await gitCapture(repoRoot, ["merge-base", "--is-ancestor", a, b]);
  return code === 0;
}

/** Map a git name-status letter to a merge file status (no -M, so no renames). */
function mapMergeStatus(code: string): MergeFileStatus {
  const c = code[0] ?? "";
  if (c === "A") return "added";
  if (c === "D") return "deleted";
  return "modified";
}

/** Parse `git diff --name-status -z` output into merge preview files. */
function parseNameStatusZ(out: string): MergePreviewFile[] {
  const files: MergePreviewFile[] = [];
  const parts = out.split("\0");
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++]?.trim();
    if (!code) continue;
    const path = parts[i++];
    if (path) files.push({ path, status: mapMergeStatus(code) });
  }
  return files;
}

/**
 * Dry-run preview of merging `source` into the current branch (HEAD) — computed
 * without touching the working tree via `git merge-tree --write-tree`. Reports
 * which files the merge would change (relative to the current branch), which ones
 * conflict, whether the merge can fast-forward, and a default commit message.
 *
 * Falls back to a base..source diff (conflicts undetectable) on git versions that
 * lack `merge-tree --write-tree`, and reports an `error` when there is no current
 * branch or `source` can't be resolved.
 */
export async function computeMergePreview(repoRoot: string, source: string): Promise<MergePreview> {
  const target = (await currentBranchCli(repoRoot)) || "HEAD";
  const base: MergePreview = {
    source,
    target,
    upToDate: false,
    canFastForward: false,
    files: [],
    conflicts: [],
    defaultMessage: `Merge branch '${source}'` + (target !== "HEAD" ? ` into ${target}` : ""),
  };

  const headTip = (await git(repoRoot, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  const sourceTip = (await git(repoRoot, ["rev-parse", source]).catch(() => "")).trim();
  if (!headTip) return { ...base, error: "No commit is checked out." };
  if (!sourceTip) return { ...base, error: `Branch "${source}" was not found.` };

  if (await isAncestor(repoRoot, sourceTip, headTip)) {
    return { ...base, upToDate: true };
  }
  const canFastForward = await isAncestor(repoRoot, headTip, sourceTip);

  // `git merge-tree --write-tree` (git 2.38+) computes the merged tree in memory.
  // stdout line 1 is the resulting tree's oid; on conflict (exit 1) the following
  // non-empty lines (until a blank line) are the conflicted paths (--name-only).
  const mt = await gitCapture(repoRoot, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    headTip,
    sourceTip,
  ]);
  const mtLines = mt.stdout.split("\n");
  const resultTree = (mtLines[0] ?? "").trim();
  const looksLikeOid = /^[0-9a-f]{7,64}$/.test(resultTree);

  if ((mt.code === 0 || mt.code === 1) && looksLikeOid) {
    const conflicts: string[] = [];
    for (let i = 1; i < mtLines.length; i++) {
      const line = mtLines[i]!.trim();
      if (!line) break; // blank line ends the conflicted-files section
      conflicts.push(line);
    }
    // The real result the merge produces, relative to the current branch.
    const diffOut = await git(repoRoot, [
      "diff",
      "--name-status",
      "-z",
      headTip,
      resultTree,
    ]).catch(() => "");
    const files = parseNameStatusZ(diffOut);
    const conflictSet = new Set(conflicts);
    for (const f of files) if (conflictSet.has(f.path)) f.status = "conflict";
    // A conflicted path always differs from the base, but guard the rare case the
    // result diff missed one so the user still sees every conflict.
    const known = new Set(files.map((f) => f.path));
    for (const c of conflicts) if (!known.has(c)) files.push({ path: c, status: "conflict" });
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { ...base, canFastForward, files, conflicts };
  }

  // Older git: approximate the change set from the merge base, conflicts unknown.
  const mergeBase = (await git(repoRoot, ["merge-base", headTip, sourceTip]).catch(() => "")).trim();
  const fromRef = mergeBase || headTip;
  const diffOut = await git(repoRoot, [
    "diff",
    "--name-status",
    "-z",
    fromRef,
    sourceTip,
  ]).catch(() => "");
  const files = parseNameStatusZ(diffOut).sort((a, b) => a.path.localeCompare(b.path));
  return { ...base, canFastForward, files, conflicts: [] };
}

/**
 * Merge `source` into the current branch. `noFastForward` forces a merge commit
 * even when a fast-forward is possible; `message` (when given) is the merge-commit
 * message (ignored by git on a fast-forward). On conflict the merge is left in
 * progress so the user resolves it with the IDE's merge editor.
 */
export async function mergeCli(
  repoRoot: string,
  source: string,
  message: string | undefined,
  noFastForward: boolean,
): Promise<OpOutcome> {
  const args = ["merge"];
  if (noFastForward) args.push("--no-ff");
  if (message && message.trim()) args.push("-m", message.trim());
  args.push(source);
  try {
    await git(repoRoot, args);
    return "ok";
  } catch (err) {
    if (await hasUnmergedPaths(repoRoot)) return "conflict";
    throw err;
  }
}

/**
 * The before/after text of one file a merge of `source` would change — the current
 * branch (HEAD) on the left, the merged result on the right — for the merge dialog's
 * side-by-side diff. Computed without touching the working tree: the "after" side
 * reads from the in-memory merged tree (`git merge-tree --write-tree`), so a
 * conflicted file's "after" text includes git's conflict markers. Added files have
 * no before, deleted files no after. Falls back to the source tip's content on git
 * versions without `merge-tree --write-tree`.
 */
export async function readMergeFileDiff(
  repoRoot: string,
  source: string,
  path: string,
  status: MergeFileStatus,
): Promise<FileDiff> {
  // conflict renders side-by-side (HEAD vs merged-with-markers), like a modification.
  const diffStatus: DiffFileStatus =
    status === "added" ? "added" : status === "deleted" ? "deleted" : "modified";
  const base: FileDiff = { sha: "", path, status: diffStatus, oldText: "", newText: "" };

  // The "after" side comes from the merged tree; fall back to the source tip.
  const mt = await gitCapture(repoRoot, ["merge-tree", "--write-tree", "--name-only", "HEAD", source]);
  const resultTree = (mt.stdout.split("\n")[0] ?? "").trim();
  const newRev = (mt.code === 0 || mt.code === 1) && /^[0-9a-f]{7,64}$/.test(resultTree) ? resultTree : source;

  const needOld = status !== "added";
  const needNew = status !== "deleted";

  const sizes = await Promise.all([
    needOld ? blobSize(repoRoot, "HEAD", path) : Promise.resolve(0),
    needNew ? blobSize(repoRoot, newRev, path) : Promise.resolve(0),
  ]);
  if (sizes.some((s) => s > MAX_DIFF_BYTES)) return { ...base, tooLarge: true };

  const [oldText, newText] = await Promise.all([
    needOld ? blobText(repoRoot, "HEAD", path) : Promise.resolve(""),
    needNew ? blobText(repoRoot, newRev, path) : Promise.resolve(""),
  ]);
  if (hasNulByte(oldText) || hasNulByte(newText)) return { ...base, binary: true };
  return { ...base, oldText, newText };
}

/* ------------------------------------------------------------------ */
/* commit changes / diff                                               */
/* ------------------------------------------------------------------ */

/** Files larger than this (in bytes) are reported as `tooLarge` instead of diffed. */
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

/** Map a git name-status letter to our protocol's file status. */
function mapStatus(code: string): DiffFileStatus {
  const c = code[0] ?? "";
  if (c === "A") return "added";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "C") return "renamed"; // copy — surface its source like a rename
  return "modified"; // M, T (type change), and anything else
}

/**
 * The list of files a commit changed, compared against its first parent (so
 * merges show only what the merge itself introduced, and a root commit shows all
 * its files as added). Renames/copies carry the parent-side path in `oldPath`.
 */
export async function readCommitChanges(repoRoot: string, sha: string): Promise<CommitChangeFile[]> {
  // --first-parent picks the first parent for merges; -M/-C detect renames/copies;
  // -z gives NUL-separated fields so paths with spaces/tabs parse safely.
  const out = await git(repoRoot, [
    "show",
    "--first-parent",
    "-M",
    "-C",
    "--name-status",
    "--format=",
    "-z",
    sha,
  ]).catch(() => "");

  const files: CommitChangeFile[] = [];
  // -z output: STATUS \0 path [\0 newPath for R/C] \0 STATUS \0 ...
  const parts = out.split("\0");
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++]?.trim();
    if (!code) continue;
    const status = mapStatus(code);
    if (status === "renamed") {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      if (newPath) files.push({ path: newPath, oldPath: oldPath || undefined, status });
    } else {
      const path = parts[i++];
      if (path) files.push({ path, status });
    }
  }
  return files;
}

/** True when a string contains a NUL byte (git's binary-file signal). */
function hasNulByte(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0) return true;
  return false;
}

/** Byte size of a blob (`<rev>:<path>`), or -1 when it doesn't exist. */
async function blobSize(repoRoot: string, rev: string, filePath: string): Promise<number> {
  const out = await git(repoRoot, ["cat-file", "-s", `${rev}:${filePath}`]).catch(() => "");
  const n = parseInt(out.trim(), 10);
  return Number.isFinite(n) ? n : -1;
}

/** Raw blob text (`<rev>:<path>`), or "" when it doesn't exist. */
async function blobText(repoRoot: string, rev: string, filePath: string): Promise<string> {
  return git(repoRoot, ["show", `${rev}:${filePath}`]).catch(() => "");
}

/**
 * The before/after text of one changed file, for the side-by-side diff. The
 * "before" side reads from the commit's first parent (`<sha>^`); added files have
 * no before, deleted files no after. Binary or oversized files are flagged rather
 * than streamed back as text.
 */
export async function readFileDiff(
  repoRoot: string,
  sha: string,
  filePath: string,
  status: DiffFileStatus,
  oldPath?: string,
): Promise<FileDiff> {
  const base: FileDiff = { sha, path: filePath, status, oldText: "", newText: "" };
  const parent = `${sha}^`;
  const beforePath = oldPath ?? filePath;

  const needOld = status !== "added";
  const needNew = status !== "deleted";

  // Size-gate before reading anything large.
  const sizes = await Promise.all([
    needOld ? blobSize(repoRoot, parent, beforePath) : Promise.resolve(0),
    needNew ? blobSize(repoRoot, sha, filePath) : Promise.resolve(0),
  ]);
  if (sizes.some((s) => s > MAX_DIFF_BYTES)) return { ...base, tooLarge: true };

  const [oldText, newText] = await Promise.all([
    needOld ? blobText(repoRoot, parent, beforePath) : Promise.resolve(""),
    needNew ? blobText(repoRoot, sha, filePath) : Promise.resolve(""),
  ]);

  // A NUL byte means git treats it as binary — no meaningful text diff.
  if (hasNulByte(oldText) || hasNulByte(newText)) {
    return { ...base, binary: true };
  }
  return { ...base, oldText, newText };
}

/** A commit's current subject line (first line of its message). */
export async function commitSummaryCli(repoRoot: string, sha: string): Promise<string> {
  return (await git(repoRoot, ["show", "-s", "--format=%s", sha]).catch(() => "")).trim();
}

/**
 * Reword a local commit's message *silently* — no editor pops up and the
 * rewrite leaves no visible "amended" marker.
 *
 *  - HEAD commit: a plain `--amend` (the common "typo in my last commit" case).
 *  - older commit: a non-interactive interactive-rebase, driving git's sequence
 *    and message editors with the extension host's own Node runtime so nothing
 *    extra need be installed.
 *
 * Throws if the index has staged changes (an amend would silently fold them in).
 */
export async function rewordCommitCli(
  repoRoot: string,
  sha: string,
  message: string,
): Promise<void> {
  // Refuse if something is staged — amend/rebase would otherwise capture it.
  const staged = await git(repoRoot, ["diff", "--cached", "--name-only"]).catch(() => "");
  if (staged.trim()) {
    throw new Error("There are staged changes; commit or unstage them before rewording.");
  }

  const head = await headShaCli(repoRoot);
  if (head && (head === sha || head.startsWith(sha) || sha.startsWith(head))) {
    await git(repoRoot, ["commit", "--amend", "-m", message]);
    return;
  }

  // Older commit: scripted, non-interactive `rebase -i <sha>^`.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "revgraph-reword-"));
  try {
    const seqHelper = path.join(tmp, "seq.js");
    const msgHelper = path.join(tmp, "msg.js");
    const msgFile = path.join(tmp, "message.txt");
    await fs.writeFile(msgFile, message, "utf8");
    await fs.writeFile(seqHelper, SEQ_EDITOR_JS, "utf8");
    await fs.writeFile(msgHelper, MSG_EDITOR_JS, "utf8");

    const node = process.execPath;
    const env: NodeJS.ProcessEnv = {
      ELECTRON_RUN_AS_NODE: "1",
      GIT_SEQUENCE_EDITOR: `"${node}" "${seqHelper}"`,
      GIT_EDITOR: `"${node}" "${msgHelper}"`,
      GIT_REWORD_TARGET: sha,
      GIT_REWORD_MSG_FILE: msgFile,
    };
    await gitEnv(repoRoot, ["rebase", "-i", "--autostash", `${sha}^`], env);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Marks exactly the target commit as "reword" in the rebase todo list.
const SEQ_EDITOR_JS = `
const fs = require('fs');
const file = process.argv[2];
const target = process.env.GIT_REWORD_TARGET || '';
const lines = fs.readFileSync(file, 'utf8').split('\\n');
let done = false;
const out = lines.map((line) => {
  if (done) return line;
  const m = line.match(/^(pick|p)\\s+([0-9a-f]+)\\s/i);
  if (m && (target.startsWith(m[2]) || m[2].startsWith(target))) {
    done = true;
    return line.replace(/^(pick|p)\\b/i, 'reword');
  }
  return line;
});
fs.writeFileSync(file, out.join('\\n'));
`;

// Writes the new commit message into the file git opens for the reword.
const MSG_EDITOR_JS = `
const fs = require('fs');
const file = process.argv[2];
const msgFile = process.env.GIT_REWORD_MSG_FILE;
if (msgFile) fs.writeFileSync(file, fs.readFileSync(msgFile, 'utf8'));
`;
