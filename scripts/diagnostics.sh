#!/usr/bin/env bash
set -uo pipefail
source "$(cd -- "$(dirname -- "$0")/.." && pwd)/lib/common.sh"
set +e  # Collect later diagnostics even when an earlier command fails.
STATE="$HOME/.local/share/qwen-bootstrap"
mkdir -p "$STATE/logs"
umask 077
out="$STATE/logs/diagnostics-$(date -u +%Y%m%dT%H%M%SZ).txt"
{
 date -u; uname -a; cat /etc/os-release
 nvidia-smi; free -h; df -h; node --version
 "$HOME/.cargo/bin/rustc" --version
 docker version
 docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.State.Error}}' qwen-coder
 docker logs --tail 300 qwen-coder
} > "$out" 2>&1
printf 'Saved %s. Review prompts/paths in logs before sharing. API key and container environment are excluded.\n' "$out"
