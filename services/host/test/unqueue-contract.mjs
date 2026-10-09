// Source-extracted host unqueue contract. No SDK startup or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve("services/host/src/host.ts"), "utf8");
const match = /async function unqueue\(id: string, ws: WebSocket\) \{([\s\S]*?)\n\}\n\/\*\* Claude took/.exec(source);
assert.ok(match, "host unqueue function present");
const body = match[1].replace("q as any", "q").replace("(text: string)", "(text)");
const make = new Function("waiting", "q", "lifecycle", "send", `return async function unqueue(id, ws) {${body}\n}`);
async function run(q, id = "m-1") {
  const waiting = new Map([["m-1", { text: "fixture" }]]);
  const events = [];
  await make(waiting, q, (id, phase) => { events.push([id, phase]); waiting.delete(id); }, (_ws, event) => events.push(["send", event]))(id, {});
  return { waiting: waiting.has("m-1"), events };
}
try {
  const absent = await run({});
  const falseResult = await run({ cancelAsyncMessage: async () => false });
  const rejected = await run({ cancelAsyncMessage: async () => { throw new Error("unsupported"); } });
  const confirmed = await run({ cancelAsyncMessage: async () => true });
  const unknown = await run({ cancelAsyncMessage: async () => true }, "missing");
  assert.deepEqual(absent, { waiting: true, events: [["send", { t: "unqueue_failed", id: "m-1", text: "This queued message cannot be taken back by the current agent runtime." }]] });
  assert.deepEqual(falseResult, { waiting: true, events: [["send", { t: "unqueue_failed", id: "m-1", text: "Could not confirm removal; the message may still be sent." }]] });
  assert.deepEqual(rejected, { waiting: true, events: [["send", { t: "unqueue_failed", id: "m-1", text: "Could not confirm removal; the message may still be sent." }]] });
  assert.deepEqual(confirmed, { waiting: false, events: [["m-1", "cancelled"]] });
  assert.deepEqual(unknown, { waiting: true, events: [["send", { t: "unqueue_failed", id: "missing", text: "This message is no longer pending in the agent queue." }]] });
  console.log(JSON.stringify({ ok: true, absent, falseResult, rejected, confirmed, unknown }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
