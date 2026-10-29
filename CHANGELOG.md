# 0.2.0

* Assume direct root SSH login; remove non-root checks, sudo branching and sudo commands.
* Add a dependency-free Rust repair controller with format/compiler/Clippy/test gates,
  bounded local OpenCode repair, protected tests/config, source snapshots and audit logs.
* Require at least one actually passing test; reject zero-test success.
* Add Rust GPU/model smoke test to stage 2 and an upgrade path for existing applications.
* Upgrade keeps inference and application source intact; append AGENTS rules once
  with a backup and ignore audit artifacts in Git.
* CPU validation: 26 tests pass; live Qwen Rust repair remains a server-side test.

This is RustAssistant-inspired; it is not Microsoft's original implementation.
