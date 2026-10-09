// Hermetic queue identity probe: a queued prompt must not press Enter into a replacement
// agent that reused the original pane while the first long paste is settling.
// Run: heavy -- node services/node/test/overnight-queued-identity.test.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const probe = createServer();
await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
const PORT = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-queued-identity."));
const agentsFile = path.join(scratch, "agents.json");
const logFile = path.join(scratch, "herdr.jsonl");
const seatFile = path.join(scratch, "seat.json");
const claudeDir = path.join(scratch, "claude/projects/-tmp");
mkdirSync(claudeDir, { recursive: true });

const S = { zero: "queued-zero", alpha: "queued-alpha", other: "queued-other" };
for (const [name, session] of Object.entries(S)) {
  writeFileSync(path.join(claudeDir, `${session}.jsonl`), `${JSON.stringify({ type: "assistant", uuid: `a-${session}`, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: `${name}-fixture` }] } })}\n`);
}
writeFileSync(seatFile, JSON.stringify({ session: S.zero, pane: "w1:p1", name: "A0" }));
const agent = (title, pane, terminal_id, session) => ({ agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id, terminal_title_stripped: title, agent_session: { value: session } });
const ZERO = agent("A0", "w1:p1", "term_queued_zero", S.zero);
const A = agent("QUEUE-A", "w1:p2", "term_queued_old", S.alpha);
const OTHER = agent("OTHER", "w1:p2", "term_queued_new", S.other);
const setAgents = (list) => writeFileSync(agentsFile, JSON.stringify(list));
setAgents([ZERO, A]);

// The adapter snapshots the current agent list for every command. It delays only the
// first long paste, making the Enter-after-paste window deterministic without sleeping
// in the test process or talking to a real herdr.
const fake = path.join(scratch, "queued-fake-herdr.mjs");
writeFileSync(fake, String.raw`import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const file = process.env.FAKE_HERDR_AGENTS_FILE;
const agents = () => JSON.parse(readFileSync(file, "utf8"));
const current = agents();
const snapshot = () => current.map((a) => ({ id: a.terminal_id, session: a.agent_session?.value ?? null, pane: a.pane_id }));
const text = typeof args[3] === "string" ? args[3] : "";
const kind = args[0] === "agent" && args[1] === "list" ? "agent-list" : args[0] === "pane" ? args[1] : "other";
const textRole = text.includes("QUEUE-A-FIRST") ? "first" : text.includes("QUEUE-A-SECOND") ? "second" : null;
const record = { kind, args: kind === "send-text" ? args.slice(0, 3) : args, textLength: text.length, textRole, snapshot: snapshot(), at: Date.now() };
if (process.env.FAKE_HERDR_LOG) appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(record) + "\n");
if (args[0] === "agent" && args[1] === "list") process.stdout.write(JSON.stringify({ result: { agents: current } }));
else if (args[0] === "pane" && args[1] === "send-text" && text.includes("QUEUE-A-FIRST")) setTimeout(() => process.stdout.write("{}"), 4000);
else process.stdout.write("{}");
`);

writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: {}, domains: [] }));
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true; return false; };
const records = () => { try { return readFileSync(logFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
const env = {
  PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL,
  HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"),
  CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_CACHE_HOME: path.join(scratch, ".cache"), XDG_DATA_HOME: path.join(scratch, ".local/share"), XDG_STATE_HOME: path.join(scratch, ".local/state"),
  AB_PORT: String(PORT), AB_HOST: "127.0.0.1", AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_HUD_DIR: path.join(scratch, "ctx"),
  AB_HERDR: `${process.execPath} ${fake}`, FAKE_HERDR_AGENTS_FILE: agentsFile, FAKE_HERDR_LOG: logFile,
  AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: seatFile, AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
  AB_OPEN_DRY: "1", AB_CONSOLE_URL: BASE, AB_BURN_CMD: "true", AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_WATCH: "0",
};
let node, socket;
const events = [];
try {
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
  check("isolated node health", await until(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 15000));
  const initial = (await (await fetch(`${BASE}/api/agents`)).json()).agents;
  check("initial agent list exposes A on pane2", initial.some((a) => a.id === A.terminal_id && a.session === S.alpha && a.pane === A.pane_id), { rows: initial.map((a) => ({ id: a.id, session: a.session, pane: a.pane })) });
  socket = new WebSocket(`ws://127.0.0.1:${PORT}/chat/${A.terminal_id}/ws`, { headers: { Origin: BASE } });
  socket.on("message", (data) => { try { events.push(JSON.parse(String(data))); } catch {} });
  check("A socket receives its session hello", await until(() => events.some((e) => e.t === "hello" && e.session === S.alpha)));

  const first = `QUEUE-A-FIRST ${"x".repeat(20_000)}`;
  socket.send(JSON.stringify({ t: "prompt", key: "queued-first", text: first }));
  const firstPaste = await until(() => records().some((r) => r.kind === "send-text" && r.textRole === "first" && r.textLength >= 20_000), 5000);
  check("first 20k paste is accepted before fixture change", firstPaste, { sends: records().filter((r) => r.kind === "send-text").map((r) => ({ length: r.textLength, snapshot: r.snapshot })) });

  const listsBeforeSecond = records().filter((r) => r.kind === "agent-list").length;
  socket.send(JSON.stringify({ t: "prompt", key: "queued-second", text: "QUEUE-A-SECOND" }));
  const secondList = await until(() => records().filter((r) => r.kind === "agent-list").length > listsBeforeSecond, 5000);
  check("second prompt forces an agent-list refresh before it queues", secondList, { lists: records().filter((r) => r.kind === "agent-list").length, before: listsBeforeSecond });
  setAgents([ZERO, OTHER]);
  check("fixture replacement reuses pane2 with a distinct session and terminal", (await until(async () => (await (await fetch(`${BASE}/api/agents`)).json()).agents.some((a) => a.id === OTHER.terminal_id && a.session === S.other && a.pane === OTHER.pane_id))), { replacement: { id: OTHER.terminal_id, session: S.other, pane: OTHER.pane_id } });

  // The fix (ab-sol-deepdive ea782ec + session recheck): before Enter and before each queued paste the recipient (its
  // pane and its session) is looked at again; the replacement OTHER in the same pane gets nothing, and each prompt answers.
  const keys = ["queued-first", "queued-second"];
  const answered = await until(() => keys.every((k) => events.some((e) => (e.t === "sent" || e.t === "unsent") && e.key === k)), 15000);
  const sends = records().filter((r) => r.kind === "send-text" || r.kind === "send-keys");
  const targetsOther = (r) => r?.args?.[2] === OTHER.pane_id && r.snapshot?.some((a) => a.pane === OTHER.pane_id && a.session === S.other);
  check("nothing (no text, no Enter) is typed into replacement OTHER", !sends.some(targetsOther), { sends: sends.map((r) => ({ kind: r.kind, textRole: r.textRole, targetIsOther: targetsOther(r) })) });
  check("each prompt gets exactly one answer, sent or unsent with its reason", answered && keys.every((k) => events.filter((e) => (e.t === "sent" || e.t === "unsent") && e.key === k).length === 1), { events: events.filter((e) => ["sent", "unsent", "moved"].includes(e.t)) });
} catch (e) {
  check("terminal completion", false, { error: String(e?.stack ?? e).slice(0, 700) });
} finally {
  socket?.close();
  if (node) { node.kill(); if (node.exitCode === null) await new Promise((resolve) => node.once("exit", resolve)); }
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exit(results.every(Boolean) ? 0 : 1);
