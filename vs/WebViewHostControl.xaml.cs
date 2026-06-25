using System;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
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

        public WebViewHostControl()
        {
            InitializeComponent();
            Loaded += OnLoaded;
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
            await WebView.EnsureCoreWebView2Async().ConfigureAwait(true);

            var assetDir = Path.Combine(
                Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".",
                "webview");
            WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                VirtualHost, assetDir, CoreWebView2HostResourceAccessKind.Allow);

            WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            WebView.CoreWebView2.Navigate($"https://{VirtualHost}/index.html");
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
            }
        }

        /// <summary>Point the host at a repository (called by the tool window).</summary>
        public async Task SetRepositoryAsync(string startDir)
        {
            var root = await GitService.FindRepoRootAsync(startDir).ConfigureAwait(true);
            _git = root != null ? new GitService(root) : null;
            await RefreshAsync().ConfigureAwait(true);
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
                await _git.CheckoutAsync(treeish).ConfigureAwait(true);
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
