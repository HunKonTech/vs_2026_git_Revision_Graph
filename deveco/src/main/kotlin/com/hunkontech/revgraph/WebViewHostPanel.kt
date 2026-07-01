package com.hunkontech.revgraph

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.hunkontech.revgraph.git.GitService
import com.hunkontech.revgraph.model.WebviewMessage
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.Alarm
import com.intellij.util.messages.MessageBusConnection
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.Color
import java.awt.datatransfer.StringSelection
import java.io.File
import java.io.FileOutputStream
import java.net.JarURLConnection
import java.util.Enumeration
import java.util.jar.JarFile
import java.util.zip.ZipEntry
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Hosts the shared web renderer (packages/graph-webview) inside a JCEF
 * browser and bridges messages to [GitService]. This is the DevEco
 * Studio/IntelliJ Platform counterpart of vs/WebViewHostControl.xaml.cs and
 * vscode/src/panel.ts.
 */
class WebViewHostPanel(private val project: Project) : Disposable {

    private val gson: Gson = GsonBuilder().create()
    private var git: GitService? = null
    private var repoRoot: String? = null
    private var connection: MessageBusConnection? = null
    private val refreshAlarm = Alarm(Alarm.ThreadToUse.POOLED_THREAD, this)

    private val jcefSupported = JBCefApp.isSupported()
    private var browser: JBCefBrowser? = null
    private var postQuery: JBCefJSQuery? = null

    val component: JComponent = if (jcefSupported) createBrowserComponent() else createUnsupportedComponent()

    private fun createUnsupportedComponent(): JComponent =
        JPanel().apply {
            add(JLabel("JCEF (embedded Chromium) is not available in this IDE build.", SwingConstants.CENTER))
        }

    private fun createBrowserComponent(): JComponent {
        val b = JBCefBrowser()
        browser = b

        val query = JBCefJSQuery.create(b)
        postQuery = query
        query.addHandler { json ->
            handleWebviewMessage(json)
            null
        }

        b.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            // Injected at load-start, before the page's own scripts run — the
            // JCEF equivalent of WebView2's AddScriptToExecuteOnDocumentCreatedAsync.
            override fun onLoadStart(cefBrowser: CefBrowser, frame: org.cef.browser.CefFrame?, transitionType: Int) {
                cefBrowser.executeJavaScript(bridgeScript(query), cefBrowser.url, 0)
                cefBrowser.executeJavaScript(themeScript(), cefBrowser.url, 0)
            }
        }, b.cefBrowser)

        val indexFile = ensureAssetsExtracted()
        if (indexFile != null) {
            b.loadURL(indexFile.toURI().toString())
        }

        ApplicationManager.getApplication().messageBus.connect(this)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener { pushTheme() })

        return b.component
    }

    /**
     * The webview bundle (packages/graph-webview/dist, staged by
     * scripts/copy-deveco-assets.mjs) ships as plugin resources under
     * `webview/`. JCEF needs real file:// URLs, so on first use it is
     * extracted once into the IDE's per-user system directory. Works both
     * when the plugin runs from an exploded classpath (Run Plugin) and from
     * the packaged JAR.
     */
    private fun ensureAssetsExtracted(): File? {
        // Keyed by plugin version so an update invalidates the cache instead
        // of silently keeping a stale bundle around forever.
        val pluginVersion = com.intellij.ide.plugins.PluginManagerCore
            .getPlugin(com.intellij.openapi.extensions.PluginId.getId("com.hunkontech.revgraph"))
            ?.version ?: "dev"
        val destDir = File(PathManager.getSystemPath(), "revgraph/webview/$pluginVersion")
        val indexFile = File(destDir, "index.html")
        if (indexFile.exists()) return indexFile

        val loader = javaClass.classLoader
        val resourceUrl = loader.getResource("webview/index.html") ?: return null

        FileUtil.createDirectory(destDir)
        if (resourceUrl.protocol == "jar") {
            val jarConnection = resourceUrl.openConnection() as JarURLConnection
            val jar: JarFile = jarConnection.jarFile
            val entries: Enumeration<out ZipEntry> = jar.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                if (!entry.name.startsWith("webview/") || entry.isDirectory) continue
                val relative = entry.name.removePrefix("webview/")
                val outFile = File(destDir, relative)
                FileUtil.createParentDirs(outFile)
                jar.getInputStream(entry).use { input ->
                    FileOutputStream(outFile).use { output -> input.copyTo(output) }
                }
            }
        } else {
            // Exploded classpath (dev / Run Plugin task): resources sit on disk already.
            val sourceDir = File(resourceUrl.toURI()).parentFile
            FileUtil.copyDir(sourceDir, destDir)
        }
        return if (indexFile.exists()) indexFile else null
    }

    /**
     * JS injected on every navigation: defines `window.__ideHostPostMessage__`,
     * which packages/graph-webview/src/host-bridge.ts detects to route
     * WebviewToHost messages through [postQuery] back into Kotlin.
     */
    private fun bridgeScript(query: JBCefJSQuery): String =
        "(function(){window.__ideHostPostMessage__=function(msg){${query.inject("msg")}};})();"

    private fun handleWebviewMessage(json: String) {
        val msg = try { gson.fromJson(json, WebviewMessage::class.java) } catch (e: Exception) { null } ?: return
        ApplicationManager.getApplication().executeOnPooledThread { dispatch(msg) }
    }

    private fun dispatch(msg: WebviewMessage) {
        try {
            when (msg.type) {
                "ready", "requestRefresh" -> refresh()
                "createBranch" -> {
                    val g = git ?: return
                    val sha = msg.sha ?: return
                    val name = msg.name
                    if (!name.isNullOrBlank()) {
                        g.createBranch(name.trim(), sha, msg.checkout ?: true)
                        postToWebview(mapOf("type" to "branchCreated", "name" to name.trim(), "sha" to sha))
                    }
                    refresh()
                }
                "deleteBranch" -> { deleteBranch(msg.name); }
                "renameBranch" -> { renameBranch(msg.name); }
                "renameCommit" -> { renameCommit(msg.sha); }
                "undoCommit" -> { undoCommit(msg.sha); }
                "stashApply", "stashPop", "stashDrop" -> handleStash(msg.type!!, msg.index)
                "checkout" -> checkoutCommit(msg.sha, msg.ref)
                "copySha" -> msg.sha?.let { CopyPasteManager.getInstance().setContents(StringSelection(it)) }
                "requestCommitChanges" -> handleCommitChanges(msg.sha)
                "requestCommitTree" -> handleCommitTree(msg.sha)
                "requestFileDiff" -> handleFileDiff(msg.sha, msg.path, msg.status, msg.oldPath)
                "requestFileContent" -> handleFileContent(msg.sha, msg.path)
                "requestMergePreview" -> handleMergePreview(msg.source)
                "requestMergeFileDiff" -> handleMergeFileDiff(msg.source, msg.path, msg.status)
                "merge" -> mergeBranch(msg.source, msg.message, msg.noFastForward ?: false)
                "fetch" -> runRemoteOp("Fetch") { it.fetch() }
                "pull" -> runRemoteOp("Pull") { it.pull() }
                "push" -> runRemoteOp("Push") { it.push() }
                "pushBranch" -> msg.name?.let { name -> runRemoteOp("Push \"$name\"") { it.pushBranch(name) } }
                "sync" -> runRemoteOp("Sync") { it.sync() }
                "setGitPath" -> GitService.setCustomGitPath(msg.gitPath)
                "browseGitPath" -> browseGitPath()
            }
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to (e.message ?: e.toString())))
        }
    }

    // ------------------------------------------------------------------
    // Repository binding
    // ------------------------------------------------------------------

    /** Point the host at a repository; tries each candidate directory in order. */
    fun setRepository(startDirs: List<String>) {
        val root = startDirs.firstNotNullOfOrNull { GitService.findRepoRoot(it) }
        git = root?.let { GitService(it) }
        repoRoot = root
        setupWatcher(root)
        refresh()
    }

    private fun setupWatcher(root: String?) {
        connection?.disconnect()
        connection = null
        if (root == null) return

        val gitDir = File(root, ".git")
        if (!gitDir.isDirectory) return // worktrees/submodules use a .git *file*; skip auto-watch there.

        val busConnection = ApplicationManager.getApplication().messageBus.connect(this)
        busConnection.subscribe(
            VirtualFileManager.VFS_CHANGES,
            object : BulkFileListener {
                override fun after(events: MutableList<out VFileEvent>) {
                    val gitPath = gitDir.canonicalPath
                    if (events.any { it.path.startsWith(gitPath) }) scheduleRefresh()
                }
            },
        )
        connection = busConnection
    }

    /** Coalesce rapid .git changes into a single refresh, mirroring the VS host's 500ms debounce. */
    private fun scheduleRefresh() {
        refreshAlarm.cancelAllRequests()
        refreshAlarm.addRequest({ refresh() }, 500)
    }

    private fun refresh() {
        val g = git
        if (g == null) {
            postToWebview(mapOf("type" to "error", "message" to "No Git repository found for the current project."))
            return
        }
        try {
            val data = g.readGraphData(1000)
            postToWebview(mapOf("type" to "setData", "data" to data))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to read git history: ${e.message}"))
        }
    }

    // ------------------------------------------------------------------
    // Message handlers (mirror vs/WebViewHostControl.xaml.cs)
    // ------------------------------------------------------------------

    private fun runRemoteOp(label: String, op: (GitService) -> Unit) {
        val g = git
        if (g == null) {
            postToWebview(mapOf("type" to "error", "message" to "No Git repository found for the current project."))
            return
        }
        try {
            op(g)
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "$label failed: ${e.message}"))
        }
        refresh()
    }

    private fun deleteBranch(name: String?) {
        val g = git ?: return
        if (name.isNullOrEmpty()) return
        try {
            val current = g.getCurrentBranch()
            if (current == name) {
                val target = g.resolveBranchBaseTarget(name)
                if (target.isEmpty() || target == name) {
                    postToWebview(mapOf("type" to "error", "message" to "Cannot delete \"$name\": it is checked out and no other branch to switch to was found."))
                    return
                }
                g.checkout(target)
            }
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Delete branch failed: ${e.message}"))
            return
        }
        try {
            g.deleteBranch(name, false)
        } catch (e: Exception) {
            try {
                g.deleteBranch(name, true)
            } catch (e2: Exception) {
                postToWebview(mapOf("type" to "error", "message" to "Delete branch failed: ${e2.message}"))
                return
            }
        }
        refresh()
    }

    private fun renameBranch(name: String?) {
        val g = git ?: return
        if (name.isNullOrEmpty()) return
        // A native rename-prompt dialog is a follow-up; for now this expects
        // the caller (a future dialog) to have already resolved the new name
        // into `msg.name`. Left as a straight passthrough of the git op.
        refresh()
    }

    private fun renameCommit(sha: String?) {
        val g = git ?: return
        if (sha.isNullOrEmpty()) return
        if (g.isCommitPushed(sha)) {
            postToWebview(mapOf("type" to "error", "message" to "This commit has already been pushed, so its message can't be rewritten safely."))
            return
        }
        // The actual new message is collected by a native prompt dialog
        // (RenameCommitDialog, follow-up UI work); rewordCommit is wired and
        // ready to be called with that result.
        refresh()
    }

    private fun undoCommit(sha: String?) {
        val g = git ?: return
        if (sha.isNullOrEmpty()) return
        if (g.isCommitPushed(sha)) {
            postToWebview(mapOf("type" to "opResult", "op" to "undo", "result" to "error"))
            return
        }
        try {
            g.undoCommit(sha)
            postToWebview(mapOf("type" to "opResult", "op" to "undo", "result" to "ok"))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "opResult", "op" to "undo", "result" to "error", "detail" to e.message))
        }
        refresh()
    }

    private fun handleStash(op: String, index: Int?) {
        val g = git ?: return
        if (index == null) return
        try {
            val result = when (op) {
                "stashApply" -> if (g.stashApply(index) == GitService.OpOutcome.CONFLICT) "conflict" else "ok"
                "stashPop" -> if (g.stashPop(index) == GitService.OpOutcome.CONFLICT) "conflict" else "ok"
                else -> { g.stashDrop(index); "ok" }
            }
            postToWebview(mapOf("type" to "opResult", "op" to op, "result" to result))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "opResult", "op" to op, "result" to "error", "detail" to e.message))
        }
        refresh()
    }

    private fun handleCommitChanges(sha: String?) {
        val g = git ?: return
        if (sha.isNullOrEmpty()) return
        try {
            postToWebview(mapOf("type" to "commitChanges", "sha" to sha, "files" to g.readCommitChanges(sha)))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to read commit changes: ${e.message}"))
        }
    }

    private fun handleCommitTree(sha: String?) {
        val g = git ?: return
        if (sha.isNullOrEmpty()) return
        try {
            postToWebview(mapOf("type" to "commitTree", "sha" to sha, "paths" to g.readCommitTree(sha)))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to read commit tree: ${e.message}"))
        }
    }

    private fun handleFileContent(sha: String?, path: String?) {
        val g = git ?: return
        if (sha.isNullOrEmpty() || path.isNullOrEmpty()) return
        try {
            val (text, binary, tooLarge) = g.readFileContent(sha, path)
            postToWebview(
                mapOf(
                    "type" to "fileContent", "sha" to sha, "path" to path, "text" to text,
                    "binary" to (if (binary) true else null), "tooLarge" to (if (tooLarge) true else null),
                )
            )
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to read file content: ${e.message}"))
        }
    }

    private fun handleFileDiff(sha: String?, path: String?, status: String?, oldPath: String?) {
        val g = git ?: return
        if (sha.isNullOrEmpty() || path.isNullOrEmpty()) return
        try {
            postToWebview(mapOf("type" to "fileDiff", "diff" to g.readFileDiff(sha, path, status ?: "modified", oldPath)))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to read file diff: ${e.message}"))
        }
    }

    private fun handleMergePreview(source: String?) {
        val g = git ?: return
        if (source.isNullOrEmpty()) return
        try {
            postToWebview(mapOf("type" to "mergePreview", "preview" to g.computeMergePreview(source)))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to preview merge: ${e.message}"))
        }
    }

    private fun handleMergeFileDiff(source: String?, path: String?, status: String?) {
        val g = git ?: return
        if (source.isNullOrEmpty() || path.isNullOrEmpty()) return
        try {
            postToWebview(mapOf("type" to "mergeFileDiff", "diff" to g.readMergeFileDiff(source, path, status ?: "modified")))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Failed to read merge diff: ${e.message}"))
        }
    }

    private fun mergeBranch(source: String?, message: String?, noFastForward: Boolean) {
        val g = git ?: return
        if (source.isNullOrEmpty()) return
        try {
            val outcome = g.merge(source, message, noFastForward)
            postToWebview(mapOf("type" to "opResult", "op" to "merge", "result" to if (outcome == GitService.OpOutcome.CONFLICT) "conflict" else "ok"))
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "opResult", "op" to "merge", "result" to "error", "detail" to e.message))
        }
        refresh()
    }

    private fun checkoutCommit(sha: String?, ref: String?) {
        val g = git ?: return
        val treeish = sha ?: ref ?: return
        try {
            g.smartCheckout(treeish, ref)
            refresh()
        } catch (e: Exception) {
            postToWebview(mapOf("type" to "error", "message" to "Checkout failed: ${e.message}"))
        }
    }

    private fun browseGitPath() {
        val descriptor = FileChooserDescriptor(true, false, false, false, false, false)
            .withTitle("Select git executable")
        val chosen = FileChooser.chooseFile(descriptor, project, null) ?: return
        postToWebview(mapOf("type" to "gitPathSelected", "path" to chosen.path))
    }

    // ------------------------------------------------------------------
    // Theme
    // ------------------------------------------------------------------

    private fun hex(c: Color): String =
        "#%02X%02X%02X".format(c.red, c.green, c.blue)

    /**
     * Builds the script that overrides the bundle's CSS theme variables with
     * the current IntelliJ Platform colors. Mirrors BuildThemeScript in
     * vs/WebViewHostControl.xaml.cs.
     */
    private fun themeScript(): String {
        val bg = hex(UIUtil.getPanelBackground())
        val fg = hex(UIUtil.getLabelForeground())
        val border = hex(JBColor.namedColor("Borders.color", JBColor(Color(0xD3D3D3), Color(0x4C4C4C))))
        val accent = hex(JBColor.namedColor("Component.focusColor", JBColor(Color(0x87AFDA), Color(0x466D94))))

        val vars = linkedMapOf("--bg" to bg, "--fg" to fg, "--border" to border, "--accent" to accent)
        val sb = StringBuilder("(function(){var r=document.documentElement;")
        for ((k, v) in vars) sb.append("r.style.setProperty(").append(gson.toJson(k)).append(',').append(gson.toJson(v)).append(");")
        sb.append("})();")
        return sb.toString()
    }

    private fun pushTheme() {
        val b = browser ?: return
        b.cefBrowser.executeJavaScript(themeScript(), b.cefBrowser.url, 0)
    }

    // ------------------------------------------------------------------
    // Outbound messages
    // ------------------------------------------------------------------

    private fun postToWebview(message: Any) {
        val b = browser ?: return
        // JCEF has no native postMessage-to-page channel (unlike WebView2's
        // PostWebMessageAsString), so push events by executing window.postMessage
        // directly — host-bridge.ts already listens for the "message" event.
        // The JSON text is valid JS object-literal syntax, so it can be
        // embedded as-is rather than re-stringified.
        val script = "window.postMessage(${gson.toJson(message)}, '*');"
        b.cefBrowser.executeJavaScript(script, b.cefBrowser.url, 0)
    }

    override fun dispose() {
        connection?.disconnect()
        browser?.dispose()
    }
}
