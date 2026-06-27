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

    /// <summary>Incoming message from the webview (webview -> host).</summary>
    public sealed class WebviewMessage
    {
        public string Type { get; set; }
        public string Sha { get; set; }
        public string Ref { get; set; }
        /// <summary>Branch name for createBranch (when the SVN-style dialog
        /// supplied it) and for deleteBranch.</summary>
        public string Name { get; set; }
        /// <summary>Checkout-after-create choice from the SVN-style dialog.</summary>
        public bool? Checkout { get; set; }
    }
}
