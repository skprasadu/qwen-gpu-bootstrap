#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "$0")/.." && pwd)/lib/common.sh"
STATE="$HOME/.local/share/qwen-bootstrap"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
[[ -f "$STATE/opencode.json" ]] || fail 'Run stage 2 first.'
# Isolate from the user's global config and run only inside a disposable directory.
SMOKE=$(mktemp -d "$STATE/smoke-XXXXXXXX")
mkdir -p "$SMOKE/xdg"
export XDG_CONFIG_HOME="$SMOKE/xdg"
export XDG_DATA_HOME="$SMOKE/xdg-data"
export XDG_CACHE_HOME="$SMOKE/xdg-cache"
export XDG_STATE_HOME="$SMOKE/xdg-state"
export OPENCODE_CONFIG="$STATE/opencode.json"
export OPENCODE_PERMISSION
OPENCODE_PERMISSION=$(python3 -c 'import json,sys; print(json.dumps({"*":"allow","external_directory":{"*":"deny",sys.argv[1]+"/*":"allow"}}))' "$SMOKE")
export PYTHONDONTWRITEBYTECODE=1
cd "$SMOKE"
printf 'def add(a, b):\n    return a - b\n' > calc.py
printf 'from calc import add\nassert add(2, 3) == 5\nassert add(-1, 1) == 0\nprint("repair verified")\n' > verify.py
if python3 verify.py > baseline.log 2>&1; then fail 'Broken fixture unexpectedly passed.'; fi
timeout 300 opencode run --agent build --format json -m local/qwen3-coder-next \
 'Use your file editing tool to create hello.txt with exactly TOOL_EDIT_OK followed by a newline. Do not use shell redirection or Python to create it.' > edit.jsonl 2>edit.stderr
python3 "$ROOT/scripts/verify-events.py" edit.jsonl edit
python3 -c 'from pathlib import Path; assert Path("hello.txt").read_bytes() == b"TOOL_EDIT_OK\n", "Incorrect file content"'
timeout 300 opencode run --agent build --format json -m local/qwen3-coder-next \
 'Run python3 verify.py to observe the failing test. Read calc.py and verify.py, fix only calc.py using a file editing tool, then run python3 verify.py again to prove the repair. Do not modify verify.py.' > repair.jsonl 2>repair.stderr
python3 "$ROOT/scripts/verify-events.py" repair.jsonl repair
printf 'from calc import add\nassert add(2, 3) == 5\nassert add(-1, 1) == 0\nprint("repair verified")\n' > expected-verify.py
cmp verify.py expected-verify.py
python3 verify.py
printf 'PASS: real OpenCode edit and repair. Evidence: %s\n' "$SMOKE"
