#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
[[ $# == 1 ]] || { echo 'Usage: ./scripts/new-app.sh /absolute/path/to/new-app'; exit 1; }
[[ $1 == /* ]] || { echo 'Use an absolute path.'; exit 1; }
[[ ! -e $1 ]] || { echo 'Destination already exists; refusing to overwrite.'; exit 1; }
STATE="$HOME/.local/share/qwen-bootstrap"
[[ -f "$STATE/opencode.json" ]] || { echo 'Run stage 2 first.'; exit 1; }
mkdir -p -- "$1"
cp "$ROOT/AGENTS.md" "$1/AGENTS.md"
cp "$STATE/opencode.json" "$1/opencode.json"
printf '.env\n.env.*\nnode_modules/\ntarget/\n.rust-loop/\n' > "$1/.gitignore"
git -C "$1" init
printf 'Created %s. Open this folder in Remote SSH and run opencode.\n' "$1"
