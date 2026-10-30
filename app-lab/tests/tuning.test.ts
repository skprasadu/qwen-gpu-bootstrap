import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tunedProfile,
  safeCommand,
  TuningTransaction,
  type DockerControl,
} from "../src/tuning-profile.ts";
const original = {
  Id: "old",
  Name: "/qwen-coder",
  Image: "sha256:pinned",
  Config: {
    Labels: { "qwen-bootstrap": "managed" },
    Cmd: [
      "model",
      "--max-num-seqs",
      "1",
      "--max-num-batched-tokens",
      "2048",
      "--enable-chunked-prefill",
      "--enforce-eager",
      "--gpu-memory-utilization",
      "0.95",
    ],
  },
  HostConfig: { Binds: ["cache:/cache"] },
  NetworkSettings: { Networks: {} },
};
test("graph profile changes only explicit tuning knobs and preserves image/memory/mounts", () => {
  const p = tunedProfile(original, { id: "graphs", eager: false, batch: 4096 });
  assert.equal(p.Image, original.Image);
  assert.deepEqual(p.HostConfig, original.HostConfig);
  assert.ok(p.Cmd.includes("--no-enforce-eager"));
  assert.ok(!p.Cmd.includes("--enforce-eager"));
  assert.equal(p.Cmd[2], "2");
  assert.equal(p.Cmd[4], "4096");
  assert.ok(p.Cmd.includes("0.95"));
  assert.equal(original.Config.Cmd[2], "1");
  const duplicate = structuredClone(original);
  duplicate.Config.Cmd.push("--max-num-seqs=4");
  assert.throws(
    () => tunedProfile(duplicate, { id: "x", eager: false, batch: 2048 }),
    /Duplicate/,
  );
  assert.deepEqual(safeCommand(["--api-key=secret", "--api-key", "secret"]), [
    "--api-key=[redacted]",
    "--api-key",
    "[redacted]",
  ]);
});
test("failed startup can restore original and refuses foreign replacement", async () => {
  const state = await mkdtemp(join(tmpdir(), "tune-test-"));
  const containers: any[] = [structuredClone(original)];
  const control: DockerControl = {
    async inspect(name) {
      const c = containers.find((c) => c.Id === name || c.Name === `/${name}`);
      if (!c) throw Error("missing");
      return structuredClone(c);
    },
    async run(args) {
      if (args[0] === "rename")
        containers.find((c) => c.Name === `/${args[1]}`)!.Name = `/${args[2]}`;
      if (args[0] === "rm")
        containers.splice(
          containers.findIndex((c) => c.Id === args[2]),
          1,
        );
    },
    async create(name, payload) {
      containers.push({ Id: "new", Name: `/${name}`, Config: payload });
      return { Id: "new" };
    },
    async healthy() {
      if (containers.some((c) => c.Id === "new")) throw Error("GPU OOM");
    },
  };
  try {
    const tx = new TuningTransaction(state, control);
    await tx.begin("qwen-coder");
    await assert.rejects(
      tx.install(
        tunedProfile(original, { id: "x", eager: false, batch: 2048 }),
      ),
      /OOM/,
    );
    containers[1].Config.Labels["p2i.tuning"] = "foreign";
    await assert.rejects(tx.restore(), /not owned/);
    containers.pop();
    await tx.restore();
    assert.equal(containers[0].Name, "/qwen-coder");
    assert.equal(await tx.load(), undefined);
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});
