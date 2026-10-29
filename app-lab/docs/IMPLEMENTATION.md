# Implementation checklist

- [x] Inspect repository and existing integration. Branch: feat/p2i-app-lab.
- [x] GitHub authentication available. User clarified: build and push only; they will rent the GPU and run the scripts.
- [x] Rust/Axum contract template and generated Next/MUI/Zod client.
- [x] Durable controller, private dashboard and isolated OpenCode worker implementation.
- [x] Independent verifier, managed previews, bounded repair and cancellation implementation.
- [x] Local controller/fault tests and actual template verification.
- [x] Familiar bootstrap-01 → reboot → bootstrap-02 → bootstrap-03 flow, plus optional comparison/rollback commands.
- [ ] Linux container validation through CI (local Docker application is incomplete).
- [x] Review, commit, push, draft PR: https://github.com/skprasadu/qwen-gpu-bootstrap/pull/1.
- [ ] User-run milestone after rental: actual local-Qwen generation and sequential/concurrent trial. Outside this implementation session; not claimed tested.

Local environment: macOS arm64, Node 24.19.0, Rust 1.92.0. Docker CLI exists;
daemon initially unavailable. Existing host services have not been changed.
