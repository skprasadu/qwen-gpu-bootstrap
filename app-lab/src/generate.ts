import { resolve, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { command } from "./process.ts";
import { hashTree } from "./files.ts";
export const labRoot = fileURLToPath(new URL("..", import.meta.url));
export async function generate(
  project: string,
  check = false,
  signal?: AbortSignal,
) {
  const before = check ? await hashTree(project, true) : "";
  await command("cargo", ["build", "--locked"], {
    cwd: join(project, "backend"),
    signal,
  });
  const binary = join(
    process.env.CARGO_TARGET_DIR ?? join(project, "backend/target"),
    "debug/p2i-todo",
  );
  const schema = await command(binary, ["--openapi"], { signal });
  JSON.parse(schema);
  await writeFile(join(project, "openapi.json"), schema);
  await command("npm", ["run", "generate"], {
    cwd: join(project, "frontend"),
    signal,
  });
  if (check && before !== (await hashTree(project, true)))
    throw new Error(
      "OpenAPI/generated-client drift: regenerate and review the trusted template",
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generate(
    resolve(process.argv[2] ?? join(labRoot, "template")),
    process.argv.includes("--check"),
  );
}
