#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
# This bundle assumes a direct root SSH login.
export HOME=/root
host_check
log_start /var/log/qwen-bootstrap
exec 9>/var/lock/qwen-bootstrap.lock
flock -n 9 || fail 'Another bootstrap is running.'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git build-essential pkg-config libssl-dev python3 unzip pciutils mokutil xz-utils kmod util-linux
if mokutil --sb-state 2>/dev/null | grep -qi 'SecureBoot enabled'; then
 fail 'Secure Boot is enabled. Disable it through the VM provider before driver installation.'
fi
lspci -nn | grep -i nvidia || fail 'No NVIDIA PCI device; check rental.'
# Preserve a working R580+ open-module driver. CUDA lives in the vLLM image.
if nvidia-smi >/dev/null 2>&1 && [[ $(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | cut -d. -f1) -ge 580 ]] && modinfo -F license nvidia | grep -q 'Dual MIT/GPL'; then
 echo 'Keeping compatible working open NVIDIA driver.'
else
 apt-get install -y "linux-headers-$(uname -r)"
 curl -fL --retry 3 "https://developer.download.nvidia.com/compute/cuda/repos/ubuntu${VERSION_ID//./}/x86_64/cuda-keyring_1.1-1_all.deb" -o /var/tmp/qwen-cuda-keyring.deb
 dpkg -i /var/tmp/qwen-cuda-keyring.deb
 apt-get update
 apt-get install -y nvidia-open-580
fi
install -m 0755 -d /etc/apt/keyrings
curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
curl -fsSL --retry 3 https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /etc/apt/keyrings/nvidia-container.gpg
curl -fsSL --retry 3 https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/etc/apt/keyrings/nvidia-container.gpg] https://#g' > /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl enable --now docker
systemctl restart docker
# Pin Node and validate its official checksum before extraction.
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
curl -fsSL --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
curl -fsSL --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/sums"
expected=$(awk -v n="node-v$NODE_VERSION-linux-x64.tar.xz" '$2 == n {print $1}' "$tmp/sums")
[[ $expected =~ ^[0-9a-f]{64}$ ]] || fail 'Missing Node checksum.'
printf '%s  %s\n' "$expected" "$tmp/node.tar.xz" | sha256sum -c -
mkdir -p "/opt/node-v$NODE_VERSION"
tar -xJf "$tmp/node.tar.xz" --strip-components=1 -C "/opt/node-v$NODE_VERSION"
for bin in node npm npx; do ln -sfn "/opt/node-v$NODE_VERSION/bin/$bin" "/usr/local/bin/$bin"; done
# Rust belongs to the root account used for both stages.
if [[ ! -x /root/.cargo/bin/rustup ]]; then
 curl -fsSL --retry 3 https://sh.rustup.rs -o "$tmp/rustup-init.sh"
 sh "$tmp/rustup-init.sh" -y --profile minimal --default-toolchain "$RUST_VERSION"
fi
/root/.cargo/bin/rustup toolchain install "$RUST_VERSION" --profile minimal --component rustfmt --component clippy
/root/.cargo/bin/rustup default "$RUST_VERSION"
install -d -m 0755 /var/lib/qwen-bootstrap
cat /proc/sys/kernel/random/boot_id > /var/lib/qwen-bootstrap/stage1-boot
chmod 0644 /var/lib/qwen-bootstrap/stage1-boot
dpkg-query -W > /var/log/qwen-bootstrap/packages.txt
echo 'Stage 1 complete. Run reboot, reconnect as root, then bash bootstrap-02.sh.'
