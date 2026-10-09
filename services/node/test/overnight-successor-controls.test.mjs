// Hermetic successor controls: same-session replacement may move; distinct or missing
// identity must not. All agents, sessions, panes and host records are synthetic.
// Run: heavy -- node services/node/test/overnight-successor-controls.test.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true; return false; };
const freePort = async () => { const s = createServer(); await new Promise((resolve, reject) => s.once("error", reject).listen(0, "127.0.0.1", resolve)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
const agent = (id, title, pane, session) => ({ agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id: id, terminal_title_stripped: title, ...(session === undefined ? {} : { agent_session: { value: session } }) });
const readLog = (file) => { try { return readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
const cases = [
  { name: "same-session", old: agent("same_old", "RELAY", "w1:p2", "same"), next: agent("same_new", "RELAY", "w1:p2-new", "same"), move: true, pane: "w1:p2-new" },
  { name: "distinct-same-name", old: agent("distinct_old", "RELAY", "w1:p2", "alpha"), next: agent("distinct_new", "RELAY", "w1:p3", "beta"), move: false },
  { name: "empty-new", old: agent("empty_new_old", "RELAY", "w1:p2", "alpha"), next: agent("empty_new", "RELAY", "w1:p3", ""), move: false },
  { name: "empty-old", old: agent("empty_old", "RELAY", "w1:p2"), next: agent("empty_old_new", "RELAY", "w1:p3", "beta"), move: false, noChat: true },
];
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };

async function runCase(c) {
  const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-successor-controls."));
  const port = await freePort(); const base = `http://127.0.0.1:${port}`; const agentsFile = path.join(scratch, "agents.json"); const logFile = path.join(scratch, "herdr.jsonl"); const fake = path.join(scratch, "fake.mjs");
  mkdirSync(path.join(scratch, "claude/projects/-tmp"), { recursive: true }); mkdirSync(path.join(scratch, "hosts"), { recursive: true });
  for (const a of [c.old, c.next]) if (a.agent_session?.value) writeFileSync(path.join(scratch, "claude/projects/-tmp", `${a.agent_session.value}.jsonl`), "{}\n");
  const zero = agent(`${c.name}_zero`, "A0", "w1:p1", "zero"); writeFileSync(path.join(scratch, "claude/projects/-tmp/zero.jsonl"), "{}\n");
  writeFileSync(path.join(scratch, "seat.json"), JSON.stringify({ session: "zero", pane: "w1:p1", name: "A0" })); writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: {}, domains: [] })); writeFileSync(agentsFile, JSON.stringify([zero, c.old]));
  writeFileSync(fake, String.raw`import { appendFileSync, readFileSync } from "node:fs"; const a=process.argv.slice(2),f=process.env.FAKE_HERDR_AGENTS_FILE,rows=()=>JSON.parse(readFileSync(f,"utf8")); if(process.env.FAKE_HERDR_LOG) appendFileSync(process.env.FAKE_HERDR_LOG,JSON.stringify({args:a,agents:rows().map(x=>({id:x.terminal_id,session:x.agent_session?.value??null,pane:x.pane_id}))})+"\n"); if(a[0]==="agent"&&a[1]==="list") console.log(JSON.stringify({result:{agents:rows()}})); else console.log("{}");`);
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL, HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"), CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_STATE_HOME: path.join(scratch, ".state"), AB_PORT: String(port), AB_HOST: "127.0.0.1", AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_HERDR: `${process.execPath} ${fake}`, FAKE_HERDR_AGENTS_FILE: agentsFile, FAKE_HERDR_LOG: logFile, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: path.join(scratch, "seat.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_OPEN_DRY: "1", AB_CONSOLE_URL: base, AB_BURN_CMD: "true", AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_WATCH: "0" };
  let node, socket, reopened; const events = [], reopenEvents = [];
  try {
    node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
    check(`${c.name}: health`, await until(async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok, 15000));
    const initial = (await (await fetch(`${base}/api/agents`)).json()).agents; check(`${c.name}: initial exact id/session/pane`, initial.some((a) => a.id === c.old.terminal_id && a.session === (c.old.agent_session?.value || null) && a.pane === c.old.pane_id), { rows: initial.map((a) => ({ id: a.id, session: a.session, pane: a.pane })) });
    if (!c.noChat) { socket = new WebSocket(`ws://127.0.0.1:${port}/chat/${c.old.terminal_id}/ws`, { headers: { Origin: base } }); socket.on("message", (d) => { try { events.push(JSON.parse(String(d))); } catch {} }); check(`${c.name}: old hello`, await until(() => events.some((e) => e.t === "hello" && e.session === c.old.agent_session.value))); }
    writeFileSync(agentsFile, JSON.stringify([zero, c.next])); const replacementRows = []; const expectedSession = c.next.agent_session ? c.next.agent_session.value : null; const replaced = await until(async () => { const rows = (await (await fetch(`${base}/api/agents`)).json()).agents; replacementRows.push(rows); return rows.some((a) => a.id === c.next.terminal_id && a.pane === c.next.pane_id) && !rows.some((a) => a.id === c.old.terminal_id); }, 8000); const replacement = replacementRows.at(-1)?.find((a) => a.id === c.next.terminal_id); check(`${c.name}: replacement exact id/session/pane and old id absent`, replaced && replacement?.session === expectedSession, { expected: { id: c.next.terminal_id, session: expectedSession, pane: c.next.pane_id }, observed: replacement ? { id: replacement.id, session: replacement.session ?? null, pane: replacement.pane } : null, oldPresent: replacementRows.at(-1)?.some((a) => a.id === c.old.terminal_id) ?? null });
    reopened = new WebSocket(`ws://127.0.0.1:${port}/chat/${c.old.terminal_id}/ws`, { headers: { Origin: base } }); reopened.on("message", (d) => { try { reopenEvents.push(JSON.parse(String(d))); } catch {} }); reopened.on("error", () => {}); const moved = await until(() => reopenEvents.some((e) => e.t === "moved" && e.id === c.next.terminal_id), 5000);
    check(`${c.name}: ${c.noChat ? "no-session reopen has no moved contract" : "reopen moved expectation"}`, c.noChat ? !moved : c.move ? moved : !moved, { moved: reopenEvents.filter((e) => e.t === "moved") });
    if (!c.noChat && c.move) { socket.send(JSON.stringify({ t: "prompt", key: `${c.name}-prompt`, text: "CONTROL-PROMPT\n" })); const expectedText = "\x1b[200~CONTROL-PROMPT\n\x1b[201~"; const sent = await until(() => readLog(logFile).some((r) => r.args?.[0] === "pane" && r.args?.[1] === "send-text"), 5000); const sends = readLog(logFile).filter((r) => r.args?.[0] === "pane" && r.args?.[1] === "send-text"); check(`${c.name}: ACK and exact replacement pane command`, sent && sends.length === 1 && sends[0].args[2] === c.pane && sends[0].args[3] === expectedText && await until(() => events.some((e) => e.t === "sent" && e.key === `${c.name}-prompt`)), { sends: sends.map((r) => r.args), events: events.filter((e) => ["sent", "unsent", "moved"].includes(e.t)) }); }
  } finally { socket?.close(); reopened?.close(); if (node) { node.kill(); if (node.exitCode === null) await new Promise((r) => node.once("exit", r)); } rmSync(scratch, { recursive: true, force: true }); }
}
for (const c of cases) await runCase(c);
// Host-derived identity is an explicit bounded gap: hostsByPane() requires a live pid
// and pass-through chat requires a real host websocket, so this matrix does not invent
// a fake-host contract.
console.log(JSON.stringify({ gap: "host-derived session control", why: "requires live pid plus pass-through websocket; schema is server.ts:673-692 and route is 1692-1700" }));
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length })); process.exit(results.every(Boolean) ? 0 : 1);
