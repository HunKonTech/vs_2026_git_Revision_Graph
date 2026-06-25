# Building the Visual Studio extension (VSIX)

> This project is authored cross-platform, but the VSIX can only be **built and
> run on Windows** with Visual Studio (the VS SDK, MSBuild, and WebView2 are
> Windows-only).

## Prerequisites
- Windows 10/11
- Visual Studio 2022 (17.x) or 2026, with the **Visual Studio extension
  development** workload installed.
- Node.js 18+ (to build the shared web renderer).
- Git on `PATH`.

## Steps
1. Build the shared web renderer and stage it into this project:
   ```
   npm install
   npm run build:webview
   npm run build:vs-assets
   ```
   This produces `vs/webview/main.js` and `vs/webview/main.css`.

2. Open `vs/RevisionGraph.csproj` in Visual Studio (or add it to a solution).
   Restore NuGet packages and build. The first build also restores
   `Microsoft.VSSDK.BuildTools` and `Microsoft.Web.WebView2`.

3. Press **F5**. A second, experimental VS instance launches with the extension
   installed.

## Trying it
- In the experimental instance, open a folder/solution that is inside a Git repo.
- **View → Other Windows → Revision Graph** opens the tool window.
- The graph shows commits, local & remote branches, and tags as connected boxes.
- **Right-click a box → "Create branch from here…"** opens the new-branch dialog
  seeded from that commit; on confirm the branch is created (and optionally
  checked out), then the graph refreshes.

## Notes / known caveats
- Package versions in `RevisionGraph.csproj` (`Microsoft.VisualStudio.SDK`,
  `Microsoft.VSSDK.BuildTools`, `Microsoft.Web.WebView2`) may need bumping to
  match your installed VS version; pin them to the versions your VS provides.
- The repository root is resolved from the active solution/folder via
  `git rev-parse --show-toplevel`. An alternative is the VS Git Extensibility
  service (`IGitExt.ActiveRepositories`) — see the plan's "open risks".
- Branch creation currently uses the git CLI behind a themed dialog. Seeding the
  *built-in* VS "New Branch" dialog from an arbitrary commit is undocumented and
  is a future enhancement (see plan).
- WebView2 Runtime ships with VS; on a bare machine install the Evergreen
  runtime.
