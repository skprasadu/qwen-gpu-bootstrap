import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson } from "./files.ts";
import { cloneProfile, dockerCreate } from "./profile.ts";
import { command, readiness } from "./process.ts";

export type Profile = { id: string; eager: boolean; batch: number };
export const candidates: Profile[] = [
  { id: "eager-2-b2048", eager: true, batch: 2048 },
  { id: "graphs-2-b2048", eager: false, batch: 2048 },
  { id: "graphs-2-b4096", eager: false, batch: 4096 },
];

export function flag(args: string[], name: string): string | undefined {
  const matches = args.filter((s) => s === name || s.startsWith(name + "="));
  if (matches.length > 1)
    throw new Error(`Duplicate ${name}; inspect profile manually`);
  const item = matches[0];
  if (!item) return undefined;
  return item.includes("=")
    ? item.slice(name.length + 1)
    : args[args.indexOf(item) + 1];
}

export function tunedProfile(inspect: any, profile: Profile) {
  const args: string[] = inspect.Config.Cmd;
  // Only tune the bootstrap's explicit, pinned profile. Custom compilation settings
  // could otherwise override --no-enforce-eager and invalidate the comparison.
  if (
    args.some((s) => /^(-cc|--compilation-config|--optimization-level)/.test(s))
  )
    throw new Error("Custom compilation settings need manual tuning");
  if (!args.includes("--enable-chunked-prefill"))
    throw new Error("Explicit chunked prefill required for this batch sweep");
  if (![2048, 4096].includes(profile.batch))
    throw new Error("Unsupported batch size");
  // cloneProfile preserves the image digest, device bindings, mounts and network.
  for (const name of ["--max-num-seqs", "--max-num-batched-tokens"]) {
    if (!args.includes(name) || !/^\d+$/.test(flag(args, name) ?? ""))
      throw new Error(`Explicit numeric ${name} required`);
  }
  const payload = cloneProfile(inspect);
  const batch = payload.Cmd.indexOf("--max-num-batched-tokens");
  if (batch < 0 || !flag(args, "--max-num-batched-tokens"))
    throw new Error("Explicit --max-num-batched-tokens required");
  flag(args, "--max-num-seqs");
  payload.Cmd[batch + 1] = String(profile.batch);
  payload.Cmd = payload.Cmd.filter(
    (s: string) => !/^--(?:no-)?enforce-eager(?:=|$)/.test(s),
  );
  payload.Cmd.push(profile.eager ? "--enforce-eager" : "--no-enforce-eager");
  return payload;
}

export function safeCommand(args: string[]) {
  return args.map((s, i) =>
    args[i - 1] === "--api-key"
      ? "[redacted]"
      : s.startsWith("--api-key=")
        ? "--api-key=[redacted]"
        : s,
  );
}

export interface DockerControl {
  inspect(name: string): Promise<any>;
  run(args: string[]): Promise<unknown>;
  create(name: string, payload: any): Promise<{ Id: string }>;
  healthy(): Promise<void>;
}
export const dockerControl: DockerControl = {
  async inspect(name) {
    return JSON.parse(await command("docker", ["inspect", name]))[0];
  },
  run: (args) => command("docker", args),
  create: dockerCreate,
  healthy: () => readiness("http://127.0.0.1:8000/health", undefined, 900_000),
};
type Record = {
  name: string;
  backup: string;
  originalId: string;
  token: string;
  newId: string | null;
};

// A separate backup leaves the existing stage-03 qualification backup intact.
// The journal precedes every destructive step. A token recovers the create/save
// crash window without trusting a container merely because its name matches.
export class TuningTransaction {
  file: string;
  docker: DockerControl;
  record?: Record;
  constructor(state: string, docker = dockerControl) {
    this.file = join(state, "private/tuning-profile.json");
    this.docker = docker;
  }
  async load() {
    try {
      this.record = JSON.parse(await readFile(this.file, "utf8"));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    return this.record;
  }
  async begin(name: string) {
    if (await this.load())
      throw new Error("Restore the previous tuning backup first");
    const original = await this.docker.inspect(name);
    if (original.Config.Labels?.["qwen-bootstrap"] !== "managed")
      throw new Error("Refusing to tune an unrelated model container");
    const backup = `${name}-p2i-tuning-backup`;
    const existing = await this.docker.inspect(backup).catch(() => null);
    if (existing)
      throw new Error("Tuning backup name already exists; inspect it manually");
    this.record = {
      name,
      backup,
      originalId: original.Id,
      token: randomUUID(),
      newId: null,
    };
    await atomicJson(this.file, this.record);
    await this.docker.run(["stop", "--time", "30", name]);
    await this.docker.run(["rename", name, backup]);
    return original;
  }
  async removeTrial() {
    const record = this.record!;
    const current = await this.docker.inspect(record.name).catch(() => null);
    if (!current) return;
    if (
      current.Id === record.originalId ||
      current.Config.Labels?.["p2i.tuning"] !== record.token ||
      (record.newId && current.Id !== record.newId)
    )
      throw new Error(
        "Refusing to remove a model container not owned by this tuning trial",
      );
    await this.docker.run(["rm", "-f", current.Id]);
  }
  async install(payload: any) {
    const record = this.record!;
    await this.removeTrial();
    record.newId = null;
    await atomicJson(this.file, record);
    payload = structuredClone(payload);
    payload.Labels = { ...payload.Labels, "p2i.tuning": record.token };
    const created = await this.docker.create(record.name, payload);
    record.newId = created.Id;
    await atomicJson(this.file, record);
    await this.docker.run(["start", record.name]);
    await this.docker.healthy();
  }
  async restore() {
    const record = await this.load();
    if (!record) return false;
    const original = await this.docker.inspect(record.originalId);
    if (
      original.Name !== `/${record.name}` &&
      original.Name !== `/${record.backup}`
    )
      throw new Error(
        "Original model container was renamed externally; refusing rollback",
      );
    if (original.Name === `/${record.backup}`) {
      await this.removeTrial();
      await this.docker.run(["rename", record.backup, record.name]);
    }
    await this.docker.run(["start", record.name]);
    await this.docker.healthy();
    await unlink(this.file);
    this.record = undefined;
    return true;
  }
}
