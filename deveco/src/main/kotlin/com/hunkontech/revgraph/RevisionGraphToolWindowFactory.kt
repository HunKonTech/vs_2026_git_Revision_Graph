package com.hunkontech.revgraph

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/**
 * Registers the dockable "Revision Graph" tool window and binds it to the
 * active project's repository. Mirrors vs/RevisionGraphToolWindow.cs.
 */
class RevisionGraphToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = WebViewHostPanel(project)
        val content = ContentFactory.getInstance().createContent(panel.component, "", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)

        // Resolving the repo + reading git history are blocking I/O — run off the EDT.
        ApplicationManager.getApplication().executeOnPooledThread {
            val startDirs = RepoResolver.resolveStartDirectories(project)
            panel.setRepository(startDirs)
        }
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}
