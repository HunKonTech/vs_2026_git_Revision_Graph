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
                    await CreateBranchAsync(msg.Sha).ConfigureAwait(true);
                    break;
                case "checkout":
                    await CheckoutAsync(msg.Sha ?? msg.Ref).ConfigureAwait(true);
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

        private async Task CreateBranchAsync(string sha)
        {
            if (_git == null || string.IsNullOrEmpty(sha)) return;

            // Native-feeling input via a themed VS dialog (NewBranchDialog), seeded
            // from the clicked commit. Falls back-compatibly to the CLI for the
            // actual branch creation.
            var dialog = new NewBranchDialog(sha);
            if (dialog.ShowDialog() != true) return;

            try
            {
                await _git.CreateBranchAsync(dialog.BranchName, sha, dialog.Checkout).ConfigureAwait(true);
                PostToWebview(new { type = "branchCreated", name = dialog.BranchName, sha });
            }
            catch (Exception ex)
            {
                PostToWebview(new { type = "error", message = "Create branch failed: " + ex.Message });
            }
        }

        private async Task CheckoutAsync(string treeish)
        {
            if (_git == null || string.IsNullOrEmpty(treeish)) return;
            try
            {
                // Resolve a branch to switch to instead of detaching HEAD on a commit —
                // crucially, a remote-only branch becomes a new local tracking branch.
                await _git.SmartCheckoutAsync(treeish).ConfigureAwait(true);
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
