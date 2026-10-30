// Host-side Docker networking regression. Synthetic HTTP fixture; no model calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerAdapter } from "./docker.ts";
import { command, readiness } from "./process.ts";
import type { Run } from "./engine.ts";

for (const [variant, expectedPort] of [
  ["list", 5174],
  ["kanban", 5175],
  ["focus", 5176],
] as const) {
  const root = await mkdtemp(join(tmpdir(), "p2i-preview-check-"));
  const adapter = new DockerAdapter(
    root,
    process.env.P2I_IMAGE ?? "p2i-app-lab:local",
    {},
  );
  const run: Run = {
    id: randomUUID(),
    brief: "Synthetic preview networking check",
    source: "fake-test",
    state: "running",
    concurrency: 1,
    createdAt: Date.now(),
    deadline: Date.now() + 60000,
    reserveMs: 0,
    interventions: 0,
    jobs: [
      {
        variant,
        status: "publishing",
        attempts: 1,
        history: [
          {
            passed: true,
            category: "environment",
            summary: "synthetic fixture only",
            required: 4,
            passedTests: 4,
            skipped: 0,
            candidate: root,
          },
        ],
      },
    ],
  };
  const job = run.jobs[0];
  const app = adapter.name(run, job, "preview");
  const network = adapter.name(run, job, "network");
  try {
    await command("docker", ["network", "create", "--internal", network]);
    await command("docker", [
      "run",
      "-d",
      "--name",
      app,
      "--label",
      `p2i.run=${run.id}`,
      "--label",
      "p2i.role=preview",
      "--label",
      `p2i.variant=${variant}`,
      "--network",
      network,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--user",
      "10001:10001",
      adapter.image,
      "node",
      "-e",
      'require("node:http").createServer((q,s)=>s.end("preview-check")).listen(5173,"0.0.0.0")',
    ]);
    const port = await adapter.publish(run, job, new AbortController().signal);
    assert.equal(port, expectedPort);
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "preview-check",
    );
    const appNetworks = JSON.parse(
      await command("docker", [
        "inspect",
        "-f",
        "{{json .NetworkSettings.Networks}}",
        app,
      ]),
    );
    assert.deepEqual(Object.keys(appNetworks), [network]);
    const bindings = JSON.parse(
      await command("docker", [
        "inspect",
        "-f",
        "{{json .NetworkSettings.Ports}}",
        adapter.name(run, job, "relay"),
      ]),
    );
    assert.deepEqual(bindings["5173/tcp"], [
      { HostIp: "127.0.0.1", HostPort: String(port) },
    ]);
    job.status = "passed";
    await adapter.cleanup(run, false);
    await readiness(`http://127.0.0.1:${port}`);
    await command("docker", ["restart", app, adapter.name(run, job, "relay")]);
    await readiness(`http://127.0.0.1:${port}`);
    console.log(
      `PASS synthetic Docker ${variant} preview on ${port}: host HTTP, loopback-only binding, app isolation, retention and restart`,
    );
  } finally {
    await adapter.cleanup(run, true);
    await rm(root, { recursive: true, force: true });
  }
}
