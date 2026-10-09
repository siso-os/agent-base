// Synthetic upload HTTP/delivery policy: outside fixture files must never be read or pasted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { WebSocket } from "ws";

const root = path.resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(path.join(tmpdir(), "ab-upload-delivery-"));
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const fake = path.join(scratch, "herdr.mjs");
const agent = { agent: "claude", agent_status: "idle", cwd: "/synthetic", pane_id: "w1:p1", terminal_id: "term_fixture", terminal_title_stripped: "FIXTURE", agent_session: { value: "fixture" } };
const trace = path.join(scratch, "calls.jsonl");
writeFileSync(fake, `import { appendFileSync } from 'node:fs'; const args = process.argv.slice(2); appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n'); console.log(JSON.stringify(args[0] === 'agent' && args[1] === 'list' ? { result: { agents: [${JSON.stringify(agent)}] } } : {}));`);
const uploads = path.join(scratch, "uploads");
mkdirSync(uploads);
const valid = path.join(uploads, "valid.png"), outside = path.join(scratch, "outside.png");
const escape = path.join(uploads, "escape.png"), traversal = `${uploads}/../outside.png`;
writeFileSync(valid, "VALID-SYNTHETIC"); writeFileSync(outside, "OUTSIDE-SYNTHETIC");
symlinkSync(outside, escape);
const claude = path.join(scratch, "claude");
const project = path.join(claude, "projects", "-synthetic");
mkdirSync(project, { recursive: true });
const file = path.join(project, "fixture.jsonl");
const line = (text) => JSON.stringify({ type: "user", uuid: text, timestamp: "2026-10-02T20:00:00Z", message: { role: "user", content: text } }) + "\n";
writeFileSync(file, line("OLD"));
const servers = path.join(scratch, "servers.json");
writeFileSync(servers, JSON.stringify({ servers: [] }));
const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(root, "services/node"),
  env: { ...process.env, HOME: scratch, AB_PORT: String(port), AB_HERDR: `${process.execPath} ${fake}`, AB_UPLOADS: uploads, AB_CLAUDE_DIRS: claude, AB_SERVERS_FILE: servers, AB_VOICE_WATCH: "0", AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none"), AB_HUB_HOME: scratch },
  stdio: ["ignore", "ignore", "pipe"],
});
let error = "", ws;
child.stderr.on("data", (b) => error += b);
const until = async (fn) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, error);
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail("fixture timed out");
};
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/agents`)).ok; } catch { return false; } });
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/uploads/escape.png`)).status, 404);
  const response = await fetch(`http://127.0.0.1:${port}/api/uploads/valid.png`);
  assert.equal(response.status, 200); assert.equal(await response.text(), "VALID-SYNTHETIC");
  const got = [];
  ws = new WebSocket(`ws://127.0.0.1:${port}/chat/term_fixture/ws`, { origin: `http://127.0.0.1:${port}` });
  ws.on("message", (b) => got.push(JSON.parse(String(b))));
  await until(() => got.some((m) => m.t === "hello"));
  writeFileSync(trace, "");
  ws.send(JSON.stringify({ t: "prompt", text: "fixture images", images: [valid, traversal, escape, outside], key: "images" }));
  await until(() => got.some((m) => m.t === "sent" && m.key === "images"));
  const calls = readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const paste = calls.filter((a) => a[0] === "pane" && a[1] === "send-text");
  assert.equal(paste.length, 1);
  assert.equal(paste[0].at(-1), `\x1b[200~fixture images\n${valid}\x1b[201~`, "only canonical allowed image path may be pasted");
  console.log("PASS: upload thumbnail rejects symlink escape; node delivery pastes valid image only");
} finally {
  ws?.terminate();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((r) => child.once("exit", r));
  rmSync(scratch, { recursive: true, force: true });
}
