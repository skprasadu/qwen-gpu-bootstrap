# Implementation checklist

- [x] Inspect repository and existing integration. Branch: feat/p2i-app-lab.
- [x] GitHub authentication available; current saved Vast SSH address refuses connections. Requested current target.
- [x] Rust/Axum contract template and generated Next/MUI/Zod client.
- [x] Durable controller, private dashboard and isolated OpenCode worker implementation.
- [x] Independent verifier, managed previews, bounded repair and cancellation implementation.
- [x] Local controller/fault tests and actual template verification.
- [x] Reproducible deployment, GPU qualification and comparison commands implemented.
- [ ] Linux container validation through CI (local Docker application is incomplete).
- [x] Review, commit, push, draft PR: https://github.com/skprasadu/qwen-gpu-bootstrap/pull/1.
- [ ] GPU deployment and local-Qwen sequential/concurrent trial (requires reachable target).

Local environment: macOS arm64, Node 24.19.0, Rust 1.92.0. Docker CLI exists;
daemon initially unavailable. Existing host services have not been changed.
