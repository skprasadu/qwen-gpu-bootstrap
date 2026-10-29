#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
export HOME=/root
host_check
STATE="$HOME/.local/share/qwen-bootstrap"
mkdir -p "$STATE"
log_start "$STATE/logs"
exec 9>"$STATE/lock"
flock -n 9 || fail 'Another stage 2 is running.'
[[ -f /var/lib/qwen-bootstrap/stage1-boot ]] || fail 'Run stage 1 first.'
[[ $(cat /var/lib/qwen-bootstrap/stage1-boot) != $(cat /proc/sys/kernel/random/boot_id) ]] || fail 'Reboot after stage 1 first.'
nvidia-smi
[[ $(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l) -eq 1 ]] || fail 'This bundle requires exactly one visible GPU.'
nvidia-smi --query-gpu=name --format=csv,noheader | grep -Eq 'RTX PRO 6000.*Blackwell' || fail 'Expected RTX PRO 6000 Blackwell.'
mem=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits)
[[ $mem -ge 95000 ]] || fail 'Expected a full 96GB GPU.'
major=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | cut -d. -f1)
[[ $major -ge 580 ]] || fail 'CUDA 13 requires driver R580+.'
check_host_ram "$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
cached_kb=0
[[ ! -d "$STATE/cache" ]] || cached_kb=$(du -sk "$STATE/cache" | cut -f1)
needed_kb=$((200000000 - cached_kb))
((needed_kb >= 40000000)) || needed_kb=40000000
[[ $(df -Pk "$STATE" | awk 'END {print $4}') -ge $needed_kb ]] || fail 'Need at least 200GB free in home/cache filesystem.'
docker_root=$(docker info --format '{{.DockerRootDir}}')
[[ $(df -Pk "$docker_root" | awk 'END {print $4}') -ge 40000000 ]] || fail 'Need at least 40GB free for Docker images.'
docker info >/dev/null
# Rust is user-scoped and was prepared before the reboot.
[[ -x "$HOME/.cargo/bin/rustc" ]] || fail 'Run stage 1 first to install Rust in /root.'
"$HOME/.cargo/bin/rustc" --version
node --version | grep -Fx "v$NODE_VERSION"
# Explicit platform package avoids the upstream wrapper postinstall failure observed locally.
npm install --prefix "$STATE/client" --ignore-scripts "opencode-linux-x64@$OPENCODE_VERSION"
mkdir -p "$HOME/.local/bin"
ln -sfn "$STATE/client/node_modules/opencode-linux-x64/bin/opencode" "$HOME/.local/bin/opencode"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! grep -q '# qwen-bootstrap PATH' "$HOME/.profile" 2>/dev/null; then
 printf '\n# qwen-bootstrap PATH\nexport PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"\n' >> "$HOME/.profile"
fi
opencode --version
bash "$ROOT/scripts/install-rust-loop.sh"
if [[ ! -f "$STATE/image.lock" ]]; then
 docker pull "$VLLM_IMAGE"
 docker image inspect "$VLLM_IMAGE" --format '{{index .RepoDigests 0}}' > "$STATE/image.lock.tmp"
 mv "$STATE/image.lock.tmp" "$STATE/image.lock"
fi
image=$(cat "$STATE/image.lock")
[[ $image =~ ^vllm/vllm-openai@sha256:[0-9a-f]{64}$ ]] || fail 'Invalid image lock.'
docker pull "$image"
docker run --rm --gpus all --entrypoint nvidia-smi "$image"
# Validate flags against the exact downloaded image before reserving GPU memory.
docker run --rm --gpus all "$image" --help=all > "$STATE/vllm-help.txt"
for flag in --revision --tokenizer-revision --enable-auto-tool-choice --tool-call-parser --max-model-len --api-key --max-num-seqs --max-num-batched-tokens --gpu-memory-utilization --enforce-eager --enable-chunked-prefill --served-model-name --host --port --tensor-parallel-size; do
 grep -q -- "$flag" "$STATE/vllm-help.txt" || fail "Image lacks $flag"
done
[[ -f "$STATE/api-key" ]] || python3 -c 'import secrets; print(secrets.token_hex(32))' > "$STATE/api-key"
chmod 600 "$STATE/api-key"
printf 'VLLM_API_KEY=%s\n' "$(cat "$STATE/api-key")" > "$STATE/server.env"
mkdir -p "$STATE/cache"
# Refuse to replace any unrelated container with our reserved name.
if docker container inspect qwen-coder >/dev/null 2>&1; then
 [[ $(docker inspect -f '{{index .Config.Labels "qwen-bootstrap"}}' qwen-coder) == managed ]] || fail 'Container name qwen-coder is already occupied.'
 docker rm -f qwen-coder >/dev/null
fi
docker run -d --name qwen-coder --label qwen-bootstrap=managed --restart unless-stopped \
 --gpus all --shm-size 8g --security-opt no-new-privileges --cap-drop ALL \
 --env VLLM_NO_USAGE_STATS=1 --env DO_NOT_TRACK=1 --env HF_HUB_DISABLE_TELEMETRY=1 \
 --log-opt max-size=20m --log-opt max-file=3 \
 -p 127.0.0.1:8000:8000 --env-file "$STATE/server.env" \
 -v "$STATE/cache:/root/.cache/huggingface" "$image" \
 "$MODEL" --revision "$REVISION" --tokenizer-revision "$REVISION" \
 --served-model-name qwen3-coder-next --host 0.0.0.0 --port 8000 \
 --tensor-parallel-size 1 --max-model-len 16384 --max-num-seqs 1 \
 --max-num-batched-tokens 2048 --enable-chunked-prefill --gpu-memory-utilization 0.95 --enforce-eager \
 --enable-auto-tool-choice --tool-call-parser qwen3_coder
python3 "$ROOT/scripts/configure.py" "$STATE"
# Up to 60 minutes for initial ~80GB download and kernel initialization.
ready=0
for ((i=0; i<360; i++)); do
 if curl --silent --fail --max-time 5 http://127.0.0.1:8000/health >/dev/null; then ready=1; break; fi
 running=$(docker inspect -f '{{.State.Running}}' qwen-coder)
 [[ $running == true ]] || break
 sleep 10
done
docker logs --tail 300 qwen-coder > "$STATE/logs/vllm-startup.log" 2>&1
[[ $ready == 1 ]] || fail 'Server did not become healthy. Inspect docker logs qwen-coder; see docs/TROUBLESHOOTING.md.'
python3 "$ROOT/scripts/api-smoke.py" "$STATE"
"$ROOT/scripts/opencode-smoke.sh"
"$ROOT/scripts/rust-loop-smoke.sh"
echo 'Stage 2 passed API, OpenCode and Rust repair smoke tests. Reconnect SSH to refresh PATH. See README.md to create your app.'
