# Qwen coding VM bootstrap

## App Lab: one brief, three todo prototypes

The App Lab iteration is on **`feat/p2i-app-lab`** while its PR is under review.
Run the familiar stages as root on your rented Ubuntu VM, then the new stage 03.
No `sudo` is needed when already logged in as root.

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

Reconnect as root, then:

```bash
cd /home/user/my-applications/qwen-gpu-bootstrap
bash bootstrap-02.sh
bash bootstrap-03.sh
```

For the previously used **96GiB host-RAM** instance, stage 02 retains the existing
explicit opt-in: use `QWEN_ALLOW_LOW_RAM=1 bash bootstrap-02.sh` in place of the
plain stage-02 command. This does not change the FP8 model or guarantee that every
96GiB machine will load it. A machine with >=128GB host RAM uses the normal command.

Stage 03 builds and tests the App Lab environment, attempts a reversible
two-request serving qualification, and starts the persistent dashboard. If two
requests are not qualified, the dashboard retains a sequential mode. Forward
**5173, 5181, 5182, 5183** through VS Code Remote SSH and open
**http://localhost:5173** on your Mac. Submit your brief there; App Lab creates
its run folders and asks local Qwen to produce List, Kanban and Daily Focus views.

If stages 01 and 02 already work, run **only `bash bootstrap-03.sh`** for App Lab.
To preserve the current serving profile during setup, use
`P2I_QUALIFY_TWO=0 bash bootstrap-03.sh` and qualify concurrency later.
Read [App Lab instructions](app-lab/README.md) for status, updates, comparison and
rollback. [Validation](app-lab/docs/VALIDATION.md) distinguishes local/CI checks
from the GPU trial you will run after rental.

## Original bootstrap requirements

A two-stage setup for a **true Ubuntu 22.04/24.04 x86_64 VM or bare-metal host**,
one NVIDIA RTX PRO 6000 Blackwell 96GB, a root SSH account, >=128GB RAM,
>=250GB recommended free on the home filesystem and >=40GB on Docker storage.
If both use one filesystem, rent >=300GB free; a 400GB+ disk is more comfortable.
Internet access is needed for apt, Docker Hub, npm, Node, Rust and Hugging Face.

**Vast warning:** many Vast offers are Docker containers, even when SSH works.
Those cannot own the host driver or reboot the host. These scripts reject them.
Confirm a true VM/bare-metal offering with host administration before paying.
This is a source-reviewed, locally tested bootstrap candidate, not a GPU-certified
image. See [validation](docs/VALIDATION.md) and [sources](docs/SOURCES.md).

## Run

Upload/extract the ZIP on the VM, then in its extracted directory:

```bash
chmod +x bootstrap-*.sh scripts/*.sh
bash bootstrap-01.sh
reboot
```

This iteration assumes you log in as root. There is no non-root/sudo account
check or sudo command in either stage. Rust, OpenCode and state belong to /root.

Reconnect over SSH as the **root**, return to this directory:

```bash
./bootstrap-02.sh
```

Stage 2 requires at least **120 GiB of visible host RAM** by default, targeting
machines rented with >=128GB RAM. The GPU's 96GB VRAM is separate from host RAM.
If your host has less RAM, an explicit, unverified trial is available:

```bash
QWEN_ALLOW_LOW_RAM=1 bash bootstrap-02.sh
```

This overrides only the host RAM cutoff and prints a warning. Model loading or
inference may still run out of host RAM; all other checks and smoke tests remain
required. More host RAM is the recommended fix. See [troubleshooting](docs/TROUBLESHOOTING.md).

Stage 1 prepares an open R580 NVIDIA driver (preserves a compatible working one),
Docker and NVIDIA Container Toolkit, git/build tools, pinned Node/npm and Rust.
It records a mandatory reboot boundary; it does not reboot automatically.
CUDA 13.0.3 user libraries come inside the pinned vLLM image; no host CUDA toolkit
is necessary. A stage 1 rerun requires another reboot.

Stage 2 checks the machine, installs pinned OpenCode, locks the Docker image
by digest on first pull, installs the Rust repair controller, starts the server,
waits for health, and runs API tool
calling plus **real OpenCode file-edit, Python repair, and Rust compiler-repair smoke tests**.
First startup downloads ~80.36GB of checkpoint tensors and can take an hour.
A timeout means failure, not successful setup. Follow the diagnostic instructions.

## Upgrade the already-working server (no GPU reinstall/reboot)

Extract this release into a NEW bootstrap directory and run from that directory:

```bash
bash scripts/install-rust-loop.sh
bash scripts/enable-rust-loop.sh /home/user/my-applications/todo-app
```

The first command installs the root Rust controller and rustfmt/Clippy. The second
backs up AGENTS.md if it changes, appends the mandatory backend gates once,
adds .rust-loop/ to .gitignore, and leaves application source/provider config alone. Keep the existing app and inference
container; you do not need to rerun stage 1 or 2 just to enable this iteration.

```bash
source /root/.profile
/root/.local/bin/rust-loop check --project /home/user/my-applications/todo-app/backend
/root/.local/bin/rust-loop repair --project /home/user/my-applications/todo-app/backend --max-attempts 3
```

Close/reopen the OpenCode chat after updating AGENTS.md so it loads the new rules.
Ask it: “Follow AGENTS.md, run the Rust backend gates, use rust-loop for any
implementation repair, and report actual results. Preserve my existing app.”
Read [the Rust loop contract](docs/RUST-LOOP.md), especially existing inline tests.
To test real Qwen-driven Rust repair independently:
`bash scripts/rust-loop-smoke.sh`. This creates an isolated fixture, not app edits.

## Create your application

```bash
./scripts/new-app.sh "/home/user/my-applications/todo-app"
cd "/home/user/my-applications/todo-app"
opencode
```

The helper creates a new folder with AGENTS.md, a local provider config and Git.
It refuses to overwrite an existing folder. For another existing project, copy
AGENTS.md and `~/.local/share/qwen-bootstrap/opencode.json` manually after reviewing
its existing instructions/config. Do not use the bootstrap repository itself as
the app folder. The project config refers to an absolute API-key file belonging
to your SSH account; it contains no key value and is specific to that VM/account.

Suggested prompt:

> Build a complete in-memory todo app following AGENTS.md. Implement CRUD, test
> the backend and frontend, repair failures, and give me the two commands to run
> it. Use React/TypeScript/MUI in frontend and Rust/Axum in backend.

The expected app commands, once the agent has actually built it, are:

```bash
cd frontend && npm run dev
# In another terminal, from the app folder:
cd backend && npm run dev
```

The app is generated by the model when you ask; this ZIP does not include or
claim to have tested that future application. The 16K context baseline may limit
larger tasks. Keep prompts small and verify generated code.

## VS Code on your Mac

1. Install Microsoft's Remote - SSH extension locally. Use the host, mapped SSH
   port and key shown by your rental provider, not a guessed IP/port.
2. Connect using Remote-SSH and open the app folder on the VM.
3. Install OpenCode's IDE extension **in the SSH remote extension host**. Open a
   fresh terminal so `opencode` is in PATH. The remote CLI is the tested baseline;
   extension-specific UI behavior/version has not been tested here.
4. In VS Code's Ports panel forward remote **5173** to local 5173 and **3000** to
   local 3000, both private. Open http://localhost:5173 on the Mac. Vite proxies
   `/api` on the VM to Axum; the browser never needs a public backend URL.
5. OpenCode runs on the VM and reaches vLLM there at 127.0.0.1:8000. You need not
   forward 8000 unless a client intentionally runs on your Mac.

Optional SSH config on the Mac (replace placeholders):

```sshconfig
Host coding-gpu
    HostName PROVIDER_HOST
    User root
    Port PROVIDER_SSH_PORT
    IdentityFile ~/.ssh/YOUR_KEY
    ServerAliveInterval 30
    LocalForward 5173 127.0.0.1:5173
    LocalForward 3000 127.0.0.1:3000
```

Use either SSH forwards or VS Code Ports forwarding; do not compete for the same
local port. If local 5173 is occupied, choose another local forwarded port and
open that port in your browser. Retain SSH host-key verification.

## Operate

```bash
docker logs -f qwen-coder
./scripts/diagnostics.sh
./scripts/opencode-smoke.sh       # repeat real model/client tests
docker stop qwen-coder       # stop inference; VM billing may continue
docker start qwen-coder
```

Re-running stage 2 preserves the API key, model cache and image digest, recreates
only its labelled container, regenerates its dedicated config, and repeats tests.
It interrupts active model requests. It never overwrites global OpenCode config
or app code. See [security and recovery](docs/TROUBLESHOOTING.md).
