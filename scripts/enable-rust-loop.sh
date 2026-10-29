#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
[[ $# == 1 && -d $1 ]] || { echo 'Usage: bash scripts/enable-rust-loop.sh /absolute/path/to/app'; exit 1; }
app=$(cd -- "$1" && pwd -P)
python3 "$ROOT/scripts/enable-rust-loop.py" "$app" "$ROOT"
