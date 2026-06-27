/**
 * Build a folder tree from branch names, the way TortoiseSVN groups branches by
 * their path. A name like "Release/vs_code/1.0.0" contributes the folders
 * "Release" and "Release/vs_code" and the branch leaf "1.0.0".
 *
 * Folders are selectable in the New Branch dialog (they become the new branch's
 * location prefix); branch leaves are shown for context but are not selectable.
 */

export interface BranchTreeNode {
  /** The segment label shown in the tree (e.g. "vs_code"). */
  name: string;
  /** Full slash-joined path from the root (e.g. "Release/vs_code"). */
  path: string;
  /** Folders are selectable locations; branch leaves are not. */
  isFolder: boolean;
  children: BranchTreeNode[];
}

/**
 * Turn a flat list of branch names into the tree's top-level nodes. Remote
 * names are expected to already have their remote prefix stripped by the caller.
 * Folders sort before branch leaves, each group alphabetically.
 */
export function buildBranchTree(names: string[]): BranchTreeNode[] {
  const root: BranchTreeNode = { name: "", path: "", isFolder: true, children: [] };

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const segments = name.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let parent = root;
    // All but the last segment are folders.
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const path = parent.path ? `${parent.path}/${seg}` : seg;
      let folder = parent.children.find((c) => c.name === seg);
      if (folder) {
        // A branch leaf of the same name becomes a folder (the folder wins).
        folder.isFolder = true;
      } else {
        folder = { name: seg, path, isFolder: true, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }

    // The terminal segment is the branch leaf — unless it collides with an
    // existing folder of the same name, in which case the folder wins.
    const leaf = segments[segments.length - 1]!;
    const leafPath = parent.path ? `${parent.path}/${leaf}` : leaf;
    const existing = parent.children.find((c) => c.name === leaf);
    if (!existing) {
      parent.children.push({ name: leaf, path: leafPath, isFolder: false, children: [] });
    }
  }

  sortTree(root);
  return root.children;
}

/** Sort folders before leaves, each alphabetically (case-insensitive), in place. */
function sortTree(node: BranchTreeNode): void {
  node.children.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const child of node.children) sortTree(child);
}
