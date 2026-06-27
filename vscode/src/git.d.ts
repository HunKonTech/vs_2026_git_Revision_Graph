/**
 * Minimal typings for the built-in VS Code Git extension API (`vscode.git`).
 * Only the members this extension uses are declared.
 * Full definition: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */
import type { Uri } from "vscode";

export interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  readonly repositories: Repository[];
  /** The git binary the built-in Git extension resolved (path + version). */
  readonly git: { readonly path: string };
  getRepository(uri: Uri): Repository | null;
  onDidOpenRepository(listener: (repo: Repository) => void): { dispose(): void };
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  /** Create a branch; `ref` seeds the start point (commit sha / ref). */
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  onDidChange(listener: () => void): { dispose(): void };
}

export interface Branch {
  readonly name?: string;
  readonly commit?: string;
}

export interface Ref {
  readonly name?: string;
  readonly commit?: string;
}
