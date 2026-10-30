import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Variant } from "./engine.ts";

export class ContextOverflow extends Error {}

// Inspect structured events, not model prose or only the last chunk of stdout.
export async function contextOverflow(log: string) {
  let found = false;
  let otherError = false;
  const lines = createInterface({
    input: createReadStream(log),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "error") continue;
    if (event.error?.name === "ContextOverflowError") found = true;
    else otherError = true;
  }
  return found && !otherError;
}

export function workerConfig(config: any, baseURL: string) {
  const result = {
    model: config.model,
    small_model: config.model,
    autoupdate: false,
    enabled_providers: ["local"],
    permission: { "*": "allow", external_directory: "deny" },
    // Reserve space for tool results and compaction on the 16K serving profile.
    compaction: { auto: true, prune: true, reserved: 4096 },
    provider: { local: structuredClone(config.provider.local) },
  };
  result.provider.local.options = { baseURL, apiKey: "p2i-worker" };
  return result;
}

const behavior: Record<Variant, string> = {
  list: "Show a list with All, Active and Completed filter buttons.",
  kanban:
    'Show two accessible regions named "Active tasks" and "Completed tasks". Keep CRUD controls in both columns.',
  focus:
    'Show one selected active task with "Next task" and "Previous task" buttons. Include Active and Completed buttons so completed tasks can be reopened.',
};

export function workerPrompt(
  variant: Variant,
  brief: string,
  failure?: string,
) {
  return `Implement ONLY the ${variant} variant. Other workers implement the other variants; do not build tabs or multiple views.
Design brief: ${brief}
Read AGENTS.md and frontend/src/app/page.tsx. ${behavior[variant]}
Edit frontend/src only, using the existing generated SDK. Preserve all CRUD, loading and error behavior. No API or dependency changes.
Keep changes small. Read specific file ranges (at most 120 lines per tool call); avoid full-file dumps, directory scans and repeated summaries. Prefer small edits over rewriting the whole file. Run npm run typecheck -- --incremental false from frontend without piping away its exit status.
Finish after implementing. Do not ask whether to continue: this is an unattended worker. The controller builds and runs the independent acceptance tests.
${failure ? "Repair these verification failures:\n" + failure.slice(0, 4000) : "Implement now."}`;
}
