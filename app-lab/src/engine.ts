import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson } from "./files.ts";
import { ContextOverflow } from "./worker.ts";
export const variants = ["list", "kanban", "focus"] as const;
export type Variant = (typeof variants)[number];
export type Status =
  | "queued"
  | "generating"
  | "verifying"
  | "publishing"
  | "passed"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";
export type Evidence = {
  passed: boolean;
  category: "code" | "environment" | "policy";
  summary: string;
  required: number;
  passedTests: number;
  skipped: number;
  candidate?: string;
  fingerprint?: string;
};
export type Job = {
  variant: Variant;
  status: Status;
  attempts: number;
  history: Evidence[];
  startedAt?: number;
  finishedAt?: number;
  preview?: number;
  error?: string;
  failureStage?: "generation" | "verification" | "preview";
  generationWarnings?: string[];
};
export type Run = {
  id: string;
  brief: string;
  concurrency: number;
  createdAt: number;
  deadline: number;
  reserveMs: number;
  state:
    "running" | "passed" | "partial" | "failed" | "cancelled" | "interrupted";
  jobs: Job[];
  finishedAt?: number;
  interventions: number;
  source: "local-qwen" | "fake-test";
  error?: string;
};
export interface Adapter {
  source: Run["source"];
  prepare(run: Run, job: Job, signal: AbortSignal): Promise<void>;
  generate(run: Run, job: Job, signal: AbortSignal): Promise<void>;
  verify(run: Run, job: Job, signal: AbortSignal): Promise<Evidence>;
  publish(run: Run, job: Job, signal: AbortSignal): Promise<number>;
  cleanup(run: Run, previews: boolean): Promise<void>;
}
export class Engine {
  root: string;
  adapter: Adapter;
  active?: { run: Run; abort: AbortController; done: Promise<void> };
  private starting = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(root: string, adapter: Adapter) {
    this.root = root;
    this.adapter = adapter;
  }
  async save(run: Run) {
    const write = this.writes.then(() =>
      atomicJson(join(this.root, run.id, "run.json"), run),
    );
    this.writes = write.catch(() => {});
    await write;
  }
  async list(): Promise<Run[]> {
    const entries = await readdir(this.root).catch(() => [] as string[]);
    const runs: Run[] = [];
    for (const id of entries) {
      try {
        runs.push(
          JSON.parse(await readFile(join(this.root, id, "run.json"), "utf8")),
        );
      } catch {
        /* ignore incomplete temporary dirs */
      }
    }
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }
  async recover() {
    for (const run of await this.list()) {
      if (run.state !== "running") continue;
      await this.adapter.cleanup(run, false);
      run.state = "interrupted";
      run.finishedAt = Date.now();
      run.error =
        "Controller restarted. Active worker/verifier containers were stopped; saved evidence retained. Submit a fresh run to retry.";
      for (const job of run.jobs)
        if (
          ["queued", "generating", "verifying", "publishing"].includes(
            job.status,
          )
        ) {
          job.status = "interrupted";
          job.finishedAt = Date.now();
        }
      await this.save(run);
    }
  }
  async start(
    brief: string,
    concurrency = 2,
    budgetMs = 3_600_000,
    reserveMs = 300_000,
  ) {
    if (this.active || this.starting)
      throw new Error("A run is already active");
    if (!brief.trim() || brief.length > 8_000)
      throw new Error("Brief must contain 1–8000 characters");
    if (
      ![1, 2].includes(concurrency) ||
      budgetMs < 100 ||
      reserveMs >= budgetMs
    )
      throw new Error("Invalid run limits");
    this.starting = true;
    try {
      // Fixed preview ports: release previous previews explicitly before new allocation.
      for (const old of await this.list())
        if (old.jobs.some((j) => j.preview))
          throw new Error("Stop previous previews before starting another run");
      const run: Run = {
        id: randomUUID(),
        brief,
        concurrency,
        createdAt: Date.now(),
        deadline: Date.now() + budgetMs,
        reserveMs,
        state: "running",
        jobs: variants.map((variant) => ({
          variant,
          status: "queued",
          attempts: 0,
          history: [],
        })),
        interventions: 0,
        source: this.adapter.source,
      };
      await this.save(run);
      const abort = new AbortController();
      const done = this.execute(run, abort).finally(() => {
        this.active = undefined;
      });
      this.active = { run, abort, done };
      return run;
    } finally {
      this.starting = false;
    }
  }
  async cancel(id: string) {
    if (this.active?.run.id === id) {
      this.active.run.interventions++;
      this.active.run.state = "cancelled";
      this.active.abort.abort(new Error("Cancelled by user"));
      await this.active.done;
    }
    const run = (await this.list()).find((r) => r.id === id);
    if (!run) throw new Error("Unknown run");
    await this.adapter.cleanup(run, true);
    for (const job of run.jobs) delete job.preview;
    await this.save(run);
  }
  private async execute(run: Run, abort: AbortController) {
    const timer = setTimeout(
      () => abort.abort(new Error("Run deadline exhausted")),
      Math.max(1, run.deadline - Date.now()),
    );
    let index = 0;
    const worker = async () => {
      while (index < run.jobs.length) {
        const job = run.jobs[index++];
        if (abort.signal.aborted) {
          job.status =
            run.state === "cancelled"
              ? "cancelled"
              : run.state === "interrupted"
                ? "interrupted"
                : "failed";
          continue;
        }
        job.startedAt = Date.now();
        try {
          await this.adapter.prepare(run, job, abort.signal);
          for (let attempt = 0; attempt <= 3; attempt++) {
            if (Date.now() >= run.deadline - run.reserveMs) {
              job.error = "Generation budget exhausted; no unverified success";
              break;
            }
            job.attempts++;
            job.status = "generating";
            job.failureStage = "generation";
            await this.save(run);
            const generation = AbortSignal.any([
              abort.signal,
              AbortSignal.timeout(
                Math.max(1, run.deadline - run.reserveMs - Date.now()),
              ),
            ]);
            try {
              await this.adapter.generate(run, job, generation);
            } catch (error) {
              // A generation-only deadline leaves the reserved verification time.
              if (abort.signal.aborted) throw error;
              if (error instanceof ContextOverflow) {
                (job.generationWarnings ??= []).push(
                  `Attempt ${job.attempts}: ${error.message}`,
                );
              } else {
                if (!generation.aborted) throw error;
                job.error =
                  "Generation budget exhausted; verifying captured source";
              }
            }
            job.status = "verifying";
            job.failureStage = "verification";
            await this.save(run);
            const evidence = await this.adapter.verify(run, job, abort.signal);
            job.history.push(evidence);
            await this.save(run);
            if (
              evidence.passed &&
              evidence.required > 0 &&
              evidence.passedTests === evidence.required &&
              evidence.skipped === 0
            ) {
              job.status = "publishing";
              job.failureStage = "preview";
              await this.save(run);
              job.preview = await this.adapter.publish(run, job, abort.signal);
              job.status = "passed";
              delete job.error;
              delete job.failureStage;
              break;
            }
            job.error = evidence.summary;
            if (evidence.category !== "code") break;
            const previous = job.history.at(-2);
            if (
              previous?.fingerprint &&
              previous.fingerprint === evidence.fingerprint &&
              previous.summary === evidence.summary
            ) {
              job.error =
                "Repeated failure without source progress: " + evidence.summary;
              break;
            }
          }
          if (job.status !== "passed")
            job.status =
              job.history.at(-1)?.category === "code" ? "partial" : "failed";
        } catch (error) {
          job.status =
            run.state === "cancelled"
              ? "cancelled"
              : run.state === "interrupted"
                ? "interrupted"
                : "failed";
          job.error = String(error).slice(0, 12_000);
        } finally {
          job.finishedAt = Date.now();
          await this.save(run);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: run.concurrency }, worker));
    } catch (error) {
      run.error = String(error);
    } finally {
      clearTimeout(timer);
      try {
        await this.adapter.cleanup(run, false);
      } catch (error) {
        run.error = String(error);
      }
      if (run.state !== "cancelled" && run.state !== "interrupted")
        run.state = run.jobs.every((j) => j.status === "passed")
          ? "passed"
          : run.jobs.some(
                (j) => j.status === "passed" || j.status === "partial",
              )
            ? "partial"
            : "failed";
      run.finishedAt = Date.now();
      await this.save(run);
    }
  }
}
