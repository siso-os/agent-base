// Backend ownership control: herdrOnceMore retries the same send-text after the pane's session changes.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const NODE = path.join(REPO, "services/node");
const resultFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(tmpdir(), `.siso-ephemeral-retry-identity-wave1-${process.pid}.jsonl`);
mkdirSync(path.dirname(resultFile), { recursive: true });
writeFileSync(resultFile, "");
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-retry-identity."));
const agentsFile = path.join(scratch, "agents.json");
const logFile = path.join(scratch, "herdr.jsonl");
const switched = path.join(scratch, "switched");
const claude = path.join(scratch, "claude", "projects", "fixture");
mkdirSync(claude, { recursive: true });
const pane = "fixture:p2";
const terminal = "retry-identity-terminal";
const alpha = { agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id: terminal, terminal_title_stripped: "ALPHA", agent_session: { value: "session-alpha" } };
const other = { ...alpha, terminal_title_stripped: "OTHER", agent_session: { value: "session-other" } };
writeFileSync(agentsFile, JSON.stringify([alpha]));
writeFileSync(path.join(claude, "session-alpha.jsonl"), "{}\n");
writeFileSync(path.join(claude, "session-other.jsonl"), "{}\n");
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: {}, domains: [] }));
const fake = path.join(scratch, "fake-herdr.mjs");
writeFileSync(fake, String.raw`import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2), agentsFile = process.env.FAKE_HERDR_AGENTS_FILE, log = process.env.FAKE_HERDR_LOG;
const agents = JSON.parse(readFileSync(agentsFile, "utf8"));
const snapshot = agents.map((a) => ({ id: a.terminal_id, name: a.terminal_title_stripped, session: a.agent_session?.value ?? null, pane: a.pane_id }));
const kind = args[0] === "agent" && args[1] === "list" ? "agent-list" : args[0] === "pane" ? args[1] : "other";
if (log) appendFileSync(log, JSON.stringify({ kind, args, snapshot, at: Date.now() }) + "\n");
if (kind === "agent-list") process.stdout.write(JSON.stringify({ result: { agents } }));
else if (kind === "send-text" && !existsSync(process.env.FAKE_SWITCHED)) {
  writeFileSync(process.env.FAKE_SWITCHED, "1");
  writeFileSync(agentsFile, JSON.stringify([JSON.parse(process.env.FAKE_OTHER)]));
  process.exit(42);
} else process.stdout.write("{}");
`);
const reserve = createServer();
await new Promise((resolve, reject) => reserve.once("error", reject).listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: scratch, LANG: "C", SHELL: "/bin/sh", HOME: scratch,
  AB_HOME: scratch, AB_CODEX_HOME: path.join(scratch, ".codex"), CODEX_HOME: path.join(scratch, ".codex"), CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), AB_CLAUDE_DIRS: path.join(scratch, "claude"),
  XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_CACHE_HOME: path.join(scratch, ".cache"), XDG_DATA_HOME: path.join(scratch, ".local/share"), XDG_STATE_HOME: path.join(scratch, ".local/state"),
  AB_PORT: String(port), AB_HOST: "127.0.0.1", AB_CONSOLE_URL: base, AB_OPEN_DRY: "1", AB_BURN_CMD: "true", AB_HERDR: `${process.execPath} ${fake}`,
  FAKE_HERDR_AGENTS_FILE: agentsFile, FAKE_HERDR_LOG: logFile, FAKE_SWITCHED: switched, FAKE_OTHER: JSON.stringify(other),
  AB_STATE: path.join(scratch, "state.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "events.jsonl"), AB_A0_SEAT: path.join(scratch, "seat.json"),
  AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_DB: path.join(scratch, "voice.sqlite"), AB_VOICE_WATCH: "0", AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch,
};
const checks = [];
const check = (name, ok, detail = {}) => { checks.push(Boolean(ok)); const line = JSON.stringify({ check: name, ok: Boolean(ok), ...detail }); appendFileSync(resultFile, line + "\n"); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await Promise.resolve().then(fn).catch(() => false)) return true; await sleep(40); } return false; };
const records = () => { try { return readFileSync(logFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
const closeSocket = async (ws) => { if (ws.readyState === WebSocket.CLOSED) return; const done = new Promise((resolve) => ws.once("close", resolve)); ws.close(); await done; };
let node; let ws; const events = [];
try {
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: NODE, env, stdio: "ignore" });
  check("scratch node health", await until(async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok === true));
  const initial = (await (await fetch(`${base}/api/agents`)).json()).agents.find((a) => a.id === terminal);
  check("initial API identity is ALPHA/session-alpha/p2", initial?.name === "ALPHA" && initial?.session === "session-alpha" && initial?.pane === pane, { initial });
  ws = new WebSocket(`ws://127.0.0.1:${port}/chat/${terminal}/ws`, { headers: { Origin: base } });
  ws.on("message", (data) => { try { events.push(JSON.parse(String(data))); } catch {} });
  check("chat hello proves initial session", await until(() => events.some((e) => e.t === "hello" && e.session === "session-alpha")), { hello: events.find((e) => e.t === "hello") ?? null });
  const text = `RETRY-IDENTITY-${"é界🚀".repeat(500)}`;
  ws.send(JSON.stringify({ t: "prompt", key: "retry-identity-key", text }));
  // The fix: the failed paste is retried only after the recipient (pane and session) is looked at again.
  check("the prompt gets its one answer", await until(() => events.some((e) => (e.t === "sent" || e.t === "unsent") && e.key === "retry-identity-key")), { acks: events.filter((e) => ["sent", "unsent"].includes(e.t)) });
  const sends = records().filter((r) => r.kind === "send-text");
  check("first failed paste has exact ALPHA identity and payload", sends.length >= 1 && sends[0].args[2] === pane && sends[0].args[3] === `\x1b[200~${text}\x1b[201~` && sends[0].snapshot[0]?.name === "ALPHA" && sends[0].snapshot[0]?.session === "session-alpha", { first: { args: [sends[0]?.args?.[2], `[${sends[0]?.args?.[3]?.length ?? 0} chars]`], snapshot: sends[0]?.snapshot } });
  check("retry paste never reaches a different proven session", sends.every((r) => r.snapshot[0]?.session === "session-alpha"), { observedSessions: sends.map((r) => r.snapshot[0]?.session) });
  const enters = records().filter((r) => r.kind === "send-keys" && r.args[3] === "Enter");
  check("delayed Enter never reaches a different proven session", enters.every((r) => r.snapshot[0]?.session === "session-alpha"), { enters: enters.map((r) => ({ args: r.args, snapshot: r.snapshot })) });
  check("after the ownership switch the answer is unsent, once", events.filter((e) => e.t === "unsent" && e.key === "retry-identity-key").length === 1 && events.filter((e) => e.t === "sent" && e.key === "retry-identity-key").length === 0, { acks: events.filter((e) => ["sent", "unsent"].includes(e.t)) });
  check("no command reached another pane or altered the payload", records().filter((r) => r.kind === "send-text").every((r) => r.args[2] === pane && r.args[3] === `\x1b[200~${text}\x1b[201~`) && enters.every((r) => r.args[2] === pane), { commands: records().map((r) => ({ kind: r.kind, args: r.args.slice(0, 3) })) });
} catch (error) { check("retry identity terminal completion", false, { error: String(error?.stack ?? error).slice(0, 900) }); }
finally {
  if (ws) await closeSocket(ws).catch(() => {});
  if (node && node.exitCode === null && node.signalCode === null) { const done = new Promise((resolve) => node.once("close", resolve)); node.kill("SIGTERM"); await Promise.race([done, sleep(2000)]); if (node.exitCode === null && node.signalCode === null) { node.kill("SIGKILL"); await Promise.race([done, sleep(2000)]); } }
  const summary = { passed: checks.filter(Boolean).length, failed: checks.filter((x) => !x).length, of: checks.length };
  appendFileSync(resultFile, JSON.stringify(summary) + "\n"); console.log(JSON.stringify(summary)); rmSync(scratch, { recursive: true, force: true }); process.exit(summary.failed ? 1 : 0);
}
