import * as vscode from "vscode";
import type { Repository } from "./git";
import { createBranchCli } from "./gitData";

/** A name + checkout choice already collected by the webview's SVN-style dialog. */
export interface PreparedBranch {
  name: string;
  checkout: boolean;
}

/**
 * Create a branch from a specific commit using the host's native Git.
 *
 * When `prepared` is supplied (the webview's SVN-style dialog already gathered
 * the name and checkout choice) the branch is created directly. Otherwise the
 * native VS Code prompts are shown. Either way it uses the built-in `vscode.git`
 * API `createBranch(name, checkout, ref)` — the `ref` seeds the branch at the
 * clicked commit — falling back to the git CLI if the API call is unavailable.
 *
 * Returns the created branch name, or undefined if the user cancelled.
 */
export async function createBranchFromCommit(
  repo: Repository,
  repoRoot: string,
  sha: string,
  prepared?: PreparedBranch,
): Promise<string | undefined> {
  let branchName: string;
  let checkout: boolean;

  if (prepared) {
    branchName = prepared.name.trim();
    if (!branchName) return undefined;
    checkout = prepared.checkout;
  } else {
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

    const choice = await vscode.window.showQuickPick(
      [
        { label: "Create and checkout", checkout: true },
        { label: "Create only", checkout: false },
      ],
      { title: `Create branch "${name.trim()}"` },
    );
    if (!choice) return undefined;
    branchName = name.trim();
    checkout = choice.checkout;
  }

  try {
    // Native built-in Git API: ref seeds the start point.
    await repo.createBranch(branchName, checkout, sha);
  } catch (err) {
    // Fallback to CLI (e.g. older API without ref support).
    await createBranchCli(repoRoot, branchName, sha, checkout);
  }
  return branchName;
}
