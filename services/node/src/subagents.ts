import { recentOutputRate, type OutputSample } from "./subagent-rate.ts";
import { readChildren } from "../../host/src/codex-children.ts";
import { readCodexRuns, groupCodexRuns, belongs } from "./codex-runs.ts";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { lineToEvents, sessionFile } from "./transcript.ts";
import { summarize } from "../../host/src/events.ts";
import { sessionFile as codexSessionFile } from "./codex-transcript.ts";
import { readIfChanged, readdirIfChanged } from "./stat-memo.ts";

export type Subagent = {
  id: string; kind: "claude" | "codex"; type: string; what: string; spec: string; about?: string; title?: string; tickets?: { id: string; title: string }[]; why?: string; effort?: string; pid?: number; machine?: "laptop"; usage?: { in: number; out: number }; proc?: { cpu: number; rssMb: number; at: number };
  start: string | null; end: string | null; tools: number | null; tokens: number;
  running: boolean; background: boolean; agentId?: string;
  /** The Agent tool_use id that spawned it (the key the chat files its steps under), its own name and model, from .meta.json. */
  toolUseId?: string; name?: string; model?: string; batch?: string; batchId?: string; rate?: number; rateAt?: number; rateWindowMs?: number; rateEstimated?: boolean; estimated?: boolean; status?: string; outputSamples?: OutputSample[];
  /** R1.23 (rightpanel SPEC §2.3): unfinished, but no write for 10 min (a lost stop event): not "running" for ever. */
  quiet?: boolean;
  /** SPEC-PANEL-CARDS §5: its newest tool step ("Bash gh repo list …"), and how many of its tool calls failed. */
  last?: string;
  errors?: number;
};
const QUIET_MS = 10 * 60_000;
type Parent = { id: string; name: string; session: string | null; cwd: string; tool: string; pane?: string };
type Crew = Parent & { lead?: string | null; owner?: string | null; status: string };
const cache = new Map<string, { mtime: number; size: number; rows: Subagent[]; open?: boolean; metaStamp?: string; cwd?: string }>();
const textOf = (content: any) => typeof content === "string" ? content : Array.isArray(content) ? content.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : "";
const firstLine = (s: string) => s.trim().split(/\r?\n/, 1)[0].slice(0, 240);

function claudeRows(parent: Parent): Subagent[] {
  if (!parent.session) return [];
  // t-0534: no forced rescan; a fresh scan probed ~460 project folders on every fleet-board read. The 30 s rescan
  // still follows a session that moved logins, and opening the chat itself scans fresh.
  const file = sessionFile(parent.session, parent.cwd);
  if (!file) return [];
  const dir = path.join(path.dirname(file), parent.session, "subagents");
  const names = readdirIfChanged(dir).filter((n) => /^agent-.+\.jsonl$/.test(n));
  // Enumeration succeeded, so stale transcript entries for this parent can no longer be live.
  // Scope the sweep to this directory: the module cache is shared by all parents.
  const liveFiles = new Set(names.map((name) => path.join(dir, name)));
  for (const key of cache.keys()) if (path.dirname(key) === dir && !liveFiles.has(key)) cache.delete(key);
  return names.map((name) => {
    const full = path.join(dir, name);
    let mtime = 0, size = 0;
    try { const st = statSync(full); mtime = st.mtimeMs; size = st.size; } catch { return null; }
    // Running and quiet go by the clock, so they are worked out on every read, never cached with the parse.
    const live = (row: Subagent, open: boolean): Subagent => {
      const age = Date.now() - mtime;
      const { quiet: _, ...rest } = row;
      return { ...rest, rate: recentOutputRate(rest.outputSamples ?? []), rateAt: Date.now(), rateWindowMs: 30_000, running: age < 90_000 || (open && age < QUIET_MS), ...(open && age >= QUIET_MS ? { quiet: true } : {}) };
    };
    const metaFile = full.replace(/\.jsonl$/, ".meta.json");
    let metaStamp = "";
    try { const st = statSync(metaFile); metaStamp = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`; } catch { /* metadata is optional */ }
    const hit = cache.get(full);
    if (hit && hit.mtime === mtime && hit.size === size && hit.metaStamp === metaStamp) return live(hit.rows[0], !!hit.open);
    let meta: any = {};
    try { meta = JSON.parse(readIfChanged(metaFile) ?? "{}"); } catch { /* metadata is optional */ }
    const outputSamples: OutputSample[] = [], outputs = new Map<string, number>();
    let output = 0;
    let prompt = "", start: string | null = null, end: string | null = null, tools = 0, usage: any = {}, open = false, last = "", errors = 0;
    try {
      // Read only when the stamp moved (the parse is cached above by mtime+size); never kept in memory: transcripts are large.
      for (const line of readFileSync(full, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let rec: any; try { rec = JSON.parse(line); } catch { continue; }
        if (typeof rec.timestamp === "string") { start ??= rec.timestamp; end = rec.timestamp; }
        if (rec.type === "user" && !prompt) prompt = textOf(rec.message?.content);
        if (rec.type === "assistant") {
          usage = rec.message?.usage ?? usage;
          const out = rec.message?.usage?.output_tokens, key = rec.message?.id ?? rec.uuid;
          if (typeof key === "string" && Number.isFinite(out) && out >= 0) {
            output += out - (outputs.get(key) ?? 0); outputs.set(key, out);
            outputSamples.push({ at: Date.parse(rec.timestamp), tokens: output });
          }
          const uses = (Array.isArray(rec.message?.content) ? rec.message.content : []).filter((b: any) => b?.type === "tool_use");
          const calls = uses.length;
          tools += calls;
          const lastUse = uses.at(-1);
          if (lastUse) last = `${lastUse.name} ${summarize(String(lastUse.name), lastUse.input ?? {})}`.trim().slice(0, 160);
          // Its last step asked for a tool: it has not answered yet.
          open = calls > 0;
        } else if (rec.type === "user") {
          open = true;
          if (Array.isArray(rec.message?.content)) errors += rec.message.content.filter((b: any) => b?.type === "tool_result" && b.is_error).length;
        }
      }
    } catch { return null; }
    // The spawner names its sub-agent in the Agent call's description, "NAME: what it does" (UI, 4 Oct: "the agent spawning
    // the agents should be able to set them as nice names with descriptions"); a bare description is the about line.
    const desc = typeof meta.description === "string" ? meta.description : "";
    const named = desc.match(/^([A-Z][A-Z0-9_-]{1,31}):\s*(.+)$/);
    const row: Subagent = { id: name.replace(/\.jsonl$/, ""), kind: "claude", type: typeof meta.agentType === "string" ? meta.agentType : "agent", what: named ? named[2] : desc, title: named ? named[2] : desc, about: firstLine(prompt) || undefined, spec: firstLine(prompt), start, end, tools,
      tokens: [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens, usage.output_tokens].reduce((n, v) => n + (Number(v) || 0), 0),
      outputSamples: outputSamples.slice(-256), running: false, background: meta.requestShape === "background", ...(last ? { last } : {}), ...(errors ? { errors } : {}),
      ...(meta.toolUseId ? { toolUseId: String(meta.toolUseId) } : {}), ...(meta.name ? { name: String(meta.name) } : named ? { name: named[1] } : {}), ...(meta.model ? { model: String(meta.model) } : {}) };
    cache.set(full, { mtime, size, rows: [row], open, metaStamp });
    // Unfinished and writing within 10 min is running; unfinished and silent longer is quiet.
    return live(row, open);
  }).filter((x): x is Subagent => !!x);
}

function laneTitle(parent: Parent, worker: Crew) {
  const lane = path.basename(worker.cwd), roots = new Set<string>();
  for (const start of [worker.cwd, parent.cwd]) for (let d = start; d !== path.dirname(d); d = path.dirname(d)) {
    roots.add(path.join(d, ".agents", "tasks"));
    roots.add(path.join(d, ".agents", "a0", "tasks"));
  }
  for (const root of roots) {
    const task = path.join(root, lane, "TASK.md");
    const content = readIfChanged(task);
    if (content) return firstLine(content).replace(/^#\s*/, "");
  }
  return lane;
}

function crewRows(parent: Parent, agents: Crew[]): Subagent[] {
  return agents.filter((a) => (a.lead ?? a.owner) === parent.name).flatMap((a) => {
    const lane = path.basename(a.cwd), what = laneTitle(parent, a), running = a.status === "working";
    if (a.tool !== "codex" || !a.session) return [{ id: a.id, agentId: a.id, kind: "codex" as const, type: `${a.tool} · herdr · ${lane}`, what, spec: "", start: null, end: null, tools: null, tokens: 0, running, background: true }];
    const file = codexSessionFile(a.session, a.cwd);
    if (!file) return [];
    let mtime = 0, size = 0; try { const st = statSync(file); mtime = st.mtimeMs; size = st.size; } catch { return []; }
    // Herdr says working but its session file has not moved for 10 min: quiet, not running for ever.
    const quiet = running && Date.now() - mtime >= QUIET_MS;
    const now = (row: Subagent): Subagent => ({ ...row, name: a.name, rate: recentOutputRate(row.outputSamples ?? []), rateAt: Date.now(), rateWindowMs: 30_000, id: a.id, agentId: a.id, type: `${a.name} · herdr · ${lane}`, what, ...(quiet ? { running: false, quiet: true } : { running }) });
    const hit = cache.get(file); if (hit && hit.mtime === mtime && hit.size === size && hit.cwd === path.resolve(a.cwd)) return hit.rows.map(now);
    const outputSamples: OutputSample[] = [];
    let start: string | null = null, end: string | null = null, tokens = 0, sessionCwd = "", model: string | undefined;
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let rec: any; try { rec = JSON.parse(line); } catch { continue; }
        if (typeof rec.timestamp === "string") { start ??= rec.timestamp; end = rec.timestamp; }
        if (rec.type === "session_meta") sessionCwd = rec.payload?.cwd ?? sessionCwd;
        if (rec.type === "turn_context" && typeof rec.payload?.model === "string") model = rec.payload.model;
        if (rec.type === "event_msg" && rec.payload?.type === "token_count") {
          const usage = rec.payload.info?.total_token_usage;
          tokens = Number(usage?.total_tokens) || tokens;
          if (Number.isFinite(usage?.output_tokens) && usage.output_tokens >= 0) outputSamples.push({ at: Date.parse(rec.timestamp), tokens: usage.output_tokens });
        }
      }
    } catch { return []; }
    if (!sessionCwd || path.resolve(sessionCwd) !== path.resolve(a.cwd)) return [];
    const row: Subagent = { id: a.id, agentId: a.id, kind: "codex", type: `${a.name} · herdr · ${lane}`, what, spec: "", start, end, tools: null, tokens, model, outputSamples: outputSamples.slice(-256), running, background: true };
    cache.set(file, { mtime, size, rows: [row], cwd: path.resolve(sessionCwd) }); return [now(row)];
  });
}

/** Fleet can point at an isolated run fixture without changing the standing-worker reader. */
const fleetRoot = () => process.env.AB_FLEET_RUNS ?? process.env.AB_CODEX_RUNS ?? path.join(os.homedir(), ".local/state/codex-run/runs");
let procAt = 0;
let procStats = new Map<number, { cpu: number; rssMb: number; at: number }>();
let reasonsAt = 0, reasonsRoot = "";
let reasons = new Map<string, string>();
function runReasons(root: string, now: number) {
  if (root === reasonsRoot && now - reasonsAt < 5000) return reasons;
  reasonsAt = now; reasonsRoot = root; reasons = new Map();
  // The harness writes a reason to its completed run log. Read a bounded tail, never another project's logs.
  let fd: number | undefined;
  try {
    fd = openSync(path.join(path.dirname(root), "log.jsonl"), "r");
    const size = fstatSync(fd).size, bytes = Math.min(size, 1024 * 1024), buf = Buffer.alloc(bytes);
    readSync(fd, buf, 0, bytes, size - bytes);
    for (const line of buf.toString("utf8").split("\n")) {
      try { const row = JSON.parse(line); if (typeof row.run === "string" && typeof row.sol_why === "string") reasons.set(row.run, row.sol_why); } catch { /* partial or malformed row */ }
    }
  } catch { /* reason not recorded */ } finally { if (fd !== undefined) closeSync(fd); }
  return reasons;
}
function processStats(rows: Subagent[], now: number) {
  if (now - procAt >= 5000) {
    procAt = now; procStats = new Map();
    const pids = [...new Set(rows.flatMap(r => r.running && Number.isInteger(r.pid) && r.pid! > 0 ? [r.pid!] : []))];
    if (pids.length) try {
      const text = execFileSync("ps", ["-o", "pid=,%cpu=,rss=", "-p", pids.join(",")], { encoding: "utf8", timeout: 1000, maxBuffer: 128 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      for (const line of text.trim().split("\n")) {
        const [pid, cpu, rss] = line.trim().split(/\s+/).map(Number);
        if ([pid, cpu, rss].every(Number.isFinite)) procStats.set(pid, { cpu, rssMb: rss / 1024, at: now });
      }
    } catch { /* no measurement is different from zero CPU */ }
  }
  for (const r of rows) if (r.running && r.pid && procStats.has(r.pid)) r.proc = procStats.get(r.pid);
}

/** Every run in the fleet root, read once, for a caller that lists many parents (the fleet board read all 259 per agent). */
export const fleetRuns = (now = Date.now()) => readCodexRuns(now, fleetRoot(), undefined, { includeItems: false });

export function listSubagents(parent: Parent, agents: Crew[], pre?: { runs?: ReturnType<typeof readCodexRuns> }) {
  const now = Date.now();
  const root = fleetRoot(), why = runReasons(root, now);
  const runs = (pre?.runs ?? readCodexRuns(now, root, parent, { includeItems: false })).filter(r => belongs(r, parent) && (r.running || new Date(r.ended ?? r.started).toDateString() === new Date(now).toDateString()));
  const codex: Subagent[] = groupCodexRuns(runs).flatMap(g => g.runs.map(r => ({
    id: `run:${r.id}`, kind: "codex", type: "Codex", name: r.worker ?? r.name, model: r.model, what: r.step, last: r.step, spec: r.ticket, about: r.about, title: r.title, tickets: r.tickets, why: r.why ?? why.get(path.join(root, r.id)), effort: r.effort, pid: r.pid, machine: "laptop", usage: r.usage,
    start: new Date(r.started).toISOString(), end: r.ended ? new Date(r.ended).toISOString() : null, tools: null,
    tokens: r.tokens, running: r.running, background: true, batch: g.name, batchId: g.id, rate: r.rateMeasured ? r.rate : undefined, rateAt: now, rateWindowMs: 5000, estimated: r.estimated, rateEstimated: r.rateEstimated, status: r.status,
  })));
  const children = readChildren(parent.session).filter(c => !c.endedAt || now - c.endedAt < 86400000);
  const childMeters = new Map(crewRows(parent, children.map(c => ({ id: c.id, name: c.name, session: c.session, cwd: c.cwd, tool: "codex", lead: parent.name, status: "working" }))).map(row => [row.id, row]));
  const managed: Subagent[] = children.map(c => ({
    id: c.id, agentId: `service-${c.hostName}`, kind: 'codex', type: 'Codex', name: c.name, model: c.model,
    what: c.last ?? '', spec: '', start: new Date(c.startedAt).toISOString(), end: c.endedAt ? new Date(c.endedAt).toISOString() : null,
    tokens: c.tokens, tools: c.tools, running: ['starting','running','blocked','stop_requested'].includes(c.status), background: true,
    // Use the child session output counters; the legacy host rate has no freshness contract.
    toolUseId: c.id, status: c.status, rate: childMeters.get(c.id)?.rate, rateAt: now, rateWindowMs: 30_000,
  }));
  const managedIds = new Set(managed.map(c => c.agentId));
  const rows = [...claudeRows(parent), ...crewRows(parent, agents).filter(c => !managedIds.has(c.agentId)), ...managed, ...codex].sort((a, b) => Date.parse(b.start ?? "") - Date.parse(a.start ?? ""));
  processStats(rows, now);
  return { rows: rows.map(({ outputSamples: _samples, ...row }) => row), machine: { load: os.loadavg(), cores: os.cpus().length }, at: now, running: rows.filter((r) => r.running).length, tokens: rows.reduce((n, r) => n + r.tokens, 0) };
}

/**
 * R1.20b (chat-hud spec §5 bug 3): one sub-agent's own steps, read from `<session>/subagents/agent-*.jsonl`, as chat
 * events tagged with the Agent tool_use id that spawned it (the shape siso-host gives a live sub-agent). A terminal
 * agent's file holds none of them, and a resumed host chat has only the main file, so the side pane asks for this.
 * `key` is the tool_use id (matched against .meta.json) or the file id `agent-…`.
 */
export function subagentEvents(parent: Parent, key: string): { parent: string; events: Record<string, unknown>[]; brief: string; usage: { in: number; out: number; cacheRead: number; cacheWrite: number } } | null {
  if (key.startsWith("run:")) {
    const run = readCodexRuns(Date.now(), fleetRoot(), parent).find(r => `run:${r.id}` === key && belongs(r, parent));
    if (!run) return null;
    return { parent: key, events: run.items.map((it,i) => ({ t: "text", id: it.id, text: it.text, at: run.started + i, parent: key })), brief: run.ticket, usage: { in: run.usage?.in ?? 0, out: run.usage?.out ?? run.tokens, cacheRead: 0, cacheWrite: 0 } };
  }
  if (!parent.session || !/^[\w-]+$/.test(key)) return null;
  const file = sessionFile(parent.session, parent.cwd, { fresh: true });
  if (!file) return null;
  const dir = path.join(path.dirname(file), parent.session, "subagents");
  let names: string[];
  try { names = readdirSync(dir).filter((n) => /^agent-.+\.jsonl$/.test(n)); } catch { return null; }
  let hit: string | null = null, tool = key;
  for (const name of names) {
    const id = name.replace(/\.jsonl$/, "");
    let meta: any = {};
    try { meta = JSON.parse(readFileSync(path.join(dir, `${id}.meta.json`), "utf8")); } catch { /* metadata is optional */ }
    if (meta.toolUseId === key || id === key) { hit = path.join(dir, name); tool = meta.toolUseId ?? key; break; }
  }
  if (!hit) return null;
  const events: Record<string, unknown>[] = [];
  let first = true, brief = "";
  // SPEC-PANEL-CARDS §6: what it read in (fresh, cache read, cache write) and wrote, summed over its turns.
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  let text: string;
  try {
    text = readFileSync(hit, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: any; try { rec = JSON.parse(line); } catch { continue; }
    const u = rec.type === "assistant" ? rec.message?.usage : null;
    if (u) {
      usage.in += Number(u.input_tokens) || 0;
      usage.cacheRead += Number(u.cache_read_input_tokens) || 0;
      usage.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
      usage.out += Number(u.output_tokens) || 0;
    }
    // Its first user line is the prompt the Agent call already shows (the page shows it as the brief); the rest of its
    // user lines carry tool results.
    if (first && rec.type === "user") { first = false; brief = textOf(rec.message?.content).trim().slice(0, 8000); continue; }
    for (const e of lineToEvents({ ...rec, isSidechain: false })) if (["text", "thinking", "tool", "tool_done"].includes(e.t)) events.push({ ...e, parent: tool });
  }
  return { parent: tool, events, brief, usage };
}
