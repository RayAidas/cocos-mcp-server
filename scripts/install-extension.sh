#!/usr/bin/env bash
#
# Install the cc-mcp extension into a Cocos Creator project.
#
# Usage:
#   ./scripts/install-extension.sh /path/to/your/cocos-project [--link]
#
# With --link, the extension is symlinked (edits to this repo are reflected in
# the project); without it, the extension is copied.
#
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 /path/to/cocos-project [--link]" >&2
  exit 1
fi

PROJECT="$1"
MODE="copy"
[ "${2:-}" = "--link" ] && MODE="link"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/../extension" && pwd)"

if [ ! -f "$PROJECT/package.json" ]; then
  echo "error: $PROJECT does not look like a Cocos Creator project (no package.json)" >&2
  exit 1
fi

DEST="$PROJECT/extensions/cc-mcp"
mkdir -p "$PROJECT/extensions"

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  rm -rf "$DEST"
fi

if [ "$MODE" = "link" ]; then
  ln -s "$SRC" "$DEST"
  echo "linked: $DEST -> $SRC"
else
  cp -R "$SRC" "$DEST"
  echo "copied: $SRC -> $DEST"
fi

MCP_CFG="$PROJECT/.cc-mcp.json"
if [ ! -f "$MCP_CFG" ]; then
  cp "$SCRIPT_DIR/../examples/cc-mcp.project.json" "$MCP_CFG"
  echo "created: $MCP_CFG (fixed port 32123, strictPort)"
else
  echo "keep existing: $MCP_CFG"
fi

cat <<'EOF'

Next steps:
  1. In Cocos Creator, open the project.
  2. Menu: Extension -> Extension Manager -> reload (or restart the editor).
  3. The extension reads .cc-mcp.json in the project root (default port 32123, strictPort).
     Check http://127.0.0.1:32123/health — if the port differs, see the [cc-mcp] log line.
  4. Point your MCP client at the cocos-mcp server (see docs/setup.md).
EOF
