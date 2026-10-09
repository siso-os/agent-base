#!/usr/bin/env node
// A stand-in `claude` that speaks the Agent SDK's stream-json protocol, for siso-host checks with no model and no
// network (a0-018). Use as CLAUDE_BIN. Every start and every message it reads is logged (FAKE_CLAUDE_LOG, JSON lines),
// so a check can see what reached Claude and when, and which pid to kill.
//   a message containing HANG     starts a turn that never ends (to kill mid-turn)
//   a message containing COMPACT  compacts first: PreCompact hook, FAKE_COMPACT_MS of work, PostCompact hook with a
//                                 summary of FAKE_SUMMARY_TOKENS tokens; FAKE_NEW_SESSION makes the session id change
//   anything else                 answers "echo: <text>"
// FAKE_CTX: input tokens each request reports (default 164000, of a 200k window: 82%).
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const argv = process.argv.slice(2);
const after = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);
const log = (o) => process.env.FAKE_CLAUDE_LOG && appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ at: Date.now(), pid: process.pid, ...o }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const WINDOW = 200_000;
let session = after("--resume") ?? argv.find((a) => a.startsWith("--resume="))?.slice(9) ?? randomUUID();
let ctx = Number(process.env.FAKE_CTX ?? 164_000);
const model = process.env.FAKE_MODEL ?? "claude-fake-1";
let hooks = {};
log({ ev: "start", argv, session });

let n = 0;
const asked = new Map();
/** A control request to the SDK (a hook callback), answered on stdin. */
const ask = (request) =>
  new Promise((resolve) => {
    const id = `fake-${++n}`;
    asked.set(id, resolve);
    send({ type: "control_request", request_id: id, request });
  });
const ok = (request_id, response = {}) => send({ type: "control_response", response: { subtype: "success", request_id, response } });

const queue = [];
let busy = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.type === "control_response") {
    asked.get(m.response?.request_id)?.(m.response);
    asked.delete(m.response?.request_id);
  } else if (m.type === "control_request") {
    const r = m.request ?? {};
    if (r.subtype === "initialize") {
      hooks = r.hooks ?? {};
      ok(m.request_id, { commands: [], agents: [], output_style: "default", available_output_styles: ["default"], models: [], account: {} });
    } else if (r.subtype === "get_context_usage") {
      ok(m.request_id, { categories: [], totalTokens: ctx, maxTokens: WINDOW, rawMaxTokens: WINDOW, percentage: Math.round((ctx / WINDOW) * 100), gridRows: [], model, memoryFiles: [], mcpTools: [], agents: [] });
    } else ok(m.request_id);
  } else if (m.type === "user") {
    const c = m.message?.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
    log({ ev: "user", text, uuid: m.uuid ?? null, busy });
    queue.push({ text, uuid: m.uuid, mid: busy });
    if (!busy) void run();
  }
});

const base = () => ({ session_id: session, uuid: randomUUID(), parent_tool_use_id: null });
const stream = (event) => send({ type: "stream_event", event, ...base() });
async function reply(text) {
  const id = `msg_${randomUUID().slice(0, 8)}`;
  stream({ type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: ctx - 10, output_tokens: 1 } } });
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
  stream({ type: "content_block_stop", index: 0 });
  send({ type: "assistant", message: { id, type: "message", role: "assistant", model, content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }, ...base() });
  stream({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } });
  stream({ type: "message_stop" });
}
async function hook(name, input) {
  const id = hooks[name]?.[0]?.hookCallbackIds?.[0];
  if (!id) return log({ ev: "hook", name, registered: false });
  const r = await ask({ subtype: "hook_callback", callback_id: id, input: { hook_event_name: name, session_id: session, transcript_path: "", cwd: process.cwd(), ...input } });
  log({ ev: "hook", name, registered: true, answered: r?.subtype ?? null, session });
}

async function run() {
  busy = true;
  while (queue.length) {
    const { text, uuid, mid } = queue.shift();
    const started = Date.now();
    send({ type: "system", subtype: "init", cwd: process.cwd(), tools: [], mcp_servers: [], model, permissionMode: "default", slash_commands: [], apiKeySource: "none", output_style: "default", ...base() });
    if (mid && uuid) send({ type: "command_lifecycle", command_uuid: uuid, state: "started", ...base() });
    if (text.includes("HANG")) {
      const id = `msg_${randomUUID().slice(0, 8)}`;
      stream({ type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, output_tokens: 1 } } });
      stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "working on it, half a sentence" } });
      log({ ev: "hanging" });
      await new Promise(() => {});
    }
    if (text.includes("COMPACT")) {
      send({ type: "system", subtype: "status", status: "compacting", ...base() });
      await hook("PreCompact", { trigger: "auto", custom_instructions: null });
      await sleep(Number(process.env.FAKE_COMPACT_MS ?? 1500));
      const pre = ctx;
      if (process.env.FAKE_NEW_SESSION) session = process.env.FAKE_NEW_SESSION;
      ctx = 9_000;
      await hook("PostCompact", { trigger: "auto", compact_summary: "s".repeat(4 * Number(process.env.FAKE_SUMMARY_TOKENS ?? 1234)) });
      send({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: pre, post_tokens: ctx }, ...base() });
      send({ type: "system", subtype: "status", status: null, compact_result: "success", ...base() });
      log({ ev: "compacted", session });
    }
    await reply(`echo: ${text}`);
    send({ type: "result", subtype: "success", is_error: false, duration_ms: Date.now() - started, duration_api_ms: 1, num_turns: 1, result: `echo: ${text}`, total_cost_usd: 0, usage: {}, ...base() });
  }
  busy = false;
}
