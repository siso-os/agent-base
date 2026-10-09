// Synthetic siso-host pass-through successor controls. The host server is a local
// WebSocket fixture; token/session values are dummy strings and no model runs.
// Run: heavy -- node services/node/test/overnight-successor-host.test.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true; return false; };
const freePort = async () => { const s = createServer(); await new Promise((resolve, reject) => s.once("error", reject).listen(0, "127.0.0.1", resolve)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
const agent = (id, pane, title = "HOST-RELAY") => ({ agent: "siso", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id: id, terminal_title_stripped: title });
const cases = [
  { name: "host-same-session", old: agent("host_same_old", "w1:p2"), next: agent("host_same_new", "w1:p3"), oldSession: "host-same", nextSession: "host-same", move: true },
  { name: "host-distinct-session", old: agent("host_distinct_old", "w1:p2"), next: agent("host_distinct_new", "w1:p3"), oldSession: "host-alpha", nextSession: "host-beta", move: false },
  { name: "host-empty-session", old: agent("host_empty_old", "w1:p2"), next: agent("host_empty_new", "w1:p3"), oldSession: null, nextSession: null, move: false },
];
const results = []; const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };

const hostWs = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const hostCases = new Map();
hostWs.on("connection", (ws, req) => {
  const token = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token");
  const c = [...hostCases.values()].find((x) => x.tokens.has(token));
  if (!c) return ws.close();
  const phase = c.tokenPhase.get(token); c.connections++; c.connectionLog.push({ token, phase });
  ws.send(JSON.stringify({ t: "hello", name: c.name, session: phase.session, state: "working", log: [], partial: {}, tasks: [], bg: [] }));
  ws.send(JSON.stringify({ t: "text", id: `${c.name}-${phase.phase}-frame`, text: phase.phase === "new" ? "HOST-FRAME-NEW" : "HOST-FRAME" }));
  ws.on("message", (data) => { try { const m = JSON.parse(String(data)); c.messages.push({ phase: phase.phase, token, ...m }); if (m.t === "prompt") ws.send(JSON.stringify({ t: "sent", key: m.key })); } catch {} });
});
await new Promise((r) => hostWs.once("listening", r));
const hostPort = hostWs.address().port;

async function runCase(c) {
  const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-successor-host."));
  const port = await freePort(); const base = `http://127.0.0.1:${port}`; const agentsFile = path.join(scratch, "agents.json"); const hostsDir = path.join(scratch, "hosts"); const fake = path.join(scratch, "fake.mjs");
  mkdirSync(path.join(scratch, "claude/projects/-tmp"), { recursive: true }); mkdirSync(hostsDir, { recursive: true });
  const zero = agent(`${c.name}_zero`, "w1:p1", "A0"); writeFileSync(path.join(scratch, "seat.json"), JSON.stringify({ session: "zero", pane: "w1:p1", name: "A0" })); writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: {}, domains: [] })); writeFileSync(agentsFile, JSON.stringify([zero, c.old]));
  writeFileSync(fake, `import { readFileSync } from "node:fs"; const a=process.argv.slice(2); if(a[0]==="agent"&&a[1]==="list") console.log(JSON.stringify({result:{agents:JSON.parse(readFileSync(process.env.FAKE_HERDR_AGENTS_FILE,"utf8"))}})); else console.log("{}");`);
  const oldToken = `${c.name}-old-token`; const newToken = `${c.name}-new-token`; const state = { name: c.name, session: c.oldSession, tokens: new Set([oldToken, newToken]), tokenPhase: new Map([[oldToken, { phase: "old", session: c.oldSession }], [newToken, { phase: "new", session: c.nextSession }]]), connections: 0, connectionLog: [], messages: [] }; hostCases.set(c.name, state);
  const hostFile = (pane, session, suffix) => path.join(hostsDir, `${pane.replace(/[^A-Za-z0-9_-]/g, "_")}-${suffix}.json`);
  const oldHost = hostFile(c.old.pane_id, c.oldSession, "old"); const newHost = hostFile(c.next.pane_id, c.nextSession, "new");
  const writeHost = (file, pane, session, suffix) => writeFileSync(file, JSON.stringify({ pid: process.pid, port: hostPort, token: `${c.name}-${suffix}-token`, session, pane, name: c.name, cwd: "/tmp", model: null }));
  writeHost(oldHost, c.old.pane_id, c.oldSession, "old");
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL, HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"), CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_PORT: String(port), AB_HOST: "127.0.0.1", AB_CONSOLE_URL: base, AB_HERDR: `${process.execPath} ${fake}`, FAKE_HERDR_AGENTS_FILE: agentsFile, AB_HOSTS_DIR: hostsDir, AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: path.join(scratch, "seat.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_OPEN_DRY: "1", AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_VOICE_WATCH: "0", AB_VOICE_PREFS: path.join(scratch, "voice-prefs.plist"), AB_VOICE_DB: path.join(scratch, "voice.db"), AB_BURN_CMD: "true" };
  let node, socket, reopened, replacementSocket; const events = [], reopenEvents = [], replacementEvents = [];
  try {
    node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
    check(`${c.name}: health`, await until(async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok, 15000));
    const initial = (await (await fetch(`${base}/api/agents`)).json()).agents; check(`${c.name}: host-derived initial session/pane`, initial.some((a) => a.id === c.old.terminal_id && a.session === c.oldSession && a.pane === c.old.pane_id), { rows: initial.map((a) => ({ id: a.id, session: a.session, pane: a.pane })) });
    socket = new WebSocket(`ws://127.0.0.1:${port}/chat/${c.old.terminal_id}/ws`, { headers: { Origin: base } }); socket.on("message", (d) => { try { events.push(JSON.parse(String(d))); } catch {} });
    check(`${c.name}: exact host hello and frame pass through`, await until(() => events.some((e) => e.t === "hello" && e.session === c.oldSession) && events.some((e) => e.t === "text" && e.text === "HOST-FRAME")), { events });
    socket.send(JSON.stringify({ t: "prompt", key: `${c.name}-prompt`, text: "HOST-PROMPT" })); check(`${c.name}: prompt frame reaches host and ACK returns`, await until(() => state.messages.some((m) => m.t === "prompt" && m.text === "HOST-PROMPT") && events.some((e) => e.t === "sent" && e.key === `${c.name}-prompt`)), { messages: state.messages, events: events.filter((e) => ["sent", "moved"].includes(e.t)) });
    writeFileSync(agentsFile, JSON.stringify([zero, c.next])); unlinkSync(oldHost); writeHost(newHost, c.next.pane_id, c.nextSession, "new"); state.session = c.nextSession;
    const rows = []; const replaced = await until(async () => { const r = (await (await fetch(`${base}/api/agents`)).json()).agents; rows.push(r); return r.some((a) => a.id === c.next.terminal_id && a.session === c.nextSession && a.pane === c.next.pane_id) && !r.some((a) => a.id === c.old.terminal_id); }, 8000); check(`${c.name}: replacement exact host session/pane and old absent`, replaced, { expected: { id: c.next.terminal_id, session: c.nextSession, pane: c.next.pane_id }, oldPresent: rows.at(-1)?.some((a) => a.id === c.old.terminal_id) ?? null });
    reopened = new WebSocket(`ws://127.0.0.1:${port}/chat/${c.old.terminal_id}/ws`, { headers: { Origin: base } }); reopened.on("message", (d) => { try { reopenEvents.push(JSON.parse(String(d))); } catch {} }); reopened.on("error", () => {}); const moved = await until(() => reopenEvents.some((e) => e.t === "moved" && e.id === c.next.terminal_id), 5000); check(`${c.name}: reopen moved expectation`, c.move ? moved : !moved, { moved: reopenEvents.filter((e) => e.t === "moved") });
    if (c.move) {
      replacementSocket = new WebSocket(`ws://127.0.0.1:${port}/chat/${c.next.terminal_id}/ws`, { headers: { Origin: base } }); replacementSocket.on("message", (d) => { try { replacementEvents.push(JSON.parse(String(d))); } catch {} }); replacementSocket.on("error", () => {});
      const newHello = await until(() => replacementEvents.some((e) => e.t === "hello" && e.session === c.nextSession) && replacementEvents.some((e) => e.t === "text" && e.text === "HOST-FRAME-NEW"), 5000); check(`${c.name}: replacement id reaches new host token and exact new hello/frame`, newHello && state.connectionLog.some((x) => x.phase?.phase === "new" && x.token === `${c.name}-new-token`), { connectionLog: state.connectionLog, replacementEvents });
      replacementSocket.send(JSON.stringify({ t: "prompt", key: `${c.name}-prompt2`, text: "HOST-PROMPT2" })); check(`${c.name}: replacement host receives exact HOST-PROMPT2 and ACK`, await until(() => state.messages.some((m) => m.phase === "new" && m.token === `${c.name}-new-token` && m.t === "prompt" && m.key === `${c.name}-prompt2` && m.text === "HOST-PROMPT2") && replacementEvents.some((e) => e.t === "sent" && e.key === `${c.name}-prompt2`), 5000), { messages: state.messages, replacementEvents: replacementEvents.filter((e) => e.t === "sent") });
    }
  } finally { socket?.close(); reopened?.close(); replacementSocket?.close(); hostCases.delete(c.name); try { unlinkSync(oldHost); } catch {} try { unlinkSync(newHost); } catch {} if (node) { node.kill(); if (node.exitCode === null) await new Promise((r) => node.once("exit", r)); } rmSync(scratch, { recursive: true, force: true }); }
}
for (const c of cases) await runCase(c);
hostWs.close();
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length, cases: cases.map((c) => c.name), fixture: "local WebSocket + scratch host JSON + parent PID" }));
process.exit(results.every(Boolean) ? 0 : 1);
