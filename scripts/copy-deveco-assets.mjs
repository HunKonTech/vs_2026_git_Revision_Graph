// Stage the shared web renderer bundle into the DevEco Studio (IntelliJ
// Platform) plugin project so it can be packaged as a resource
// (deveco/src/main/resources/webview/). Run after build:webview.
// Mirrors scripts/copy-vs-assets.mjs.
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "packages/graph-webview/dist");
const dst = resolve(root, "deveco/src/main/resources/webview");

// index.html is a static file checked into deveco/ itself (like
// vs/webview/index.html) — only the built bundle is copied here.
await mkdir(dst, { recursive: true });
for (const f of ["main.js", "main.css"]) {
  await cp(resolve(src, f), resolve(dst, f));
}
await cp(resolve(src, "schematics"), resolve(dst, "schematics"), { recursive: true });
console.log("copied webview bundle -> deveco/src/main/resources/webview/");
