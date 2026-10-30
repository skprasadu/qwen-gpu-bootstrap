import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("service entry survives missing HOME and passes the resolved home to transient jobs", async () => {
  const bin = await mkdtemp(join(tmpdir(), "p2i-service-env-"));
  try {
    for (const [name, body] of Object.entries({
      id: 'echo 0',
      systemctl: 'echo dashboard-status-reached',
      node: 'exit 0',
      "systemd-run": 'printf "%s\\n" "$@"',
    })) await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const script = resolve("../scripts/app-lab.sh");
    for (const home of [undefined, "/custom/home"]) {
      const env: NodeJS.ProcessEnv = { PATH: `${bin}:/usr/bin:/bin` };
      if (home) env.HOME = home;
      const status = spawnSync("/bin/bash", [script, "status"], { env, encoding: "utf8" });
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /dashboard-status-reached/);
      for (const action of ["tune", "benchmark"]) {
        const result = spawnSync("/bin/bash", [script, action], { env, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(result.stdout.includes(`--setenv=HOME=${home ?? "/root"}`), result.stdout);
      }
    }
  } finally { await rm(bin, { recursive: true, force: true }); }
});
