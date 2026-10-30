import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { labRoot } from "./generate.ts";
import { atomicJson } from "./files.ts";
import { command } from "./process.ts";
import {
  candidates,
  tunedProfile,
  TuningTransaction,
} from "./tuning-profile.ts";

const state = resolve(process.env.P2I_STATE ?? join(labRoot, ".p2i"));
const tx = new TuningTransaction(state);
const lock = join(state, "private/tuning.lock");
await mkdir(join(state, "private"), { recursive: true });
await mkdir(lock); // Exclusive across manual and service invocations.
try {
  const service = await command("systemctl", [
    "is-active",
    "p2i-app-lab",
  ]).catch(() => "inactive");
  if (service.trim() === "active")
    throw new Error("Use app-lab.sh tune so the controller is stopped first");
  // Controller must be stopped first; disk state remains authoritative.
  for (const entry of await readdir(join(state, "runs")).catch(() => [])) {
    const run = JSON.parse(
      await readFile(join(state, "runs", entry, "run.json"), "utf8").catch(
        () => "{}",
      ),
    );
    if (run.state === "running")
      throw new Error("Finish the active App Lab run before tuning");
  }
  if (process.argv.includes("--restore")) {
    await tx.restore();
    await unlink(join(state, "qualification.json")).catch(() => {});
    console.log("Original serving profile restored. Run qualify, then up.");
  } else {
    const gpu = await command("nvidia-smi", [
      "--query-gpu=name",
      "--format=csv,noheader",
    ]);
    if (!/6000.*Blackwell/i.test(gpu))
      throw new Error("This tuning sweep targets RTX PRO 6000 Blackwell");
    if (await tx.load())
      throw new Error(
        "A tuning backup exists. Run tune-restore before another sweep.",
      );
    const original = await tx.docker.inspect(
      process.env.P2I_MODEL_CONTAINER ?? "qwen-coder",
    );
    const payloads = candidates.map((p) => tunedProfile(original, p));
    const report: any = {
      at: Date.now(),
      gpu: gpu.trim(),
      image: original.Image,
      note: "Synthetic concurrent generation throughput; not verified apps/hour. Fixed order and cache effects can bias results.",
      trials: [],
    };
    const reportFile = join(state, "tuning-result.json");
    async function probe() {
      await command(process.execPath, [join(labRoot, "src/qualify.ts")], {
        env: { P2I_STATE: state, P2I_PROBE_TOKENS: "2048" },
        timeout: 240_000,
      });
      const q = JSON.parse(
        await readFile(join(state, "qualification.json"), "utf8"),
      );
      const tokens = q.requests.map((r: any) => r.usage?.completion_tokens);
      if (!q.passed || tokens.some((n: any) => !Number.isFinite(n) || n <= 0))
        throw new Error("Missing throughput or concurrent inference evidence");
      return {
        tokensPerSecond:
          tokens.reduce((a: number, b: number) => a + b, 0) /
          ((Math.max(...q.ends) - Math.min(...q.starts)) / 1000),
        qualification: q,
      };
    }
    try {
      await tx.begin(process.env.P2I_MODEL_CONTAINER ?? "qwen-coder");
      for (let i = 0; i < candidates.length; i++) {
        const trial: any = { profile: candidates[i] };
        console.log(
          `Testing ${candidates[i].id}; model startup/compilation can take 15 minutes`,
        );
        try {
          await tx.install(payloads[i]);
          await probe(); // Warmup is excluded from scored rounds.
          trial.rounds = [await probe(), await probe()];
          trial.score = Math.min(
            ...trial.rounds.map((r: any) => r.tokensPerSecond),
          );
        } catch (e) {
          trial.error = String(e);
        }
        report.trials.push(trial);
        await atomicJson(reportFile, report);
        if (i === 0 && !trial.score)
          throw new Error("Baseline failed; restoring original profile");
      }
      const baseline = report.trials[0];
      if (!baseline.score)
        throw new Error("Baseline failed; restoring original profile");
      const best = report.trials
        .filter((t: any) => t.score > baseline.score * 1.05)
        .sort((a: any, b: any) => b.score - a.score)[0];
      if (!best) {
        await tx.restore();
        await unlink(join(state, "qualification.json")).catch(() => {});
        report.selected = "original (no measured improvement above 5%)";
      } else {
        await tx.install(
          payloads[candidates.findIndex((p) => p.id === best.profile.id)],
        );
        await probe();
        report.selected = best.profile.id;
      }
      await atomicJson(reportFile, report);
      console.log(`Selected: ${report.selected}. Evidence: ${reportFile}`);
    } catch (e) {
      await tx.restore();
      await unlink(join(state, "qualification.json")).catch(() => {});
      throw e;
    }
  }
} finally {
  const { rmdir } = await import("node:fs/promises");
  await rmdir(lock);
}
