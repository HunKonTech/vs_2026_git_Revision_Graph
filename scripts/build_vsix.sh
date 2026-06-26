#!/usr/bin/env bash
# Builds the VS Code extension and packages it as a .vsix file into dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="$ROOT/vscode"
OUT_DIR="$ROOT/dist"

mkdir -p "$OUT_DIR"

echo "==> Building protocol + graph-core"
npx tsc -b "$ROOT/packages/protocol" "$ROOT/packages/graph-core"

echo "==> Building graph-webview"
npm run --prefix "$ROOT" build:webview

echo "==> Building VS Code extension"
npm run --prefix "$ROOT" build:vscode

# Copy root LICENSE into the extension package directory
if [ -f "$ROOT/LICENSE" ]; then
  cp "$ROOT/LICENSE" "$VSCODE_DIR/LICENSE"
fi

# Read name and version from vscode/package.json
PKG_NAME=$(node -p "require('$VSCODE_DIR/package.json').name")
PKG_VERSION=$(node -p "require('$VSCODE_DIR/package.json').version")
OUT_FILE="$OUT_DIR/${PKG_NAME}-${PKG_VERSION}.vsix"

echo "==> Packaging VSIX → $OUT_FILE"
(cd "$VSCODE_DIR" && npx --yes @vscode/vsce package --no-dependencies -o "$OUT_FILE")

echo ""
echo "Done: $OUT_FILE"
