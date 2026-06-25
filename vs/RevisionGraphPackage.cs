using System;
using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace RevisionGraph
{
    /// <summary>
    /// The VSIX package. Registers the Revision Graph tool window and the
    /// command that opens it. Works in Visual Studio 2022 and 2026.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("Git Revision Graph", "TortoiseSVN-style Git revision graph.", "0.1.0")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(RevisionGraphToolWindow), Style = VsDockStyle.Tabbed, Window = "DocumentWell")]
    [Guid(PackageGuidString)]
    public sealed class RevisionGraphPackage : AsyncPackage
    {
        public const string PackageGuidString = "b7e9c2a4-1f63-4d8e-9a2b-5c6d7e8f9a01";

        // Command set + ids (must match RevisionGraphPackage.vsct).
        public static readonly Guid CommandSet = new Guid("c1d2e3f4-a5b6-47c8-9d0e-1f2a3b4c5d6e");
        public const int OpenGraphCommandId = 0x0100;

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await this.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            if (await GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService mcs)
            {
                var id = new CommandID(CommandSet, OpenGraphCommandId);
                mcs.AddCommand(new MenuCommand(OnOpenGraph, id));
            }
        }

        private void OnOpenGraph(object sender, EventArgs e)
        {
            _ = ShowToolWindowAsync();
        }

        private async Task ShowToolWindowAsync()
        {
            await this.JoinableTaskFactory.SwitchToMainThreadAsync();
            var window = await ShowToolWindowAsync(
                typeof(RevisionGraphToolWindow), 0, create: true, cancellationToken: DisposalToken);
            if (window is RevisionGraphToolWindow graph)
            {
                graph.Initialize(this);
            }
        }
    }
}
