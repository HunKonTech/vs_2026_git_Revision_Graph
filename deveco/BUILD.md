# Building the DevEco Studio plugin

> This project is authored cross-platform, but has not been compiled or run
> in this environment: doing so needs a JDK 17 + Gradle + the IntelliJ
> Platform Gradle plugin's dependency resolution (network access to the
> IntelliJ Platform Maven repositories), none of which are available in the
> sandbox this was written in. Review the Kotlin carefully; build and
> manually test it on a machine that has those installed, the same caveat
> `vs/BUILD.md` already carries for the Visual Studio VSIX on non-Windows
> machines.

Huawei DevEco Studio is built on **IntelliJ IDEA Community Edition**, so it
loads standard IntelliJ Platform plugins. This plugin is not published to
the JetBrains Marketplace (out of scope for now) — install it by sideloading
the built ZIP.

## Prerequisites
- JDK 17.
- Gradle 8.9+ (or just `deveco/gradlew` once generated — see below).
- Node.js 18+ (to build the shared web renderer).
- Git on `PATH`.
- DevEco Studio (or plain IntelliJ IDEA Community, which is close enough for
  UI development) for manually installing/trying the built plugin.

## Steps
1. Build the shared web renderer and stage it into this project:
   ```
   npm install
   npm run build:core
   npm run build:webview
   npm run build:deveco-assets
   ```
   This produces `deveco/src/main/resources/webview/main.js` and `main.css`
   (`index.html` is checked in as a static file, like `vs/webview/index.html`).

2. Generate the Gradle wrapper once (only `gradle/wrapper/gradle-wrapper.properties`
   is checked in; the wrapper jar/scripts are not, since they're binary):
   ```
   cd deveco
   gradle wrapper --gradle-version 8.9
   ```
   From then on use `./gradlew` (or `gradlew.bat` on Windows).

3. Build the plugin distribution ZIP:
   ```
   ./gradlew buildPlugin
   ```
   Output: `deveco/build/distributions/revision-graph-deveco-<version>.zip`.

4. To try it interactively instead of sideloading the ZIP, use the IntelliJ
   Platform Gradle plugin's run task:
   ```
   ./gradlew runIde
   ```
   This launches a sandboxed DevEco-Studio-compatible IDE (IntelliJ IDEA
   Community at the pinned `platformVersion`) with the plugin installed.

## Trying it
- Open a project that is inside a Git repo.
- **View → Tool Windows → Revision Graph** opens the tool window.
- The graph shows commits, local & remote branches, tags, and stashes as
  connected boxes, matching the VS Code and Visual Studio hosts pixel-for-
  pixel (same shared renderer).
- Right-click a box for the same context menu as the other hosts: create
  branch, checkout, merge, rename/undo a local commit, copy SHA, etc.

## Notes / known differences from the other two hosts
- **Reword/undo of a non-HEAD commit** is implemented with pure git plumbing
  (`commit-tree` + `update-ref`) rather than the Visual Studio host's
  PowerShell-scripted `git rebase -i`, since DevEco Studio runs on
  Windows/macOS/Linux alike. See the doc comments on
  `GitService.rewordCommit` / `undoCommit` for the exact algorithm. A
  side-effect: these two ops require a **clean working tree** first (no
  `--autostash` equivalent) and can never report a mid-op conflict — they
  either succeed or throw.
- Renaming a branch and rewording a commit currently expect their new-name
  prompt to come from a future native dialog (mirroring
  `vs/NewBranchDialog.xaml`/`vs/PromptDialog.cs`); the plumbing is wired but
  the dialogs themselves are a small follow-up.
- The webview bundle loads from a `file://` URL under the IDE's per-user
  system directory (`PathManager.getSystemPath()/revgraph/webview/<version>`),
  since JCEF can't load resources straight out of the plugin JAR. It's
  extracted once per plugin version and cached there, so installing an
  update automatically re-extracts instead of serving a stale bundle.
