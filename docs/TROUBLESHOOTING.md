# Security, recovery and diagnostics

* Use a dedicated development VM/account. OpenCode can execute commands as that
  user; its permission UI is not an operating-system sandbox. The smoke tests
  explicitly allow tools in a disposable folder and deny external-directory
  tool permissions. Do not put secrets in that folder or run untrusted prompts.
* vLLM is published only on host loopback and requires a generated API key for
  `/v1` model requests. vLLM also has endpoints outside `/v1` that are not
  protected by its API-key option; loopback plus SSH is the security boundary.
  Health is public on loopback. Do not change the published bind
  to 0.0.0.0 or open firewall ports. All normal access uses SSH tunnels.
* The key and dedicated config are private to the user. The container receives
  the key through a mode-600 env file, not the command line. Root/Docker admins
  can still inspect it. No Docker group membership is granted: that is root
  equivalent. Docker commands run directly as root. vLLM runs as container root with dropped Linux
  capabilities, only the model cache mounted, and no Docker socket or app source.
* Do not run either stage with shell tracing (`bash -x`). Review logs before
  sharing: prompts, paths, generated source and model output may be present.
  API keys are not intentionally logged. Container logs rotate (3 x 20MB).
* Stage 1 logs and package inventory: `/var/log/qwen-bootstrap/` (root-private).
  Stage 2: `~/.local/share/qwen-bootstrap/logs/`; smoke evidence lives in the
  printed `smoke-*` directory. `./scripts/diagnostics.sh` collects bounded output
  without full container inspection/environment or the API-key file.
* Bootstrap scripts stop on error and can be rerun after fixing the cause. They
  are repeatable, not transactional: an interrupted APT change may require
  `dpkg --configure -a` before retry. Concurrent runs are locked per stage;
  do not run the two stages simultaneously.
* Existing Docker installations with conflicting Ubuntu `docker.io`/containerd
  packages may require provider-specific migration. The script does not purge
  existing packages, drivers, containers or data to force installation.
* A container-rental rejection is deliberate. Request host driver/toolkit setup
  from the provider or choose a true VM. No driver-install shortcut is safe in
  an ordinary Vast Docker instance. Both stages assume a direct root login and keep their user-scoped tools in /root.
* Driver install failures: inspect APT output, matching running-kernel headers,
  DKMS logs and Secure Boot. Stage 1 refuses enabled Secure Boot to avoid an
  unattended module-signing/enrollment failure. Reboot must be provider-supported.
* `nvidia-smi` on host but not in Docker: rerun stage 1, reboot, check
  `nvidia-ctk runtime configure --runtime=docker`, then restart Docker.
  Restarting Docker interrupts other containers.
* Host RAM preflight rejection: `free -h` reports system RAM; `nvidia-smi`
  reports separate GPU VRAM. Stage 2 requires at least 120 GiB visible in
  `/proc/meminfo` by default, targeting a >=128GB host. For example, 101708100 kB
  in `MemTotal` is about 97.0 GiB and fails this cutoff even with a 96GB GPU.
  Prefer a host with more RAM. To explicitly try the existing host, run
  `QWEN_ALLOW_LOW_RAM=1 bash bootstrap-02.sh`. This is an unverified override,
  not a claim that the model will fit. It changes only the host RAM guard; it
  does not change the model, GPU settings or success criteria.
  If startup fails, inspect `docker logs --tail 100 qwen-coder`,
  `docker inspect -f '{{.State.OOMKilled}} {{.State.ExitCode}}' qwen-coder`
  and `journalctl -k -b` for host out-of-memory kills. A host OOM requires
  addressing system RAM pressure; reducing GPU context alone may not help.
* Startup OOM: inspect `docker logs qwen-coder`. First stop other GPU users.
  Reducing context may help memory, but OpenCode's system/tool definitions also
  consume context. A context small enough to load may be too small for the client.
  If experimenting, change BOTH the vLLM context flag and the client context in
  `scripts/configure.py`, and repeat all smoke tests. Never count startup alone
  as success or blindly raise utilization to 1.0. Prefer more VRAM if this baseline
  fails. If kernels fail on SM120, save diagnostics and review a new image pin.
* Model downloads can fail from disk pressure, network interruption or rate
  limiting. Cached shards are reused. The public model normally needs no HF key;
  this bundle does not forward arbitrary host HF credentials into the container.
* Real tool test failure: keep edit/repair JSONL and stderr files; check tool
  parser, config, model ID, token budget and actual tool-use events. Model prose
  saying “done” is not a pass. A failed repair must leave stage 2 unsuccessful.
* To update the image deliberately, stop inference, archive the existing private
  `image.lock`, change versions.env, rerun stage 2, then repeat all GPU tests.
  Do not share the entire state folder: it contains the API key.
* Stop with `docker stop qwen-coder`. To uninstall the serving container,
  remove that named container after reviewing it. Remove cache/client/config
  directories only deliberately; the cache is large and expensive to redownload.
  No destructive uninstall command is run automatically. Stop/destroy the rented
  machine through Vast when finished to end rental charges.
