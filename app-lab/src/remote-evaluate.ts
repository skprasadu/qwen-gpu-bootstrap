import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { command, readiness } from "./process.ts";
import { validateReport } from "./verify.ts";
import { atomicJson } from "./files.ts";
import { labRoot } from "./generate.ts";
const out = process.env.P2I_EVIDENCE ?? "/evidence";
const url = process.env.FRONTEND_URL!;
try {
  await readiness(url);
  await readiness(process.env.BACKEND_URL! + "/health");
  const report = join(out, "playwright.json");
  await command(
    "node",
    [
      join(labRoot, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config",
      join(labRoot, "evaluator/playwright.config.ts"),
    ],
    {
      log: join(out, "playwright.log"),
      env: { P2I_REPORT: report, P2I_ARTIFACTS: join(out, "browser") },
      timeout: 240_000,
    },
  );
  if (!validateReport(JSON.parse(await readFile(report, "utf8"))))
    throw new Error("Missing, skipped, retried or failed required case");
  await atomicJson(join(out, "acceptance.json"), {
    passed: true,
    required: 4,
    passedTests: 4,
    skipped: 0,
  });
} catch (error) {
  // The controller captures this output for the next repair prompt.
  console.error(String(error));
  await atomicJson(join(out, "acceptance.json"), {
    passed: false,
    required: 4,
    passedTests: 0,
    skipped: 0,
    error: String(error),
  });
  process.exitCode = 1;
}
