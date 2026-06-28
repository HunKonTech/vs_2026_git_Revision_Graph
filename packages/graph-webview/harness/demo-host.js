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

  const handlers = {
    ready: refresh,
    requestRefresh: refresh,

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
