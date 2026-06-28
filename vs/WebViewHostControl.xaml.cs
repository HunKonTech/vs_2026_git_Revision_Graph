using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.VisualStudio.PlatformUI;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using RevisionGraph.Git;
using RevisionGraph.Model;

namespace RevisionGraph
{
    /// <summary>
    /// Hosts the shared web renderer (packages/graph-webview) inside a WebView2
    /// control and bridges messages to <see cref="GitService"/>. This is the
    /// Visual Studio counterpart of vscode/src/panel.ts.
    /// </summary>
    public partial class WebViewHostControl : UserControl
    {
        private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        };

        private const string VirtualHost = "revgraph.invalid";
        private const int MaxCommits = 1000;

        private GitService _git;
        private FileSystemWatcher _watcher;
        private DispatcherTimer _refreshTimer;

        public WebViewHostControl()
        {
            InitializeComponent();
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            VSColorTheme.ThemeChanged -= OnVsThemeChanged;
            _watcher?.Dispose();
            _watcher = null;
            _refreshTimer?.Stop();
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                await InitializeAsync().ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Init failed: " + ex.Message });
            }
        }

        private async Task InitializeAsync()
        {
            // WebView2's default user-data folder is created next to the host
            // process — devenv.exe in Program Files — which is not writable.
            // The runtime then fails to start and the panel stays blank. Point
            // it at a writable per-user location instead.
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "RevisionGraphVS", "WebView2");
            Directory.CreateDirectory(userDataFolder);
            var env = await CoreWebView2Environment
                .CreateAsync(browserExecutableFolder: null, userDataFolder: userDataFolder, options: null)
                .ConfigureAwait(true);
            await WebView.EnsureCoreWebView2Async(env).ConfigureAwait(true);

            var assetDir = Path.Combine(
                Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".",
                "webview");
            WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                VirtualHost, assetDir, CoreWebView2HostResourceAccessKind.Allow);

            WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

            // Make the webview follow the Visual Studio theme. Injecting before
            // the document loads avoids a flash of the bundle's default (dark)
            // palette; ThemeChanged keeps it in sync when the user switches.
            await WebView.CoreWebView2
                .AddScriptToExecuteOnDocumentCreatedAsync(BuildThemeScript())
                .ConfigureAwait(true);
            VSColorTheme.ThemeChanged += OnVsThemeChanged;

            WebView.CoreWebView2.Navigate($"https://{VirtualHost}/index.html");
        }

        private void OnVsThemeChanged(ThemeChangedEventArgs e)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (WebView?.CoreWebView2 == null) return;
            _ = WebView.CoreWebView2.ExecuteScriptAsync(BuildThemeScript());
        }

        /// <summary>
        /// Build the script that overrides the bundle's CSS theme variables with
        /// the current VS environment colors. Set on <c>documentElement</c> so it
        /// works even before &lt;head&gt; exists (document-created timing).
        /// </summary>
        private static string BuildThemeScript()
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            string Hex(ThemeResourceKey key)
            {
                var c = VSColorTheme.GetThemedColor(key);
                return $"#{c.R:X2}{c.G:X2}{c.B:X2}";
            }

            var vars = new Dictionary<string, string>
            {
                ["--bg"] = Hex(EnvironmentColors.ToolWindowBackgroundColorKey),
                ["--fg"] = Hex(EnvironmentColors.ToolWindowTextColorKey),
                ["--border"] = Hex(EnvironmentColors.ToolWindowBorderColorKey),
                ["--accent"] = Hex(EnvironmentColors.SystemHighlightColorKey),
            };

            var sb = new StringBuilder("(function(){var r=document.documentElement;");
            foreach (var kv in vars)
            {
                sb.Append("r.style.setProperty(")
                  .Append(JsonSerializer.Serialize(kv.Key)).Append(',')
                  .Append(JsonSerializer.Serialize(kv.Value)).Append(");");
            }
            sb.Append("})();");
            return sb.ToString();
        }

        private async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            WebviewMessage msg;
            try
            {
                msg = JsonSerializer.Deserialize<WebviewMessage>(e.TryGetWebMessageAsString(), JsonOpts);
            }
            catch
            {
                return;
            }
            if (msg?.Type == null) return;

            switch (msg.Type)
            {
                case "ready":
                case "requestRefresh":
                    await RefreshAsync().ConfigureAwait(true);
                    break;
                case "createBranch":
                    await CreateBranchAsync(msg.Sha, msg.Name, msg.Checkout).ConfigureAwait(true);
                    break;
                case "deleteBranch":
                    await DeleteBranchAsync(msg.Name).ConfigureAwait(true);
                    break;
                case "renameCommit":
                    await RenameCommitAsync(msg.Sha).ConfigureAwait(true);
                    break;
                case "undoCommit":
                    await UndoCommitAsync(msg.Sha).ConfigureAwait(true);
                    break;
                case "stashApply":
                case "stashPop":
                case "stashDrop":
                    await HandleStashAsync(msg.Type, msg.Index).ConfigureAwait(true);
                    break;
                case "checkout":
                    await CheckoutAsync(msg.Sha, msg.Ref).ConfigureAwait(true);
                    break;
                case "copySha":
                    if (!string.IsNullOrEmpty(msg.Sha)) Clipboard.SetText(msg.Sha);
                    break;
                case "fetch":
                    await RunRemoteOpAsync("Fetch", g => g.FetchAsync()).ConfigureAwait(true);
                    break;
                case "pull":
                    await RunRemoteOpAsync("Pull", g => g.PullAsync()).ConfigureAwait(true);
                    break;
                case "push":
                    await RunRemoteOpAsync("Push", g => g.PushAsync()).ConfigureAwait(true);
                    break;
                case "pushBranch":
                    if (!string.IsNullOrEmpty(msg.Name))
                        await RunRemoteOpAsync($"Push \"{msg.Name}\"", g => g.PushBranchAsync(msg.Name)).ConfigureAwait(true);
                    break;
                case "renameBranch":
                    if (!string.IsNullOrEmpty(msg.Name))
                        await RenameBranchAsync(msg.Name).ConfigureAwait(true);
                    break;
                case "sync":
                    await RunRemoteOpAsync("Sync", g => g.SyncAsync()).ConfigureAwait(true);
                    break;
            }
        }

        /// <summary>Run a remote git operation, then refresh the graph.</summary>
        private async Task RunRemoteOpAsync(string label, Func<GitService, Task> op)
        {
            if (_git == null)
            {
                PostToWebview(new { type = "error", message = "No Git repository found for the current solution." });
                return;
            }
            try
            {
                await op(_git).ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = label + " failed: " + ex.Message });
            }
            await RefreshAsync().ConfigureAwait(true);
        }

        /// <summary>
        /// Point the host at a repository (called by the tool window). Tries each
        /// candidate directory in order; the first one inside a git work tree wins.
        /// </summary>
        public async Task SetRepositoryAsync(IReadOnlyList<string> startDirs)
        {
            string root = null;
            if (startDirs != null)
            {
                foreach (var dir in startDirs)
                {
                    root = await GitService.FindRepoRootAsync(dir).ConfigureAwait(true);
                    if (root != null) break;
                }
            }
            _git = root != null ? new GitService(root) : null;
            SetupWatcher(root);
            await RefreshAsync().ConfigureAwait(true);
        }

        /// <summary>
        /// Watch the repository's .git directory so the graph refreshes itself
        /// on commits, checkouts, fetch/pull/push, etc. — like the SVN graph.
        /// </summary>
        private void SetupWatcher(string repoRoot)
        {
            _watcher?.Dispose();
            _watcher = null;

            if (string.IsNullOrEmpty(repoRoot)) return;
            var gitDir = Path.Combine(repoRoot, ".git");
            // Worktrees/submodules use a .git *file*; skip auto-watch there.
            if (!Directory.Exists(gitDir)) return;

            _watcher = new FileSystemWatcher(gitDir)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName,
                EnableRaisingEvents = true,
            };
            FileSystemEventHandler onChange = (s, e) => ScheduleRefresh();
            _watcher.Changed += onChange;
            _watcher.Created += onChange;
            _watcher.Deleted += onChange;
            _watcher.Renamed += (s, e) => ScheduleRefresh();
        }

        /// <summary>Coalesce rapid .git changes into a single refresh on the UI thread.</summary>
        private void ScheduleRefresh()
        {
            // FileSystemWatcher events arrive on a thread-pool thread.
            _ = Dispatcher.BeginInvoke(new Action(() =>
            {
                if (_refreshTimer == null)
                {
                    _refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
                    _refreshTimer.Tick += async (s, e) =>
                    {
                        _refreshTimer.Stop();
                        await RefreshAsync().ConfigureAwait(true);
                    };
                }
                _refreshTimer.Stop();
                _refreshTimer.Start();
            }));
        }

        private async Task RefreshAsync()
        {
            if (_git == null)
            {
                PostToWebview(new { type = "error", message = "No Git repository found for the current solution." });
                return;
            }
            try
            {
                GraphData data = await _git.ReadGraphDataAsync(MaxCommits).ConfigureAwait(true);
                PostToWebview(new { type = "setData", data });
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Failed to read git history: " + ex.Message });
            }
        }

        private async Task CreateBranchAsync(string sha, string name, bool? checkout)
        {
            if (_git == null || string.IsNullOrEmpty(sha)) return;

            string branchName;
            bool doCheckout;

            if (!string.IsNullOrWhiteSpace(name))
            {
                // The webview's SVN-style dialog already gathered the name + choice.
                branchName = name.Trim();
                doCheckout = checkout ?? true;
            }
            else
            {
                // Native-feeling fallback via the themed VS dialog (NewBranchDialog),
                // seeded from the clicked commit.
                var dialog = new NewBranchDialog(sha);
                if (dialog.ShowDialog() != true) return;
                branchName = dialog.BranchName;
                doCheckout = dialog.Checkout;
            }

            try
            {
                await _git.CreateBranchAsync(branchName, sha, doCheckout).ConfigureAwait(true);
                PostToWebview(new { type = "branchCreated", name = branchName, sha });
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Create branch failed: " + ex.Message });
            }
        }

        private async Task DeleteBranchAsync(string name)
        {
            if (_git == null || string.IsNullOrEmpty(name)) return;

            var confirm = MessageBox.Show(
                "Delete branch \"" + name + "\"?", "Delete Branch",
                MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            // A branch checked out in this worktree can't be deleted — git refuses
            // with "used by worktree". Move HEAD to where the branch was started
            // from first: the main branch when it forked directly off main,
            // otherwise the branch it diverged from.
            try
            {
                var current = await _git.GetCurrentBranchAsync().ConfigureAwait(true);
                if (!string.IsNullOrEmpty(current) && current == name)
                {
                    var target = await _git.ResolveBranchBaseTargetAsync(name).ConfigureAwait(true);
                    if (string.IsNullOrEmpty(target) || target == name)
                    {
                        PostToWebview(new { type = "error", message =
                            "Cannot delete \"" + name + "\": it is checked out and no other branch to switch to was found." });
                        return;
                    }
                    await _git.CheckoutAsync(target).ConfigureAwait(true);
                }
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Delete branch failed: " + ex.Message });
                return;
            }

            try
            {
                await _git.DeleteBranchAsync(name, false).ConfigureAwait(true);
            }
            catch (Exception)
            {
                // -d refuses a branch that isn't fully merged; offer a force delete.
                var force = MessageBox.Show(
                    "Branch \"" + name + "\" is not fully merged. Delete anyway? This cannot be undone.",
                    "Delete Branch", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                if (force != MessageBoxResult.Yes) return;
                try
                {
                    await _git.DeleteBranchAsync(name, true).ConfigureAwait(true);
                }
                catch (Exception ex)
                {
                    PostToWebview(new { type = "error", message = "Delete branch failed: " + ex.Message });
                    return;
                }
            }
            await RefreshAsync().ConfigureAwait(true);
        }

        private async Task RenameBranchAsync(string name)
        {
            if (_git == null || string.IsNullOrEmpty(name)) return;

            var owner = Window.GetWindow(this);
            var newName = PromptDialog.Show(
                owner, $"Rename branch \"{name}\"", "Enter the new branch name", name);
            if (newName == null || newName.Trim() == name) return;
            var trimmed = newName.Trim();
            if (string.IsNullOrEmpty(trimmed)) return;

            try
            {
                await _git.RenameBranchAsync(name, trimmed).ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Rename branch failed: " + ex.Message });
                return;
            }
            await RefreshAsync().ConfigureAwait(true);
        }

        private async Task RenameCommitAsync(string sha)
        {
            if (_git == null || string.IsNullOrEmpty(sha)) return;

            // Only local (unpushed) commits may be reworded.
            if (await _git.IsCommitPushedAsync(sha).ConfigureAwait(true))
            {
                MessageBox.Show(
                    "This commit has already been pushed, so its message can't be rewritten safely.",
                    "Rename Commit", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var current = await _git.GetCommitSummaryAsync(sha).ConfigureAwait(true);
            var owner = Window.GetWindow(this);
            var message = PromptDialog.Show(
                owner, "Rename commit " + Short(sha), "Enter the new commit message", current);
            if (message == null || message == current) return;

            try
            {
                await _git.RewordCommitAsync(sha, message).ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Rename commit failed: " + ex.Message });
                return;
            }
            await RefreshAsync().ConfigureAwait(true);
        }

        /// <summary>
        /// Undo a local commit: its changes return to the working tree and it
        /// vanishes from history. Refuses pushed commits (the webview already hides
        /// the entry for them; this guards the rare race). Conflicts are reported so
        /// the webview tells the user to resolve them with Visual Studio's built-in
        /// merge tooling (it surfaces the conflicted files automatically).
        /// </summary>
        private async Task UndoCommitAsync(string sha)
        {
            if (_git == null || string.IsNullOrEmpty(sha)) return;

            if (await _git.IsCommitPushedAsync(sha).ConfigureAwait(true))
            {
                PostToWebview(new { type = "opResult", op = "undo", result = "error" });
                return;
            }
            try
            {
                var outcome = await _git.UndoCommitAsync(sha).ConfigureAwait(true);
                PostToWebview(new
                {
                    type = "opResult",
                    op = "undo",
                    result = outcome == GitService.OpOutcome.Conflict ? "conflict" : "ok",
                });
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "opResult", op = "undo", result = "error", detail = ex.Message });
            }
            await RefreshAsync().ConfigureAwait(true);
        }

        /// <summary>Apply / pop / drop a stash, reporting the outcome for a localized status.</summary>
        private async Task HandleStashAsync(string op, int? index)
        {
            if (_git == null || index == null) return;
            int i = index.Value;
            try
            {
                string result = "ok";
                if (op == "stashApply")
                    result = await _git.StashApplyAsync(i).ConfigureAwait(true) == GitService.OpOutcome.Conflict
                        ? "conflict" : "ok";
                else if (op == "stashPop")
                    result = await _git.StashPopAsync(i).ConfigureAwait(true) == GitService.OpOutcome.Conflict
                        ? "conflict" : "ok";
                else
                    await _git.StashDropAsync(i).ConfigureAwait(true);

                PostToWebview(new { type = "opResult", op, result });
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "opResult", op, result = "error", detail = ex.Message });
            }
            await RefreshAsync().ConfigureAwait(true);
        }

        private static string Short(string sha)
            => sha != null && sha.Length >= 7 ? sha.Substring(0, 7) : sha;

        private async Task CheckoutAsync(string sha, string @ref = null)
        {
            var treeish = sha ?? @ref;
            if (_git == null || string.IsNullOrEmpty(treeish)) return;
            try
            {
                // Resolve a branch to switch to instead of detaching HEAD on a commit —
                // crucially, a remote-only branch becomes a new local tracking branch.
                // `ref` names the exact branch the user clicked, so when several
                // branches share a commit we switch to the right one, not by sha.
                await _git.SmartCheckoutAsync(treeish, @ref).ConfigureAwait(true);
                await RefreshAsync().ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Checkout failed: " + ex.Message });
            }
        }

        private void PostToWebview(object message)
        {
            if (WebView?.CoreWebView2 == null) return;
            WebView.CoreWebView2.PostWebMessageAsString(JsonSerializer.Serialize(message, JsonOpts));
        }
    }
}
