# P2I App Lab

One brief queues three independently generated todo frontends: List, Kanban and
Daily Focus. Each uses the same verified Rust/Axum implementation, a separate
in-memory backend process, and an OpenAPI-generated TypeScript SDK with Zod runtime
response validation. The first slice supports this constrained experiment only.

**Status:** local and Linux container checks passed; consult [VALIDATION.md](docs/VALIDATION.md)
for the exact tested boundaries. A passed local template or fake-provider test is
not an autonomous Qwen run or a GPU throughput measurement.

The October 30 GPU trial exposed context overflow and preview publication failures.
The [checkpoint/restart guide](docs/RESUME.md) records the evidence and fixes, and
gives the next bootstrap sequence. A new three-variant Qwen run is still required.

## Start on the existing GPU VM

On a fresh VM, follow the [root quickstart](../README.md): stage 01, reboot,
stage 02, then stage 03. If stages 01 and 02 already work, run directly as root:

```bash
cd /home/user/my-applications/qwen-gpu-bootstrap
bash bootstrap-03.sh
```

Setup checks Node 24, Docker and the existing provider config; installs locked
controller dependencies; builds a pinned toolchain image; and runs actual Rust,
production frontend, HTTP and browser checks in a container. It fails if those
checks fail. Stage 03 then qualifies two-request capacity with rollback and starts
the dashboard. Set `P2I_QUALIFY_TWO=0` to skip the capacity experiment. The lower-level
`bash scripts/app-lab.sh setup` and `up` commands remain available for diagnostics.

The default provider config is `/root/.local/share/qwen-bootstrap/opencode.json`.
Override `P2I_OPENCODE_CONFIG` if needed. The existing local model configuration
and limits are retained. State lives at
`/home/user/my-applications/p2i-app-lab-state`; override `P2I_STATE` consistently
for every command. `P2I_IMAGE` and `P2I_MODEL_CONTAINER` can name the actual image
and serving container. The supported initial integration is the bootstrap's
`qwen-coder` container serving privately on host port 8000.

Forward **5173, 5181, 5182 and 5183** in VS Code Remote SSH's Ports panel. Open
`http://localhost:5173` on your Mac. Submit the brief in the dashboard. It creates
three variants from one basic frontend; their final implementations are not baked
into this repository. Only actual independent checks can mark a variant passed.
Application data lasts until its backend restarts.

The controller is managed by systemd. Closing VS Code or disconnecting SSH leaves
it running. Reconnect and open the same dashboard to inspect the persisted run.
A controller crash/restart cancels abandoned workers and marks unfinished work
interrupted; it does **not** pretend to restore agent processes. Verified previews
remain available until stopped. A new run requires stopping previous previews
because the first slice uses three fixed private ports.

## Qualify and compare concurrent work

Stage 03 attempts qualification automatically. To retry it separately if the
dashboard still shows one worker:

```bash
bash scripts/app-lab.sh qualify --enable-two
bash scripts/app-lab.sh up
bash scripts/app-lab.sh benchmark
```

Qualification stops the managed model container, preserves it as
`qwen-coder-p2i-backup`, and creates a copy changing only `--max-num-seqs` to two.
It keeps the image, model/revision, context, memory, GPU requests, mounts, private
port bindings and environment. It probes two simultaneous inference requests and
requires server metrics to show at least two running sequences. Failure restores
the old container. Do not run this while another application depends on uninterrupted
model availability. If the current profile already supports two, use `qualify`
without `--enable-two`. Missing metrics cannot silently qualify concurrency.
The startup probe uses two short 512-token completions. It establishes overlap
for that probe; the subsequent app run measures actual long-context workload behavior.

The dashboard enables two workers only for the qualified image/command. The
benchmark is another systemd job: SSH disconnection does not kill it. It runs the
same brief and three variants with one worker, stops those previews, then repeats
with two workers. Inspect `comparison.json` in the state directory and:

```bash
journalctl -fu p2i-app-lab-benchmark
```

This is an exploratory comparison, sequential first. Each variant has a fresh
workspace, but shared model/dependency caches are not reset; order effects remain.
Each run has its own 60-minute maximum, so the full comparison can take two hours.
Report passed variants/hour, wall time, attempts, tokens when available and user
interventions. GPU metrics and private gateway request timings are recorded under
`metrics/`. Overlapping HTTP requests can include queued work; the qualification
metrics are the separate proof of simultaneous running sequences. Missing data is
null/unavailable, not zero. No utilization percentage or speedup is guaranteed.

## Verification and permissions

* Host administration supports root. OpenCode executes as UID 10001 in a container.
  Only `frontend/src` is writable. Its project permissions are preauthorized.
  It gets no host home, SSH keys, Docker socket or original model API key.
* Workers use an internal Docker network and a private streaming inference gateway.
  The gateway holds the model key and records timings/usage, not prompts or keys.
  OpenCode/provider caches and toolchains are warmed during image build using a
  **fake** endpoint, explicitly separate from model validation.
* Generated code builds in a fresh container with no model network. It exits before
  evaluation. The application then runs in a read-only container with a trusted
  backend binary. A separate evaluator container owns the tests and evidence; the
  application cannot mount or rewrite them. Runtime and evaluator share only a
  dedicated internal network.
  A trusted HTTP relay joins that network and Docker's publishing bridge, exposing
  only the frontend on host loopback. Generated apps have no external network;
  the relay has no candidate mount. Stage 03 checks host publication separately.
* Captures accept bounded ordinary source files, reject symlinks/special files,
  and reconstruct protected content from the template. Source fingerprints and
  protected hashes are recorded. Tests require four executed, passing cases with
  no skips, omissions or retries. Build-only results cannot produce a passed job.
* The fixed cases cover HTTP CRUD/validation, browser CRUD/refresh, variant-specific
  behavior, and malformed-response rejection. Rust gates, client regeneration,
  TypeScript, production build and backend restart checks are additional gates.
* A 60-minute run budget includes all jobs. Generation stops five minutes before
  the deadline; each variant has one initial attempt plus at most three repairs.
  Unchanged repeated failures stop early. Environment failures do not trigger
  speculative application changes. Only verified candidates get preview links;
  partial/failed source and logs remain available in the state directory.
* Context-only worker failures verify saved source and can enter the existing
  bounded repair loop with a fresh conversation. Workers use pruning and a 4,096-token
  compaction reserve. Every independent acceptance gate still has to pass.

The platform owns process lifetimes, readiness, exit codes and cleanup. The model
does not manage background servers with fragile temporary-shell commands. Required
public UI labels and variant behavior are documented in `template/AGENTS.md`.

## Local development and pulling updates

Use Node 24.19.0+ within major 24, Rust 1.90+ with rustfmt/clippy, and the locked
dependencies. Local native verification is for the trusted template; untrusted
model candidates use the isolated Docker path above.

```bash
cd app-lab
npm ci
npm --prefix template/frontend ci
npx playwright install chromium
cargo build --release --locked --manifest-path ../tools/rust-loop/Cargo.toml
npm run generate
npm run typecheck
npm test
npm run verify
node src/local-faults.ts
```

On your rented VM, pull the App Lab branch and rerun stage 03 to update it:

```bash
bash scripts/app-lab.sh stop
git pull --ff-only origin feat/p2i-app-lab
bash bootstrap-03.sh
```

Stop existing work before updating; saved source and evidence remain in the
separate state directory. A fast-forward-only pull refuses conflicting local
changes. Stages 01 and 02 are not needed for an App Lab-only update. The user runs
these commands after rental; no SSH credentials or assistant-led deployment are
required for this iteration.

## Status, stop and rollback

```bash
bash scripts/app-lab.sh status
bash scripts/app-lab.sh logs
bash scripts/app-lab.sh stop
# Restore the serving profile saved by qualify --enable-two:
bash scripts/app-lab.sh rollback
```

Stop cancels workers and removes previews while retaining artifacts and the model
service. Rollback additionally restores the original saved model container; it
requires that backup to exist. For a code rollback, use a separate checkout of the
previous commit and run stage 03 with `P2I_QUALIFY_TWO=0`. Do not rerun stage 2
while a qualification backup is active.
State and evidence may contain project source/prompts; keep the directory private.

## Sources checked during implementation

* [OpenCode CLI](https://opencode.ai/docs/cli/) — noninteractive runs; the installed
  pinned binary's help is checked for `--auto` during image construction.
* [Hey API Zod](https://heyapi.dev/docs/openapi/typescript/plugins/zod) — runtime
  response validators, verified by an actual malformed-response browser test.
* [MUI Next integration](https://mui.com/material-ui/integrations/nextjs/) — App
  Router cache provider; compatible new template dependencies are locked.
* [vLLM optimization](https://docs.vllm.ai/en/v0.32.0/configuration/optimization/) —
  concurrency/cache tradeoffs. Original serving pins remain in `versions.env`.

## Blackwell GPU tuning and reconnecting

After the current job finishes, update the existing checkout (no bootstrap01/02
rerun). Keep completed previews alive: do **not** use `app-lab.sh stop`, rollback,
or the dashboard's stop-previews action just to disconnect VS Code.

```bash
cd /home/user/my-applications/qwen-gpu-bootstrap
git switch feat/p2i-app-lab
git pull --ff-only
bash scripts/app-lab.sh tune
journalctl -fu p2i-app-lab-tune
```

`tune` requires a reachable idle dashboard. It runs in systemd, so closing VS Code
or pressing Ctrl-C in the log viewer does not cancel it. The dashboard is offline
during tuning; existing previews remain running. On completion it restarts the
controller. Check `systemctl status p2i-app-lab-tune --no-pager` while active and
`journalctl -u p2i-app-lab-tune -n 80 --no-pager` for the result after completion.
The transient unit can disappear after success; the journal and
`/home/user/my-applications/p2i-app-lab-state/tuning-result.json` retain results.

The sweep preserves the exact running image, weights, memory fraction, context
length and private network bindings. At two sequences it compares eager/batch2048,
graphs/batch2048, then graphs/batch4096. Each profile has a warmup and two scored
pairs of simultaneous 2048-token maximum requests. It selects a candidate only
when its lower scored throughput exceeds baseline by 5%, then requalifies it.
This is synthetic throughput, **not proof of faster app completion**, and fixed
order/prefix cache effects can bias it. Compilation may take 15 minutes per profile.
Failed startup/probes are rejected; failure or no improvement restores the original.
The original model container is kept for `bash scripts/app-lab.sh tune-restore`.
Do not run bootstrap02, benchmark, qualify or other model changes during tuning.
Only App Lab jobs are checked; stop any standalone OpenCode inference first.

A hard VM crash/forced termination may leave `private/tuning.lock`. Once
`p2i-app-lab-tune` is confirmed inactive, remove that **empty directory only** with
`rmdir`, restart the dashboard with `bash scripts/app-lab.sh up`, and use
`tune-restore`. Never delete the tuning-profile.json recovery record or backup
container. A second tuning sweep requires restoring the first backup first.

Reconnect through VS Code Remote SSH. In **Ports → Forward a Port**, add **5173,
5181, 5182, 5183**. No Vast public port/firewall change is needed. Open
http://localhost:5173 and use the successful cards' preview links (usually
http://localhost:5181, http://localhost:5182, http://localhost:5183). If VS Code
assigns a different local port, use the address it displays. Failed variants have
no verified preview. Submit a fresh dashboard run to generate three new variants;
stop old previews using the dashboard when it requests the ports be released.
SSH disconnection does not reset apps, but restarting their containers resets
in-memory todos. A VM reboot is different from closing VS Code.

Tuning references: [vLLM 0.32 engine flags](https://docs.vllm.ai/en/v0.32.0/configuration/engine_args/)
and [chunked prefill tuning](https://docs.vllm.ai/en/v0.32.0/configuration/optimization/).
The [October 30 checkpoint](docs/RESUME.md) records that VM's measurements; remeasure on different hardware before making performance claims.
