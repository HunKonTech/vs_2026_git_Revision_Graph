import * as vscode from "vscode";
import type { GitExtension, GitAPI, Repository } from "./git";

let cachedApi: GitAPI | undefined;

/** Get the built-in Git extension API (activating it if needed). */
export async function getGitApi(): Promise<GitAPI | undefined> {
  if (cachedApi) return cachedApi;
  const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  cachedApi = exports.getAPI(1);
  return cachedApi;
}

/**
 * Resolve the repository to graph. Prefers the repo of the active editor,
 * otherwise the first open repository.
 */
export async function resolveRepository(): Promise<Repository | undefined> {
  const api = await getGitApi();
  if (!api || api.repositories.length === 0) return undefined;

  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const repo = api.getRepository(active);
    if (repo) return repo;
  }
  return api.repositories[0];
}
