// Builds and packages the VS Code extension into a .vsix installer.
// Output: dist/installers/<name>-<version>.vsix
//
// Cross-platform (macOS / Linux / Windows). Uses @vscode/vsce via npx.
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = resolve(root, "vscode");
const outDir = resolve(root, "dist", "installers");
mkdirSync(outDir, { recursive: true });

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

// 1. Build the shared web renderer the extension embeds.
console.log("==> Building shared web renderer");
run("npm", ["run", "build:webview"], root);

// 2. Make the LICENSE available inside the extension package.
const rootLicense = resolve(root, "LICENSE");
if (existsSync(rootLicense)) copyFileSync(rootLicense, resolve(vscodeDir, "LICENSE"));

// 3. Package. --no-dependencies: extension.js is already bundled by esbuild,
//    so no node_modules need to be included.
const pkg = JSON.parse(readFileSync(resolve(vscodeDir, "package.json"), "utf8"));
const outFile = resolve(outDir, `${pkg.name}-${pkg.version}.vsix`);

console.log("==> Packaging VS Code extension");
run("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies", "-o", outFile], vscodeDir);

console.log("\nVS Code installer: " + outFile);
