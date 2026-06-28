import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cp, mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

// Copy the shared webview bundle into the extension's media folder so it ships
// inside the VSIX. graph-webview must be built first (npm run build:webview).
async function copyWebview() {
  const src = resolve(__dirname, "../packages/graph-webview/dist");
  const dst = resolve(__dirname, "media");
  await mkdir(dst, { recursive: true });
  for (const f of ["main.js", "main.css"]) {
    await cp(resolve(src, f), resolve(dst, f));
  }
  // Generated schematic .svg files (kept in sync with the inlined previews).
  await cp(resolve(src, "schematics"), resolve(dst, "schematics"), { recursive: true });
  console.log("copied webview bundle -> media/");
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(__dirname, "src/extension.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  outfile: resolve(__dirname, "out/extension.js"),
  sourcemap: true,
  logLevel: "info",
};

await copyWebview();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching vscode extension…");
} else {
  await esbuild.build(options);
}
