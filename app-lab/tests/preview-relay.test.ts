import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { previewRelay } from "../src/preview-relay.ts";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
test("preview relay forwards CRUD bodies/statuses only to its configured upstream", async () => {
  const app = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ method: req.method, path: req.url, body }));
  });
  const appPort = await listen(app);
  const relay = previewRelay("127.0.0.1", appPort);
  const relayPort = await listen(relay);
  try {
    const response = await fetch(
      `http://127.0.0.1:${relayPort}/api/todos?x=1`,
      {
        method: "POST",
        body: '{"title":"hello"}',
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      method: "POST",
      path: "/api/todos?x=1",
      body: '{"title":"hello"}',
    });
    const status = await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: relayPort,
          path: "http://example.invalid/",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 400);
    await close(app);
    assert.equal((await fetch(`http://127.0.0.1:${relayPort}/`)).status, 502);
  } finally {
    await close(relay);
    if (app.listening) await close(app);
  }
});
