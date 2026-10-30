import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class CommandError extends Error {
  code: number;
  constructor(file: string, code: number, output: string) {
    super(`${file} exited ${code}\n${output.slice(-12_000)}`);
    this.code = code;
  }
}

export function stop(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
export async function command(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    log?: string;
    timeout?: number;
    signal?: AbortSignal;
  } = {},
) {
  options.signal?.throwIfAborted();
  if (options.log) await mkdir(dirname(options.log), { recursive: true });
  const stream = options.log
    ? createWriteStream(options.log, { flags: "a" })
    : null;
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (data: Buffer) => {
    output = (output + data.toString()).slice(-128_000);
    stream?.write(data);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  let timedOut = false;
  const kill = () => stop(child);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, options.timeout ?? 600_000);
  options.signal?.addEventListener("abort", kill, { once: true });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? -1));
    });
    options.signal?.throwIfAborted();
    if (timedOut) throw new Error(`Timeout: ${file}`);
    if (code !== 0) throw new CommandError(file, code, output);
    return output;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", kill);
    await new Promise<void>((resolve) =>
      stream ? stream.end(resolve) : resolve(),
    );
  }
}
export async function readiness(
  url: string,
  child?: ChildProcess,
  milliseconds = 30_000,
) {
  const start = Date.now();
  while (Date.now() - start < milliseconds) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`Service exited before readiness: ${url}`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (r.ok) return;
    } catch {
      /* bounded retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Readiness timeout: ${url}`);
}
