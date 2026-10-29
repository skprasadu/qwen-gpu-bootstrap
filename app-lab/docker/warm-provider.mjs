// Build-time fake API: cache OpenCode's provider dependencies for offline workers.
// This is not model/tool correctness validation and produces no trial evidence.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body || "{}");
  if (data.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          id: "warm",
          object: "chat.completion.chunk",
          created: 0,
          model: "warm",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "ready" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  } else {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "warm",
        object: "chat.completion",
        created: 0,
        model: "warm",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ready" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
});
await new Promise((r) => server.listen(8999, "127.0.0.1", r));
const config = {
  model: "local/warm",
  small_model: "local/warm",
  autoupdate: false,
  enabled_providers: ["local"],
  permission: { "*": "allow" },
  provider: {
    local: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://127.0.0.1:8999/v1", apiKey: "fake" },
      models: {
        warm: { tool_call: true, limit: { context: 16384, output: 2048 } },
      },
    },
  },
};
const child = spawn(
  "opencode",
  ["run", "--auto", "--format", "json", "Respond ready without using tools."],
  {
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    stdio: "inherit",
  },
);
const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
const code = await new Promise((r) => {
  child.on("error", () => r(1));
  child.on("exit", r);
});
clearTimeout(timer);
server.close();
if (code !== 0) process.exit(1);
