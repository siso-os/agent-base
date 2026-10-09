// t-0549: the Servers page's "Running on the Mac mini" routes. A fake ssh (AB_MINI_SSH_BIN) records argv; a fake host socket
// records prompts. Never real ssh, never a live host.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocketServer } from "ws";

const dir = mkdtempSync(path.join(tmpdir(), "ab-mini-agents-"));
const argvLog = path.join(dir, "argv.log"), down = path.join(dir, "down");
const fake = path.join(dir, "ssh");
writeFileSync(fake, `#!/bin/sh\n[ -e ${down} ] && exit 255\ncase "$*" in *BatchMode=yes*ControlPath=*) ;; *) echo "no ssh options" >&2; exit 9;; esac\nfor a; do prev=$cur; cur=$a; done\nprintf '%s %s\\n' "$prev" "$cur" >> ${argvLog}\ncase "$cur" in ps*) printf '12345 1 2.5 1048576\\n12346 12345 10.0 2097152\\n99 1 50 1\\n';; esac\n`);
chmodSync(fake, 0o755);
process.env.AB_MINI_SSH_BIN = fake;
const { miniAgentsRoutes, resetMiniAgentsCache } = await import("../src/mini-agents.ts");

const prompts = [];
const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((r) => wss.on("listening", r));
wss.on("connection", (ws, req) => {
  if (!req.url.includes("token=tok")) return ws.close();
  ws.on("message", (raw) => { const m = JSON.parse(String(raw)); prompts.push(m); ws.send(JSON.stringify({ t: "prompt.receipt", key: m.key, id: m.messageId, phase: "saved" })); });
});
const host = (over = {}) => ({ name: "TEST-AGENT", activity: "working", model: "m", cwd: "/w", context: 40, remoteMachine: "mini", remote: { ssh: "mini-fast", pid: 12345 }, startedAt: 1, port: wss.address().port, token: "tok", ...over });
let hosts = [host()];

const route = miniAgentsRoutes({
  ALLOWED_ORIGINS: new Set(["http://app"]),
  json: (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); },
  listServiceHosts: async () => hosts,
  readBody: async () => "{}",
});
const server = http.createServer((req, res) => void route.handle(req, res, []).then((h) => { if (h === false) { res.writeHead(404); res.end(); } }));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const post = (p, origin = "http://app") => fetch(url + p, { method: "POST", headers: { origin }, body: "{}" });
const argv = () => existsSync(argvLog) ? readFileSync(argvLog, "utf8").trim().split("\n") : [];
test.after(() => { server.closeAllConnections(); server.close(); wss.close(); rmSync(dir, { recursive: true }); });

test("lists the mini's chats with CPU and RAM from one ps over ssh, cached 10 s", async () => {
  resetMiniAgentsCache(); rmSync(argvLog, { force: true });
  const a = await (await fetch(url + "/api/servers/mini/agents")).json();
  assert.deepEqual(a.agents.map((x) => [x.name, x.cpu, x.rssMb, x.activity]), [["TEST-AGENT", 12.5, 3072, "working"]], "the host plus its child, not other processes");
  assert.equal(a.error, undefined);
  await fetch(url + "/api/servers/mini/agents");
  assert.deepEqual(argv(), ["mini-fast ps -A -o pid=,ppid=,%cpu=,rss="]);
});

test("the mini not answering is said, not a 500", async () => {
  resetMiniAgentsCache(); writeFileSync(down, "");
  const r = await fetch(url + "/api/servers/mini/agents");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).error, "mini did not answer");
  rmSync(down);
});

test("collect sends exactly one wrap-up prompt over the chat's socket", async () => {
  prompts.length = 0;
  const r = await post("/api/servers/mini/agents/TEST-AGENT/collect");
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { sent: true, phase: "saved" });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].delivery, "next");
  assert.match(prompts[0].text, /^Wrap up now: commit and push/);
  assert.equal((await post("/api/servers/mini/agents/NOPE/collect")).status, 404);
  assert.equal((await post("/api/servers/mini/agents/TEST-AGENT/collect", "http://evil")).status, 403);
  hosts = [host({ token: "wrong" })];
  assert.equal((await post("/api/servers/mini/agents/TEST-AGENT/collect")).status, 502);
  hosts = [host()];
});

test("stop kills only that chat's tmux window, with the mini's PATH", async () => {
  rmSync(argvLog, { force: true });
  const r = await post("/api/servers/mini/agents/TEST-AGENT/stop");
  assert.equal(r.status, 200);
  assert.deepEqual(argv(), ["mini-fast PATH=$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH tmux kill-window -t ab-owners:TEST-AGENT"]);
  assert.equal((await post("/api/servers/mini/agents/bad%20name;rm/stop")).status, 400);
  assert.equal((await post("/api/servers/mini/agents/TEST-AGENT/stop", "http://evil")).status, 403);
  assert.equal((await fetch(url + "/api/servers/mini/agents/TEST-AGENT/stop")).status, 405);
});

test("with the node's real runtime shape (HOSTS_DIR, no reader) it reads mirrored records itself", async () => {
  // 8 Oct 22:27: live answered {"error":"listServiceHosts is not a function"} because only tests passed a reader.
  const hostsDir = mkdtempSync(path.join(tmpdir(), "ab-mini-hosts-"));
  writeFileSync(path.join(hostsDir, "remote-mini-1.json"), JSON.stringify({ pid: process.pid, port: wss.address().port, token: "tok", name: "REAL-SHAPE", state: "working", remote: { machine: "mini", ssh: "mini-fast", pid: 12345 } }));
  const live = miniAgentsRoutes({ ALLOWED_ORIGINS: new Set(), HOSTS_DIR: hostsDir, json: (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); } });
  const s2 = http.createServer((req, res) => void live.handle(req, res, []));
  await new Promise((r) => s2.listen(0, "127.0.0.1", r));
  resetMiniAgentsCache();
  const a = await (await fetch(`http://127.0.0.1:${s2.address().port}/api/servers/mini/agents`)).json();
  s2.closeAllConnections(); s2.close(); rmSync(hostsDir, { recursive: true });
  assert.deepEqual(a.agents.map((x) => [x.name, x.cpu]), [["REAL-SHAPE", 12.5]]);
});
