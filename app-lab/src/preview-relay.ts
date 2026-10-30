import { createServer, request } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Trusted HTTP relay. Its upstream is fixed by the controller, never by a request.
// Only this container joins the publishing bridge; generated code stays internal.
export function previewRelay(hostname: string, port = 5173) {
  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
      res.writeHead(400).end("Invalid preview path");
      return;
    }
    const upstream = request(
      {
        hostname,
        port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${hostname}:${port}`,
          connection: "close",
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.on("error", () => res.destroy());
        response.pipe(res);
      },
    );
    upstream.setTimeout(30_000, () =>
      upstream.destroy(new Error("Preview timeout")),
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end("Preview unavailable");
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("connect", (_req, socket) =>
    socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n"),
  );
  server.on("upgrade", (_req, socket) =>
    socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n"),
  );
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const upstream = process.argv[2];
  if (!/^p2i-[a-f0-9]{8}-(list|kanban|focus)-preview$/.test(upstream ?? ""))
    throw new Error("Expected a managed preview hostname");
  const server = previewRelay(upstream);
  server.listen(5173, "0.0.0.0");
  process.on("SIGTERM", () => server.close());
}
