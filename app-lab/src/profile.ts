import { request } from "node:http";
import { command, readiness } from "./process.ts";
import { atomicJson } from "./files.ts";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
export function cloneProfile(inspect: any) {
  const config = structuredClone(inspect.Config);
  // Reuse the running image even if its original registry tag has moved locally.
  config.Image = inspect.Image;
  const args: string[] = [...(config.Cmd ?? [])];
  const index = args.indexOf("--max-num-seqs");
  if (index < 0 || !args[index + 1])
    throw new Error(
      "Explicit --max-num-seqs required; inspect your serving profile manually",
    );
  args[index + 1] = "2";
  config.Cmd = args;
  const endpoints: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(
    inspect.NetworkSettings.Networks ?? {},
  ) as [string, any][]) {
    endpoints[name] = { Aliases: value.Aliases ?? undefined };
  }
  return {
    ...config,
    HostConfig: inspect.HostConfig,
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}
async function dockerCreate(name: string, payload: unknown) {
  const endpoint = (
    await command("docker", [
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ])
  ).trim();
  if (!endpoint.startsWith("unix://"))
    throw new Error("Qualification requires local Docker on the GPU VM");
  return await new Promise<any>((resolve, reject) => {
    const req = request(
      {
        socketPath: endpoint.slice(7),
        path: `/containers/create?name=${encodeURIComponent(name)}`,
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          const value = JSON.parse(text);
          if (res.statusCode !== 201)
            reject(new Error(`Docker create failed: ${value.message}`));
          else resolve(value);
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(payload));
  });
}
export async function enableTwo(state: string, name: string) {
  const file = join(state, "private/profile.json");
  try {
    await readFile(file);
    throw new Error(
      "A profile backup already exists; qualify the current profile or roll back first",
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const inspect = JSON.parse(await command("docker", ["inspect", name]))[0];
  if (inspect.Config.Labels?.["qwen-bootstrap"] !== "managed")
    throw new Error("Refusing to replace an unrelated model container");
  const backup = `${name}-p2i-backup`;
  const payload = cloneProfile(inspect);
  const record = {
    name,
    backup,
    originalId: inspect.Id,
    newId: null as string | null,
    created: Date.now(),
  };
  await atomicJson(file, record);
  try {
    await command("docker", ["stop", "--time", "30", name]);
    await command("docker", ["rename", name, backup]);
    const created = await dockerCreate(name, payload);
    record.newId = created.Id;
    await atomicJson(file, record);
    await command("docker", ["start", name]);
    await readiness("http://127.0.0.1:8000/health", undefined, 600_000);
  } catch (error) {
    await rollback(state);
    throw error;
  }
}
export async function rollback(state: string) {
  const file = join(state, "private/profile.json");
  const record = JSON.parse(await readFile(file, "utf8"));
  const original = JSON.parse(
    await command("docker", ["inspect", record.originalId]),
  )[0];
  if (original.Id !== record.originalId)
    throw new Error("Profile backup identity changed");
  if (original.Name === `/${record.name}`) {
    await command("docker", ["start", record.name]);
    await unlink(file);
    return;
  }
  const current = await command("docker", [
    "inspect",
    "-f",
    "{{.Id}}",
    record.name,
  ]).catch(() => "");
  if (current.trim()) {
    if (!record.newId || current.trim() !== record.newId)
      throw new Error(
        "Refusing to replace a container not recorded by qualification",
      );
    await command("docker", ["rm", "-f", record.name]);
  }
  await command("docker", ["rename", record.backup, record.name]);
  await command("docker", ["start", record.name]);
  await readiness("http://127.0.0.1:8000/health", undefined, 600_000);
  await unlink(file);
  await unlink(join(state, "qualification.json")).catch(() => {});
}
