import {
  cp,
  mkdir,
  readdir,
  lstat,
  readFile,
  writeFile,
  rename,
} from "node:fs/promises";
import { join, dirname, relative, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const ignored = new Set([
  "node_modules",
  ".next",
  "target",
  ".rust-loop",
  ".git",
  ".cache",
  "test-results",
  "playwright-report",
]);
export async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        ignored.has(entry.name) ||
        entry.name.endsWith(".tsbuildinfo") ||
        entry.name === "next-env.d.ts"
      )
        continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlink rejected: ${relative(root, path)}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile())
        result.push(relative(root, path).split(sep).join("/"));
      else throw new Error("Special file rejected");
    }
  }
  await visit(root);
  return result.sort();
}
export async function hashTree(root: string, protectedOnly = false) {
  const hash = createHash("sha256");
  for (const name of await files(root)) {
    if (protectedOnly && name.startsWith("frontend/src/")) continue;
    hash.update(name);
    hash.update("\0");
    hash.update(await readFile(join(root, name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
export async function copyProject(source: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const name of await files(source)) {
    const dest = join(target, name);
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(source, name), dest);
  }
  await cp(
    join(source, "frontend/next-env.d.ts"),
    join(target, "frontend/next-env.d.ts"),
  );
}
export async function captureSource(
  source: string,
  baseline: string,
  target: string,
) {
  await copyProject(baseline, target);
  const { rm } = await import("node:fs/promises");
  await rm(join(target, "frontend/src"), { recursive: true, force: true });
  let total = 0;
  for (const name of await files(join(source, "frontend/src"))) {
    if (!/\.(tsx?|css|json|svg)$/.test(name))
      throw new Error(`Unsupported source: ${name}`);
    const from = join(source, "frontend/src", name);
    const size = (await lstat(from)).size;
    if (size > 1_000_000 || (total += size) > 8_000_000)
      throw new Error("Candidate source size limit exceeded");
    const dest = join(target, "frontend/src", name);
    await mkdir(dirname(dest), { recursive: true });
    await cp(from, dest);
  }
}
export async function atomicJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, path);
}
