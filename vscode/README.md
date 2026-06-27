# Git Revision Graph

A **TortoiseSVN-style revision graph** for Git inside **VS Code**.
Commits, local & remote branches, and tags are displayed as connected, color-coded boxes.

![Git Revision Graph](https://raw.githubusercontent.com/HunKonTech/git_Revision_Graph/main/RevisionGraph_vs_code.png)

## How to open

Open a folder or workspace that contains a Git repository, then either:

- Open the **Command Palette** (`Ctrl+Shift+P`) and run **"Git Revision Graph: Open Revision Graph"**, or
- Click the **graph icon** in the Source Control title bar (top-right of the SCM panel), or
- Use the keyboard shortcut **`Ctrl+Alt+G`**.

## Features

- **DAG layout** — commits arranged in columns per branch with connecting lines.
- **Color-coded nodes** — HEAD/current branch (red), local branches (green), remote branches (blue), tags (yellow), plain commits (grey).
- **Right-click a commit** → *"Create branch from here…"* — creates a new branch at that commit using VS Code's built-in Git, then refreshes the graph.
- **Checkout** a commit directly from the graph.
- **Copy SHA** of any commit.
- **Zoom & pan** the graph canvas.

## Settings

| Setting | Default | Description |
|---|---|---|
| `revGraph.maxCommits` | `1000` | Maximum number of commits to load into the graph. |

## Source code & license

- Source code: [https://github.com/HunKonTech/git_Revision_Graph](https://github.com/HunKonTech/git_Revision_Graph)
- License: **HunKon Personal Use License v1.0** — free for personal use.
