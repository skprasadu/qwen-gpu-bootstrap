#!/bin/sh
set -eu
cp -a /usr/local/cargo /tmp/cargo
cp -a /opt/lab/template /tmp/project
export HOME=/tmp CARGO_HOME=/tmp/cargo CARGO_NET_OFFLINE=true RUST_LOOP_BIN=/usr/local/bin/rust-loop
exec node /opt/lab/src/verify.ts /tmp/project template /evidence
