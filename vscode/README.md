# Git Revision Graph

A TortoiseSVN-style **revision graph** for Git inside VS Code. Commits, local &
remote branches, and tags are drawn as connected, color-coded boxes.

## Features
- DAG view with a column-per-branch layout, zoom & pan.
- Local and remote branches, tags, and the current HEAD, color-coded.
- **Right-click a commit → "Create branch from here…"** — creates a branch
  seeded at that commit using VS Code's built-in Git, then refreshes.
- Checkout a commit, copy its SHA.

## Usage
Open a folder that is a Git repository, then run **"Git Revision Graph: Open
Revision Graph"** from the Command Palette, or use the button in the Source
Control title bar.

## Settings
- `revGraph.maxCommits` — maximum commits to load (default `1000`).
