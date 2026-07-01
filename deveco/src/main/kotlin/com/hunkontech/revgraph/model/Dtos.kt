package com.hunkontech.revgraph.model

import com.google.gson.annotations.SerializedName

/**
 * Data classes mirroring packages/protocol/src/index.ts. Serialized to
 * camelCase JSON (Gson's default field-name behaviour, matching the field
 * names below) so the shared web renderer can consume them unchanged across
 * all three hosts. Mirrors vs/Model/Dtos.cs.
 */

class GraphData {
    var commits: List<GitCommit> = emptyList()
    var refs: List<GitRef> = emptyList()
    var head: String? = null
    var repoName: String? = null
    /** Stash entries, drawn in their own column linked to their base commit. */
    var stashes: List<StashEntry> = emptyList()
    /** The git log command that produced this data, shown in the status bar. */
    var gitCommand: String? = null
}

/** A single git stash entry (`stash@{N}`). */
class StashEntry(
    /** Stack position N in `stash@{N}` (0 = most recent). */
    val index: Int,
    val sha: String,
    val message: String,
    /** Sha of the commit the stash was created from (its first parent). */
    val baseSha: String,
    val date: String,
)

class GitCommit(
    val sha: String,
    val parents: List<String>,
    val summary: String,
    val author: String,
    val authorEmail: String,
    val date: String,
)

class GitRef(
    val name: String,
    /** One of: localBranch | remoteBranch | tag | head. */
    val type: String,
    val targetSha: String,
    val remote: String? = null,
    val isCurrent: Boolean? = null,
)

/** One file changed by a commit (left pane of the changes dialog). */
class CommitChangeFile(
    /** Path as of this commit (the new path for renames). */
    val path: String,
    /** For renames: the path the file had in the parent. */
    val oldPath: String? = null,
    /** One of: added | modified | deleted | renamed. */
    var status: String,
)

/** Before/after content of a changed file, for the side-by-side diff. */
class FileDiff(
    val sha: String,
    val path: String,
    val status: String,
    /** Content in the parent commit (empty for added files). */
    var oldText: String = "",
    /** Content in this commit (empty for deleted files). */
    var newText: String = "",
    /** True when git reports the file as binary. */
    var binary: Boolean? = null,
    /** True when the file exceeded the host's diff size cap. */
    var tooLarge: Boolean? = null,
)

/** One file a (hypothetical) merge would change. */
class MergePreviewFile(
    val path: String,
    /** One of: added | modified | deleted | conflict. */
    var status: String,
)

/**
 * Dry-run preview of merging [source] into the current branch, computed
 * without touching the working tree. Mirrors MergePreview in the TS protocol.
 */
class MergePreview(
    val source: String,
    val target: String,
) {
    var upToDate: Boolean = false
    var canFastForward: Boolean = false
    var files: List<MergePreviewFile> = emptyList()
    var conflicts: List<String> = emptyList()
    var defaultMessage: String? = null
    /** Set when the preview couldn't be computed. */
    var error: String? = null
}

/** Incoming message from the webview (webview -> host). */
class WebviewMessage {
    var type: String? = null
    var sha: String? = null
    var ref: String? = null
    /** Branch to merge in, for requestMergePreview / merge. */
    var source: String? = null
    /** Merge-commit message for the merge action. */
    var message: String? = null
    /** Force a merge commit even when a fast-forward is possible. */
    var noFastForward: Boolean? = null
    /**
     * Branch name for createBranch (when the SVN-style dialog supplied it)
     * and for deleteBranch/renameBranch/pushBranch.
     */
    var name: String? = null
    /** Checkout-after-create choice from the SVN-style dialog. */
    var checkout: Boolean? = null
    /** Stash stack index for stashApply / stashPop / stashDrop. */
    var index: Int? = null
    /** File path for requestFileDiff / requestFileContent / requestMergeFileDiff. */
    var path: String? = null
    /** Parent-side path for requestFileDiff on a renamed file. */
    var oldPath: String? = null
    /** File status for requestFileDiff/requestMergeFileDiff. */
    var status: String? = null
    /** Custom git binary path for setGitPath; null means use the built-in git. */
    @SerializedName("gitPath")
    var gitPath: String? = null
}
