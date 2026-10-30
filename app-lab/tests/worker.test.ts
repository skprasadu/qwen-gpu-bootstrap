import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextOverflow, workerConfig, workerPrompt } from "../src/worker.ts";

test("context errors are recognized before long successful tool output, without accepting other failures", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "worker-events-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, "worker.log");
  const overflow = JSON.stringify({
    type: "error",
    error: { name: "ContextOverflowError" },
  });
  await writeFile(
    log,
    overflow +
      "\n" +
      JSON.stringify({ type: "text", part: { text: "x".repeat(140000) } }) +
      "\n",
  );
  assert.equal(await contextOverflow(log), true);
  await writeFile(
    log,
    overflow + '\n{"type":"error","error":{"name":"APIError"}}\n',
  );
  assert.equal(await contextOverflow(log), false);
  await writeFile(
    log,
    JSON.stringify({ type: "text", part: { text: overflow } }),
  );
  assert.equal(await contextOverflow(log), false);
});

test("workers reserve context, replace provider credentials and constrain each variant", () => {
  const source = {
    model: "local/test",
    provider: {
      local: {
        options: { apiKey: "private-test-key", baseURL: "http://private" },
        models: { test: { limit: { context: 16384, output: 2048 } } },
      },
    },
  };
  const configured = workerConfig(source, "http://gateway/run/list/v1");
  assert.deepEqual(configured.compaction, {
    auto: true,
    prune: true,
    reserved: 4096,
  });
  assert.equal(configured.provider.local.models.test.limit.context, 16384);
  assert.equal(configured.provider.local.options.apiKey, "p2i-worker");
  assert.equal(source.provider.local.options.apiKey, "private-test-key");
  for (const variant of ["list", "kanban", "focus"] as const) {
    const prompt = workerPrompt(
      variant,
      "Build all three views",
      "x".repeat(20000),
    );
    assert.ok(prompt.startsWith(`Implement ONLY the ${variant} variant.`));
    assert.ok(prompt.length < 6000);
    assert.match(prompt, /Do not ask whether to continue/);
  }
});
