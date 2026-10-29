import { mkdir, readFile, writeFile, symlink, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command } from "./process.ts";
import { atomicJson, copyProject, captureSource, hashTree } from "./files.ts";
import { labRoot } from "./generate.ts";
import type { Adapter, Run, Job, Evidence } from "./engine.ts";
export const network = "p2i-app-lab";
export class DockerAdapter implements Adapter {
  source = "local-qwen" as const;
  root: string;
  image: string;
  config: any;
  constructor(root: string, image: string, config: any) {
    this.root = root;
    this.image = image;
    this.config = config;
  }
  path(run: Run, job: Job, ...parts: string[]) {
    return join(this.root, run.id, job.variant, ...parts);
  }
  name(run: Run, job: Job, kind: string) {
    return `p2i-${run.id.slice(0, 8)}-${job.variant}-${kind}`;
  }
  async setup() {
    await command("docker", ["image", "inspect", this.image]);
    await command("docker", ["network", "inspect", network]).catch(() =>
      command("docker", ["network", "create", "--internal", network]),
    );
    const modelContainer = process.env.P2I_MODEL_CONTAINER ?? "qwen-coder";
    const connections = JSON.parse(
      await command("docker", [
        "inspect",
        "--format",
        "{{json .NetworkSettings.Networks}}",
        modelContainer,
      ]),
    );
    if (!connections[network])
      await command("docker", ["network", "connect", network, modelContainer]);
    const privateDir = join(this.root, "../private");
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    const provider = this.config.provider?.local;
    if (!provider?.models || !provider.options?.apiKey)
      throw new Error("Expected an explicit local provider and API key");
    let key = provider.options.apiKey;
    if (
      typeof key === "string" &&
      key.startsWith("{file:") &&
      key.endsWith("}")
    )
      key = (await readFile(key.slice(6, -1), "utf8")).trim();
    if (typeof key !== "string" || key.startsWith("{"))
      throw new Error(
        "Unsupported API key reference; resolve through setup, never log it",
      );
    await writeFile(join(privateDir, "api-key"), key, { mode: 0o600 });
    const metricsDir = join(this.root, "../metrics");
    await mkdir(metricsDir, { recursive: true });
    const existing = await command("docker", [
      "ps",
      "-a",
      "--filter",
      "name=^/p2i-inference$",
      "--format",
      "{{.Names}}",
    ]);
    if (existing.trim()) {
      const label = (
        await command("docker", [
          "inspect",
          "-f",
          '{{index .Config.Labels "p2i.role"}}',
          "p2i-inference",
        ])
      ).trim();
      if (label !== "gateway")
        throw new Error("Unrelated p2i-inference container");
      await command("docker", ["rm", "-f", "p2i-inference"]);
    }
    await command("docker", [
      "run",
      "-d",
      "--name",
      "p2i-inference",
      "--label",
      "p2i.role=gateway",
      "--restart",
      "unless-stopped",
      "--network",
      network,
      "--user",
      "0",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--mount",
      `type=bind,src=${privateDir}/api-key,dst=/run/model-key,readonly`,
      "--mount",
      `type=bind,src=${metricsDir},dst=/metrics`,
      "-e",
      `P2I_UPSTREAM=http://${modelContainer}:8000`,
      this.image,
      "node",
      "/opt/lab/src/gateway.ts",
    ]);
  }
  async prepare(run: Run, job: Job, signal: AbortSignal) {
    const work = this.path(run, job, "work");
    await copyProject(join(labRoot, "template"), work);
    await symlink(
      "/opt/lab/template/frontend/node_modules",
      join(work, "frontend/node_modules"),
    );
    await atomicJson(this.path(run, job, "protected.json"), {
      hash: await hashTree(work, true),
    });
    const config = {
      model: this.config.model,
      small_model: this.config.model,
      autoupdate: false,
      enabled_providers: ["local"],
      permission: { "*": "allow", external_directory: "deny" },
      provider: { local: structuredClone(this.config.provider.local) },
    };
    config.provider.local.options = {
      baseURL: `http://p2i-inference:8001/${run.id}/${job.variant}/v1`,
      apiKey: "p2i-worker",
    };
    config.model = this.config.model;
    config.small_model = this.config.model;
    await writeFile(
      this.path(run, job, "opencode.json"),
      JSON.stringify(config),
    );
    await chmod(this.path(run, job, "opencode.json"), 0o444);
    // Ownership is limited to this new generated workspace, never a home directory.
    await command(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "0",
        "-v",
        `${work}:/workspace`,
        this.image,
        "chown",
        "-R",
        "10001:10001",
        "/workspace",
      ],
      { signal },
    );
  }
  async container(
    run: Run,
    job: Job,
    kind: string,
    args: string[],
    signal: AbortSignal,
    timeout = 600_000,
  ) {
    const name = this.name(run, job, kind);
    const log = this.path(run, job, `${kind}-${job.attempts}.log`);
    try {
      return await command(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          name,
          "--label",
          `p2i.run=${run.id}`,
          "--label",
          `p2i.role=${kind}`,
          "--init",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "256",
          ...args,
        ],
        { signal, log, timeout },
      );
    } finally {
      await command("docker", ["rm", "-f", name], { timeout: 20_000 }).catch(
        () => {},
      );
    }
  }
  async generate(run: Run, job: Job, signal: AbortSignal) {
    const work = this.path(run, job, "work");
    const previous = job.history.at(-1);
    const prompt = `Build the ${job.variant} experience for this constrained todo brief: ${run.brief}\nRead AGENTS.md. Implement real frontend/src changes using the generated SDK. No dependency or API changes. ${previous ? "Repair these independent verification failures:\n" + previous.summary : "Implement now; the controller will verify your result."}`;
    await writeFile(this.path(run, job, `prompt-${job.attempts}.txt`), prompt);
    await this.container(
      run,
      job,
      "worker",
      [
        "--network",
        network,
        "--read-only",
        "--user",
        "10001:10001",
        "--memory",
        "6g",
        "--cpus",
        "2",
        "--tmpfs",
        "/tmp:rw,nosuid,size=1g,uid=10001,gid=10001",
        "--tmpfs",
        "/home/worker:rw,nosuid,size=1g,uid=10001,gid=10001",
        "-v",
        `${work}:/workspace:ro`,
        "-v",
        `${work}/frontend/src:/workspace/frontend/src:rw`,
        "-v",
        `${this.path(run, job, "opencode.json")}:/run/opencode.json:ro`,
        "-e",
        "OPENCODE_CONFIG=/run/opencode.json",
        "-w",
        "/workspace",
        this.image,
        "/opt/lab/docker/worker.sh",
        prompt,
      ],
      signal,
      Math.min(900_000, run.deadline - run.reserveMs - Date.now()),
    );
  }
  async verify(run: Run, job: Job, signal: AbortSignal): Promise<Evidence> {
    const work = this.path(run, job, "work");
    const expected = JSON.parse(
      await readFile(this.path(run, job, "protected.json"), "utf8"),
    ).hash;
    if (expected !== (await hashTree(work, true)))
      return {
        passed: false,
        category: "policy",
        summary: "Worker changed protected files",
        required: 4,
        passedTests: 0,
        skipped: 0,
      };
    const candidate = this.path(run, job, `candidate-${job.attempts}`);
    await captureSource(work, join(labRoot, "template"), candidate);
    await symlink(
      "/opt/lab/template/frontend/node_modules",
      join(candidate, "frontend/node_modules"),
    );
    const out = this.path(run, job, `evidence-${job.attempts}`);
    await mkdir(out, { recursive: true });
    const frozenHash = await hashTree(candidate, true);
    const fingerprint = await hashTree(candidate);
    const appName = this.name(run, job, "preview");
    const evalNetwork = this.name(run, job, "network");
    const port = 5181 + ["list", "kanban", "focus"].indexOf(job.variant);
    let passed = false;
    try {
      await this.container(
        run,
        job,
        "builder",
        [
          "--network",
          "none",
          "--read-only",
          "--user",
          "0",
          "--memory",
          "10g",
          "--cpus",
          "4",
          "--tmpfs",
          "/tmp:rw,size=2g",
          "-v",
          `${candidate}:/workspace`,
          "-v",
          `${out}:/evidence`,
          "-e",
          "CARGO_NET_OFFLINE=true",
          "-e",
          "RUST_LOOP_BIN=/usr/local/bin/rust-loop",
          this.image,
          "/opt/lab/docker/build.sh",
          job.variant,
        ],
        signal,
        Math.min(900_000, run.deadline - Date.now()),
      );
      if ((await hashTree(candidate, true)) !== frozenHash)
        throw new Error("Protected files changed during build");
      await command(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--user",
          "0",
          "-v",
          `${candidate}:/workspace`,
          this.image,
          "chmod",
          "-R",
          "a+rX",
          "/workspace",
        ],
        { signal },
      );
      // Builder is gone before evaluation. Candidate cannot access evaluator files/results.
      await command(
        "docker",
        ["network", "create", "--internal", evalNetwork],
        { signal },
      );
      await command(
        "docker",
        [
          "run",
          "-d",
          "--name",
          appName,
          "--label",
          `p2i.run=${run.id}`,
          "--label",
          "p2i.role=preview",
          "--label",
          `p2i.variant=${job.variant}`,
          "--restart",
          "unless-stopped",
          "--network",
          evalNetwork,
          "--init",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--user",
          "10001:10001",
          "--memory",
          "2g",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,size=128m,uid=10001",
          "-p",
          `127.0.0.1:${port}:5173`,
          "-v",
          `${candidate}:/workspace:ro`,
          this.image,
          "node",
          "/opt/lab/src/preview.ts",
        ],
        { signal },
      );
      await this.container(
        run,
        job,
        "evaluator",
        [
          "--network",
          evalNetwork,
          "--read-only",
          "--user",
          "0",
          "--memory",
          "2g",
          "--tmpfs",
          "/tmp:rw,size=1g",
          "-v",
          `${out}:/evidence`,
          "-e",
          `FRONTEND_URL=http://${appName}:5173`,
          "-e",
          `BACKEND_URL=http://${appName}:3000`,
          "-e",
          `P2I_VARIANT=${job.variant}`,
          this.image,
          "node",
          "/opt/lab/src/remote-evaluate.ts",
        ],
        signal,
        Math.min(300_000, run.deadline - Date.now()),
      );
      const acceptance = JSON.parse(
        await readFile(join(out, "acceptance.json"), "utf8"),
      );
      if (
        acceptance.passed !== true ||
        acceptance.required !== 4 ||
        acceptance.passedTests !== 4 ||
        acceptance.skipped !== 0
      )
        throw new Error("Invalid acceptance evidence");
      await command("docker", ["restart", appName], { signal });
      await this.container(
        run,
        job,
        "restart-check",
        [
          "--network",
          evalNetwork,
          "--read-only",
          "--user",
          "10001:10001",
          this.image,
          "node",
          "/opt/lab/src/restart-check.ts",
          `http://${appName}:3000`,
        ],
        signal,
        30_000,
      );
      passed = true;
      const evidence: Evidence = {
        passed: true,
        category: "code",
        summary:
          "Build, contract, four independent acceptance cases and backend restart passed",
        required: 4,
        passedTests: 4,
        skipped: 0,
        candidate,
        fingerprint,
      };
      await atomicJson(join(out, "result.json"), evidence);
      return evidence;
    } catch (error) {
      signal.throwIfAborted();
      const summary = String(error).slice(-12_000);
      let category: Evidence["category"] = /Protected/.test(summary)
        ? "policy"
        : /Readiness|browserType.launch|Cannot connect|Timeout|docker:|ENOENT/.test(
              summary,
            )
          ? "environment"
          : "code";
      try {
        const result = JSON.parse(
          await readFile(join(out, "result.json"), "utf8"),
        );
        category = result.category ?? category;
      } catch {}
      const evidence: Evidence = {
        passed: false,
        category,
        summary,
        required: 4,
        passedTests: 0,
        skipped: 0,
        candidate,
        fingerprint,
      };
      await atomicJson(join(out, "result.json"), evidence);
      return evidence;
    } finally {
      if (!passed) {
        await command("docker", ["rm", "-f", appName]).catch(() => {});
        await command("docker", ["network", "rm", evalNetwork]).catch(() => {});
      }
    }
  }
  async publish(run: Run, job: Job, signal: AbortSignal) {
    const evidence = job.history.at(-1);
    if (!evidence?.passed || !evidence.candidate)
      throw new Error("No verified candidate");
    const candidate = evidence.candidate;
    const port = 5181 + ["list", "kanban", "focus"].indexOf(job.variant);
    const name = this.name(run, job, "preview");
    signal.throwIfAborted();
    try {
      const { readiness } = await import("./process.ts");
      await readiness(`http://127.0.0.1:${port}`);
    } catch (error) {
      await command("docker", ["rm", "-f", name]);
      throw error;
    }
    await atomicJson(this.path(run, job, "verified.json"), {
      candidate,
      port,
      at: Date.now(),
      fingerprint: evidence.fingerprint,
    });
    return port;
  }
  async cleanup(run: Run, previews: boolean) {
    const ids = (
      await command("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=p2i.run=${run.id}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) {
      const role = (
        await command("docker", [
          "inspect",
          "-f",
          '{{index .Config.Labels "p2i.role"}}',
          id,
        ])
      ).trim();
      const variant = (
        await command("docker", [
          "inspect",
          "-f",
          '{{index .Config.Labels "p2i.variant"}}',
          id,
        ])
      ).trim();
      if (
        previews ||
        role !== "preview" ||
        !run.jobs.some((j) => j.variant === variant && j.status === "passed")
      )
        await command("docker", ["rm", "-f", id]);
    }
    for (const job of run.jobs)
      if (previews || job.status !== "passed")
        await command("docker", [
          "network",
          "rm",
          this.name(run, job, "network"),
        ]).catch(() => {});
  }
}
export async function loadAdapter(root: string) {
  const configPath =
    process.env.P2I_OPENCODE_CONFIG ??
    resolve(
      process.env.HOME ?? "/root",
      ".local/share/qwen-bootstrap/opencode.json",
    );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return new DockerAdapter(
    root,
    process.env.P2I_IMAGE ?? "p2i-app-lab:local",
    config,
  );
}
