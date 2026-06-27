import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import type { GraphData, GitCommit, GitRef, RefType } from "@rev-graph/protocol";

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

/** Read the full graph (commits + refs, local & remote) for a repo. */
export async function readGraphData(repoRoot: string, maxCommits: number): Promise<GraphData> {
  const [logOut, refsOut, headSha] = await Promise.all([
    git(repoRoot, [
      "log",
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
  ]);

  const commits = parseCommits(logOut);
  const refs = parseRefs(refsOut);
  const head = headSha.trim() || null;

  return { commits, refs, head, repoName: path.basename(repoRoot) };
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
): Promise<CheckoutTarget> {
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
    "--format=%(refname:short)",
  ]).catch(() => "");
  const remotes = remote
    .split("\n")
    .map((s) => s.trim())
    .filter((r) => r && !r.endsWith("/HEAD"));
  if (remotes.length > 0) {
    const remoteRef = remotes[0]!; // e.g. "origin/feature"
    const localName = remoteRef.split("/").slice(1).join("/"); // "feature"
    return { ref: localName, track: remoteRef };
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

/** Delete a local branch. `force` uses -D (drops the merged-state safety check). */
export async function deleteBranchCli(
  repoRoot: string,
  name: string,
  force: boolean,
): Promise<void> {
  await git(repoRoot, ["branch", force ? "-D" : "-d", name]);
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
