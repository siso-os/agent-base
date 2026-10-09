// Synthetic transport regression: a failed fresh agent lookup must never authorize typing into a cached pane.
// No herdr instance or Claude process runs; HOME and all startup data point into temporary fixtures.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { WebSocket } from "ws";

const root = path.resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(path.join(tmpdir(), "ab-delivery-liveness-"));
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const trace = path.join(scratch, "calls.jsonl");
const fail = path.join(scratch, "fail-list");
const gone = path.join(scratch, "gone");
const fake = path.join(scratch, "herdr.mjs");
const agent = { agent: "claude", agent_status: "idle", cwd: "/synthetic", pane_id: "w1:p1", terminal_id: "term_fixture", terminal_title_stripped: "FIXTURE", agent_session: { value: "fixture" } };
writeFileSync(fake, `import { appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n');
if (args[0] === 'agent' && args[1] === 'list') {
  if (existsSync(${JSON.stringify(fail)})) process.exit(1);
  console.log(JSON.stringify({ result: { agents: existsSync(${JSON.stringify(gone)}) ? [] : [${JSON.stringify(agent)}] } }));
} else console.log('{}');
`);
const claude = path.join(scratch, "claude");
const project = path.join(claude, "projects", "-synthetic");
mkdirSync(project, { recursive: true });
writeFileSync(path.join(project, "fixture.jsonl"), JSON.stringify({ type: "user", uuid: "ready", timestamp: "2026-10-02T20:00:00Z", message: { role: "user", content: "fixture ready" } }) + "\n");
const servers = path.join(scratch, "servers.json");
writeFileSync(servers, JSON.stringify({ servers: [] }));
const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(root, "services/node"),
  env: { ...process.env, HOME: scratch, AB_PORT: String(port), AB_HERDR: `${process.execPath} ${fake}`, AB_CLAUDE_DIRS: claude, AB_SERVERS_FILE: servers, AB_VOICE_WATCH: "0", AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none"), AB_HUB_HOME: scratch },
  stdio: ["ignore", "ignore", "pipe"],
});
let error = "";
child.stderr.on("data", (b) => error += b);
let ws;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, error);
    if (await fn()) return;
    await sleep(25);
  }
  assert.fail("fixture timed out");
};
try {
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/api/agents`)).ok; } catch { return false; }
  });
  const got = [];
  ws = new WebSocket(`ws://127.0.0.1:${port}/chat/term_fixture/ws`, { origin: `http://127.0.0.1:${port}` });
  ws.on("message", (b) => got.push(JSON.parse(String(b))));
  await until(() => got.some((m) => m.t === "hello"));
  writeFileSync(trace, "");
  writeFileSync(fail, "1");
  ws.send(JSON.stringify({ t: "prompt", text: "must not reach a stale pane", key: "failed-lookup" }));
  await until(() => got.some((m) => ["sent", "unsent"].includes(m.t) && m.key === "failed-lookup"));
  const calls = readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(calls.filter((a) => a[0] === "pane" && ["send-text", "send-keys"].includes(a[1])).length, 0, "lookup failure must type nothing");
  assert.ok(got.some((m) => m.t === "unsent" && m.key === "failed-lookup"), "sender receives unsent acknowledgement");
  rmSync(fail);
  got.length = 0;
  ws.send(JSON.stringify({ t: "prompt", text: "retry succeeds", key: "retry" }));
  await until(() => got.some((m) => m.t === "sent" && m.key === "retry"));
  const retry = readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter((a) => a[0] === "pane" && ["send-text", "send-keys"].includes(a[1]));
  assert.deepEqual(retry.map((a) => a[1]), ["send-text", "send-keys"]);
  writeFileSync(trace, "");
  got.length = 0;
  ws.send(JSON.stringify({ t: "prompt", text: "long fixture ".repeat(80), key: "long" }));
  ws.send(JSON.stringify({ t: "prompt", text: "queued fixture must not arrive", key: "queued" }));
  await until(() => {
    const calls = readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    return calls.filter((a) => a[0] === "agent" && a[1] === "list").length >= 2 && calls.some((a) => a[1] === "send-text");
  });
  writeFileSync(gone, "1");
  await until(() => ["long", "queued"].every((key) => got.some((m) => ["sent", "unsent"].includes(m.t) && m.key === key)));
  const queuedCalls = readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter((a) => a[0] === "pane" && ["send-text", "send-keys"].includes(a[1]));
  assert.deepEqual(queuedCalls.map((a) => a[1]), ["send-text"], "neither delayed Enter nor queued prompt reaches a pane after its agent ends");
  assert.ok(got.some((m) => m.t === "unsent" && m.key === "long"));
  assert.ok(got.some((m) => m.t === "unsent" && m.key === "queued"));
  console.log("PASS: lookup failure, successful retry, disappearance during paste and queued-send liveness");
} finally {
  ws?.terminate();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((r) => child.once("exit", r));
  rmSync(scratch, { recursive: true, force: true });
}
