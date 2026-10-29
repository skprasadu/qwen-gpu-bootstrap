#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/versions.env"
fail() { echo "ERROR: $*" >&2; exit 1; }
check_host_ram() {
 local ram_kib=${1:-} ram_gib
 [[ $ram_kib =~ ^[1-9][0-9]*$ ]] || fail 'Cannot determine host RAM from /proc/meminfo.'
 case ${QWEN_ALLOW_LOW_RAM:-0} in
  0|1) ;;
  *) fail 'QWEN_ALLOW_LOW_RAM must be 0 or 1.' ;;
 esac
 ram_gib=$(awk -v kib="$ram_kib" 'BEGIN {printf "%.1f", kib/1024/1024}')
 printf 'Host RAM: %s GiB (separate from GPU VRAM).\n' "$ram_gib"
 if ((ram_kib < 120 * 1024 * 1024)); then
  [[ ${QWEN_ALLOW_LOW_RAM:-0} == 1 ]] || fail "Detected $ram_gib GiB host RAM; the default requires at least 120 GiB visible (rent >=128GB host RAM). To attempt an unverified lower-RAM setup, rerun with QWEN_ALLOW_LOW_RAM=1 bash bootstrap-02.sh."
  printf 'WARNING: Continuing with %s GiB host RAM because QWEN_ALLOW_LOW_RAM=1. This setup is unverified and may run out of host RAM during model loading or inference.\n' "$ram_gib" >&2
 fi
}
log_start() {
 mkdir -p "$1"
 LOG="$1/$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
 exec > >(tee -a "$LOG") 2>&1
 trap 'rc=$?; echo "Failed at line $LINENO (exit $rc). Log: $LOG" >&2; exit "$rc"' ERR
}
host_check() {
 [[ $(uname -m) == x86_64 ]] || fail 'Requires x86_64.'
 [[ -f /etc/os-release ]] || fail 'Requires Ubuntu.'
 source /etc/os-release
 [[ $ID == ubuntu && ( $VERSION_ID == 24.04 || $VERSION_ID == 22.04 ) ]] || fail 'Requires Ubuntu 22.04/24.04.'
 if [[ -e /.dockerenv || -e /run/.containerenv ]] || systemd-detect-virt --container --quiet; then
  fail 'This is a container rental. Rent a true VM/bare-metal host with kernel and reboot control.'
 fi
 [[ $(ps -p 1 -o comm=) == systemd ]] || fail 'Requires systemd as PID 1.'
}
