import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRequests } from "../src/request-metrics.ts";
test("missing or corrupt inference logs stay unavailable, while an empty log records zero requests", () => {
  const unavailable = {
    requests: null,
    overlappingRequests: null,
    tokens: null,
  };
  assert.deepEqual(summarizeRequests(null, "run"), unavailable);
  assert.deepEqual(summarizeRequests('{"incomplete":', "run"), unavailable);
  assert.deepEqual(summarizeRequests("", "run"), {
    requests: 0,
    overlappingRequests: false,
    tokens: null,
  });
});
test("request totals count only this run and never substitute zero for missing token fields", () => {
  const event = {
    run: "run",
    route: "v1/chat/completions",
    activeAtStart: 2,
    usage: { total_tokens: 20 },
  };
  const log = (...events: unknown[]) =>
    events.map((event) => JSON.stringify(event)).join("\n");
  assert.deepEqual(
    summarizeRequests(log(event, { ...event, run: "other" }), "run"),
    {
      requests: 1,
      overlappingRequests: true,
      tokens: 20,
    },
  );
  assert.equal(
    summarizeRequests(log(event, { ...event, usage: {} }), "run").tokens,
    null,
  );
  assert.equal(
    summarizeRequests(log({ ...event, usage: { total_tokens: 0 } }), "run")
      .tokens,
    0,
  );
});
