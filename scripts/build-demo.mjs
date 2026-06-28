// Assembles the public, try-it-in-the-browser demo that GitHub Pages serves.
//
// The demo IS the dev harness: the same shared webview bundle (packages/
// graph-webview/dist/main.js + main.css) driven by the same mock GraphData and
// the same fake host that answers every WebviewToHost message. The only
// difference from `npm run harness` is that every asset is referenced with a
// RELATIVE path so it works under the Pages project sub-path
// (https://<user>.github.io/<repo>/), not just at the server root.
//
// Run AFTER `npm run build:webview`. Output: dist/demo/ (index.html, main.js,
// main.css, *.map, mock-data.js, .nojekyll) — upload that folder to Pages.

import { mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webview = resolve(root, "packages/graph-webview");
const src = resolve(webview, "dist");
const harness = resolve(webview, "harness");
const out = resolve(root, "dist/demo");

const mainJs = resolve(src, "main.js");
if (!existsSync(mainJs)) {
  console.error(
    "dist/main.js not found — run `npm run build:webview` before build-demo.",
  );
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Shared renderer bundle + sourcemaps + the harness mock data, verbatim.
for (const f of ["main.js", "main.js.map", "main.css", "main.css.map"]) {
  if (existsSync(resolve(src, f))) await copyFile(resolve(src, f), resolve(out, f));
}
await copyFile(resolve(harness, "mock-data.js"), resolve(out, "mock-data.js"));

// The fake host. Lifted from harness/index.html so the demo answers exactly the
// same messages the local harness does — every menu action gets a response.
const hostScript = `
      // Capture messages the webview sends to the "host" and echo a fake response,
      // so every action (branch, checkout, copy SHA, stash, undo…) does something.
      window.__REV_GRAPH_HARNESS__ = {
        onPost(msg) {
          if (msg.type === "ready" || msg.type === "requestRefresh") {
            window.postMessage({ type: "setData", data: window.__MOCK_GRAPH__ }, "*");
          }
          if (msg.type === "createBranch") {
            const name = prompt("New branch name (from " + msg.sha.slice(0, 7) + "):", "feature/new");
            if (name) window.postMessage({ type: "branchCreated", name, sha: msg.sha }, "*");
          }
          if (msg.type === "checkout") alert("checkout " + (msg.sha || msg.ref));
          if (msg.type === "copySha") navigator.clipboard?.writeText(msg.sha);
          if (msg.type === "undoCommit") window.postMessage({ type: "opResult", op: "undo", result: "ok" }, "*");
          if (msg.type === "stashApply") window.postMessage({ type: "opResult", op: "stashApply", result: "ok" }, "*");
          if (msg.type === "stashPop") window.postMessage({ type: "opResult", op: "stashPop", result: "conflict" }, "*");
          if (msg.type === "stashDrop") window.postMessage({ type: "opResult", op: "stashDrop", result: "ok" }, "*");
        },
      };`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Git Revision Graph — live demo</title>
    <meta name="description" content="Interactive in-browser demo of the TortoiseSVN-style Git Revision Graph for Visual Studio and VS Code." />
    <link rel="stylesheet" href="./main.css" />
    <style>
      /* Non-intrusive ribbon so visitors know this is sample data. */
      #demo-note {
        position: fixed; right: 8px; bottom: 8px; z-index: 9999;
        font: 12px/1.4 system-ui, sans-serif; opacity: .75;
        padding: 4px 8px; border-radius: 6px;
        background: rgba(127,127,127,.18); pointer-events: none;
      }
      #demo-note a { pointer-events: auto; color: inherit; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="demo-note">Demo · sample repository ·
      <a href="https://github.com/HunKonTech/vs_2026_git_Revision_Graph">source</a>
    </div>
    <script src="./mock-data.js"></script>
    <script>${hostScript}
    </script>
    <script src="./main.js"></script>
  </body>
</html>
`;

await writeFile(resolve(out, "index.html"), html, "utf8");
// Skip Jekyll so files/folders are served as-is.
await writeFile(resolve(out, ".nojekyll"), "", "utf8");

console.log(`built demo -> ${out}`);
