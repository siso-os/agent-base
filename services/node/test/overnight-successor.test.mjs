// Hermetic duplicate-name routing: an ended session must not route to a distinct surviving session.
// Run: heavy -- node services/node/test/overnight-successor.test.mjs
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

const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-successor-identity."));
const claudeDir = path.join(scratch, "claude/projects/-tmp");
mkdirSync(claudeDir, { recursive: true });
const S = { zero: "replace-zero", alpha: "replace-alpha", beta: "replace-beta" };
for (const [name, session] of Object.entries(S)) writeFileSync(path.join(claudeDir, `${session}.jsonl`), `${JSON.stringify({ type: "user", uuid: `u-${session}`, timestamp: new Date().toISOString(), message: { role: "user", content: `${name}-fixture` } })}\n`);
const oldId = "term_replace_old";
const newId = "term_replace_new";
const agentsFile = path.join(scratch, "agents.json");
const logFile = path.join(scratch, "herdr.jsonl");
const seatFile = path.join(scratch, "seat.json");
writeFileSync(seatFile, JSON.stringify({ session: S.zero, pane: "w1:p1", name: "A0" }));
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({
  projects: [{ id: "replacement-lab", name: "Replacement Lab", group: "labs", shown: true, order: 0 }],
  agents: { ALPHA: { project: "Replacement Lab", kind: "owner", domain: "Replacement Lab" }, BETA: { project: "Replacement Lab", kind: "owner", domain: "Replacement Lab" } },
  domains: [],
}));
const agent = (title, pane, terminal_id, session, status = "working") => ({ agent: "claude", agent_status: status, cwd: "/tmp", pane_id: pane, terminal_id, terminal_title_stripped: title, agent_session: { value: session } });
const ZERO = agent("A0", "w1:p1", "term_replace_zero", S.zero);
const ALPHA_OLD = agent("RELAY", "w1:p2", oldId, S.alpha);
const ALPHA_NEW = agent("ALPHA", "w1:p2-new", newId, S.alpha);
const BETA = agent("RELAY", "w1:p3", "term_replace_beta", S.beta);
const setAgents = (list) => writeFileSync(agentsFile, JSON.stringify(list));
setAgents([ZERO, ALPHA_OLD, BETA]);
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true; return false; };
const env = {
  PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL,
  HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"),
  CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_CACHE_HOME: path.join(scratch, ".cache"), XDG_DATA_HOME: path.join(scratch, ".local/share"), XDG_STATE_HOME: path.join(scratch, ".local/state"),
  AB_PORT: String(PORT), AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_HUD_DIR: path.join(scratch, "ctx"),
  AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS_FILE: agentsFile, FAKE_HERDR_LOG: logFile,
  AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: seatFile, AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
  AB_OPEN_DRY: "1", AB_CONSOLE_URL: BASE, AB_BURN_CMD: "true", AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_WATCH: "0",
};
let node, socket; const events = [];
const commands = () => { try { return readFileSync(logFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
try {
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
  check("isolated node health", await until(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 15000));
  const initial = (await (await fetch(`${BASE}/api/agents`)).json()).agents;
  check("same-named agents have distinct sessions and terminals", initial.filter((a) => a.name === "RELAY").length === 2 && new Set(initial.filter((a) => a.name === "RELAY").map((a) => a.session)).size === 2, { rows: initial.map((a) => ({id:a.id, key:a.key, session:a.session, pane:a.pane})) });
  socket = new WebSocket(`ws://127.0.0.1:${PORT}/chat/${oldId}/ws`, { headers: { Origin: BASE } });
  socket.on("message", (data) => { try { events.push(JSON.parse(String(data))); } catch {} });
  check("original session socket receives hello", await until(() => events.some((e) => e.t === "hello" && e.session === S.alpha)));
  setAgents([ZERO, BETA]); let after = []; const refreshed = await until(async () => { after = (await (await fetch(`${BASE}/api/agents`)).json()).agents; return !after.some((a) => a.id === oldId) && after.some((a) => a.id === BETA.terminal_id && a.session === S.beta); }, 8000);
  check("original terminal removed and unrelated session remains", refreshed, { rows: after.map((a) => ({id:a.id, session:a.session, pane:a.pane})) });
  socket.send(JSON.stringify({t:"prompt",key:"original-session-only",text:"DO-NOT-SEND-TO-OTHER-SESSION"}));
  const observed = await until(() => events.some((e) => ["sent","unsent","moved"].includes(e.t)), 5000); await sleep(250);
  const sends = commands().filter((a) => a[0] === "pane" && a[1] === "send-text");
  check("ended duplicate-name session prompt is rejected without any pane send", observed && sends.length === 0 && events.some((e) => e.t === "unsent"), {sends,events:events.filter((e)=>e.t!=="hello")});
  check("old session socket does not move to distinct surviving session", !events.some((e) => e.t === "moved" && e.id === BETA.terminal_id), {moved:events.filter((e)=>e.t==="moved")});
} catch(e) { check("terminal completion",false,{error:String(e?.stack??e).slice(0,700)}); }
finally { socket?.close(); if(node) { node.kill(); if(node.exitCode===null) await new Promise(r=>node.once("exit",r)); } rmSync(scratch,{recursive:true,force:true}); }
console.log(JSON.stringify({passed:results.filter(Boolean).length,of:results.length})); process.exit(results.every(Boolean)?0:1);
