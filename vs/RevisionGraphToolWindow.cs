using System;
using System.IO;
using System.Runtime.InteropServices;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;

namespace RevisionGraph
{
    /// <summary>
    /// The dockable tool window that hosts the revision graph. Resolves the
    /// active solution's directory and points the WebView2 host at its repo.
    /// </summary>
    [Guid("3f5b2d10-9c1a-4f7e-bf2a-7a1d2c3e4b50")]
    public sealed class RevisionGraphToolWindow : ToolWindowPane
    {
        private readonly WebViewHostControl _control;

        public RevisionGraphToolWindow() : base(null)
        {
            Caption = "Revision Graph";
            _control = new WebViewHostControl();
            Content = _control;
        }

        /// <summary>Bind the window to the repository of the current solution.</summary>
        public void Initialize(IServiceProvider serviceProvider)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var startDir = ResolveStartDirectory(serviceProvider);
            _ = _control.SetRepositoryAsync(startDir);
        }

        private static string ResolveStartDirectory(IServiceProvider serviceProvider)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                if (serviceProvider.GetService(typeof(DTE)) is DTE2 dte)
                {
                    var solutionPath = dte.Solution?.FullName;
                    if (!string.IsNullOrEmpty(solutionPath))
                        return Path.GetDirectoryName(solutionPath);

                    // Folder-open ("Open Folder") mode: use the first project dir.
                    if (dte.Solution?.Projects?.Count > 0)
                    {
                        var first = dte.Solution.Projects.Item(1)?.FullName;
                        if (!string.IsNullOrEmpty(first))
                            return Path.GetDirectoryName(first);
                    }
                }
            }
            catch
            {
                // fall through
            }
            return Environment.CurrentDirectory;
        }
    }
}
