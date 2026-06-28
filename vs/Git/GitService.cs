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

        // The git binary to invoke. Visual Studio ships git with Team Explorer, so
        // we resolve it from the running IDE rather than relying on a separate
        // install or a configured PATH. Falls back to "git" on PATH.
        private static readonly string GitExe = ResolveGitPath();

        private readonly string _repoRoot;

        public GitService(string repoRoot)
        {
            _repoRoot = repoRoot;
        }

        private static string ResolveGitPath()
        {
            try
            {
                // VSAPPIDDIR points at the running IDE's Common7\IDE folder.
                var ideDir = Environment.GetEnvironmentVariable("VSAPPIDDIR");
                if (!string.IsNullOrEmpty(ideDir))
                {
                    var candidate = Path.Combine(
                        ideDir, "CommonExtensions", "Microsoft", "TeamFoundation",
                        "Team Explorer", "Git", "cmd", "git.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }
            catch
            {
                // Ignore and fall back to PATH.
            }
            return "git";
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
            // Topological order keeps each branch's commits contiguous instead of
            // interleaving branches by timestamp — the SVN revision-graph behaviour,
            // where structure (not commit time) drives vertical placement.
            var logTask = RunAsync(
                _repoRoot,
                "log", "--all", "--topo-order", "--max-count=" + maxCommits,
                "--pretty=format:%H" + FS + "%P" + FS + "%s" + FS + "%an" + FS + "%ae" + FS + "%aI" + RS);

            var refsTask = RunAsync(
                _repoRoot,
                "for-each-ref",
                "--format=%(refname)" + FS + "%(objectname)" + FS + "%(*objectname)" + FS + "%(HEAD)",
                "refs/heads", "refs/remotes", "refs/tags");

            var headTask = RunSafeAsync(_repoRoot, "rev-parse", "HEAD");

            var stashTask = ReadStashesAsync();

            await Task.WhenAll(logTask, refsTask, headTask, stashTask).ConfigureAwait(false);

            return new GraphData
            {
                Commits = ParseCommits(logTask.Result),
                Refs = ParseRefs(refsTask.Result),
                Head = string.IsNullOrWhiteSpace(headTask.Result) ? null : headTask.Result.Trim(),
                RepoName = new DirectoryInfo(_repoRoot).Name,
                Stashes = stashTask.Result,
            };
        }

        /// <summary>Read the stash stack, each entry tied to the commit it came from.</summary>
        public async Task<List<StashEntry>> ReadStashesAsync()
        {
            var outp = await TryRunAsync(
                "stash", "list",
                "--format=%gd" + FS + "%H" + FS + "%P" + FS + "%gs" + FS + "%cI").ConfigureAwait(false);
            var stashes = new List<StashEntry>();
            foreach (var raw in outp.Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                var f = line.Split(FS);
                if (f.Length < 2 || string.IsNullOrEmpty(f[1])) continue;

                var gd = f[0];
                var sha = f[1];
                var parents = f.Length > 2 ? f[2] : "";
                var message = f.Length > 3 ? f[3] : "";
                var date = f.Length > 4 ? f[4] : "";

                var m = System.Text.RegularExpressions.Regex.Match(gd ?? "", @"stash@\{(\d+)\}");
                var index = m.Success ? int.Parse(m.Groups[1].Value) : stashes.Count;
                // A stash commit's first parent is the commit HEAD was on when made.
                var parts = parents.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                var baseSha = parts.Length > 0 ? parts[0] : "";

                stashes.Add(new StashEntry
                {
                    Index = index,
                    Sha = sha,
                    BaseSha = baseSha,
                    Message = message,
                    Date = date,
                });
            }
            return stashes;
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

        /// <summary>Delete a local branch. <paramref name="force"/> uses -D.</summary>
        public Task DeleteBranchAsync(string name, bool force)
            => RunAsync(_repoRoot, "branch", force ? "-D" : "-d", name);

        /// <summary>
        /// Whether a commit is reachable from any remote branch — i.e. already
        /// pushed. Used to refuse rewording commits other people may already have.
        /// </summary>
        public async Task<bool> IsCommitPushedAsync(string sha)
        {
            var outp = await TryRunAsync("branch", "-r", "--contains", sha).ConfigureAwait(false);
            foreach (var line in SplitLines(outp))
            {
                if (!line.EndsWith("/HEAD", StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /// <summary>The full HEAD sha, or empty when detached/empty.</summary>
        public async Task<string> GetHeadShaAsync()
            => (await RunSafeAsync(_repoRoot, "rev-parse", "HEAD").ConfigureAwait(false)).Trim();

        /// <summary>A commit's current subject line (first line of its message).</summary>
        public async Task<string> GetCommitSummaryAsync(string sha)
            => (await RunSafeAsync(_repoRoot, "show", "-s", "--format=%s", sha).ConfigureAwait(false)).Trim();

        /// <summary>
        /// Reword a local commit's message silently — no editor pops up and the
        /// rewrite leaves no visible "amended" marker. HEAD uses a plain --amend;
        /// older commits use a non-interactive interactive-rebase driven by small
        /// PowerShell editor helpers. Throws if the index has staged changes.
        /// </summary>
        public async Task RewordCommitAsync(string sha, string message)
        {
            var staged = await TryRunAsync("diff", "--cached", "--name-only").ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(staged))
                throw new InvalidOperationException(
                    "There are staged changes; commit or unstage them before rewording.");

            var head = await GetHeadShaAsync().ConfigureAwait(false);
            if (!string.IsNullOrEmpty(head) &&
                (head == sha || head.StartsWith(sha, StringComparison.Ordinal) ||
                 sha.StartsWith(head, StringComparison.Ordinal)))
            {
                await RunAsync(_repoRoot, "commit", "--amend", "-m", message).ConfigureAwait(false);
                return;
            }

            // Older commit: scripted, non-interactive `rebase -i <sha>^`.
            var tmp = Path.Combine(Path.GetTempPath(), "revgraph-reword-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            try
            {
                var seqPs1 = Path.Combine(tmp, "seq.ps1");
                var msgPs1 = Path.Combine(tmp, "msg.ps1");
                var msgFile = Path.Combine(tmp, "message.txt");
                File.WriteAllText(msgFile, message);
                File.WriteAllText(seqPs1, SeqEditorPs1);
                File.WriteAllText(msgPs1, MsgEditorPs1);

                string Editor(string ps1) =>
                    "powershell -NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"";

                var env = new Dictionary<string, string>
                {
                    ["GIT_SEQUENCE_EDITOR"] = Editor(seqPs1),
                    ["GIT_EDITOR"] = Editor(msgPs1),
                    ["GIT_REWORD_TARGET"] = sha,
                    ["GIT_REWORD_MSG_FILE"] = msgFile,
                };
                await RunWithEnvAsync(_repoRoot, env, "rebase", "-i", "--autostash", sha + "^")
                    .ConfigureAwait(false);
            }
            finally
            {
                try { Directory.Delete(tmp, true); } catch { /* best effort */ }
            }
        }

        // Marks exactly the target commit as "reword" in the rebase todo list.
        private const string SeqEditorPs1 =
            "$file = $args[0]\n" +
            "$target = $env:GIT_REWORD_TARGET\n" +
            "$lines = Get-Content -LiteralPath $file\n" +
            "$done = $false\n" +
            "$out = foreach ($line in $lines) {\n" +
            "  if (-not $done -and $line -match '^(pick|p)\\s+([0-9a-f]+)\\s') {\n" +
            "    $h = $Matches[2]\n" +
            "    if ($target.StartsWith($h) -or $h.StartsWith($target)) {\n" +
            "      $done = $true\n" +
            "      $line -replace '^(pick|p)\\b','reword'\n" +
            "    } else { $line }\n" +
            "  } else { $line }\n" +
            "}\n" +
            "Set-Content -LiteralPath $file -Value $out\n";

        // Writes the new commit message into the file git opens for the reword.
        private const string MsgEditorPs1 =
            "$file = $args[0]\n" +
            "$msgFile = $env:GIT_REWORD_MSG_FILE\n" +
            "if ($msgFile) { Copy-Item -LiteralPath $msgFile -Destination $file -Force }\n";

        /// <summary>Outcome of an op that can leave conflicts for the IDE to resolve.</summary>
        public enum OpOutcome { Ok, Conflict }

        /// <summary>
        /// Undo a local commit, returning its changes to the working tree as
        /// unstaged edits — and leaving no trace in history (no revert commit).
        ///
        ///  - HEAD commit: <c>git reset --mixed HEAD~1</c> — the tip's changes
        ///    reappear unstaged, existing working-tree changes are preserved, never
        ///    conflicts.
        ///  - older local commit: a scripted, non-interactive rebase that drops
        ///    just that commit (newer commits are kept; --autostash shelves working
        ///    changes). May conflict — the rebase is then left paused so the user
        ///    resolves it with the IDE's built-in merge tooling.
        /// </summary>
        public async Task<OpOutcome> UndoCommitAsync(string sha)
        {
            var head = await GetHeadShaAsync().ConfigureAwait(false);
            var isHead = !string.IsNullOrEmpty(head) &&
                (head == sha || head.StartsWith(sha, StringComparison.Ordinal) ||
                 sha.StartsWith(head, StringComparison.Ordinal));
            if (isHead)
            {
                await RunAsync(_repoRoot, "reset", "--mixed", "HEAD~1").ConfigureAwait(false);
                return OpOutcome.Ok;
            }

            var tmp = Path.Combine(Path.GetTempPath(), "revgraph-undo-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            try
            {
                var seqPs1 = Path.Combine(tmp, "seq.ps1");
                File.WriteAllText(seqPs1, DropSeqEditorPs1);

                var env = new Dictionary<string, string>
                {
                    ["GIT_SEQUENCE_EDITOR"] =
                        "powershell -NoProfile -ExecutionPolicy Bypass -File \"" + seqPs1 + "\"",
                    ["GIT_DROP_TARGET"] = sha,
                };
                try
                {
                    await RunWithEnvAsync(_repoRoot, env, "rebase", "-i", "--autostash", sha + "^")
                        .ConfigureAwait(false);
                    return OpOutcome.Ok;
                }
                catch
                {
                    // A conflict leaves a rebase paused; report it. Re-throw otherwise.
                    if (await IsRebaseInProgressAsync().ConfigureAwait(false)) return OpOutcome.Conflict;
                    throw;
                }
            }
            finally
            {
                try { Directory.Delete(tmp, true); } catch { /* best effort */ }
            }
        }

        // Marks exactly the target commit as "drop" in the rebase todo list.
        private const string DropSeqEditorPs1 =
            "$file = $args[0]\n" +
            "$target = $env:GIT_DROP_TARGET\n" +
            "$lines = Get-Content -LiteralPath $file\n" +
            "$done = $false\n" +
            "$out = foreach ($line in $lines) {\n" +
            "  if (-not $done -and $line -match '^(pick|p)\\s+([0-9a-f]+)\\s') {\n" +
            "    $h = $Matches[2]\n" +
            "    if ($target.StartsWith($h) -or $h.StartsWith($target)) {\n" +
            "      $done = $true\n" +
            "      $line -replace '^(pick|p)\\b','drop'\n" +
            "    } else { $line }\n" +
            "  } else { $line }\n" +
            "}\n" +
            "Set-Content -LiteralPath $file -Value $out\n";

        /// <summary>Apply a stash onto the working tree, keeping the entry. May conflict.</summary>
        public async Task<OpOutcome> StashApplyAsync(int index)
        {
            try
            {
                await RunAsync(_repoRoot, "stash", "apply", "stash@{" + index + "}").ConfigureAwait(false);
                return OpOutcome.Ok;
            }
            catch
            {
                if (await HasUnmergedPathsAsync().ConfigureAwait(false)) return OpOutcome.Conflict;
                throw;
            }
        }

        /// <summary>Apply a stash and drop it on success; git keeps it on conflict.</summary>
        public async Task<OpOutcome> StashPopAsync(int index)
        {
            try
            {
                await RunAsync(_repoRoot, "stash", "pop", "stash@{" + index + "}").ConfigureAwait(false);
                return OpOutcome.Ok;
            }
            catch
            {
                if (await HasUnmergedPathsAsync().ConfigureAwait(false)) return OpOutcome.Conflict;
                throw;
            }
        }

        /// <summary>Delete a stash entry without applying it.</summary>
        public Task StashDropAsync(int index)
            => RunAsync(_repoRoot, "stash", "drop", "stash@{" + index + "}");

        /// <summary>True when a rebase is paused mid-flight (e.g. stopped on a conflict).</summary>
        private async Task<bool> IsRebaseInProgressAsync()
        {
            var gitDir = (await RunSafeAsync(_repoRoot, "rev-parse", "--git-dir").ConfigureAwait(false)).Trim();
            if (string.IsNullOrEmpty(gitDir)) return false;
            var baseDir = Path.IsPathRooted(gitDir) ? gitDir : Path.Combine(_repoRoot, gitDir);
            return Directory.Exists(Path.Combine(baseDir, "rebase-merge"))
                || Directory.Exists(Path.Combine(baseDir, "rebase-apply"));
        }

        /// <summary>True when the working tree has unmerged (conflicted) paths.</summary>
        private async Task<bool> HasUnmergedPathsAsync()
        {
            var outp = await TryRunAsync("ls-files", "-u").ConfigureAwait(false);
            return !string.IsNullOrWhiteSpace(outp);
        }

        public Task CheckoutAsync(string treeish) => RunAsync(_repoRoot, "checkout", treeish);

        /// <summary>
        /// Checkout a commit, preferring a branch over a detached HEAD:
        ///  - switch to a local branch that points at the commit;
        ///  - else create a local tracking branch for a remote-only branch;
        ///  - else fall back to the bare commit (intentional detached HEAD).
        /// Mirrors resolveCheckoutTarget/checkoutTrackingCli in vscode/src/gitData.ts.
        /// </summary>
        public async Task SmartCheckoutAsync(string sha)
        {
            var local = await TryRunAsync(
                "branch", "--points-at", sha, "--format=%(refname:short)").ConfigureAwait(false);
            var locals = SplitLines(local);
            if (locals.Count > 0)
            {
                await CheckoutAsync(locals[0]).ConfigureAwait(false);
                return;
            }

            // %(refname:lstrip=2) strips exactly refs/remotes/, so the result is
            // reliably "origin/branch" — %(refname:short) can drop the remote prefix
            // when no same-named local branch exists, yielding an empty checkout name.
            var remote = await TryRunAsync(
                "branch", "-r", "--points-at", sha, "--format=%(refname:lstrip=2)").ConfigureAwait(false);
            foreach (var remoteRef in SplitLines(remote)) // e.g. "origin/feature"
            {
                if (remoteRef.EndsWith("/HEAD", StringComparison.Ordinal)) continue;
                var slash = remoteRef.IndexOf('/');
                if (slash < 0 || slash == remoteRef.Length - 1) continue;
                var localName = remoteRef.Substring(slash + 1); // "feature"
                try
                {
                    await RunAsync(_repoRoot, "checkout", "-b", localName, "--track", remoteRef)
                        .ConfigureAwait(false);
                }
                catch
                {
                    // A local branch of that name already exists — just switch to it.
                    await CheckoutAsync(localName).ConfigureAwait(false);
                }
                return;
            }

            await CheckoutAsync(sha).ConfigureAwait(false);
        }

        private async Task<string> TryRunAsync(params string[] args)
        {
            try { return await RunAsync(_repoRoot, args).ConfigureAwait(false); }
            catch { return string.Empty; }
        }

        private static List<string> SplitLines(string text)
        {
            var result = new List<string>();
            if (string.IsNullOrEmpty(text)) return result;
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length > 0) result.Add(line);
            }
            return result;
        }

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
            => RunCoreAsync(cwd, null, args);

        /// <summary>Run git with extra environment variables set on the process.</summary>
        private static Task<string> RunWithEnvAsync(
            string cwd, IDictionary<string, string> env, params string[] args)
            => RunCoreAsync(cwd, env, args);

        private static Task<string> RunCoreAsync(
            string cwd, IDictionary<string, string> env, string[] args)
        {
            var tcs = new TaskCompletionSource<string>();
            var psi = new ProcessStartInfo
            {
                FileName = GitExe,
                WorkingDirectory = cwd,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
            };
            if (env != null)
            {
                foreach (var kv in env) psi.EnvironmentVariables[kv.Key] = kv.Value;
            }
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
