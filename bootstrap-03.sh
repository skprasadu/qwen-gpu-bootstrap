#!/usr/bin/env bash
# Run on your rented VM after the existing stages 01 and 02 have passed.
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
[[ $(id -u) == 0 ]] || fail 'Run bootstrap-03.sh directly from your root SSH login.'
export HOME=/root
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export P2I_STATE="${P2I_STATE:-/home/user/my-applications/p2i-app-lab-state}"
host_check
log_start "$P2I_STATE/setup-logs"
curl --silent --show-error --fail --max-time 5 http://127.0.0.1:8000/health >/dev/null || fail 'The existing model server is not healthy. Complete bootstrap-02.sh first.'
if systemctl is-active --quiet p2i-app-lab.service; then
  fail 'App Lab is already running. Stop it with bash scripts/app-lab.sh stop before reinstalling; saved runs are retained.'
fi
case ${P2I_QUALIFY_TWO:-1} in 0|1) ;; *) fail 'P2I_QUALIFY_TWO must be 0 or 1.';; esac
bash "$ROOT/scripts/app-lab.sh" setup
if [[ ${P2I_QUALIFY_TWO:-1} == 1 ]]; then
  echo 'Testing two-request capacity. This may restart the model service; the original profile is backed up.'
  if ! bash "$ROOT/scripts/app-lab.sh" qualify --enable-two; then
    echo 'Two-worker capacity was not qualified. Continuing with the available sequential profile; see this log.'
    curl --silent --show-error --fail --max-time 5 http://127.0.0.1:8000/health >/dev/null || fail 'Model service is unavailable after qualification. Inspect the log and restore the saved profile before continuing.'
  fi
fi
bash "$ROOT/scripts/app-lab.sh" up
echo 'App Lab is ready. Forward 5173 and 5181–5183 in VS Code, then open http://localhost:5173.'
echo 'Submit one brief in the dashboard. The controller runs the three variants and reports actual checks.'
