import { readiness } from "./process.ts";
const base = process.argv[2];
await readiness(base + "/health");
const value = await (await fetch(base + "/api/todos")).json();
if (!Array.isArray(value) || value.length)
  throw new Error("Backend restart did not reset state");
console.log("PASS backend restart resets in-memory data");
