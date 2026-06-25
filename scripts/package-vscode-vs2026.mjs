// Builds a VS Code .vsix specifically targeted for VS 2026's embedded VS Code.
// VS 2026 ships with a VS Code engine >= 1.96 — this package sets the minimum
// accordingly so Marketplace / manual install can distinguish the two artifacts.
//
// Output: dist/installers/rev-graph-vscode-vs2026-<version>.vsix
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = resolve(root, "vscode");
const outDir = resolve(root, "dist", "installers");
mkdirSync(outDir, { recursive: true });

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

/** Recursively copy a directory tree. */
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

// 1. Build the shared web renderer.
console.log("==> Building shared web renderer (VS 2026 variant)");
run("npm", ["run", "build:webview"], root);

// 2. Read base package.json and patch for VS 2026 target.
const basePkg = JSON.parse(readFileSync(resolve(vscodeDir, "package.json"), "utf8"));
const vs2026Pkg = {
  ...basePkg,
  // VS 2026 bundles VS Code engine >= 1.96.
  engines: { vscode: "^1.96.0" },
  // Separate displayName so users can tell the two apart.
  displayName: basePkg.displayName + " (VS 2026)",
  // Remove the prepublish script: the bundle is already built; vsce must not
  // try to execute build.mjs from the temp directory.
  scripts: {},
};

// 3. Stage into a temp directory with the patched package.json.
const tmpDir = resolve(tmpdir(), "rev-graph-vs2026-" + Date.now());
mkdirSync(tmpDir, { recursive: true });

for (const entry of ["out", "media", "icons"]) {
  const src = resolve(vscodeDir, entry);
  if (existsSync(src)) copyDir(src, resolve(tmpDir, entry));
}
for (const file of [".vscodeignore", "README.md"]) {
  const src = resolve(vscodeDir, file);
  if (existsSync(src)) copyFileSync(src, resolve(tmpDir, file));
}
const rootLicense = resolve(root, "LICENSE");
if (existsSync(rootLicense)) copyFileSync(rootLicense, resolve(tmpDir, "LICENSE"));

writeFileSync(resolve(tmpDir, "package.json"), JSON.stringify(vs2026Pkg, null, 2), "utf8");

// 4. Package from tmpDir.
// --skip-license: license is already copied; --no-dependencies: bundle is pre-built;
// --skip-vscode-version: engine version is set explicitly in the patched package.json.
// We pass the prepublish script as a no-op to avoid vsce trying to run build.mjs.
const outFile = resolve(outDir, `rev-graph-vscode-vs2026-${basePkg.version}.vsix`);
console.log("==> Packaging VS Code extension for VS 2026");
run("npx", ["--yes", "@vscode/vsce", "package",
  "--no-dependencies",
  "--no-git-tag-version",
  "--skip-license",
  "--pre-release",                // mark as prerelease — VS 2026 is still in preview
  "-o", outFile,
], tmpDir);

console.log("\nVS 2026 VS Code installer: " + outFile);
