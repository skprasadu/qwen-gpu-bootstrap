import { test } from "node:test";
import assert from "node:assert/strict";
import { cloneProfile } from "../src/profile.ts";
test("concurrency profile preserves image, model, environment, memory, bindings and command order", () => {
  const original = {
    Image: "sha256:actually-running-image",
    Config: {
      Image: "vllm/vllm-openai:v0.32.0",
      Env: ["VLLM_API_KEY=private"],
      Cmd: [
        "model",
        "--revision",
        "revision",
        "--max-num-seqs",
        "1",
        "--max-model-len",
        "16384",
        "--gpu-memory-utilization",
        "0.95",
      ],
    },
    HostConfig: {
      PortBindings: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "8000" }] },
      Binds: ["cache:/cache"],
      DeviceRequests: [{ Count: -1, Capabilities: [["gpu"]] }],
    },
    NetworkSettings: {
      Networks: { bridge: { Aliases: null, IPAddress: "172.1.1.1" } },
    },
  };
  const copy = cloneProfile(original);
  assert.equal(copy.Image, original.Image);
  assert.deepEqual(copy.Env, original.Config.Env);
  assert.deepEqual(copy.HostConfig, original.HostConfig);
  assert.equal(copy.Cmd[4], "2");
  assert.equal(original.Config.Cmd[4], "1");
  assert.ok(!JSON.stringify(copy.NetworkingConfig).includes("172.1.1.1"));
});
