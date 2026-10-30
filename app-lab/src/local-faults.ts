import { mkdtemp, symlink, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { copyProject, atomicJson } from "./files.ts";
import { command } from "./process.ts";
import { labRoot } from "./generate.ts";
const root = await mkdtemp(join(labRoot, ".cache/fault-"));
try {
  await copyProject(join(labRoot, "template"), root);
  await symlink(
    join(labRoot, "template/frontend/node_modules"),
    join(root, "frontend/node_modules"),
  );
  await appendFile(
    join(root, "frontend/src/app/page.tsx"),
    "\nconst injectedCompileFailure: string = 123;\n",
  );
  let detected = false;
  try {
    await command("npm", ["run", "typecheck", "--", "--incremental", "false"], {
      cwd: join(root, "frontend"),
    });
  } catch (error) {
    detected = String(error).includes("TS2322");
  }
  assert.ok(
    detected,
    "Real TypeScript compiler must detect injected type error",
  );
  await atomicJson(join(labRoot, ".p2i/local-faults.json"), {
    compilerFaultDetected: detected,
    repairProvider: "fake-only in controller tests",
    gpuRepairTested: false,
  });
  console.log(
    "PASS injected TypeScript compile failure detected (no real-model repair claimed)",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
