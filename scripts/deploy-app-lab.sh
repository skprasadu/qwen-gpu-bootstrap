#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
target=${1:?Usage: bash scripts/deploy-app-lab.sh SSH_ALIAS}
[[ "$target" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Use a configured SSH alias, not shell options.' >&2; exit 2; }
[[ -z $(git -C "$ROOT" status --porcelain) ]] || { echo 'Commit and push the reviewed work before deployment.' >&2; exit 1; }
revision=$(git -C "$ROOT" rev-parse HEAD)
ssh "$target" bash -s -- "$revision" <<'REMOTE'
set -Eeuo pipefail
revision=$1
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 2
base=/home/user/my-applications
release="$base/p2i-app-lab-releases/$revision"
current="$base/p2i-app-lab-current"
mkdir -p "$(dirname "$release")"
[[ ! -e "$current" || -L "$current" ]] || { echo 'Current-release path is occupied by an unrelated directory.'; exit 1; }
if [[ ! -d "$release/.git" ]]; then
  git clone --no-checkout https://github.com/skprasadu/qwen-gpu-bootstrap.git "$release"
else
  [[ -z $(git -C "$release" status --porcelain) ]] || { echo 'Release checkout contains local edits; refusing overwrite.'; exit 1; }
fi
git -C "$release" fetch --depth 1 origin "$revision"
git -C "$release" checkout --detach "$revision"
cd "$release"
bash scripts/app-lab.sh setup
previous=$(readlink "$current" || true)
if ! bash scripts/app-lab.sh up; then
  if [[ -n "$previous" && -f "$previous/scripts/app-lab.sh" ]]; then bash "$previous/scripts/app-lab.sh" up; fi
  exit 1
fi
ln -sfn "$release" "$current"
printf 'Deployed commit %s\nPrevious release: %s\n' "$revision" "${previous:-none}"
REMOTE
