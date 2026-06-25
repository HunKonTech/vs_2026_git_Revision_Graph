// Stage the shared web renderer bundle into the Visual Studio VSIX project so
// it can be packaged as content (out\webview\). Run after build:webview.
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "packages/graph-webview/dist");
const dst = resolve(root, "vs/webview");

await mkdir(dst, { recursive: true });
for (const f of ["main.js", "main.css"]) {
  await cp(resolve(src, f), resolve(dst, f));
}
console.log("copied webview bundle -> vs/webview/");
