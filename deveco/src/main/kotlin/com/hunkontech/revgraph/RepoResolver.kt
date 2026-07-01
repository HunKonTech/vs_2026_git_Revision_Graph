package com.hunkontech.revgraph

import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import java.io.File

/**
 * Collects candidate directories that may sit inside the active repository,
 * most-specific first — any directory inside the work tree is enough, since
 * [com.hunkontech.revgraph.git.GitService.findRepoRoot] walks up to the root
 * with `git rev-parse`. Mirrors ResolveStartDirectories in
 * vs/RevisionGraphToolWindow.cs.
 */
object RepoResolver {

    fun resolveStartDirectories(project: Project): List<String> {
        val dirs = LinkedHashSet<String>()

        fun add(path: String?) {
            val dir = toExistingDirectory(path) ?: return
            dirs.add(dir)
        }

        add(project.basePath)
        for (root in ProjectRootManager.getInstance(project).contentRoots) {
            add(root.path)
        }
        add(System.getProperty("user.dir"))

        return dirs.toList()
    }

    private fun toExistingDirectory(path: String?): String? {
        if (path.isNullOrEmpty()) return null
        return try {
            val f = File(path)
            when {
                f.isDirectory -> f.canonicalPath
                f.parentFile?.isDirectory == true -> f.parentFile.canonicalPath
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }
}
