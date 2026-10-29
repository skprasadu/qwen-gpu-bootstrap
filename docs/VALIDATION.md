# Validation performed — 2026-10-28

Local host: macOS arm64, Python 3.13, Node 24.19.0. No NVIDIA GPU, Ubuntu VM,
Docker daemon, rented Vast instance, or running vLLM was available here.

## Host RAM preflight update — 2026-10-29

On Linux, six new CPU checks pass for the reported 101708100 kB host, explicit
low-RAM opt-in, the unchanged 120 GiB boundary, disabled/invalid overrides and
invalid RAM readings. Existing local, root-login and upgrade suites also pass:
15 tests passed in total, with one macOS-only test skipped. The local suite
includes Bash syntax checks for every shell script. Repeat with:

```bash
python3 tests/memory-tests.py
python3 tests/local-tests.py
python3 tests/root-login-tests.py
python3 tests/upgrade-tests.py
```

No full bootstrap or GPU/model loading was run for this update. The override
does not establish that this host has enough RAM for inference. Results below
remain historical unless explicitly repeated above.

## Passed here

* Five CPU tests: Bash syntax for every shell file; idempotent, private config
  generation; refusal to overwrite an existing app; rejection of prose-only or
  failed-tool “success” evidence; unsupported-host rejection before installation.
* All Python source files parse successfully.
* Actual OpenCode **1.19.5** binary version check and `debug config` accepted the
  custom v1 provider with `@ai-sdk/openai-compatible` and `tool_call: true`.
* Actual OpenCode client against a **scripted localhost OpenAI-compatible API**:
  it executed a real `write` tool, then real `bash`, `read`, `edit`, `bash` tools.
  The validator required a nonzero test exit before the edit and zero afterward.
  The final file contents and repaired Python test were independently checked.
  This is client/tool plumbing verification, not model inference or a benchmark.
* Source verification: live release metadata, pinned model revision and tensor
  index, vLLM's pinned Dockerfile/CLI source, OpenCode's pinned provider schema,
  official Docker/NVIDIA/VS Code instructions. Links are in SOURCES.md.

The generic `opencode-ai@1.19.5` npm wrapper failed its platform-package
postinstall on this Mac. Installing the same-version platform-specific package
worked. Stage 2 therefore installs `opencode-linux-x64@1.19.5` explicitly and
links its binary. The Linux binary itself was not executed on this Mac.

The local mock test exposed separate OpenCode title-generation requests and
external-directory permission behavior. The harness handles title requests
separately and explicitly permits only its disposable folder in the tool
permission map. Those failures were corrected before the final passing run.

Raw concise pass output is in local-test-output.txt.

## Must pass on your GPU before calling deployment verified

1. Stage 1 APT installation, open driver loading, Docker runtime setup, reboot.
2. Exact vLLM image pull/digest, SM120/CUDA kernel compatibility, model download,
   one-card FP8 loading, runtime allocations, and 16K context feasibility.
3. Auth rejection without a key, model listing, automatic parsed function call,
   JSON arguments and tool-result follow-up against real Qwen/vLLM.
4. Real OpenCode/model-driven file edit and observed failure/repair/retest.
5. VS Code Remote SSH extension workflow and the eventual generated todo app.

Stage 2 implements checks 2–4 and stops on failures; it cannot make them pass by
substituting scripted model output. No throughput, long-context, Rust/React app,
or unattended production reliability claim is made. A successful mock run does
not establish that the model will choose valid tools consistently.

## Repeat local checks

```bash
python3 tests/local-tests.py
python3 tests/mock-client.py /absolute/path/to/opencode
```

The mock test needs permission to bind a temporary localhost port and run tools
as your current user. Its fixtures and isolated OpenCode state are temporary.
No model, API account or GPU is needed. OpenCode may fetch provider dependencies
from its normal package sources. Do not confuse this test with
`scripts/opencode-smoke.sh`, which requires the real GPU endpoint.

## Root-only iteration and Rust loop (v0.2.0)

Both stages now assume a direct root login with HOME=/root. They have no sudo or
non-root account branching. The root regression suite checks both entry prefixes
with absent/root/non-root SUDO_USER environments; all use /root. Old dual-account
support has been deliberately removed at the user's request.

The new Rust controller builds locally and passes its own format/Clippy checks.
Sixteen integration tests use REAL Cargo, rustfmt, Clippy and test binaries with a
SCRIPTED OpenCode substitute. They cover clean/failing checks, compiler and
behavior fixes, mechanical formatting, lint repair, frozen inline tests, test and
manifest tampering, new-file rejection, symlinks, no progress, attempt budget,
model timeout, concurrent changes and rejection of zero-test success.
One upgrade-helper test verifies preservation, backup and idempotent AGENTS edits.
Four root-only checks and five existing local checks also pass (26 CPU tests).
Actual OpenCode 1.19.5 accepts the nested repair configuration/permission overrides.

No real Qwen-driven Rust repair was run here. `scripts/rust-loop-smoke.sh` performs
that test on the GPU server and is included in stage 2. Local tests used Rust
1.92.0; the server installer builds with pinned 1.90.0, not executed here.
The previous real-client/scripted-API OpenCode plumbing result remains historical;
it is not a live-model test or a new GPU result for this iteration.

Repeat the new checks after building the crate:

```bash
cargo fmt --manifest-path tools/rust-loop/Cargo.toml -- --check
cargo clippy --manifest-path tools/rust-loop/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo build --manifest-path tools/rust-loop/Cargo.toml --locked --offline
RUST_LOOP_BIN="$PWD/tools/rust-loop/target/debug/rust-loop" python3 tests/rust-loop-tests.py
python3 tests/root-login-tests.py
python3 tests/local-tests.py
python3 tests/upgrade-tests.py
```
