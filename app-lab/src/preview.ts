import { spawn } from "node:child_process";
const backend = spawn("/opt/lab/template/backend/target/debug/p2i-todo", [], {
  env: { ...process.env, BACKEND_ADDR: "0.0.0.0:3000" },
  stdio: "inherit",
});
const frontend = spawn(
  "node",
  [
    "/workspace/frontend/node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    "5173",
  ],
  { cwd: "/workspace/frontend", stdio: "inherit" },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  backend.kill();
  frontend.kill();
  setTimeout(() => process.exit(1), 1000).unref();
}
backend.on("exit", stop);
frontend.on("exit", stop);
backend.on("error", stop);
frontend.on("error", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
