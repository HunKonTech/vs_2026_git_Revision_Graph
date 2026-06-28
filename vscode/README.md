# Git Revision Graph

A **TortoiseSVN-style revision graph** for Git inside **VS Code**.
Commits, local & remote branches, and tags are displayed as connected, color-coded boxes.

**▶ [Try the live demo in your browser](https://hunkontech.github.io/vs_2026_git_Revision_Graph/)** — no install required; runs the real renderer on a sample repository.

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
- License: **HunKon Personal Use License v1.0** — free for personal use. For commercial use, please contact [koncsik.benedek.andras@gmail.com](mailto:koncsik.benedek.andras@gmail.com).

---

# Git Revision Graph (Magyar)

Egy **TortoiseSVN-stílusú revíziógraf** Git-hez **VS Code**-on belül.
A commitok, helyi és távoli ágak, valamint tagek összekötött, színkódolt dobozokként jelennek meg.

**▶ [Próbáld ki az élő demót a böngésződben](https://hunkontech.github.io/vs_2026_git_Revision_Graph/)** — telepítés nélkül; a valódi megjelenítő fut egy minta-repozitóriummal.

![Git Revision Graph](https://raw.githubusercontent.com/HunKonTech/git_Revision_Graph/main/RevisionGraph_vs_code.png)

## Megnyitás

Nyiss meg egy mappát vagy munkaterületet, amely egy Git repozitóriumot tartalmaz, majd:

- Nyisd meg a **Parancspalettát** (`Ctrl+Shift+P`) és futtasd a **"Git Revision Graph: Open Revision Graph"** parancsot, vagy
- Kattints a **gráf ikonra** a Forráskezelő panel fejlécében (jobb felső sarok), vagy
- Használd a **`Ctrl+Alt+G`** billentyűparancsot.

## Funkciók

- **DAG elrendezés** — a commitok áganként oszlopokba rendezve, összekötő vonalakkal.
- **Színkódolt csomópontok** — HEAD/aktuális ág (piros), helyi ágak (zöld), távoli ágak (kék), tagek (sárga), sima commitok (szürke).
- **Jobb klikk egy commitra** → *"Ág létrehozása innen…"* — új ágat hoz létre az adott committól a VS Code beépített Git-jén keresztül, majd frissíti a gráfot.
- **Checkout** — commit közvetlen kivétele a gráfból.
- **SHA másolása** bármely commithoz.
- **Nagyítás és mozgatás** a gráf felületén.

## Beállítások

| Beállítás | Alapértelmezett | Leírás |
|---|---|---|
| `revGraph.maxCommits` | `1000` | A gráfba betöltendő commitok maximális száma. |

## Forráskód és licenc

- Forráskód: [https://github.com/HunKonTech/git_Revision_Graph](https://github.com/HunKonTech/git_Revision_Graph)
- Licenc: **HunKon Personal Use License v1.0** — személyes használatra ingyenes. Üzleti célú felhasználás esetén kérlek vedd fel velem a kapcsolatot: [koncsik.benedek.andras@gmail.com](mailto:koncsik.benedek.andras@gmail.com).
