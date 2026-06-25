import * as vscode from "vscode";
import type { Repository } from "./git";
import { createBranchCli } from "./gitData";

/**
 * Create a branch from a specific commit using the host's native Git.
 *
 * Prompts for a name (the native VS Code input), then uses the built-in
 * `vscode.git` API `createBranch(name, checkout, ref)` — the `ref` argument
 * seeds the branch at the clicked commit. Falls back to the git CLI if the
 * API call is unavailable.
 *
 * Returns the created branch name, or undefined if the user cancelled.
 */
export async function createBranchFromCommit(
  repo: Repository,
  repoRoot: string,
  sha: string,
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: `New branch from ${sha.slice(0, 7)}`,
    prompt: "Enter a name for the new branch",
    placeHolder: "feature/my-branch",
    validateInput: (value) => {
      const v = value.trim();
      if (!v) return "Branch name is required";
      if (/[\s~^:?*\[\\]/.test(v)) return "Branch name contains invalid characters";
      if (v.startsWith("-") || v.endsWith("/") || v.endsWith(".lock")) return "Invalid branch name";
      return undefined;
    },
  });
  if (!name) return undefined;

  const checkout = await vscode.window.showQuickPick(
    [
      { label: "Create and checkout", checkout: true },
      { label: "Create only", checkout: false },
    ],
    { title: `Create branch "${name.trim()}"` },
  );
  if (!checkout) return undefined;

  const branchName = name.trim();
  try {
    // Native built-in Git API: ref seeds the start point.
    await repo.createBranch(branchName, checkout.checkout, sha);
  } catch (err) {
    // Fallback to CLI (e.g. older API without ref support).
    await createBranchCli(repoRoot, branchName, sha, checkout.checkout);
  }
  return branchName;
}
