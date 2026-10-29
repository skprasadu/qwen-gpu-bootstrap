#!/bin/sh
set -eu
# Only the temporary copy of Cargo's cache is writable. The evaluator is in a
# different container; generated build code has no access to acceptance results.
cp -a /usr/local/cargo /tmp/cargo
export CARGO_HOME=/tmp/cargo
exec node /opt/lab/src/verify.ts /workspace "$1" /evidence --build-only
