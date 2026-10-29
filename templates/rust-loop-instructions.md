<!-- rust-loop-v2 -->
## Mandatory Rust backend gates

Before claiming the backend is ready, run:
`/root/.local/bin/rust-loop check --project backend`.
If it fails on implementation errors, run:
`/root/.local/bin/rust-loop repair --project backend --max-attempts 3`.
After accepting repairs, rerun the check command. Report its actual status.

The controller runs rustfmt, cargo check for all targets, Clippy with warnings
as errors, all-target tests and doctests. It handles deterministic formatting,
then bounded OpenCode source repair in a temporary copy. It accepts changes only
when ALL gates pass; compilation alone is insufficient. On failure, read the
printed audit logs and report the unresolved issue; never bypass the controller.

Generate Cargo.lock before entering this strict loop. Keep backend a standalone
Cargo package. Put behavior and regression tests in backend/tests/; those files,
Cargo manifests and lockfiles are frozen during automatic repairs. Source files
containing inline tests are frozen too: do not weaken or move existing tests just
to make a repair pass. Existing inline-test code can be repaired manually with
review, followed by the same checks. Do not suppress lints, add unsafe shortcuts,
disable tests, hardcode test answers or change intended behavior to pass checks.
For behavior bugs, first add a test that fails for the reported behavior; then
repair the implementation. Test success is evidence, not proof of correctness.
Also run frontend checks and exercise CRUD over HTTP; Rust gates do not replace
end-to-end application testing.
