import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { labRoot } from "./generate.ts";
import { atomicJson } from "./files.ts";
import type { Run } from "./engine.ts";
import { summarizeRequests } from "./request-metrics.ts";
const state = resolve(process.env.P2I_STATE ?? join(labRoot, ".p2i"));
const base = "http://127.0.0.1:5173";
const brief =
  "Build a calm, responsive todo app with useful loading and error states. Explore a simple list, a Kanban board, and a daily focus view.";
async function api(path: string, body?: unknown) {
  const response = await fetch(
    base + path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data: any = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
const initial = await api("/api/runs");
if (initial.maximumConcurrency < 2)
  throw new Error("Qualify two-request serving first");
if (
  initial.runs.some(
    (r: Run) => r.state === "running" || r.jobs.some((j) => j.preview),
  )
)
  throw new Error("Stop existing runs/previews before the comparison");
const records: unknown[] = [];
for (const concurrency of [1, 2]) {
  const submitted: Run = await api("/api/runs", { brief, concurrency });
  let run = submitted;
  while (run.state === "running") {
    await new Promise((r) => setTimeout(r, 3000));
    run = (await api("/api/runs")).runs.find((r: Run) => r.id === submitted.id);
    if (!run) throw new Error("Run disappeared");
  }
  const elapsed = (run.finishedAt ?? Date.now()) - run.createdAt;
  const passed = run.jobs.filter((j) => j.status === "passed").length;
  let requestLog: string | null = null;
  try {
    requestLog = await readFile(join(state, "metrics/requests.jsonl"), "utf8");
  } catch {}
  records.push({
    run: run.id,
    concurrency,
    state: run.state,
    elapsedMs: elapsed,
    passed,
    passedPerHour: passed / (elapsed / 3_600_000),
    ...summarizeRequests(requestLog, run.id),
    interventions: run.interventions,
    jobs: run.jobs.map((j) => ({
      variant: j.variant,
      status: j.status,
      attempts: j.attempts,
    })),
    cacheConditions:
      "Same image/dependencies/model/profile; model caches not reset. Sequential first; order effects are a limitation.",
  });
  await atomicJson(join(state, "comparison.json"), {
    brief,
    exploratory: true,
    runs: records,
  });
  if (concurrency === 1) await api(`/api/runs/${run.id}/stop`, {});
}
console.log(
  JSON.stringify(
    { report: join(state, "comparison.json"), runs: records },
    null,
    2,
  ),
);
