#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${GO_POOL_CONFIG_DIR:-${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}}"
PLUGIN_DIR="$CONFIG_DIR/plugins"
LOADER_PATH="$PLUGIN_DIR/opencode-go-workspace-pool.js"
TARGET_PATH="$ROOT/plugin/index.js"

mkdir -p "$PLUGIN_DIR"

TARGET_PATH="$TARGET_PATH" LOADER_PATH="$LOADER_PATH" node <<'EOF'
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const targetPath = process.env.TARGET_PATH;
const loaderPath = process.env.LOADER_PATH;
const source = `const mod = await import(${JSON.stringify(pathToFileURL(targetPath).href)});
export const OpencodeGoWorkspacePoolPlugin = mod.OpencodeGoWorkspacePoolPlugin ?? mod.default;
export default OpencodeGoWorkspacePoolPlugin;
`;
fs.writeFileSync(loaderPath, source, "utf8");
EOF

echo "Installed plugin loader at $LOADER_PATH"
