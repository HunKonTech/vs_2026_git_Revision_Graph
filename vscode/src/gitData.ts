import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { GraphData, GitCommit, GitRef, RefType } from "@rev-graph/protocol";

const run = promisify(execFile);

const FS = "\x1f"; // field separator
const RS = "\x1e"; // record separator

/** Run a git command in `cwd` and return stdout. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
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
      "--date-order",
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
