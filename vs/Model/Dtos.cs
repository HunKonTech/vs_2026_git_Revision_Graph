using System.Collections.Generic;

namespace RevisionGraph.Model
{
    /// <summary>
    /// Data-transfer objects mirroring packages/protocol/src/index.ts.
    /// Serialized to camelCase JSON so the shared web renderer can consume them
    /// unchanged across both the VS Code and Visual Studio hosts.
    /// </summary>
    public sealed class GraphData
    {
        public List<GitCommit> Commits { get; set; } = new List<GitCommit>();
        public List<GitRef> Refs { get; set; } = new List<GitRef>();
        public string Head { get; set; }
        public string RepoName { get; set; }
        /// <summary>Stash entries, drawn in their own column linked to their base commit.</summary>
        public List<StashEntry> Stashes { get; set; } = new List<StashEntry>();
    }

    /// <summary>A single git stash entry (<c>stash@{N}</c>).</summary>
    public sealed class StashEntry
    {
        /// <summary>Stack position N in <c>stash@{N}</c> (0 = most recent).</summary>
        public int Index { get; set; }
        public string Sha { get; set; }
        public string Message { get; set; }
        /// <summary>Sha of the commit the stash was created from (its first parent).</summary>
        public string BaseSha { get; set; }
        public string Date { get; set; }
    }

    public sealed class GitCommit
    {
        public string Sha { get; set; }
        public List<string> Parents { get; set; } = new List<string>();
        public string Summary { get; set; }
        public string Author { get; set; }
        public string AuthorEmail { get; set; }
        public string Date { get; set; }
    }

    public sealed class GitRef
    {
        public string Name { get; set; }
        /// <summary>One of: localBranch | remoteBranch | tag | head.</summary>
        public string Type { get; set; }
        public string TargetSha { get; set; }
        public string Remote { get; set; }
        public bool? IsCurrent { get; set; }
    }

    /// <summary>One file changed by a commit (left pane of the changes dialog).</summary>
    public sealed class CommitChangeFile
    {
        /// <summary>Path as of this commit (the new path for renames).</summary>
        public string Path { get; set; }
        /// <summary>For renames: the path the file had in the parent.</summary>
        public string OldPath { get; set; }
        /// <summary>One of: added | modified | deleted | renamed.</summary>
        public string Status { get; set; }
    }

    /// <summary>Before/after content of a changed file, for the side-by-side diff.</summary>
    public sealed class FileDiff
    {
        public string Sha { get; set; }
        public string Path { get; set; }
        public string Status { get; set; }
        /// <summary>Content in the parent commit (empty for added files).</summary>
        public string OldText { get; set; }
        /// <summary>Content in this commit (empty for deleted files).</summary>
        public string NewText { get; set; }
        /// <summary>True when git reports the file as binary.</summary>
        public bool? Binary { get; set; }
        /// <summary>True when the file exceeded the host's diff size cap.</summary>
        public bool? TooLarge { get; set; }
    }

    /// <summary>One file a (hypothetical) merge would change.</summary>
    public sealed class MergePreviewFile
    {
        public string Path { get; set; }
        /// <summary>One of: added | modified | deleted | conflict.</summary>
        public string Status { get; set; }
    }

    /// <summary>
    /// Dry-run preview of merging <c>Source</c> into the current branch, computed
    /// without touching the working tree. Mirrors MergePreview in the TS protocol.
    /// </summary>
    public sealed class MergePreview
    {
        public string Source { get; set; }
        public string Target { get; set; }
        public bool UpToDate { get; set; }
        public bool CanFastForward { get; set; }
        public List<MergePreviewFile> Files { get; set; } = new List<MergePreviewFile>();
        public List<string> Conflicts { get; set; } = new List<string>();
        public string DefaultMessage { get; set; }
        /// <summary>Set when the preview couldn't be computed.</summary>
        public string Error { get; set; }
    }

    /// <summary>Incoming message from the webview (webview -> host).</summary>
    public sealed class WebviewMessage
    {
        public string Type { get; set; }
        public string Sha { get; set; }
        public string Ref { get; set; }
        /// <summary>Branch to merge in, for requestMergePreview / merge.</summary>
        public string Source { get; set; }
        /// <summary>Merge-commit message for the merge action.</summary>
        public string Message { get; set; }
        /// <summary>Force a merge commit even when a fast-forward is possible.</summary>
        public bool? NoFastForward { get; set; }
        /// <summary>Branch name for createBranch (when the SVN-style dialog
        /// supplied it) and for deleteBranch.</summary>
        public string Name { get; set; }
        /// <summary>Checkout-after-create choice from the SVN-style dialog.</summary>
        public bool? Checkout { get; set; }
        /// <summary>Stash stack index for stashApply / stashPop / stashDrop.</summary>
        public int? Index { get; set; }
        /// <summary>File path for requestFileDiff.</summary>
        public string Path { get; set; }
        /// <summary>Parent-side path for requestFileDiff on a renamed file.</summary>
        public string OldPath { get; set; }
        /// <summary>File status for requestFileDiff (added|modified|deleted|renamed).</summary>
        public string Status { get; set; }
        /// <summary>Custom git binary path for setGitPath; null means use the built-in git.</summary>
        public string GitPath { get; set; }
    }
}
