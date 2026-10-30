import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateReport } from "../src/verify.ts";
import { hashTree, captureSource } from "../src/files.ts";
import { command, readiness } from "../src/process.ts";
import { spawn } from "node:child_process";
test("evaluator rejects skipped, flaky, omitted and empty test reports", () => {
  const make = () => ({
    suites: [
      {
        specs: [
          {
            tests: Array.from({ length: 4 }, () => ({
              status: "expected",
              expectedStatus: "passed",
              results: [{ status: "passed" }],
            })),
          },
        ],
      },
    ],
  });
  assert.ok(validateReport(make()));
  assert.ok(!validateReport({ suites: [] }));
  const skipped = make();
  skipped.suites[0].specs[0].tests[0].results[0].status = "skipped";
  assert.ok(!validateReport(skipped));
  const omitted = make();
  omitted.suites[0].specs[0].tests.pop();
  assert.ok(!validateReport(omitted));
  const retried = make();
  retried.suites[0].specs[0].tests[0].results.unshift({ status: "failed" });
  assert.ok(!validateReport(retried));
});
test("source edits are allowed, protected changes detected, escaping symlinks rejected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "p2i-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "frontend/src"), { recursive: true });
  await writeFile(join(root, "frontend/src/page.tsx"), "first");
  await writeFile(join(root, "frontend/package.json"), "{}");
  await writeFile(join(root, "frontend/next-env.d.ts"), "");
  const before = await hashTree(root, true);
  await writeFile(join(root, "frontend/src/page.tsx"), "edited");
  assert.equal(await hashTree(root, true), before);
  await writeFile(join(root, "frontend/package.json"), "changed");
  assert.notEqual(await hashTree(root, true), before);
  await symlink("/etc/passwd", join(root, "frontend/src/leak.ts"));
  await assert.rejects(
    () => captureSource(root, root, join(root, "captured")),
    /Symlink/,
  );
});
test("a process that exits instead of listening is classified as a readiness failure", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await new Promise((r) => child.once("exit", r));
  await assert.rejects(
    () => readiness("http://127.0.0.1:1/health", child, 100),
    /exited before readiness/,
  );
});
test("command timeout terminates the child process group", async () => {
  await assert.rejects(
    () =>
      command(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        timeout: 80,
      }),
    /Timeout/,
  );
});
