#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
LAB="$ROOT/app-lab"
# Transient system services do not necessarily inherit the login environment.
APP_LAB_HOME=${HOME:-}
if [[ -z "$APP_LAB_HOME" ]]; then
  if [[ $(id -u) == 0 ]]; then APP_LAB_HOME=/root
  else APP_LAB_HOME=$(getent passwd "$(id -u)" | cut -d: -f6); fi
fi
[[ "$APP_LAB_HOME" == /* ]] || { echo 'Cannot resolve an absolute account home directory.' >&2; exit 1; }
export PATH="${APP_LAB_HOME}/.local/bin:${APP_LAB_HOME}/.cargo/bin:$PATH"
export P2I_STATE="${P2I_STATE:-/home/user/my-applications/p2i-app-lab-state}"
export P2I_IMAGE="${P2I_IMAGE:-p2i-app-lab:local}"
export P2I_MODEL_CONTAINER="${P2I_MODEL_CONTAINER:-qwen-coder}"
export P2I_OPENCODE_CONFIG="${P2I_OPENCODE_CONFIG:-${APP_LAB_HOME}/.local/share/qwen-bootstrap/opencode.json}"
action=${1:-status}
shift || true
case "$action" in
 setup)
  [[ $(id -u) == 0 && $(uname -s) == Linux ]] || { echo 'Setup runs as root on the Ubuntu GPU VM.' >&2; exit 1; }
  node -e 'if(process.versions.node.split(".")[0]!=="24")throw Error("Use the existing Node 24 toolchain")'
  docker info >/dev/null
  [[ -f "$P2I_OPENCODE_CONFIG" ]] || { echo 'Set P2I_OPENCODE_CONFIG to the working local provider configuration.' >&2; exit 1; }
  mkdir -p "$P2I_STATE/private" "$P2I_STATE/template-check"
  chmod 700 "$P2I_STATE" "$P2I_STATE/private"
  npm --prefix "$LAB" ci
  npm --prefix "$LAB" run typecheck
  npm --prefix "$LAB" test
  source "$ROOT/versions.env"
  docker build --build-arg "OPENCODE_VERSION=$OPENCODE_VERSION" -f "$LAB/docker/Dockerfile" -t "$P2I_IMAGE" "$ROOT"
  docker run --rm --network none --read-only --user 0 --shm-size 1g --tmpfs /tmp:rw,exec,size=6g \
    -v "$P2I_STATE/template-check:/evidence" "$P2I_IMAGE" /opt/lab/docker/template-check.sh
  node "$LAB/src/preview-check.ts"
  echo 'Setup and actual container template checks passed. Run: bash scripts/app-lab.sh up'
  ;;
 up)
  [[ $(id -u) == 0 ]] || { echo 'Run as root on the GPU VM.' >&2; exit 1; }
  unit=/etc/systemd/system/p2i-app-lab.service
  if [[ -f "$unit" ]] && ! grep -q '# Managed by P2I App Lab' "$unit"; then echo 'Refusing to replace an unrelated systemd unit.' >&2; exit 1; fi
  for value in "$LAB" "$P2I_STATE" "$P2I_IMAGE" "$P2I_OPENCODE_CONFIG" "$P2I_MODEL_CONTAINER" "$APP_LAB_HOME"; do [[ "$value" != *$'\n'* && "$value" != *'"'* ]] || { echo 'Unsupported quote/newline in configuration path.' >&2; exit 1; }; done
  cat > "$unit" <<EOF
# Managed by P2I App Lab
[Unit]
Description=P2I App Lab controller
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=simple
User=root
WorkingDirectory=$LAB
Environment="HOME=$APP_LAB_HOME"
Environment="PATH=$PATH"
Environment="P2I_STATE=$P2I_STATE"
Environment="P2I_IMAGE=$P2I_IMAGE"
Environment="P2I_MODEL_CONTAINER=$P2I_MODEL_CONTAINER"
Environment="P2I_OPENCODE_CONFIG=$P2I_OPENCODE_CONFIG"
ExecStart="$(command -v node)" "$LAB/src/server.ts"
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable p2i-app-lab.service
  systemctl restart p2i-app-lab.service
  for ((i=0;i<30;i++)); do if curl -fsS --max-time 2 http://127.0.0.1:5173/api/runs >/dev/null; then echo 'App Lab: forward 5173 and previews 5174–5176 in VS Code.'; exit 0; fi; sleep 1; done
  journalctl -u p2i-app-lab -n 40 --no-pager
  exit 1
  ;;
 status) systemctl status p2i-app-lab --no-pager; ;;
 logs) journalctl -u p2i-app-lab -f; ;;
 stop) systemctl stop p2i-app-lab; node "$LAB/src/cleanup.ts"; ;;
 qualify) node "$LAB/src/qualify.ts" "$@"; ;;
 tune|tune-restore)
  # Require a reachable, idle controller before taking it offline.
  node --input-type=module -e 'const r=await fetch("http://127.0.0.1:5173/api/runs"); if(!r.ok)throw Error("Dashboard unavailable"); const d=await r.json(); if(d.runs.some(r=>r.state==="running"))throw Error("Wait for the current run to finish before tuning")'
  systemd-run --unit=p2i-app-lab-tune --collect --property="WorkingDirectory=$ROOT" \
    --setenv="HOME=$APP_LAB_HOME" --setenv="PATH=$PATH" --setenv="P2I_STATE=$P2I_STATE" --setenv="P2I_IMAGE=$P2I_IMAGE" \
    --setenv="P2I_OPENCODE_CONFIG=$P2I_OPENCODE_CONFIG" --setenv="P2I_MODEL_CONTAINER=$P2I_MODEL_CONTAINER" \
    /bin/bash "$ROOT/scripts/app-lab.sh" tune-worker "$action"
  echo 'Tuning continues after SSH disconnect. Logs: journalctl -fu p2i-app-lab-tune'
  ;;
 tune-worker)
  systemctl stop p2i-app-lab
  trap 'bash "$ROOT/scripts/app-lab.sh" up' EXIT
  if [[ ${1:-} == tune-restore ]]; then node "$LAB/src/tune.ts" --restore;
  else node "$LAB/src/tune.ts"; fi
  node "$LAB/src/qualify.ts"
  ;;
 rollback) systemctl stop p2i-app-lab; node "$LAB/src/cleanup.ts"; node "$LAB/src/qualify.ts" --rollback; ;;
 benchmark)
  systemd-run --unit=p2i-app-lab-benchmark --collect --property="WorkingDirectory=$LAB" \
    --setenv="HOME=$APP_LAB_HOME" --setenv="PATH=$PATH" --setenv="P2I_STATE=$P2I_STATE" "$(command -v node)" "$LAB/src/benchmark.ts"
  echo 'Comparison continues after SSH disconnect. Logs: journalctl -fu p2i-app-lab-benchmark'
  ;;
 *) echo 'Usage: bash scripts/app-lab.sh setup|up|status|logs|stop|qualify [--enable-two]|benchmark|tune|tune-restore|rollback' >&2; exit 2;;
esac
