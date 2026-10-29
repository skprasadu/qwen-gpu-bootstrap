import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type Adapter } from "../src/engine.ts";
import { createLabServer } from "../src/server.ts";
import { get } from "node:http";
test("private dashboard rejects cross-origin mutations, invalid host and unqualified concurrency", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "p2i-server-"));
  const adapter: Adapter = {
    source: "fake-test",
    async prepare() {},
    async generate() {},
    async verify() {
      return {
        passed: false,
        category: "environment",
        summary: "fixture",
        required: 4,
        passedTests: 0,
        skipped: 0,
      };
    },
    async publish() {
      return 5181;
    },
    async cleanup() {},
  };
  const engine = new Engine(root, adapter);
  const server = createLabServer(engine, 1);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });
  assert.equal((await fetch(base + "/api/runs")).status, 200);
  const invalidHost = await new Promise<number | undefined>(
    (resolve, reject) => {
      get(base + "/api/runs", { headers: { host: "evil.example" } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on("error", reject);
    },
  );
  assert.equal(invalidHost, 403);
  assert.equal(
    (
      await fetch(base + "/api/runs", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: "todo", concurrency: 2 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(base + "/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: "todo", concurrency: 1 }),
      })
    ).status,
    202,
  );
  await engine.active?.done;
});
