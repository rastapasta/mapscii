#!/bin/sh
export TERM=xterm-256color
NODE="$(command -v node || command -v nodejs)" || { echo "mapscii requires Node.js >= 18" >&2; exit 127; }
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$NODE" "$SCRIPT_DIR/mapscii.js" "$@"
