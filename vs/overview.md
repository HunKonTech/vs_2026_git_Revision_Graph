# Git Revision Graph

A **TortoiseSVN-style revision graph** for Git inside **Visual Studio 2022 and 2026**.
Commits, local & remote branches, and tags are displayed as connected, color-coded boxes — just like SVN's classic revision graph.

**▶ [Try the live demo in your browser](https://hunkontech.github.io/git_Revision_Graph/)** — no install required; runs the real renderer on a sample repository.

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
- License: **HunKon Personal Use License v1.0** — free for personal use. For commercial use, please contact [koncsik.benedek.andras@gmail.com](mailto:koncsik.benedek.andras@gmail.com).

---

# Git Revision Graph (Magyar)

Egy **TortoiseSVN-stílusú revíziógraf** Git-hez **Visual Studio 2022 és 2026** számára.
A commitok, helyi és távoli ágak, valamint tagek összekötött, színkódolt dobozokként jelennek meg — pont úgy, mint az SVN klasszikus revíziógrafja.

**▶ [Próbáld ki az élő demót a böngésződben](https://hunkontech.github.io/git_Revision_Graph/)** — telepítés nélkül; a valódi megjelenítő fut egy minta-repozitóriummal.

![Git Revision Graph](https://raw.githubusercontent.com/HunKonTech/git_Revision_Graph/main/RevisionGraph_vs_code.png)

## Megnyitás

1. Nyiss meg egy mappát vagy megoldást, amely egy Git repozitóriumon belül van.
2. Lépj a **Nézet → Egyéb ablakok → Revision Graph** menüpontba.

A gráf automatikusan betölti az aktuális repozitórium teljes commit-fáját.

## Funkciók

- **DAG elrendezés** — a commitok áganként oszlopokba rendezve, összekötő vonalakkal.
- **Színkódolt csomópontok** — HEAD/aktuális ág (piros), helyi ágak (zöld), távoli ágak (kék), tagek (sárga), sima commitok (szürke).
- **Jobb klikk egy commitra** → *"Ág létrehozása innen…"* — új ágat hoz létre az adott committól a natív Git CLI-vel, majd frissíti a gráfot.
- **Checkout** — commit közvetlen kivétele a gráfból.
- **SHA másolása** bármely commithoz.
- **Nagyítás és mozgatás** a gráf felületén.

## Forráskód és licenc

- Forráskód: [https://github.com/HunKonTech/git_Revision_Graph](https://github.com/HunKonTech/git_Revision_Graph)
- Licenc: **HunKon Personal Use License v1.0** — személyes használatra ingyenes. Üzleti célú felhasználás esetén kérlek vedd fel velem a kapcsolatot: [koncsik.benedek.andras@gmail.com](mailto:koncsik.benedek.andras@gmail.com).
