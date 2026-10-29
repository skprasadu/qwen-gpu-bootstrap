# Source review — 2026-10-28

The current release endpoints were checked, rather than assuming remembered
versions. This is a compatibility hypothesis awaiting the target GPU run.

* [Qwen official FP8 model card](https://huggingface.co/Qwen/Qwen3-Coder-Next-FP8):
  80B total / 3B activated, hybrid attention/MoE; vLLM >=0.15.0; automatic tool
  choice with parser `qwen3_coder`. Its example is multi-GPU. It does not establish
  a tested one-card 96GB recipe.
* [Model revision API](https://huggingface.co/api/models/Qwen/Qwen3-Coder-Next-FP8):
  observed revision `da6e2ed27304dd39abadd9c82ef50e8de67bdd4c`.
  [Pinned tensor index](https://huggingface.co/Qwen/Qwen3-Coder-Next-FP8/blob/da6e2ed27304dd39abadd9c82ef50e8de67bdd4c/model.safetensors.index.json):
  `metadata.total_size = 80362904064` bytes = 80.36GB / 74.85GiB of tensors.
  This excludes runtime allocations, activations, workspace and cache.
* [Latest vLLM release API](https://api.github.com/repos/vllm-project/vllm/releases/latest)
  reported v0.32.0. [Release](https://github.com/vllm-project/vllm/releases/tag/v0.32.0).
  [Pinned Dockerfile](https://github.com/vllm-project/vllm/blob/v0.32.0/docker/Dockerfile)
  defaults to CUDA 13.0.3 / Ubuntu 24.04, entrypoint `vllm serve`.
  [GPU install notes](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/)
  describe CUDA/driver compatibility. Host R580+ is required by this bundle;
  forward-compatibility mode is not enabled.
* [Tool calling](https://docs.vllm.ai/en/stable/features/tool_calling/): automatic
  parser-based tool calls. Stage 2 validates flags against the pulled image;
  its API smoke requires a real parsed function call and a tool-result round trip.
* [NVIDIA open modules](https://github.com/NVIDIA/open-gpu-kernel-modules) and
  [driver installation guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/):
  use an open kernel driver for Blackwell. This bootstrap chooses R580, not the
  newest driver branch, to match CUDA 13 and avoid an uncontrolled major upgrade.
* [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/) and
  [NVIDIA Container Toolkit installation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html):
  signed package repositories and Docker runtime configuration.
* [OpenCode registry latest](https://registry.npmjs.org/opencode-ai/latest)
  reported 1.19.5. [Pinned source config](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/v1/config/provider.ts)
  confirms the v1 provider fields, including `tool_call`.
  [Provider docs](https://opencode.ai/docs/providers/) and
  [CLI docs](https://opencode.ai/docs/cli/) describe compatible providers and JSON events.
  This bundle pins v1 fields (`provider`, `npm`, `options`), not the incompatible
  v2 preview fields (`providers`, `package`, `settings`).
* [VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh): remote
  extension installation and private port forwarding.

## Memory feasibility

A 96GiB device with 95% allocation budget offers about 91.2GiB; ~74.85GiB of
checkpoint tensors leaves roughly 16GiB before all other allocations. The actual
reported GPU capacity can vary. The 3B active count does NOT make this a 3GB model.
Single-GPU FP8 is plausible, not verified. The baseline uses eager execution,
16384 total context tokens, 2048 output tokens, one sequence and 2048 prefill batch
tokens to reduce memory pressure. It does not promise the advertised 256K context
or a throughput target. FP8 kernel support on SM120 with this exact image and
checkpoint still needs the physical GPU test. If it OOMs even at 4096 context,
use more VRAM/two GPUs with a separately reviewed TP configuration, or deliberately
choose a smaller/4-bit checkpoint; this bundle never silently substitutes models.

## Reproducibility scope

The model and tokenizer use an immutable HF commit. vLLM uses a release tag and
records/uses its immutable registry digest after first pull. OpenCode 1.19.5,
Node 24.19.0 and Rust 1.90.0 are selected fixed versions. Node/Rust were chosen
stable pins, not claimed to be latest. APT security packages, rustup bootstrap,
repository keys and client provider dependencies are fetched from upstream over
TLS and are not a complete immutable supply-chain lock. Package inventory is
recorded. This is not an offline installer. The Docker digest was not resolved
or tested locally; first pull must succeed before stage 2 can proceed.

## Rust loop sources (v0.2.0)

* [RustAssistant paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2024/08/paper.pdf):
  compiler diagnostics, localized source context, bounded candidate repair and rollback.
  This integration uses a simpler bounded single-candidate sequence, not a replication.
* [cargo check](https://doc.rust-lang.org/cargo/commands/cargo-check.html),
  [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html), and
  [Clippy](https://doc.rust-lang.org/cargo/commands/cargo-clippy.html):
  distinguish compilation, lint and behavioral gates. Rustfmt/Clippy are installed
  explicitly, since the minimal Rust profile does not include them.
