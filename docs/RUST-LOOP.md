# RustAssistant-inspired backend loop — version 0.2.0

This repository implements a small Rust controller (`tools/rust-loop/`), inspired
by [Microsoft's RustAssistant](https://www.microsoft.com/en-us/research/publication/rustassistant-using-llms-to-fix-compilation-errors-in-rust-code/).
It integrates the existing OpenCode + local Qwen provider. It is not Microsoft's
implementation, a reproduction of its full algorithm, or evidence of its success
rates. It uses one bounded proposal per iteration, not a best-of-N error-group
search. No new inference framework or hosted API account is added.

## What is enforced in code

`rust-loop check --project backend` makes a source snapshot and runs checks in a
copy. It does not edit the original source. `repair` uses the same copy and:

1. Records the failing baseline. Applies deterministic `cargo fmt` in the copy.
2. Runs format check, locked all-target compiler check, locked all-target Clippy
   with `-D warnings`, locked all-target tests, and default locked tests (including
   doctests when the package has a library). At least one passing executed test
   is required; “0 tests” is not accepted as behavior validation.
3. If still failing, sends bounded diagnostics to OpenCode on the same local
   `local/qwen3-coder-next` provider. File-read/edit tools are enabled; shell,
   delegation and web tools are denied for this nested repair call.
4. Checks that only existing `src/**/*.rs` implementation files changed. All tests,
   manifests, Cargo.lock and other copied files are frozen. New/deleted files and
   symlinks are rejected. For conservative test protection, a source file that
   contains `#[test]` or `cfg(test)` is entirely frozen. Use `backend/tests/` for
   new behavior tests. Do not remove existing inline tests to evade the gate.
5. Repeats all checks. Stops on no source progress, subprocess failure, timeout,
   or attempt exhaustion (default three, maximum five). Failed candidate sequences
   stay in the audit directory; the original source is not promoted.
6. If all checks pass, rechecks that the original tree has not changed concurrently
   and copies only accepted source edits back. Saves an accepted.diff and result.

A per-project lock prevents two controller runs at once. Do not manually edit the
app during repair. Copyback is multiple file writes, not a filesystem transaction:
ordinary write errors trigger rollback of already-written files, but power loss,
SIGKILL or a simultaneous external writer can interrupt promotion. The original
snapshot remains in the run directory for review/recovery. The tool does not
reset Git, commit, discard dirty user changes or replace the whole application.

## Boundaries and setup

The first version targets the standalone backend Cargo package used by this
bootstrap: existing Cargo.toml/Cargo.lock, existing source files, no symlinks,
no external path dependencies/workspace references. A new project needs its
initial scaffolding, lockfile, dependencies and behavior tests before this loop.
A manifest/dependency/test change remains a deliberate normal OpenCode task,
followed by the same checks, rather than an automatic source repair.

Install uses the pinned Rust toolchain with rustfmt and Clippy. The controller
has zero third-party dependencies and builds offline once that toolchain exists.
Checking an application may still download its dependencies from Cargo sources.
Local validation here used Rust 1.92.0; server installation targets pinned 1.90.0.
The source declares minimum 1.90, but an actual 1.90 server build is still required.

The loop is a correctness gate, not a security sandbox. Cargo build scripts and
Rust tests execute as the current account (root in this bundle). OpenCode tool
permissions and file comparisons do not safely isolate malicious projects or
prove semantic equivalence. Don't feed it untrusted source or secrets. A model
can still produce incorrect code that passes insufficient tests; forbidden
shortcuts/lint suppressions remain review items, not a formal proof system.

Source snapshots omit target, .git, node_modules, .rust-loop and .env files;
regular files are limited to 2MB each / 20MB total. Build artifacts are not shared
between different controller runs. Review source/configuration files for secrets
before using the loop. Audit logs contain code and diagnostics; keep them private.
They are retained in `backend/.rust-loop/<timestamp>-<pid>/`; add `.rust-loop/`
to the app's .gitignore (the new-app helper does this). Clean old runs deliberately
once no run is active; snapshots/build artifacts can be large.

All commands have a per-command timeout (default 600s, maximum 1800s); this is not
a global wall-clock deadline. Unix process groups are terminated on timeout.
After a crash, verify the recorded PID is no longer active before removing a
stale `backend/.rust-loop/lock`.

## Existing todo application

Run the two upgrade commands in README.md. Then open a fresh OpenCode chat and ask
it to follow the updated AGENTS.md and validate your current backend. If its tests
are inline and a source repair is needed, the first version deliberately refuses
automatic changes to that file. You can request a reviewed manual implementation
fix that preserves those tests, then rerun `rust-loop check`. No existing tests
are silently moved or rewritten by the upgrade helper.

Frontend type/build checks and CRUD-over-HTTP checks are still required. Compiler
success establishes neither business behavior nor a working browser application.
