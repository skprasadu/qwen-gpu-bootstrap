import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, appendFile } from "node:fs/promises";
const key = (await readFile("/run/model-key", "utf8")).trim();
let active = 0;
async function proxy(req: IncomingMessage, res: ServerResponse) {
  const match = req.url?.match(
    /^\/([a-f0-9-]{36})\/(list|kanban|focus|probe)\/(v1\/(?:chat\/completions|completions|models))$/,
  );
  if (!match || !["GET", "POST"].includes(req.method ?? "")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) {
      res.writeHead(413).end();
      return;
    }
  }
  const start = Date.now(),
    before = active++;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 600_000);
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  let usage: unknown = null,
    status = 502,
    pending = "";
  try {
    const upstream = await fetch(`${process.env.P2I_UPSTREAM}/${match[3]}`, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: req.method === "POST" ? body : undefined,
      signal: abort.signal,
    });
    status = upstream.status;
    res.writeHead(status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    });
    for await (const chunk of upstream.body ?? []) {
      pending += new TextDecoder().decode(chunk);
      if (pending.length > 1_000_000) pending = pending.slice(-100_000);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line.replace(/^data: /, ""));
          if (event.usage) usage = event.usage;
        } catch {}
      }
      if (!res.write(chunk))
        await new Promise<void>((r) => {
          res.once("drain", r);
          res.once("close", r);
        });
    }
    try {
      const event = JSON.parse(pending);
      if (event.usage) usage = event.usage;
    } catch {}
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  } finally {
    clearTimeout(timeout);
    active--;
    await appendFile(
      "/metrics/requests.jsonl",
      JSON.stringify({
        run: match[1],
        variant: match[2],
        route: match[3],
        start,
        end: Date.now(),
        activeAtStart: before + 1,
        status,
        usage,
        aborted: abort.signal.aborted,
      }) + "\n",
    );
  }
}
createServer((req, res) => {
  void proxy(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
}).listen(8001, "0.0.0.0");
