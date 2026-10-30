import { resolve, join } from "node:path";
import { labRoot } from "./generate.ts";
import { loadAdapter } from "./docker.ts";
import { Engine } from "./engine.ts";
import { command } from "./process.ts";
const state = resolve(process.env.P2I_STATE ?? join(labRoot, ".p2i"));
const adapter = await loadAdapter(join(state, "runs"));
const engine = new Engine(join(state, "runs"), adapter);
for (const run of await engine.list()) {
  await adapter.cleanup(run, true);
  for (const job of run.jobs) {
    delete job.preview;
    if (["queued", "generating", "verifying", "publishing"].includes(job.status))
      job.status = "interrupted";
  }
  if (run.state === "running") run.state = "interrupted";
  await engine.save(run);
}
const label = await command("docker", [
  "inspect",
  "-f",
  '{{index .Config.Labels "p2i.role"}}',
  "p2i-inference",
]).catch(() => "");
if (label.trim() === "gateway")
  await command("docker", ["rm", "-f", "p2i-inference"]);
console.log(
  "App Lab workers and previews stopped; artifacts and inference service retained.",
);
