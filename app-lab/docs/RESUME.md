# Resume after the 2026-10-30 GPU trial

Use branch **feat/p2i-app-lab**. Original bootstrap stages and model/image pins are
unchanged. This checkpoint fixes preview publication and context-error handling;
it does not claim a successful three-variant Qwen run.

## Before destroying this VM

Download `/home/user/my-applications/gpu-checkpoint-2026-10-30.tar.gz` and its
`.sha256` sidecar to your computer using VS Code Explorer's download action or your
existing SSH transfer setup. Check the downloaded file:

```bash
shasum -a 256 gpu-checkpoint-2026-10-30.tar.gz
```

Expected SHA256: `66f2f169641842a8639b3e15145d4d9e33fc73c30c9409ab5078b0c07923cc5d`.

The archive contains the run record, worker logs, request/GPU metrics, tuning
results, and verified Simple List candidate source/evidence. It excludes API keys,
provider configs, private recovery records, weights, dependencies and build caches.
It is an inspection/source archive, not a VM image or live session restore. Keep it
private: logs contain project prompts/source. The archive itself is not pushed to
GitHub. Download it before destroying the disk if you want those original files;
Git stores the implementation and this summary.

If retaining the same disk, preserve `p2i-app-lab-state`, including its private
recovery records, and the existing Docker containers. Never transplant old
qualification results or container recovery IDs into a different VM.

## Fresh VM tomorrow

Use a true Ubuntu VM/bare-metal host meeting the [existing requirements](../../README.md#original-bootstrap-requirements).
As root:

```bash
apt-get update
apt-get install -y git
mkdir -p /home/user/my-applications
cd /home/user/my-applications
git clone --branch feat/p2i-app-lab https://github.com/skprasadu/qwen-gpu-bootstrap.git
cd qwen-gpu-bootstrap
bash bootstrap-01.sh
reboot
```

Reconnect as root:

```bash
cd /home/user/my-applications/qwen-gpu-bootstrap
bash bootstrap-02.sh
bash bootstrap-03.sh
```

For the previously used 96GiB **host-RAM** machine, replace only stage 02 with
`QWEN_ALLOW_LOW_RAM=1 bash bootstrap-02.sh`. The original explicit opt-in and other
checks still apply; GPU VRAM is a separate resource.

Stage 03 now also tests a synthetic preview from the host through the actual
Docker relay, checking isolation, localhost binding and restart. Setup fails if
that gate fails. Port 5181 must be available for the check.

Forward **5173, 5181, 5182, 5183** in VS Code. Open http://localhost:5173 and submit
a fresh brief with two workers if qualification enables it. The next milestone
is three independently verified, reachable previews. No tuning sweep is required
to test correctness. A fresh VM uses the bootstrap baseline; this checkpoint does
not transplant the old tuning profile or assume identical new-hardware performance.
Optional tuning comes after functionality works.

## Required follow-up after starting the server

**All three Todo jobs in the October 30 run were FAILED. This remains an unresolved
end-to-end milestone.** Fixes were pushed, but no subsequent real-Qwen run has
proved all three applications work. Do not treat bootstrap success, GPU tuning,
or the synthetic networking check as completion of this follow-up.

The user wants the three browser previews at **localhost:5174, :5175 and :5176**.
The controller currently binds remote preview ports **5181, 5182 and 5183**.
In VS Code's Ports panel, forward the following remote ports and set their local
ports with **Change Local Port**:

| Service | Remote VM port | Local browser port |
| --- | --- | --- |
| Dashboard | 5173 | 5173 |
| Simple List | 5181 | 5174 |
| Kanban | 5182 | 5175 |
| Daily Focus | 5183 | 5176 |

With this mapping, open http://localhost:5174, http://localhost:5175 and
http://localhost:5176 directly (or use the Ports panel's Open in Browser action).
The dashboard currently constructs preview links from remote port numbers; its
links do not automatically detect remapped local ports. Local forwarding alone
cannot repair a failed generation or a preview that was never published.

After startup:

1. Confirm the updated stage-03 host-publication check passes. If it fails, repair
   the preview/relay path and inspect its saved logs before starting generation.
2. Submit a fresh three-variant Qwen run. Verify that context overflow is either
   avoided or recovered through the bounded verification/repair loop. Investigate
   and fix any remaining generation, code or publishing errors; retain all gates.
3. Require **all three cards to pass**, with four executed acceptance cases each,
   successful builds and reachable previews. The original List's 4/4 result alone
   did not satisfy this: publishing failed. Kanban/Focus never reached acceptance.
4. Open all three requested local URLs and exercise create, edit, complete/reopen
   and delete, plus each variant's behavior. Record actual results and unresolved
   errors. Do not report the task complete until all three previews work.

## Same VM with its disk preserved

Do not rerun stages 01/02 just to update App Lab. Stage 02 must not overwrite a
model profile while qualification/tuning backups are active.
Once the existing model is healthy at http://127.0.0.1:8000/health:

```bash
cd /home/user/my-applications/qwen-gpu-bootstrap
bash scripts/app-lab.sh stop
git switch feat/p2i-app-lab
git pull --ff-only origin feat/p2i-app-lab
P2I_QUALIFY_TWO=0 bash bootstrap-03.sh
```

This rebuilds App Lab and retains the serving profile. Existing qualification must
match the running image/command to enable two workers. If the model container is
stopped, start `qwen-coder` and wait for health before stage 03. Keep its backup
containers intact; see [rollback instructions](../README.md#status-stop-and-rollback)
if it cannot start.

## Trial evidence and checkpoint fixes

Run `b086d49a-c194-44a2-aa2d-b6d25b91c81f`, two workers, 465 seconds:

- Simple List candidate 2 passed Rust gates, contract drift, TypeScript, production
  build, four acceptance cases and backend restart. Host publication timed out.
  Its source is archived separately, not inserted into the template.
- Docker 29.9.2 reproduced the defect: an internal-only HTTP server responded
  inside Docker, but requested published ports remained null.
- Kanban had one ContextOverflowError; Focus had four. Both exceeded the 16,384-token
  model context and failed generation before independent evaluation. Kanban's final
  TypeScript check passed; that was not acceptance evidence.
- GPU metrics reached two running requests, zero waiting requests and zero
  preemptions. The 2,048 batch-token setting is separate from the conversation limit.
- Tuning selected graphs-2-b2048. Conservative synthetic scores: eager/2048 33.1271
  tokens/s; graphs/2048 274.0349; graphs/4096 273.6322. Fixed-order/cache effects limit
  interpretation. These are not verified apps/hour measurements.

Changes:

- Trusted HTTP relay publishes only on 127.0.0.1. App/evaluator stay internal. The
  relay has no candidate mount and a fixed upstream. Failure cleanup saves logs.
- One-variant prompts, shorter repair feedback, pruning and a 4,096-token compaction
  reserve. See [OpenCode compaction settings](https://opencode.ai/docs/config/#compaction).
  New worker images include ripgrep for search tools.
- Structured context-only worker exit-1 failures verify captured source, then use
  existing bounded fresh-session repairs if needed. Other failures remain fatal.
  Cancellation, deadlines, source protection and every acceptance gate remain.
- Dashboard distinguishes tests not run from preview publication failures.

See [VALIDATION.md](VALIDATION.md) for checks performed. Fresh Qwen generation with
these changes remains tomorrow's test. Synthetic relay/controller tests do not
establish model success.
