#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
export HOME=/root
export PATH="/root/.cargo/bin:/root/.local/bin:$PATH"
source "$ROOT/versions.env"
rustup component add --toolchain "$RUST_VERSION" rustfmt clippy
cargo +"$RUST_VERSION" install --path "$ROOT/tools/rust-loop" --locked --offline --root /root/.local --force
test -x /root/.local/bin/rust-loop
printf 'Installed /root/.local/bin/rust-loop. No inference container was changed.\n'
