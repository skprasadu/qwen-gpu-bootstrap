# Validation record

2026-10-29, local macOS arm64; Node 24.19.0, Rust 1.92.0.

## Passed locally

- Controller TypeScript check.
- 17 deterministic tests: bounded concurrent scheduling; simultaneous submission
  exclusion; code/environment classification; bounded repairs; repeated-failure
  stopping; missing/skipped test rejection; cancellation; deadline; restart
  reconciliation; source protection/symlink rejection; process failure and timeout;
  serving-profile preservation; dashboard origin/host/concurrency restrictions;
  honest request/token accounting when measurements are missing or incomplete.
  These use a **fake provider**, not Qwen.
- Actual trusted template: all five existing rust-loop gates, generated contract
  drift, TypeScript, Next production build, backend/frontend readiness, four
  Playwright acceptance cases, and backend restart/reset.
- Playwright: **4 passed, 0 skipped, 0 failed, 0 flaky**. Cases cover real HTTP
  CRUD/invalid requests, browser CRUD and refresh, baseline presentation, and
  rejection of a deliberately malformed API response through generated Zod
  validators. This is baseline template verification, not proof of the three
  Qwen-generated variants.
- Actual injected TypeScript type error detected. Automatic bounded repair was
  exercised with a fake provider; real-Qwen repair remains unverified.
- Dashboard submitted a brief and displayed three honest failure cards in a real
  Chromium browser with the provider explicitly labeled fake-test. No fake
  passing previews were presented as model output.
- Shell syntax and existing bootstrap local/root-login/memory/upgrade tests.
- npm audits of the two new locked dependency sets: no reported vulnerabilities
  at installation. The generator's transitive js-yaml is overridden to 4.3.2.

Native browser testing initially hit the restricted macOS launch environment.
With browser-launch permission, Chromium headless-shell also stalled on action
stability. Switching to Playwright's full Chromium channel resolved that issue.
A Next.js route-announcer alert also exposed an ambiguous test locator; the
assertion now identifies a visible error message rather than an empty announcer.
Required behavior, test counts and assertions remain enforced.

Latest tested template fingerprint before any subsequent change:
`f7008523843846da8322175559c475723552e6f1a23126a8ef0d32fe4958cb2b`.
Native evidence is under `app-lab/.p2i/template-check/`; it is intentionally ignored
by Git because it contains machine-specific paths. CI uploads its own evidence.

## Passed in Linux CI

- Local Docker is unavailable: its macOS application executable is missing and
  no daemon socket is available. Instead, [GitHub Actions run 40953921332](https://github.com/skprasadu/qwen-gpu-bootstrap/actions/runs/40953921332)
  passed both jobs at commit `0d263a2ba58b47a1536025826f01ac8a134d2762`:
  controller typecheck/17 tests, Linux image build, pinned OpenCode warmup against
  a fake endpoint, and actual template verification in a read-only, offline container.
- The container used Rust 1.90.0 and Node 24.19.0. Template verification includes
  the five Rust gates, OpenAPI/client drift, TypeScript, production build, real
  HTTP and browser acceptance, malformed-response validation and restart/reset.
- CI exposed and resolved container-specific packaging failures: Rust scratch
  storage needed executable mounts, and Chromium needed a temporary writable home.
  The full original container check passed after those fixes. Required checks were
  retained. CI artifacts include gate logs and browser screenshots.

## Pending user-run GPU validation

- The user will rent the GPU and run stages 01, 02 and 03 themselves. No GPU
  deployment, local-Qwen tool-edit/repair run, two-sequence qualification,
  SSH-disconnect trial, or throughput comparison has been claimed.
- Production worker/controller integration, streaming cancellation and systemd
  bootstrap startup still require the target VM. Unit tests do not
  establish these integration outcomes.

The code implements safe interruption reporting rather than transparent restoration
of a live OpenCode process. Failed/partial sources and evidence are retained; this
slice publishes previews only after all required checks pass. Operator actions
outside the controller cannot be inferred from the recorded intervention counter.

## Blackwell tuning update
Local TypeScript check, shell syntax and 19 controller/transaction tests passed.
New tests verify graph/batch argument preservation, duplicate flag rejection,
startup failure rollback and refusal to delete an unrelated replacement container.
These Docker operations use a fake adapter; no GPU, Docker startup, systemd tuning
or measured throughput claim is made from these local tests. The GPU-side tune
command records real qualification evidence and rejects unqualified profiles.
