#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="/root/.local/bin:/root/.cargo/bin:$PATH"
state=/root/.local/share/qwen-bootstrap
mkdir -p "$state"
fixture=$(mktemp -d "$state/rust-loop-smoke-XXXXXXXX")
mkdir -p "$fixture/src" "$fixture/tests"
cat > "$fixture/Cargo.toml" <<'TOML'
[package]
name = "repair_probe"
version = "0.1.0"
edition = "2021"
TOML
cat > "$fixture/src/lib.rs" <<'RS'
pub fn add(a: i32, b: i32) -> i32 {
    a + missing
}
RS
cat > "$fixture/tests/behavior.rs" <<'RS'
#[test]
fn adds_positive_and_negative() {
    assert_eq!(repair_probe::add(2, 3), 5);
    assert_eq!(repair_probe::add(-1, 1), 0);
    assert_eq!(repair_probe::add(0, 0), 0);
}
RS
(cd "$fixture" && cargo generate-lockfile --offline)
if rust-loop check --project "$fixture" > "$fixture/baseline.log" 2>&1; then
 echo 'ERROR: deliberately broken Rust fixture passed.' >&2; exit 1
fi
# Baseline log belongs outside the snapshot: checker logs are under .rust-loop.
mv "$fixture/baseline.log" "$fixture/.rust-loop/baseline-smoke.log"
rust-loop repair --project "$fixture" --max-attempts 3
rust-loop check --project "$fixture"
printf 'PASS: real model-driven Rust compiler repair and all Rust gates. Evidence: %s\n' "$fixture"
