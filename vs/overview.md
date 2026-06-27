# Git Revision Graph

A **TortoiseSVN-style revision graph** for Git inside **Visual Studio 2022 and 2026**.
Commits, local & remote branches, and tags are displayed as connected, color-coded boxes — just like SVN's classic revision graph.

![Git Revision Graph in VS Code](https://raw.githubusercontent.com/HunKonTech/git_Revision_Graph/main/RevisionGraph_vs_code.png)

## How to open

1. Open a folder or solution that is inside a Git repository.
2. Go to **View → Other Windows → Revision Graph**.

The graph loads automatically and shows the full commit DAG of the current repository.

## Features

- **DAG layout** — commits arranged in columns per branch with connecting lines.
- **Color-coded nodes** — HEAD/current branch (red), local branches (green), remote branches (blue), tags (yellow), plain commits (grey).
- **Right-click a commit** → *"Create branch from here…"* — creates a new branch at that commit using the native Git CLI, then refreshes the graph.
- **Checkout** a commit directly from the graph.
- **Copy SHA** of any commit.
- **Zoom & pan** the graph canvas.

## Source code & license

- Source code: [https://github.com/HunKonTech/git_Revision_Graph](https://github.com/HunKonTech/git_Revision_Graph)
- License: **HunKon Personal Use License v1.0** — free for personal use.
