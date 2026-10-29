import { createServer, type IncomingMessage } from "node:http";
import { mkdir, open, readFile, unlink, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "./engine.ts";
import { labRoot } from "./generate.ts";
import { loadAdapter } from "./docker.ts";
import { collectMetrics } from "./telemetry.ts";
import { command } from "./process.ts";
async function body(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16_000) throw new Error("Request too large");
  }
  return JSON.parse(text || "{}");
}
export function createLabServer(engine: Engine, maximumConcurrency = 1) {
  return createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    const json = (value: unknown, status = 200) => {
      res
        .writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(value));
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      json({ error: "Loopback Host required" }, 403);
      return;
    }
    if (
      req.method === "POST" &&
      ((req.headers.origin && req.headers.origin !== `http://${host}`) ||
        !req.headers["content-type"]?.startsWith("application/json"))
    ) {
      json({ error: "Same-origin JSON required" }, 403);
      return;
    }
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html",
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        });
        res.end(await readFile(join(labRoot, "ui/index.html")));
        return;
      }
      if (
        req.method === "GET" &&
        ["/app.js", "/style.css"].includes(url.pathname)
      ) {
        res.setHeader(
          "content-type",
          url.pathname.endsWith(".js") ? "application/javascript" : "text/css",
        );
        res.end(await readFile(join(labRoot, "ui", url.pathname.slice(1))));
        return;
      }
      if (url.pathname === "/api/runs" && req.method === "GET") {
        json({ runs: await engine.list(), maximumConcurrency });
        return;
      }
      if (url.pathname === "/api/runs" && req.method === "POST") {
        const input = await body(req);
        const concurrency = Number(input.concurrency ?? maximumConcurrency);
        if (
          !Number.isInteger(concurrency) ||
          concurrency < 1 ||
          concurrency > maximumConcurrency
        )
          throw new Error(
            "Qualify two-request serving before choosing two workers",
          );
        json(await engine.start(String(input.brief ?? ""), concurrency), 202);
        return;
      }
      const cancel = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/stop$/);
      if (cancel && req.method === "POST") {
        await engine.cancel(cancel[1]);
        json({ stopped: true });
        return;
      }
      const evidence = url.pathname.match(
        /^\/api\/evidence\/([a-f0-9-]{36})\/(list|kanban|focus)\/(.+)$/,
      );
      if (evidence && req.method === "GET") {
        const suffix = decodeURIComponent(evidence[3]);
        if (
          !/^(?:evidence-\d+\/(?:result\.json|stages\.json|playwright\.json|acceptance\.json|[\w-]+\.log|browser\/[\w./-]+\.(?:png|zip|md))|(?:worker|builder|evaluator|restart-check)-\d+\.log)$/.test(
            suffix,
          )
        )
          throw new Error("Unsupported evidence path");
        const root = await realpath(
          join(engine.root, evidence[1], evidence[2]),
        );
        const file = await realpath(join(root, suffix));
        if (!file.startsWith(root + sep))
          throw new Error("Invalid evidence path");
        res.setHeader(
          "content-type",
          file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".zip")
              ? "application/zip"
              : "text/plain; charset=utf-8",
        );
        res.setHeader("x-content-type-options", "nosniff");
        res.end(await readFile(file));
        return;
      }
      json({ error: "Not found" }, 404);
    } catch (error) {
      json({ error: String(error).slice(-2000) }, 400);
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const state = resolve(process.env.P2I_STATE ?? join(labRoot, ".p2i"));
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = join(state, "controller.lock");
  try {
    const handle = await open(lock, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) {
    let alive = true;
    try {
      process.kill(Number(await readFile(lock, "utf8")), 0);
    } catch (e: any) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "Controller lock is held; use the service status command",
      );
    await unlink(lock);
    const handle = await open(lock, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
  }
  const adapter = await loadAdapter(join(state, "runs"));
  await adapter.setup();
  const engine = new Engine(join(state, "runs"), adapter);
  await engine.recover();
  for (const run of await engine.list())
    for (const job of run.jobs)
      if (job.preview) {
        const name = adapter.name(run, job, "preview");
        const running = (
          await command("docker", [
            "inspect",
            "-f",
            "{{.State.Running}}",
            name,
          ]).catch(() => "")
        ).trim();
        if (running !== "true") {
          delete job.preview;
          job.error =
            "Previously verified preview is no longer running. Evidence retained; start a fresh run to rebuild.";
          await engine.save(run);
        }
      }
  let concurrency = 1;
  try {
    const q = JSON.parse(
      await readFile(join(state, "qualification.json"), "utf8"),
    );
    const model = JSON.parse(
      await command("docker", [
        "inspect",
        process.env.P2I_MODEL_CONTAINER ?? "qwen-coder",
      ]),
    )[0];
    if (
      q.passed &&
      q.maxRunning >= 2 &&
      q.image === model.Image &&
      JSON.stringify(q.command) === JSON.stringify(model.Config.Cmd)
    )
      concurrency = 2;
  } catch {}
  const server = createLabServer(engine, concurrency);
  server.listen(Number(process.env.P2I_PORT ?? 5173), "127.0.0.1", () =>
    console.log(
      "App Lab ready on private port " + (process.env.P2I_PORT ?? 5173),
    ),
  );
  const metrics = setInterval(() => {
    if (engine.active)
      void collectMetrics(state, engine.active.run.id).catch((e) =>
        console.error("Metrics unavailable:", String(e)),
      );
  }, 5000);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(metrics);
    server.close();
    if (engine.active) {
      engine.active.run.state = "interrupted";
      engine.active.abort.abort(new Error("Controller stopped"));
      await engine.active.done;
    }
    await unlink(lock).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}
