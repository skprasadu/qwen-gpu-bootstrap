import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  Engine,
  type Adapter,
  type Run,
  type Job,
  type Evidence,
} from "../src/engine.ts";
import { atomicJson } from "../src/files.ts";
import { ContextOverflow } from "../src/worker.ts";
class Fake implements Adapter {
  source = "fake-test" as const;
  active = 0;
  peak = 0;
  cleaned = 0;
  wait = 15;
  verifyWait = 0;
  result: (job: Job) => Evidence = () => ({
    passed: true,
    category: "code",
    summary: "fake fixture only",
    required: 4,
    passedTests: 4,
    skipped: 0,
  });
  async prepare() {}
  async generate(_r: Run, _j: Job, signal: AbortSignal) {
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try {
      await delay(this.wait, undefined, { signal });
    } finally {
      this.active--;
    }
  }
  async verify(_r: Run, j: Job, signal: AbortSignal) {
    if (this.verifyWait) await delay(this.verifyWait, undefined, { signal });
    return this.result(j);
  }
  async publish() {
    return 5174;
  }
  async cleanup() {
    this.cleaned++;
  }
}
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), "p2i-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = new Fake();
  return { root, fake, engine: new Engine(root, fake) };
}
test("three jobs run with a strict two-worker ceiling and persist their evidence", async (t) => {
  const { engine, fake } = await fixture(t);
  await engine.start("todo", 2, 2000, 100);
  await engine.active!.done;
  assert.equal(fake.peak, 2);
  const [run] = await engine.list();
  assert.equal(run.state, "passed");
  assert.equal(run.source, "fake-test");
  assert.equal(run.jobs.length, 3);
  assert.ok(run.jobs.every((j) => j.history.length === 1 && j.attempts === 1));
});
test("simultaneous submissions cannot start two runs", async (t) => {
  const { engine } = await fixture(t);
  const submissions = await Promise.allSettled([
    engine.start("first", 1, 2000, 100),
    engine.start("second", 1, 2000, 100),
  ]);
  assert.equal(submissions.filter((s) => s.status === "fulfilled").length, 1);
  await engine.active!.done;
});
test("code failure gets a bounded repair, while environment failure is not sent back for code changes", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.result = (j) => ({
    passed: j.variant === "list" && j.attempts > 1,
    category: j.variant === "kanban" ? "environment" : "code",
    summary: "injected failure",
    required: 4,
    passedTests: j.variant === "list" && j.attempts > 1 ? 4 : 0,
    skipped: 0,
    fingerprint: String(j.attempts),
  });
  await engine.start("todo", 2, 3000, 100);
  await engine.active!.done;
  const [run] = await engine.list();
  assert.equal(run.jobs[0].attempts, 2);
  assert.equal(run.jobs[1].attempts, 1);
  assert.equal(run.jobs[2].attempts, 4);
  assert.equal(run.state, "partial");
});
test("unchanged repeated failure stops early", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.result = () => ({
    passed: false,
    category: "code",
    summary: "same error",
    required: 4,
    passedTests: 0,
    skipped: 0,
    fingerprint: "unchanged",
  });
  await engine.start("todo", 1, 2000, 100);
  await engine.active!.done;
  assert.ok((await engine.list())[0].jobs.every((j) => j.attempts === 2));
});
test("context overflow verifies saved source and uses a fresh bounded repair without weakening gates", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.generate = async () => {
    throw new ContextOverflow("context exceeded");
  };
  fake.result = (j) => ({
    passed: j.variant === "list" || j.attempts === 2,
    category: "code",
    summary: "required behavior missing",
    required: 4,
    passedTests: j.variant === "list" || j.attempts === 2 ? 4 : 0,
    skipped: 0,
    fingerprint: String(j.attempts),
  });
  await engine.start("todo", 2, 2000, 100);
  await engine.active!.done;
  const [run] = await engine.list();
  assert.equal(run.state, "passed");
  assert.deepEqual(
    run.jobs.map((j) => j.attempts),
    [1, 2, 2],
  );
  assert.ok(run.jobs.every((j) => j.generationWarnings?.length === j.attempts));
});
test("unrelated generation failures stay fatal and preview failures retain passing evidence", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.generate = async (_r, j) => {
    if (j.variant === "kanban") throw Error("docker unavailable");
  };
  fake.publish = async () => {
    throw Error("Readiness timeout");
  };
  await engine.start("todo", 2, 2000, 100);
  await engine.active!.done;
  const [run] = await engine.list();
  assert.equal(run.jobs[0].failureStage, "preview");
  assert.equal(run.jobs[0].history[0].passedTests, 4);
  assert.equal(run.jobs[1].failureStage, "generation");
  assert.equal(run.jobs[1].history.length, 0);
  assert.ok(run.jobs.every((j) => j.status === "failed" && !j.preview));
});
test("zero tests and skipped required tests cannot be accepted", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.result = () => ({
    passed: true,
    category: "code",
    summary: "lying provider",
    required: 0,
    passedTests: 0,
    skipped: 1,
  });
  await engine.start("todo", 2, 2000, 100);
  await engine.active!.done;
  assert.notEqual((await engine.list())[0].state, "passed");
  assert.ok((await engine.list())[0].jobs.every((j) => !j.preview));
});
test("cancellation stops outstanding generations and queued work", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.wait = 5000;
  const run = await engine.start("todo", 2, 10000, 100);
  await delay(10);
  await engine.cancel(run.id);
  assert.equal(fake.active, 0);
  assert.equal((await engine.list())[0].state, "cancelled");
  assert.ok(fake.cleaned > 0);
});
test("global deadline includes generation and does not grant a fresh budget per retry", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.wait = 5000;
  fake.verifyWait = 5000;
  const begin = Date.now();
  await engine.start("todo", 2, 180, 30);
  await engine.active!.done;
  assert.ok(Date.now() - begin < 1500);
  assert.equal(fake.active, 0);
  assert.equal((await engine.list())[0].state, "failed");
});
test("generation cutoff preserves time to verify already written candidates", async (t) => {
  const { engine, fake } = await fixture(t);
  fake.wait = 5000;
  await engine.start("todo", 2, 300, 100);
  await engine.active!.done;
  const [run] = await engine.list();
  assert.equal(run.state, "partial");
  assert.equal(run.jobs.filter((j) => j.status === "passed").length, 2);
  assert.equal(fake.active, 0);
});
test("restart reconciliation never claims that an old conversation restored a process", async (t) => {
  const { engine, root, fake } = await fixture(t);
  const run: Run = {
    id: "restart",
    brief: "todo",
    concurrency: 2,
    createdAt: 0,
    deadline: 5000,
    reserveMs: 100,
    state: "running",
    source: "fake-test",
    interventions: 0,
    jobs: [{ variant: "list", status: "generating", attempts: 1, history: [] }],
  };
  await mkdir(join(root, run.id));
  await atomicJson(join(root, run.id, "run.json"), run);
  await engine.recover();
  const restored = (await engine.list())[0];
  assert.equal(restored.state, "interrupted");
  assert.equal(restored.jobs[0].status, "interrupted");
  assert.equal(fake.cleaned, 1);
});
