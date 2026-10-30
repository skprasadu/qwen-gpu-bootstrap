# Implementation checklist

- [x] Inspect repository and existing integration. Branch: feat/p2i-app-lab.
- [x] GitHub authentication available. User clarified: build and push only; they will rent the GPU and run the scripts.
- [x] Rust/Axum contract template and generated Next/MUI/Zod client.
- [x] Durable controller, private dashboard and isolated OpenCode worker implementation.
- [x] Independent verifier, managed previews, bounded repair and cancellation implementation.
- [x] Local controller/fault tests and actual template verification.
- [x] Familiar bootstrap-01 → reboot → bootstrap-02 → bootstrap-03 flow, plus optional comparison/rollback commands.
- [x] Linux container validation through CI: controller and actual Docker template checks passed in run 40953921332.
- [x] Review, commit, push, draft PR: https://github.com/skprasadu/qwen-gpu-bootstrap/pull/1.
- [ ] User-run milestone after rental: actual local-Qwen generation and sequential/concurrent trial. Outside this implementation session; not claimed tested.

Local environment: macOS arm64, Node 24.19.0, Rust 1.92.0. Docker CLI exists;
daemon initially unavailable. Existing host services have not been changed.

### Reversible Blackwell tuning
`app-lab.sh tune` runs an idle-only systemd sweep, preserving previews and the
running model image digest. Three profiles compare eager/2048, graphs/2048 and
graphs/4096 at two sequences. Warmup plus two concurrent 2048-token probe pairs
measure a conservative tokens/sec score; a >5% gain is required to select a trial.
The transaction journals ownership before mutation and retains the original
container for rollback. Startup/inference failures restore the original. This is
synthetic evidence, not an app-throughput guarantee; full application evaluation
still runs unchanged. No GPU validation was performed locally.
