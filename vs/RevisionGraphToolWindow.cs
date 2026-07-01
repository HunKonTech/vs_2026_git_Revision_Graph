using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

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

        /// <summary>
        /// Called by the shell once the tool window's frame exists — both when a
        /// user opens it via the command AND when Visual Studio auto-restores a
        /// previously docked window on startup. Binding here (rather than only from
        /// the command handler) ensures the graph loads either way; relying solely
        /// on the command handler left the auto-restored window blank until the
        /// user closed and reopened it manually.
        /// </summary>
        public override void OnToolWindowCreated()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            base.OnToolWindowCreated();
            Initialize((IServiceProvider)Package);
        }

        /// <summary>Bind the window to the repository of the current solution.</summary>
        public void Initialize(IServiceProvider serviceProvider)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var startDirs = ResolveStartDirectories(serviceProvider);
            _ = _control.SetRepositoryAsync(startDirs);
        }

        /// <summary>
        /// Collect candidate directories that may sit inside the active
        /// repository, most-specific first. Any directory inside the work tree
        /// is enough — <see cref="GitService.FindRepoRootAsync"/> walks up to the
        /// root with <c>git rev-parse</c>. We gather from several sources because
        /// no single API covers both classic solutions and Open Folder mode.
        /// </summary>
        private static IReadOnlyList<string> ResolveStartDirectories(IServiceProvider serviceProvider)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var dirs = new List<string>();
            void Add(string path)
            {
                var d = ToExistingDirectory(path);
                if (d != null && !dirs.Contains(d)) dirs.Add(d);
            }

            // 1. IVsSolution reports the solution/workspace directory in BOTH
            //    classic-solution and Open Folder modes.
            try
            {
                if (serviceProvider.GetService(typeof(SVsSolution)) is IVsSolution sol &&
                    sol.GetSolutionInfo(out string slnDir, out string slnFile, out _) == VSConstants.S_OK)
                {
                    Add(slnDir);
                    Add(slnFile);
                }
            }
            catch { /* fall through to DTE */ }

            // 2. DTE fallbacks: solution file, loaded projects, active document.
            try
            {
                if (serviceProvider.GetService(typeof(DTE)) is DTE2 dte)
                {
                    Add(dte.Solution?.FullName);
                    if (dte.Solution?.Projects?.Count > 0)
                    {
                        for (int i = 1; i <= dte.Solution.Projects.Count && i <= 5; i++)
                        {
                            try { Add(dte.Solution.Projects.Item(i)?.FullName); } catch { }
                        }
                    }
                    try { Add(dte.ActiveDocument?.FullName); } catch { }
                }
            }
            catch { /* fall through */ }

            Add(Environment.CurrentDirectory);
            return dirs;
        }

        /// <summary>Resolve a file or directory path to an existing directory.</summary>
        private static string ToExistingDirectory(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            try
            {
                if (Directory.Exists(path)) return path;
                var dir = Path.GetDirectoryName(path);
                return (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) ? dir : null;
            }
            catch
            {
                return null;
            }
        }
    }
}
