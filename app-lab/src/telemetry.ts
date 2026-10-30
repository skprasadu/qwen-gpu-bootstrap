import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { command } from "./process.ts";
let busy = false;
export async function collectMetrics(state: string, run: string) {
  if (busy) return;
  busy = true;
  try {
    let gpu: string | null = null,
      metrics: string | null = null;
    try {
      gpu = (
        await command(
          "nvidia-smi",
          [
            "--query-gpu=utilization.gpu,memory.used,memory.total,power.draw",
            "--format=csv,noheader,nounits",
          ],
          { timeout: 3000 },
        )
      ).trim();
    } catch {}
    try {
      const response = await fetch("http://127.0.0.1:8000/metrics", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok)
        metrics = (await response.text())
          .split("\n")
          .filter(
            (l) =>
              !l.startsWith("#") &&
              /num_requests_running|num_requests_waiting|cache_usage_perc|num_preemptions|generation_tokens_total|prompt_tokens_total/.test(
                l,
              ),
          )
          .join("\n");
    } catch {}
    await mkdir(join(state, "metrics"), { recursive: true });
    await appendFile(
      join(state, "metrics", `${run}.jsonl`),
      JSON.stringify({ at: Date.now(), run, gpu, metrics }) + "\n",
    );
  } finally {
    busy = false;
  }
}
