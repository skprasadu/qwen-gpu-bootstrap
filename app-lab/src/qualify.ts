import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { labRoot } from "./generate.ts";
import { atomicJson } from "./files.ts";
import { command } from "./process.ts";
import { enableTwo, rollback } from "./profile.ts";
const state = resolve(process.env.P2I_STATE ?? join(labRoot, ".p2i"));
const name = process.env.P2I_MODEL_CONTAINER ?? "qwen-coder";
try {
  const r = await fetch("http://127.0.0.1:5173/api/runs", {
    signal: AbortSignal.timeout(1000),
  });
  const data: any = await r.json();
  if (data.runs?.some((x: any) => x.state === "running"))
    throw new Error(
      "Stop the active App Lab run before changing or qualifying serving capacity",
    );
} catch (e) {
  if (String(e).includes("Stop the active")) throw e;
}
if (process.argv.includes("--rollback")) {
  await rollback(state);
  console.log(
    "Original serving profile restored. Restart App Lab to refresh capacity.",
  );
  process.exit(0);
}
let changed = false;
await atomicJson(join(state, "qualification.json"), {
  passed: false,
  at: Date.now(),
  status: "qualification in progress",
});
try {
  let inspect = JSON.parse(await command("docker", ["inspect", name]))[0];
  const i = inspect.Config.Cmd.indexOf("--max-num-seqs");
  if (Number(inspect.Config.Cmd[i + 1]) < 2) {
    if (!process.argv.includes("--enable-two"))
      throw new Error(
        "Current capacity is one. Rerun qualify --enable-two for a reversible capacity-only change.",
      );
    await enableTwo(state, name);
    changed = true;
    inspect = JSON.parse(await command("docker", ["inspect", name]))[0];
  }
  const path =
    process.env.P2I_OPENCODE_CONFIG ??
    resolve(
      process.env.HOME ?? "/root",
      ".local/share/qwen-bootstrap/opencode.json",
    );
  const config = JSON.parse(await readFile(path, "utf8"));
  const options = config.provider.local.options;
  let key = options.apiKey;
  if (key.startsWith("{file:"))
    key = (await readFile(key.slice(6, -1), "utf8")).trim();
  const headers = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  const base = options.baseURL.replace(/\/$/, "");
  const model = config.model.replace(/^local\//, "");
  let maximum = 0,
    sampling = true;
  const samples: { at: number; running: number | null }[] = [];
  const sampler = (async () => {
    while (sampling) {
      let running: number | null = null;
      try {
        const r = await fetch(base.replace(/\/v1$/, "") + "/metrics", {
          headers,
          signal: AbortSignal.timeout(2000),
        });
        if (r.ok) {
          const matches = [
            ...(await r.text()).matchAll(
              /^vllm:num_requests_running(?:\{[^\n]*\})?\s+([0-9.]+)/gm,
            ),
          ];
          if (matches.length)
            running = matches.reduce((sum, m) => sum + Number(m[1]), 0);
        }
      } catch {}
      if (running !== null) maximum = Math.max(maximum, running);
      samples.push({ at: Date.now(), running });
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  const starts: number[] = [];
  const ends: number[] = [];
  let results: any[] = [];
  try {
    results = await Promise.all(
      [0, 1].map(async (index) => {
        starts[index] = Date.now();
        const r = await fetch(base + "/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: `Probe ${index}: Explain 100 useful frontend accessibility checks in detail.`,
              },
            ],
            max_tokens: 512,
            temperature: 0,
            stream: false,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!r.ok) throw new Error(`Inference probe HTTP ${r.status}`);
        const result: any = await r.json();
        ends[index] = Date.now();
        if (!result.choices?.[0]?.message?.content)
          throw new Error("Probe returned no content");
        return { usage: result.usage ?? null };
      }),
    );
  } finally {
    sampling = false;
    await sampler;
  }
  const gpu = (
    await command("nvidia-smi", [
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader",
    ])
  ).trim();
  const cmd: string[] = inspect.Config.Cmd.map(
    (v: string, index: number, array: string[]) =>
      array[index - 1] === "--api-key" ? "[redacted]" : v,
  );
  const result = {
    passed: maximum >= 2,
    maxRunning: maximum,
    starts,
    ends,
    samples,
    requests: results,
    gpu,
    image: inspect.Image,
    command: cmd,
    at: Date.now(),
    changedProfile: changed,
  };
  await atomicJson(join(state, "qualification.json"), result);
  if (maximum < 2)
    throw new Error(
      "Two replies completed but metrics did not demonstrate two running sequences; concurrency remains unqualified",
    );
  console.log(
    "PASS: two simultaneous running inference sequences observed. Restart App Lab to enable two workers.",
  );
} catch (error) {
  if (changed) await rollback(state);
  console.error(String(error));
  process.exitCode = 1;
}
