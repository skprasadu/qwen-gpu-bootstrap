import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, cp } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { command, readiness, stop } from "./process.ts";
import { generate, labRoot } from "./generate.ts";
import { atomicJson, hashTree } from "./files.ts";
import type { Evidence } from "./engine.ts";
export function validateReport(report: any, required = 4) {
  const tests: any[] = [];
  const visit = (suite: any) => {
    for (const spec of suite.specs ?? []) tests.push(...spec.tests);
    for (const sub of suite.suites ?? []) visit(sub);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return (
    tests.length === required &&
    (report.errors ?? []).length === 0 &&
    tests.every(
      (t) =>
        t.status === "expected" &&
        t.expectedStatus === "passed" &&
        t.results?.length === 1 &&
        t.results[0].status === "passed",
    )
  );
}
async function port() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}
export async function verify(
  project: string,
  variant: string,
  out: string,
  buildOnly = false,
): Promise<Evidence> {
  await mkdir(out, { recursive: true });
  const stages: {
    name: string;
    passed: boolean;
    milliseconds: number;
    error?: string;
  }[] = [];
  const fingerprint = await hashTree(project);
  const protectedHash = await hashTree(project, true);
  let backend: ChildProcess | undefined,
    frontend: ChildProcess | undefined,
    category: Evidence["category"] = "environment";
  const signal = AbortSignal.timeout(15 * 60_000);
  async function gate(name: string, action: () => Promise<unknown>) {
    const begin = Date.now();
    try {
      await action();
      stages.push({ name, passed: true, milliseconds: Date.now() - begin });
    } catch (e) {
      stages.push({
        name,
        passed: false,
        milliseconds: Date.now() - begin,
        error: String(e),
      });
      throw e;
    } finally {
      await atomicJson(join(out, "stages.json"), stages);
    }
  }
  function service(
    file: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    log: string,
  ) {
    const fd = openSync(join(out, log), "a");
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    closeSync(fd);
    child.on("error", () => {});
    return child;
  }
  let evidence: Evidence;
  try {
    const rustLoop =
      process.env.RUST_LOOP_BIN ??
      join(labRoot, "../tools/rust-loop/target/release/rust-loop");
    await gate("rust-loop", async () => {
      try {
        await command(
          rustLoop,
          [
            "check",
            "--project",
            join(project, "backend"),
            "--timeout-secs",
            "300",
          ],
          { log: join(out, "rust-loop.log"), signal },
        );
      } finally {
        await cp(join(project, "backend/.rust-loop"), join(out, "rust-loop"), {
          recursive: true,
          filter: (source) => basename(source) !== "target",
        }).catch(() => {});
      }
    });
    await gate("contract-drift", () => generate(project, true, signal));
    category = "code";
    await gate("typescript", () =>
      command("npm", ["run", "typecheck", "--", "--incremental", "false"], {
        cwd: join(project, "frontend"),
        log: join(out, "typescript.log"),
        signal,
      }),
    );
    await gate("production-build", () =>
      command("npm", ["run", "build"], {
        cwd: join(project, "frontend"),
        log: join(out, "build.log"),
        signal,
      }),
    );
    if (buildOnly) {
      const result: Evidence = {
        passed: true,
        category: "code",
        summary: "Build gates passed; browser acceptance still required",
        required: 0,
        passedTests: 0,
        skipped: 0,
        fingerprint,
      };
      if (protectedHash !== (await hashTree(project, true)))
        throw new Error("Protected files changed during build");
      await atomicJson(join(out, "build-result.json"), result);
      return result;
    }
    category = "environment";
    const bp = 3000;
    const fp = await port();
    const backendURL = `http://127.0.0.1:${bp}`;
    const frontendURL = `http://127.0.0.1:${fp}`;
    const binary = join(
      process.env.CARGO_TARGET_DIR ?? join(project, "backend/target"),
      "debug/p2i-todo",
    );
    backend = service(
      binary,
      [],
      project,
      { BACKEND_ADDR: `127.0.0.1:${bp}` },
      "backend.log",
    );
    await gate("backend-ready", () =>
      readiness(backendURL + "/health", backend),
    );
    // Each candidate has its own container/network namespace; internal backend port is fixed.
    frontend = service(
      "node",
      [
        join(project, "frontend/node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(fp),
      ],
      join(project, "frontend"),
      { BACKEND_URL: backendURL },
      "frontend.log",
    );
    await gate("frontend-ready", () => readiness(frontendURL, frontend));
    category = "code";
    const report = join(out, "playwright.json");
    await gate("http-browser-runtime-validation", async () => {
      await command(
        "node",
        [
          join(labRoot, "node_modules/@playwright/test/cli.js"),
          "test",
          "--config",
          join(labRoot, "evaluator/playwright.config.ts"),
        ],
        {
          cwd: labRoot,
          log: join(out, "playwright.log"),
          signal,
          env: {
            FRONTEND_URL: frontendURL,
            P2I_VARIANT: variant,
            P2I_REPORT: report,
            P2I_ARTIFACTS: join(out, "browser"),
          },
        },
      );
      if (!validateReport(JSON.parse(await readFile(report, "utf8"))))
        throw new Error("Required cases missing, skipped, retried, or failed");
    });
    category = "environment";
    stop(backend);
    await new Promise((resolve) => backend!.once("exit", resolve));
    backend = service(
      binary,
      [],
      project,
      { BACKEND_ADDR: `127.0.0.1:${bp}` },
      "backend-restart.log",
    );
    await gate("restart-resets-state", async () => {
      await readiness(backendURL + "/health", backend);
      const list = await (await fetch(backendURL + "/api/todos")).json();
      if (!Array.isArray(list) || list.length !== 0)
        throw new Error("Fresh backend was not empty");
    });
    evidence = {
      passed: true,
      category: "code",
      summary:
        "Rust, contract, build, HTTP, browser, runtime schema and restart checks passed",
      required: 4,
      passedTests: 4,
      skipped: 0,
      fingerprint,
    };
  } catch (error) {
    if (
      /browserType.launch|Executable doesn't exist|Readiness timeout|ENOENT/.test(
        String(error),
      )
    )
      category = "environment";
    evidence = {
      passed: false,
      category,
      summary: String(error).slice(-12_000),
      required: 4,
      passedTests: 0,
      skipped: 0,
      fingerprint,
    };
  } finally {
    if (backend) stop(backend);
    if (frontend) stop(frontend);
  }
  // next-env.d.ts is framework-generated; all other protected content must remain fixed.
  if (protectedHash !== (await hashTree(project, true)))
    evidence = {
      ...evidence,
      passed: false,
      category: "policy",
      summary: "Protected files changed during verification",
    };
  await atomicJson(join(out, "result.json"), evidence);
  return evidence;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const project = resolve(process.argv[2] ?? join(labRoot, "template"));
  const out = resolve(process.argv[4] ?? join(labRoot, ".p2i/template-check"));
  const result = await verify(
    project,
    process.argv[3] ?? "template",
    out,
    process.argv.includes("--build-only"),
  );
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
