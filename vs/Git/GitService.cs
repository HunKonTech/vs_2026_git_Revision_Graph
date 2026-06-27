using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using RevisionGraph.Model;

namespace RevisionGraph.Git
{
    /// <summary>
    /// Reads git history and performs branch operations via the git CLI.
    /// Mirrors vscode/src/gitData.ts so both hosts feed the same shape to the
    /// shared web renderer.
    /// </summary>
    public sealed class GitService
    {
        private const char FS = '\u001f'; // field separator (ASCII unit separator)
        private const char RS = '\u001e'; // record separator (ASCII record separator)

        private readonly string _repoRoot;

        public GitService(string repoRoot)
        {
            _repoRoot = repoRoot;
        }

        /// <summary>
        /// Find the repository root containing <paramref name="startDir"/>,
        /// or null if it is not inside a git work tree.
        /// </summary>
        public static async Task<string> FindRepoRootAsync(string startDir)
        {
            if (string.IsNullOrEmpty(startDir) || !Directory.Exists(startDir))
                return null;
            try
            {
                var top = await RunAsync(startDir, "rev-parse", "--show-toplevel").ConfigureAwait(false);
                top = top.Trim();
                return string.IsNullOrEmpty(top) ? null : top.Replace('/', Path.DirectorySeparatorChar);
            }
            catch
            {
                return null;
            }
        }

        public async Task<GraphData> ReadGraphDataAsync(int maxCommits)
        {
            var logTask = RunAsync(
                _repoRoot,
                "log", "--all", "--date-order", "--max-count=" + maxCommits,
                "--pretty=format:%H" + FS + "%P" + FS + "%s" + FS + "%an" + FS + "%ae" + FS + "%aI" + RS);

            var refsTask = RunAsync(
                _repoRoot,
                "for-each-ref",
                "--format=%(refname)" + FS + "%(objectname)" + FS + "%(*objectname)" + FS + "%(HEAD)",
                "refs/heads", "refs/remotes", "refs/tags");

            var headTask = RunSafeAsync(_repoRoot, "rev-parse", "HEAD");

            await Task.WhenAll(logTask, refsTask, headTask).ConfigureAwait(false);

            return new GraphData
            {
                Commits = ParseCommits(logTask.Result),
                Refs = ParseRefs(refsTask.Result),
                Head = string.IsNullOrWhiteSpace(headTask.Result) ? null : headTask.Result.Trim(),
                RepoName = new DirectoryInfo(_repoRoot).Name,
            };
        }

        private static List<GitCommit> ParseCommits(string output)
        {
            var commits = new List<GitCommit>();
            foreach (var rec in output.Split(RS))
            {
                var line = rec.TrimStart('\n', '\r');
                if (string.IsNullOrWhiteSpace(line)) continue;
                var f = line.Split(FS);
                if (f.Length < 6 || string.IsNullOrEmpty(f[0])) continue;
                commits.Add(new GitCommit
                {
                    Sha = f[0],
                    Parents = string.IsNullOrEmpty(f[1])
                        ? new List<string>()
                        : new List<string>(f[1].Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)),
                    Summary = f[2],
                    Author = f[3],
                    AuthorEmail = f[4],
                    Date = f[5],
                });
            }
            return commits;
        }

        private static List<GitRef> ParseRefs(string output)
        {
            var refs = new List<GitRef>();
            foreach (var raw in output.Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                var f = line.Split(FS);
                if (f.Length < 2 || string.IsNullOrEmpty(f[0]) || string.IsNullOrEmpty(f[1])) continue;

                var refname = f[0];
                var objectname = f[1];
                var deref = f.Length > 2 ? f[2] : "";
                var headMark = f.Length > 3 ? f[3] : "";

                var targetSha = !string.IsNullOrEmpty(deref) ? deref : objectname;
                var isCurrent = headMark == "*";

                if (refname.StartsWith("refs/heads/", StringComparison.Ordinal))
                {
                    refs.Add(new GitRef
                    {
                        Name = refname.Substring("refs/heads/".Length),
                        Type = "localBranch",
                        TargetSha = targetSha,
                        IsCurrent = isCurrent,
                    });
                }
                else if (refname.StartsWith("refs/remotes/", StringComparison.Ordinal))
                {
                    var shortName = refname.Substring("refs/remotes/".Length);
                    if (shortName.EndsWith("/HEAD", StringComparison.Ordinal)) continue;
                    refs.Add(new GitRef
                    {
                        Name = shortName,
                        Type = "remoteBranch",
                        TargetSha = targetSha,
                        Remote = shortName.Split('/')[0],
                    });
                }
                else if (refname.StartsWith("refs/tags/", StringComparison.Ordinal))
                {
                    refs.Add(new GitRef
                    {
                        Name = refname.Substring("refs/tags/".Length),
                        Type = "tag",
                        TargetSha = targetSha,
                    });
                }
            }
            return refs;
        }

        /// <summary>Create a branch from a commit; optionally check it out.</summary>
        public Task CreateBranchAsync(string name, string sha, bool checkout)
        {
            return checkout
                ? RunAsync(_repoRoot, "checkout", "-b", name, sha)
                : RunAsync(_repoRoot, "branch", name, sha);
        }

        public Task CheckoutAsync(string treeish) => RunAsync(_repoRoot, "checkout", treeish);

        /// <summary>Fetch all remotes and prune deleted remote branches.</summary>
        public Task FetchAsync() => RunAsync(_repoRoot, "fetch", "--all", "--prune");

        /// <summary>Pull the current branch from its upstream.</summary>
        public Task PullAsync() => RunAsync(_repoRoot, "pull");

        /// <summary>Push the current branch to its upstream.</summary>
        public Task PushAsync() => RunAsync(_repoRoot, "push");

        /// <summary>Sync = pull then push, the common "sync changes" gesture.</summary>
        public async Task SyncAsync()
        {
            await PullAsync().ConfigureAwait(false);
            await PushAsync().ConfigureAwait(false);
        }

        private static async Task<string> RunSafeAsync(string cwd, params string[] args)
        {
            try { return await RunAsync(cwd, args).ConfigureAwait(false); }
            catch { return string.Empty; }
        }

        /// <summary>Run git with the given args and return stdout, throwing on non-zero exit.</summary>
        private static Task<string> RunAsync(string cwd, params string[] args)
        {
            var tcs = new TaskCompletionSource<string>();
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                WorkingDirectory = cwd,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
            };
            // ArgumentList is .NET 5+ only; on .NET Framework 4.7.2 build the
            // Arguments string manually, quoting tokens that contain spaces.
            psi.Arguments = string.Join(" ", System.Array.ConvertAll(
                args, a => a.Contains(" ") ? "\"" + a.Replace("\"", "\\\"") + "\"" : a));

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            proc.OutputDataReceived += (_, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };
            proc.Exited += (_, __) =>
            {
                try
                {
                    if (proc.ExitCode == 0) tcs.TrySetResult(stdout.ToString());
                    else tcs.TrySetException(new InvalidOperationException(
                        "git " + string.Join(" ", args) + " failed: " + stderr));
                }
                finally { proc.Dispose(); }
            };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            return tcs.Task;
        }
    }
}
