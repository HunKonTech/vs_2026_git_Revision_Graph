// Stateful fake host for the dev harness AND the public GitHub Pages demo.
//
// Instead of throwing away the webview's messages (the old harness just popped
// an alert), this keeps a *mutable* copy of the mock GraphData and edits it in
// response to each WebviewToHost message, then re-sends `setData`. The result:
// checkout, create/delete/rename branch, reword, undo, stash and push all
// visibly change the graph — fully simulated in the browser, no real git.
//
// Location-agnostic: it only reads/writes window globals, so the same file works
// from the harness (absolute paths) and the demo (relative paths). Requires
// window.__MOCK_GRAPH__ to be loaded first.
(function () {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let state = clone(window.__MOCK_GRAPH__);

  const send = (msg) => window.postMessage(msg, "*");
  const refresh = () => send({ type: "setData", data: clone(state) });

  const findLocal = (name) =>
    state.refs.find((r) => r.type === "localBranch" && r.name === name);
  const findRemote = (name) =>
    state.refs.find((r) => r.type === "remoteBranch" && r.name === name);

  // Make `name` (a local branch) the current checkout, or go detached at `sha`
  // when no branch is named. Keeps GraphData.head and the HEAD-type ref in sync.
  function setCurrent(name, sha) {
    state.refs.forEach((r) => {
      if (r.type === "localBranch") r.isCurrent = false;
    });
    const b = name ? findLocal(name) : null;
    if (b) {
      b.isCurrent = true;
      state.head = b.targetSha;
    } else if (sha) {
      state.head = sha; // detached HEAD
    }
    const headRef = state.refs.find((r) => r.type === "head");
    if (headRef) headRef.targetSha = state.head;
  }

  // Commits reachable from a tip (the tip + all ancestors), by walking parents.
  function reachable(tipSha) {
    const byId = new Map(state.commits.map((c) => [c.sha, c]));
    const seen = new Set();
    const stack = [tipSha];
    while (stack.length) {
      const sha = stack.pop();
      if (!sha || seen.has(sha)) continue;
      seen.add(sha);
      const c = byId.get(sha);
      if (c) for (const p of c.parents) stack.push(p);
    }
    return seen;
  }

  // The current local branch — the merge target.
  const currentBranchName = () =>
    (state.refs.find((r) => r.type === "localBranch" && r.isCurrent) || {}).name;

  const handlers = {
    ready: refresh,
    requestRefresh: refresh,

    // Simulate the dry-run merge preview from the mock graph + mock per-commit
    // changes: collect the files the source-only commits touched, and flag a file
    // as a conflict when a target-only commit also touched it.
    requestMergePreview(msg) {
      const target = currentBranchName() || "HEAD";
      const src = findLocal(msg.source) || findRemote(msg.source);
      const base = {
        source: msg.source,
        target,
        upToDate: false,
        canFastForward: false,
        files: [],
        conflicts: [],
        defaultMessage:
          "Merge branch '" + msg.source + "'" + (target !== "HEAD" ? " into " + target : ""),
      };
      const tgt = state.refs.find((r) => r.type === "localBranch" && r.isCurrent);
      if (!src || !tgt) {
        send({ type: "mergePreview", preview: Object.assign(base, { error: "Branch not found." }) });
        return;
      }
      const srcReach = reachable(src.targetSha);
      const tgtReach = reachable(tgt.targetSha);
      if (tgtReach.has(src.targetSha)) {
        // source already contained in target → up to date.
        send({ type: "mergePreview", preview: Object.assign(base, { upToDate: true }) });
        return;
      }
      const canFastForward = srcReach.has(tgt.targetSha); // target is an ancestor of source
      const changes = window.__MOCK_CHANGES__ || {};
      const mapStatus = (s) => (s === "renamed" ? "modified" : s);
      // Paths touched by commits unique to the target side (for conflict flagging).
      const targetTouched = new Set();
      for (const sha of tgtReach) {
        if (srcReach.has(sha)) continue;
        for (const f of changes[sha] || []) targetTouched.add(f.path);
      }
      // Files introduced by commits unique to the source side.
      const byPath = new Map();
      for (const sha of srcReach) {
        if (tgtReach.has(sha)) continue;
        for (const f of changes[sha] || []) byPath.set(f.path, mapStatus(f.status));
      }
      const conflicts = [];
      const files = [];
      for (const [path, status] of byPath) {
        const isConflict = targetTouched.has(path);
        if (isConflict) conflicts.push(path);
        files.push({ path, status: isConflict ? "conflict" : status });
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      send({ type: "mergePreview", preview: Object.assign(base, { canFastForward, files, conflicts }) });
    },

    // Serve a per-file merge diff for the merge dialog's right pane. Reuses the
    // mock per-commit changes; a conflicted file is shown with conflict markers so
    // the demo mirrors what the real host produces from the merged tree.
    requestMergeFileDiff(msg) {
      const changes = window.__MOCK_CHANGES__ || {};
      let found = null;
      for (const sha of Object.keys(changes)) {
        const f = (changes[sha] || []).find((x) => x.path === msg.path);
        if (f) { found = f; break; }
      }
      const status = msg.status;
      const oldText = found ? found.oldText || "" : "";
      let newText = found ? found.newText || "" : "";
      if (status === "conflict") {
        const target = currentBranchName() || "HEAD";
        newText =
          "<<<<<<< " + target + "\n" + oldText +
          "=======\n" + (found ? found.newText || "" : "") +
          ">>>>>>> " + msg.source + "\n";
      }
      const diffStatus = status === "added" ? "added" : status === "deleted" ? "deleted" : "modified";
      send({
        type: "mergeFileDiff",
        diff: {
          sha: "",
          path: msg.path,
          status: diffStatus,
          oldText: status === "added" ? "" : oldText,
          newText: status === "deleted" ? "" : newText,
          binary: !!(found && found.binary),
        },
      });
    },

    // Simulate the merge: fast-forward the current branch, or synthesize a merge
    // commit, then refresh and report success.
    merge(msg) {
      const tgt = state.refs.find((r) => r.type === "localBranch" && r.isCurrent);
      const src = findLocal(msg.source) || findRemote(msg.source);
      if (!tgt || !src) {
        send({ type: "opResult", op: "merge", result: "error", detail: "Branch not found." });
        return;
      }
      const srcReach = reachable(src.targetSha);
      const tgtReach = reachable(tgt.targetSha);
      if (tgtReach.has(src.targetSha)) {
        send({ type: "opResult", op: "merge", result: "ok" }); // already up to date
        return;
      }
      const canFF = srcReach.has(tgt.targetSha);
      if (canFF && !msg.noFastForward) {
        tgt.targetSha = src.targetSha; // fast-forward
      } else {
        const sha = "m" + Math.floor(performance.now()).toString(16).padStart(6, "0").slice(-7);
        state.commits.unshift({
          sha,
          parents: [tgt.targetSha, src.targetSha],
          summary: (msg.message || "Merge branch '" + msg.source + "'").split("\n")[0],
          author: "You",
          authorEmail: "you@example.com",
          date: new Date().toISOString(),
        });
        tgt.targetSha = sha;
      }
      setCurrent(tgt.name);
      refresh();
      send({ type: "opResult", op: "merge", result: "ok" });
    },

    checkout(msg) {
      const ref = msg.ref;
      if (ref && findLocal(ref)) {
        setCurrent(ref);
      } else if (ref && findRemote(ref)) {
        // Mimic `git switch <remote-branch>`: create/advance the local tracking
        // branch (name without the remote prefix) and check it out.
        const remote = findRemote(ref);
        const local = ref.replace(/^[^/]+\//, "");
        if (findLocal(local)) findLocal(local).targetSha = remote.targetSha;
        else
          state.refs.push({
            name: local,
            type: "localBranch",
            targetSha: remote.targetSha,
          });
        setCurrent(local);
      } else {
        setCurrent(null, msg.sha); // detached checkout of a bare commit
      }
      refresh();
    },

    createBranch(msg) {
      const name =
        msg.name ??
        prompt("New branch name (from " + msg.sha.slice(0, 7) + "):", "feature/new");
      if (!name) return;
      if (!findLocal(name))
        state.refs.push({ name, type: "localBranch", targetSha: msg.sha });
      if (msg.checkout) setCurrent(name);
      // Mirrors the real host: report success, then the webview asks to refresh.
      send({ type: "branchCreated", name, sha: msg.sha });
    },

    deleteBranch(msg) {
      // A checked-out branch can't be deleted; fall back to its target first.
      const b = findLocal(msg.name);
      if (b && b.isCurrent) {
        const other = state.refs.find(
          (r) => r.type === "localBranch" && r.name !== msg.name,
        );
        if (other) setCurrent(other.name);
        else setCurrent(null, b.targetSha);
      }
      state.refs = state.refs.filter(
        (r) => !(r.type === "localBranch" && r.name === msg.name),
      );
      refresh();
    },

    renameBranch(msg) {
      const b = findLocal(msg.name);
      if (!b) return;
      const next = prompt("Rename branch:", msg.name);
      if (next && next !== msg.name) {
        b.name = next;
        refresh();
      }
    },

    renameCommit(msg) {
      const c = state.commits.find((x) => x.sha === msg.sha);
      if (!c) return;
      const next = prompt("Reword commit message:", c.summary);
      if (next && next !== c.summary) {
        c.summary = next;
        refresh();
      }
    },

    undoCommit(msg) {
      // Move any ref/HEAD on this commit back to its first parent, and drop the
      // commit when nothing else points at it — a soft "undo last commit".
      const c = state.commits.find((x) => x.sha === msg.sha);
      const parent = c && c.parents[0];
      if (parent) {
        state.refs.forEach((r) => {
          if (r.targetSha === msg.sha) r.targetSha = parent;
        });
        if (state.head === msg.sha) state.head = parent;
        const stillReffed = state.refs.some((r) => r.targetSha === msg.sha);
        const isParent = state.commits.some((x) => x.parents.includes(msg.sha));
        if (!stillReffed && !isParent)
          state.commits = state.commits.filter((x) => x.sha !== msg.sha);
        refresh();
      }
      send({ type: "opResult", op: "undo", result: "ok" });
    },

    stashApply() {
      send({ type: "opResult", op: "stashApply", result: "ok" });
    },
    stashPop() {
      send({ type: "opResult", op: "stashPop", result: "conflict" });
    },
    stashDrop(msg) {
      state.stashes = (state.stashes || []).filter((s) => s.index !== msg.index);
      refresh();
      send({ type: "opResult", op: "stashDrop", result: "ok" });
    },

    pushBranch(msg) {
      const b = findLocal(msg.name);
      if (!b) return;
      const rn = "origin/" + msg.name;
      const ex = findRemote(rn);
      if (ex) ex.targetSha = b.targetSha;
      else
        state.refs.push({
          name: rn,
          type: "remoteBranch",
          targetSha: b.targetSha,
          remote: "origin",
        });
      refresh();
    },

    copySha(msg) {
      navigator.clipboard?.writeText(msg.sha);
    },

    setGitPath(msg) {
      // No real git in the browser demo — just log so developers can verify the
      // message is reaching the (simulated) host.
      console.log("[demo] setGitPath:", msg.path ?? "(builtin)");
    },

    // Serve the hand-authored mock changes for the "View changes…" dialog. The
    // real hosts compute these from git; here they come from window.__MOCK_CHANGES__.
    requestCommitChanges(msg) {
      const list = (window.__MOCK_CHANGES__ || {})[msg.sha] || [];
      send({
        type: "commitChanges",
        sha: msg.sha,
        files: list.map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status })),
      });
    },

    requestFileDiff(msg) {
      const list = (window.__MOCK_CHANGES__ || {})[msg.sha] || [];
      const f = list.find((x) => x.path === msg.path);
      const diff = f
        ? {
            sha: msg.sha,
            path: f.path,
            status: f.status,
            oldText: f.oldText || "",
            newText: f.newText || "",
            binary: !!f.binary,
          }
        : { sha: msg.sha, path: msg.path, status: msg.status, oldText: "", newText: "" };
      send({ type: "fileDiff", diff });
    },

    // Return all paths seen across all mock commit changes as the "tree".
    requestCommitTree(msg) {
      const allChanges = window.__MOCK_CHANGES__ || {};
      const seen = new Set();
      for (const sha of Object.keys(allChanges)) {
        for (const f of allChanges[sha] || []) seen.add(f.path);
      }
      const paths = Array.from(seen).sort();
      send({ type: "commitTree", sha: msg.sha, paths });
    },

    // Return mock file content for unchanged files in the "All Files" tab.
    requestFileContent(msg) {
      const allChanges = window.__MOCK_CHANGES__ || {};
      let text = "";
      for (const sha of Object.keys(allChanges)) {
        const f = (allChanges[sha] || []).find((x) => x.path === msg.path);
        if (f && f.newText) { text = f.newText; break; }
        if (f && f.oldText) { text = f.oldText; break; }
      }
      if (!text) text = "// " + msg.path + "\n// (no mock content available in the demo)";
      send({ type: "fileContent", sha: msg.sha, path: msg.path, text });
    },

    // Remote ops have no server in the demo — no-ops.
    fetch() {},
    pull() {},
    push() {},
    sync() {},
  };

  window.__REV_GRAPH_HARNESS__ = {
    onPost(msg) {
      const h = handlers[msg.type];
      if (h) h(msg);
    },
  };
})();
