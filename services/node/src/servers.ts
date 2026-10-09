/**
 * Servers: one card per machine on the estate map, and a details view for each (Shaan, 2 Oct: "the six boxes of the
 * health of those servers maybe how many tokens they spent how many agents are running on there how much storage").
 *
 *   GET /api/servers        every machine on the map (retired and deleted left out), this node's own first
 *   GET /api/servers/:key   one machine: the card plus its fuller record (role, what it is for, services, busiest processes)
 *
 * Where each number comes from:
 *   - This node's own machine (AB_MACHINE_KEY, the laptop): health is read live (node:os, `vm_stat` the way the
 *     estate's fleet.py counts free memory, `df -k /`); agents are `herdr agent list` (read-only, AB_HERDR); tokens
 *     today are summed from the Claude session files under ~/.claude/projects and ~/.config/claude-*\/projects.
 *   - Every other machine: the estate's last fleet probe, SISO_Agents/siso-estate/machines/fleet.json (written by
 *     `estate fleet`, tools/fleet.py), with the time it was taken. This file never connects to another machine.
 *     Their tokens are null: this app reads only its own machine's session files.
 *
 * Today's tokens are read incrementally: each session file changed today is read once from the start, then only its
 * new bytes; a message is counted once (by its id) when its timestamp is today, local time. Recomputed at most every
 * 60 s; herdr's list is cached for 10 s, the estate files are re-read when they change. All of it is warmed at node start
 * (warmServers) and refreshed behind the request, so after the first reading no request waits on a scan or a command.
 *
 * Live probes (servers-tokens spec, 3 Oct): every machine on the board is probed itself, over ssh with a shared
 * ControlMaster (servers-probe.ts, probe/ab-probe.sh): load, memory, disk, uptime, its services (systemd, user units,
 * launchd, docker), who listens on which port, the Caddy map. A machine is on the board when the estate map gives it a
 * probe alias (`fleet.probe`) or this node runs on it; retired, deleted, clients' boxes without an alias and boxes that
 * refuse our key are one line at the foot. While a probe has not answered, the fleet record's numbers stand in, marked.
 *   - what each service is and who owns it: the catalog siso-estate/plan/services.json (AB_SERVICES_FILE)
 *     `{services: [{machine, unit, what, owner, url, group}], herdr: {<machine>: [session, ...]}}`; else the unit's own
 *     Description; when a probe has never answered, the nightly scan machines/<m>/servers.json seeds the list
 *   - agents there: `herdr --remote <alias> --session <s> agent list` for each session the catalog names
 *   - tokens today there: the VPS rollup (tokens-money.ts `fleet`)
 *   GET /api/servers/:key/logs?unit=&n=200[&follow=1]   a unit's last lines, read-only (text/event-stream with follow)
 *
 * The answers themselves are kept too (t-0176): GET /api/servers, and each machine's GET /api/servers/:key once asked for,
 * answer from the last answer the node built, which it rebuilds in the background every 30 s (AB_SERVERS_REFRESH_MS). Only
 * the very first request after node start waits for one to be built; `at` is when the answer was built, not when it was sent.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type Probe, type Unit, PROBE_ON, everViewed, isViewing, logCommand, onProbe, probeIfDue, probeState, readLogs, siteUrl, statusOf, viewing } from "./servers-probe.ts";
import { fleet } from "./tokens-money.ts";

const run = promisify(execFile);
const HOME = os.homedir();
const MACHINE = process.env.AB_MACHINE ?? "MB";
const MACHINE_KEY = process.env.AB_MACHINE_KEY ?? "laptop";
const MACHINES_FILE = process.env.AB_MACHINES_FILE ?? path.join(HOME, "SISO_Workspace/SISO_Agents/siso-estate/plan/machines.json");
const FLEET_FILE = process.env.AB_FLEET_FILE ?? path.join(path.dirname(MACHINES_FILE), "../machines/fleet.json");
const SERVICES_FILE = process.env.AB_SERVICES_FILE ?? path.join(path.dirname(MACHINES_FILE), "services.json");
/** Checks only: the machine list as a fixture ({servers: [...]}, the cards GET /api/servers answers), so a test never
 * probes this machine, scans its Claude sessions or waits on its load. */
const SERVERS_FILE = process.env.AB_SERVERS_FILE;
const HERDR = (process.env.AB_HERDR ?? "herdr").split(" ").filter(Boolean);
/** How often the kept answers are rebuilt behind the requests. */
const REFRESH_MS = Math.max(1000, Number(process.env.AB_SERVERS_REFRESH_MS) || 30_000);

// ---------------------------------------------------------------- small helpers

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** A JSON file, re-parsed only when its mtime changes. */
const fileCache = new Map<string, { mtime: number; data: any }>();
function readJson(file: string): any {
  try {
    const m = statSync(file).mtimeMs;
    const hit = fileCache.get(file);
    if (hit && hit.mtime === m) return hit.data;
    const data = JSON.parse(readFileSync(file, "utf8"));
    fileCache.set(file, { mtime: m, data });
    return data;
  } catch {
    return null;
  }
}

const gb = (kb: number) => Math.round((kb / 1048576) * 10) / 10;
const first = (s: unknown, cut: string | RegExp) => String(s ?? "").split(cut)[0].trim();

// ---------------------------------------------------------------- health

type Health = {
  source: "live" | "probe" | "fleet record" | "none";
  /** When the numbers were taken (ms); for a fleet record, its probe time. */
  at: number | null;
  /** ok | warn | bad from the numbers; down when the last probe failed; unknown when there is no record. */
  level: "ok" | "warn" | "bad" | "down" | "unknown";
  why: string[];
  state: string | null;
  detail: string | null;
  cpus: number | null;
  load: number[] | null;
  memTotalGb: number | null;
  memAvailGb: number | null;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
  diskUsedGb: number | null;
  upDays: number | null;
  /** Swap in use on this machine (macOS `vm.swapusage`); only the live reading has it. */
  swapUsedGb?: number | null;
};

/** The same reading as fleet.py: free + inactive + speculative pages. */
async function macAvailMem(): Promise<number | null> {
  try {
    const { stdout } = await run("vm_stat", [], { timeout: 3000 });
    const page = Number(stdout.match(/page size of (\d+)/)?.[1] ?? 16384);
    const n = (k: string) => Number(stdout.match(new RegExp(`Pages ${k}:\\s+(\\d+)`))?.[1] ?? 0);
    return (n("free") + n("inactive") + n("speculative")) * page;
  } catch {
    return null;
  }
}

/** Swap in use, from `sysctl vm.swapusage` ("used = 8127.31M"); the Agent Zero home's laptop line (A0-HOME-SPEC, 6 Oct). */
async function macSwapUsed(): Promise<number | null> {
  try {
    const { stdout } = await run("sysctl", ["-n", "vm.swapusage"], { timeout: 3000 });
    const m = stdout.match(/used = ([\d.]+)([MG])/);
    return m ? Number(m[1]) * (m[2] === "G" ? 2 ** 30 : 2 ** 20) : null;
  } catch {
    return null;
  }
}

/** Free and total disk on / (on macOS the data volume shares the container, so used = total - free). */
async function rootDisk(): Promise<{ totalKb: number; freeKb: number } | null> {
  try {
    const { stdout } = await run("df", ["-k", "/"], { timeout: 3000 });
    const cols = stdout.trim().split("\n").at(-1)!.split(/\s+/);
    const totalKb = Number(cols[1]);
    const freeKb = Number(cols[3]);
    return Number.isFinite(totalKb) && Number.isFinite(freeKb) ? { totalKb, freeKb } : null;
  } catch {
    return null;
  }
}

let liveCache: { at: number; h: Health } | null = null;
let liveRun: Promise<Health> | null = null;
/** This machine's health; after the first reading a request never waits: it gets the last one and a stale one refreshes behind it. */
async function liveHealth(): Promise<Health> {
  if (liveCache && Date.now() - liveCache.at < 5000) return liveCache.h;
  liveRun ??= readLiveHealth().finally(() => (liveRun = null));
  return liveCache ? liveCache.h : liveRun;
}
async function readLiveHealth(): Promise<Health> {
  const [avail, disk, swap] = await Promise.all([os.platform() === "darwin" ? macAvailMem() : Promise.resolve(os.freemem()), rootDisk(), os.platform() === "darwin" ? macSwapUsed() : Promise.resolve(null)]);
  const h = judge({
    source: "live",
    at: Date.now(),
    state: "ok",
    detail: "read on this machine",
    cpus: os.cpus().length,
    load: os.loadavg().map((x) => Math.round(x * 100) / 100),
    memTotalGb: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    memAvailGb: avail === null ? null : Math.round((avail / 2 ** 30) * 10) / 10,
    diskTotalGb: disk ? gb(disk.totalKb) : null,
    diskFreeGb: disk ? gb(disk.freeKb) : null,
    diskUsedGb: disk ? gb(disk.totalKb - disk.freeKb) : null,
    upDays: Math.round((os.uptime() / 86400) * 10) / 10,
    swapUsedGb: swap === null ? null : Math.round((swap / 2 ** 30) * 10) / 10,
  });
  liveCache = { at: Date.now(), h };
  return h;
}

function recordHealth(r: any): Health {
  if (!r) return { source: "none", at: null, level: "unknown", why: ["no fleet record"], state: null, detail: null, cpus: null, load: null, memTotalGb: null, memAvailGb: null, diskTotalGb: null, diskFreeGb: null, diskUsedGb: null, upDays: null };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const total = num(r.disk_total_gb);
  const free = num(r.disk_free_gb);
  return judge({
    source: "fleet record",
    at: Date.parse(r.at) || null,
    state: r.state ?? null,
    detail: r.detail ?? null,
    cpus: num(r.cpus),
    load: Array.isArray(r.load) ? r.load : null,
    memTotalGb: num(r.mem_total_gb),
    memAvailGb: num(r.mem_avail_gb),
    diskTotalGb: total,
    diskFreeGb: free,
    diskUsedGb: total !== null && free !== null ? total - free : null,
    upDays: num(r.up_days),
  });
}

/** A traffic light from the numbers: load per core, free memory, free disk, and how old the record is. */
function judge(h: Omit<Health, "level" | "why">): Health {
  const why: string[] = [];
  let level: Health["level"] = "ok";
  const worse = (l: "warn" | "bad", w: string) => {
    why.push(w);
    if (l === "bad" || level === "ok") level = l;
  };
  if (h.state && h.state !== "ok") return { ...h, level: h.state === "not-probed" ? "unknown" : "down", why: [h.detail ?? h.state] };
  if (h.load && h.cpus) {
    const per = h.load[0] / h.cpus;
    if (per > 1) worse("bad", `load ${h.load[0]} on ${h.cpus} cores`);
    else if (per > 0.75) worse("warn", `load ${h.load[0]} on ${h.cpus} cores`);
  }
  if (h.memAvailGb !== null && h.memTotalGb) {
    const f = h.memAvailGb / h.memTotalGb;
    if (f < 0.1) worse("bad", `${h.memAvailGb} GB memory free`);
    else if (f < 0.2) worse("warn", `${h.memAvailGb} GB memory free`);
  }
  if (h.diskFreeGb !== null && h.diskTotalGb) {
    const f = h.diskFreeGb / h.diskTotalGb;
    if (f < 0.05) worse("bad", `${h.diskFreeGb} GB disk free`);
    else if (f < 0.1) worse("warn", `${h.diskFreeGb} GB disk free`);
  }
  if (h.source === "fleet record" && h.at && Date.now() - h.at > 6 * 3600_000) worse("warn", "record is over 6 hours old");
  return { ...h, level, why };
}

// ---------------------------------------------------------------- agents

const childEnv = (() => {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const k of ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete env[k];
  return env;
})();

type AgentCount = { count: number | null; byStatus: Record<string, number> | null; byKind: Record<string, number> | null; source: string; note: string | null };

let herdrCache: { at: number; v: AgentCount } | null = null;
let herdrRun: Promise<AgentCount> | null = null;
/** herdr's agent count; like liveHealth, only the very first call waits. */
async function herdrAgents(): Promise<AgentCount> {
  if (herdrCache && Date.now() - herdrCache.at < 10_000) return herdrCache.v;
  herdrRun ??= readHerdrAgents().finally(() => (herdrRun = null));
  return herdrCache ? herdrCache.v : herdrRun;
}
async function readHerdrAgents(): Promise<AgentCount> {
  let v: AgentCount;
  try {
    const { stdout } = await run(HERDR[0], [...HERDR.slice(1), "agent", "list"], { env: childEnv, maxBuffer: 8 << 20, timeout: 8000 });
    const raw = JSON.parse(stdout);
    const list: any[] = raw?.result?.agents ?? raw?.agents ?? (Array.isArray(raw) ? raw : []);
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const a of list) {
      byStatus[a.agent_status ?? "unknown"] = (byStatus[a.agent_status ?? "unknown"] ?? 0) + 1;
      byKind[a.agent ?? "unknown"] = (byKind[a.agent ?? "unknown"] ?? 0) + 1;
    }
    v = { count: list.length, byStatus, byKind, source: "herdr agent list", note: null };
  } catch (e) {
    v = { count: null, byStatus: null, byKind: null, source: "herdr agent list", note: `herdr did not answer: ${String((e as Error).message).split("\n")[0]}` };
  }
  herdrCache = { at: Date.now(), v };
  return v;
}

/** The fleet record's process counts by kind (claude, codex, herdr, omp…): what the estate saw running there. */
function recordAgents(r: any): AgentCount {
  if (!r || r.state !== "ok") return { count: null, byStatus: null, byKind: null, source: "none", note: "not connected: no fleet record" };
  const byKind: Record<string, number> = r.agents && typeof r.agents === "object" ? r.agents : {};
  const count = Object.values(byKind).reduce((n: number, x) => n + (Number(x) || 0), 0);
  return { count, byStatus: null, byKind, source: "fleet record (agent processes)", note: "not connected: counted from the estate's last probe, not from that machine's herdr" };
}

// ---------------------------------------------------------------- tokens today (this machine's Claude session files)

type Tokens = { input: number; output: number; cacheWrite: number; cacheRead: number; total: number; messages: number; byModel: Record<string, number> };
const emptyTokens = (): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, messages: 0, byModel: {} });

let tokDay = "";
let tok = emptyTokens();
let seen = new Set<string>();
/** Per file: how far it has been read, and the bytes of a line not yet ended. */
let files = new Map<string, { offset: number; carry: Buffer; ino: number }>();
let tokAt = 0;
let tokFiles = 0;
let tokScanMs = 0;
let tokRun: Promise<void> | null = null;

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const midnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function sessionRoots(): string[] {
  const roots = [path.join(HOME, ".claude/projects")];
  try {
    for (const d of readdirSync(path.join(HOME, ".config"))) if (d.startsWith("claude-")) roots.push(path.join(HOME, ".config", d, "projects"));
  } catch {
    /* no ~/.config */
  }
  return roots.filter((r) => existsSync(r));
}

/** Every .jsonl under a root changed since `since`, sub-agent files included, at most 4 levels down. */
async function changedSince(root: string, since: number, depth = 0, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory() && depth < 4) {
      await changedSince(p, since, depth + 1, out);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      try {
        if ((await stat(p)).mtimeMs >= since) out.push(p);
      } catch {
        /* gone */
      }
    }
  }
  return out;
}

function countLine(line: string, from: number, to: number) {
  if (!line.includes('"usage"')) return;
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  const m = o?.message;
  const u = m?.usage;
  if (!u || o.type === "summary") return;
  const t = Date.parse(o.timestamp);
  if (!(t >= from && t < to)) return;
  const id = m.id ? `${m.id}:${o.requestId ?? ""}` : null;
  if (id) {
    if (seen.has(id)) return;
    seen.add(id);
  }
  const i = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  tok.input += i;
  tok.output += out;
  tok.cacheWrite += cw;
  tok.cacheRead += cr;
  tok.total += i + out + cw + cr;
  tok.messages += 1;
  const model = String(m.model ?? "unknown");
  if (model !== "<synthetic>") tok.byModel[model] = (tok.byModel[model] ?? 0) + i + out + cw + cr;
}

async function readNew(file: string, from: number, to: number) {
  let st;
  try {
    st = await stat(file);
  } catch {
    return;
  }
  let f = files.get(file);
  if (!f || f.ino !== st.ino || st.size < f.offset) f = { offset: 0, carry: Buffer.alloc(0), ino: st.ino };
  files.set(file, f);
  if (st.size === f.offset) return;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(8 << 20);
    while (f.offset < st.size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, st.size - f.offset), f.offset);
      if (bytesRead <= 0) break;
      f.offset += bytesRead;
      let chunk = f.carry.length ? Buffer.concat([f.carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      let start = 0;
      for (let nl = chunk.indexOf(10, start); nl !== -1; nl = chunk.indexOf(10, start)) {
        if (nl > start) countLine(chunk.toString("utf8", start, nl), from, to);
        start = nl + 1;
      }
      f.carry = Buffer.from(chunk.subarray(start));
    }
  } finally {
    await fh.close();
  }
}

async function scanTokens() {
  const t0 = Date.now();
  if (dayKey() !== tokDay) {
    tokDay = dayKey();
    tok = emptyTokens();
    seen = new Set();
    files = new Map();
  }
  const from = midnight();
  const to = from + 86400_000;
  const list = (await Promise.all(sessionRoots().map((r) => changedSince(r, from)))).flat();
  for (const file of list) await readNew(file, from, to);
  tokFiles = list.length;
  tokAt = Date.now();
  tokScanMs = tokAt - t0;
}

async function tokensToday(): Promise<{ tokens: Tokens; files: number; at: number; scanMs: number; source: string }> {
  if (!tokRun && Date.now() - tokAt > 60_000) tokRun = scanTokens().finally(() => (tokRun = null));
  if (tokRun && tokAt === 0) await tokRun; // first call waits; later calls answer from the last scan
  return { tokens: tok, files: tokFiles, at: tokAt, scanMs: tokScanMs, source: "Claude session files on this machine (~/.claude/projects, ~/.config/claude-*/projects)" };
}

// ---------------------------------------------------------------- the probe's numbers, services and agents

const round1 = (x: number) => Math.round(x * 10) / 10;

function probeHealth(d: Probe, okAt: number): Health {
  const g = (b: number | null) => (b === null ? null : round1(b / 2 ** 30));
  return judge({
    source: "probe",
    at: okAt,
    state: "ok",
    detail: "probed over ssh",
    cpus: d.cpus,
    load: d.load,
    memTotalGb: g(d.memTotal),
    memAvailGb: g(d.memAvail),
    diskTotalGb: g(d.diskTotal),
    diskFreeGb: g(d.diskFree),
    diskUsedGb: d.diskTotal !== null && d.diskFree !== null ? g(d.diskTotal - d.diskFree) : null,
    upDays: d.upSecs === null ? null : round1(d.upSecs / 86400),
  });
}

type ProbeView = { state: "ok" | "probing" | "failed" | "down" | "none"; at: number | null; okAt: number | null; error: string | null; fails: number };
function probeView(key: string, probed: boolean): ProbeView {
  const p = probeState(key);
  const state: ProbeView["state"] = !probed || !PROBE_ON ? "none" : p.fails >= 2 ? "down" : p.fails === 1 ? "failed" : p.okAt ? "ok" : "probing";
  return { state, at: p.at, okAt: p.okAt, error: p.error, fails: p.fails };
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** The catalog: what a unit is, who owns it, its URL and group; and the herdr sessions each machine runs. */
function catalog(): { services: any[]; herdr: Record<string, string[]> } {
  const d = readJson(SERVICES_FILE);
  const services = Array.isArray(d) ? d : Array.isArray(d?.services) ? d.services : [];
  return { services, herdr: d?.herdr && typeof d.herdr === "object" ? d.herdr : {} };
}

const GROUPS = ["Sites and APIs", "Agents and terminals", "Data", "Streaming", "Plumbing", "System"] as const;
/** What a service is for, from its name and whether it serves a page (the catalog's `group` wins). */
function groupOf(u: Unit, hasUrl: boolean): (typeof GROUPS)[number] {
  const n = u.unit.toLowerCase();
  if (/stream|rtmp|obs|mediamtx|ffmpeg|oracle|restream|live/.test(n)) return "Streaming";
  if (/tunnel|cloudflared|caddy|nginx|proxy|tailscale|beszel|monitor|bifrost|thinkshim|wireguard|traefik|runner|docker|containerd/.test(n)) return "Plumbing";
  if (/postgres|redis|mysql|mariadb|mongo|clickhouse|minio|backup|restic|db\b|-db|sqlite|qdrant|meili/.test(n)) return "Data";
  if (/agent|herdr|claude|codex|omp|tmux|ttyd|term|pilot|director|worker|seat/.test(n)) return "Agents and terminals";
  if (hasUrl || u.ports.length) return "Sites and APIs";
  if (/^(systemd-|dbus|cron|ssh|rsyslog|getty|serial-getty|polkit|udisks|user@|unattended|snapd|multipathd|networkd|irqbalance|atd|fwupd|cloud-|qemu|chrony|ntp|apparmor|ufw|fail2ban|packagekit|modem|accounts-daemon|rtkit|upower|thermald|kerneloops|wpa_|avahi|bluetooth|colord|cups|gdm|lvm|mdmonitor|setvl|keyboard|console|plymouth|e2scrub|logrotate|man-db|apt|dpkg|motd)/.test(n)) return "System";
  return u.kind === "launchd" ? "Agents and terminals" : "Plumbing";
}

type Service = Unit & { what: string | null; owner: string | null; url: string | null; urlStatus: number | null; group: string; catalogued: boolean; seeded?: boolean };

/** The nightly scan's list (machines/<m>/servers.json), when no probe has answered yet. */
function seedUnits(key: string): Unit[] {
  const d = readJson(path.join(path.dirname(FLEET_FILE), key, "servers.json"));
  if (!d) return [];
  const out: Unit[] = [];
  for (const r of Array.isArray(d.services) ? d.services : []) {
    const unit = String(r.unit ?? r.name ?? "");
    if (!unit) continue;
    const st = String(r.state ?? r.active ?? r.health ?? "unknown");
    out.push({ unit, kind: r.user ? "user" : "systemd", user: r.user ?? null, state: st, failed: /fail/i.test(st), since: null, description: r.description ?? r.program ?? null, ports: Array.isArray(r.ports) ? r.ports.map(Number).filter(Number.isFinite) : [] });
  }
  for (const c of Array.isArray(d.containers) ? d.containers : []) {
    const name = String(c.name ?? c.Names ?? "");
    if (name) out.push({ unit: name, kind: "docker", user: null, state: String(c.state ?? c.State ?? "unknown"), failed: /exited|dead/i.test(String(c.state ?? c.State ?? "")), since: null, description: c.image ?? null, ports: [] });
  }
  return out;
}

function servicesOf(key: string, alias: string | null, d: Probe | null): { list: Service[]; source: "probe" | "seed" | "none" } {
  const units = d ? d.units : seedUnits(key);
  const source = d ? "probe" : units.length ? "seed" : "none";
  const cat = catalog().services.filter((c) => c && (c.machine === key || (alias && c.machine === alias)));
  const list = units.map((u): Service => {
    const c = cat.find((x) => x.unit === u.unit || x.unit === u.unit.replace(/\.service$/, ""));
    let url: string | null = typeof c?.url === "string" ? c.url : null;
    if (!url && d) {
      const r = d.routes.find((x) => u.ports.includes(x.port));
      if (r) url = siteUrl(r.host, r.path);
      else if (d.tailscale && u.ports.some((p) => p >= 1024) && !/ssh|tailscale|docker|containerd/.test(u.unit)) url = `http://${d.tailscale}:${u.ports.find((p) => p >= 1024)}`;
    }
    return {
      ...u,
      what: (typeof c?.what === "string" && c.what) || u.description,
      owner: typeof c?.owner === "string" ? c.owner : null,
      url,
      urlStatus: url ? statusOf(url) : null,
      group: typeof c?.group === "string" ? c.group : groupOf(u, !!url),
      catalogued: !!c,
      ...(d ? {} : { seeded: true }),
    };
  });
  // Failed first, then by group, then by name.
  const gi = (g: string) => (GROUPS as readonly string[]).indexOf(g) + 1 || 99;
  list.sort((a, b) => Number(b.failed) - Number(a.failed) || gi(a.group) - gi(b.group) || a.unit.localeCompare(b.unit));
  return { list, source };
}

type RemoteAgent = { name: string; harness: string; status: string; session: string; cwd: string | null };
const remote = new Map<string, { at: number; list: RemoteAgent[] | null; error: string | null; run: Promise<void> | null }>();
/** herdr's agents in one session on another machine; 10 s while a Servers view is open, 60 s otherwise. */
function remoteAgents(alias: string, session: string) {
  const k = `${alias}\u0000${session}`;
  let r = remote.get(k);
  if (!r) remote.set(k, (r = { at: 0, list: null, error: null, run: null }));
  const rr = r;
  if (!rr.run && PROBE_ON && everViewed() && Date.now() - rr.at > (isViewing() ? 10_000 : 60_000)) {
    rr.run = run(HERDR[0], [...HERDR.slice(1), "--remote", alias, "--session", session, "agent", "list"], { env: childEnv, maxBuffer: 8 << 20, timeout: 15_000 })
      .then(({ stdout }) => {
        const raw = JSON.parse(stdout);
        const list: any[] = raw?.result?.agents ?? raw?.agents ?? (Array.isArray(raw) ? raw : []);
        rr.list = list.map((a) => ({ name: String(a.terminal_title_stripped ?? a.name ?? a.pane_id ?? "agent"), harness: String(a.agent ?? "unknown"), status: String(a.agent_status ?? "unknown"), session, cwd: a.cwd ?? null }));
        rr.error = null;
      })
      .catch((e: Error) => void (rr.error = String(e.message).split("\n")[0].slice(0, 200)))
      .finally(() => ((rr.at = Date.now()), (rr.run = null)));
  }
  return rr;
}

/** The rollup's device for a machine: by its key, its ssh alias, its short name or the map's `fleet.tokens_device`. */
function deviceFor(key: string, v: any, alias: string | null) {
  if (!everViewed()) return null;
  const names = [key, alias, first(v?.host ?? "", /[\s(]/), v?.fleet?.tokens_device].filter(Boolean).map((x) => String(x).toLowerCase());
  return fleet().devices.find((d) => names.includes(d.device.toLowerCase())) ?? null;
}

// ---------------------------------------------------------------- the machines

const HIDE = /^(retired|deleted)/i;

async function server(key: string, v: any, fleetRec: any, full: boolean) {
  const here = key === MACHINE_KEY;
  const rec = fleetRec?.machines?.[key] ?? null;
  const client = !!v?.fleet?.client;
  const alias: string | null = here ? null : typeof v?.fleet?.probe === "string" && v.fleet.probe ? v.fleet.probe : null;
  const probed = here || !!alias;
  if (probed) probeIfDue(key, alias);
  const pv = probeView(key, probed);
  const ps = probeState(key);
  const record = recordHealth(rec);
  let health = here ? await liveHealth() : ps.data && ps.okAt ? probeHealth(ps.data, ps.okAt) : record;
  // A probe that stopped answering: the last numbers stay ("last known"), the dot says why.
  if (!here && (pv.state === "failed" || pv.state === "down")) {
    const why = `no answer since ${pv.okAt ? hhmm(pv.okAt) : "the node started"} (${pv.error ?? "no reason given"})`;
    health = { ...health, level: pv.state === "down" ? "down" : "unknown", why: [why, ...health.why.filter((w) => !/^no answer since/.test(w))] };
  }
  const svc = servicesOf(key, alias, ps.data);
  const failedNames = svc.list.filter((x) => x.failed).map((x) => x.unit.replace(/\.service$/, ""));
  const running = svc.list.filter((x) => !x.failed && /running|active|up/i.test(x.state)).length;
  // Agents: here, herdr itself; there, herdr over ssh for each session the catalog names; else the probe's process count.
  const sessions: string[] = here ? [] : (catalog().herdr[key] ?? catalog().herdr[alias ?? ""] ?? (Array.isArray(v?.fleet?.herdr) ? v.fleet.herdr : []));
  let agents: AgentCount;
  let agentList: RemoteAgent[] | null = null;
  if (here) {
    agents = await herdrAgents();
    const procs = ps.data?.procs ?? {};
    const extra = Math.max(0, (procs.codex ?? 0) - (agents.byKind?.codex ?? 0));
    if (extra) agents = { ...agents, note: `${extra} Codex seat${extra === 1 ? "" : "s"} run outside herdr` };
  } else if (alias && sessions.length) {
    const rs = sessions.map((sn) => remoteAgents(alias, sn));
    agentList = rs.flatMap((r) => r.list ?? []);
    const answered = rs.some((r) => r.list);
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const a of agentList) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byKind[a.harness] = (byKind[a.harness] ?? 0) + 1;
    }
    const err = rs.find((r) => r.error)?.error ?? null;
    agents = answered ? { count: agentList.length, byStatus, byKind, source: `herdr --remote ${alias}`, note: err ? `one session did not answer: ${err}` : null } : ps.data ? { count: Object.values(ps.data.procs).reduce((a, b) => a + b, 0), byStatus: null, byKind: ps.data.procs, source: "probe (agent processes)", note: err ? `herdr did not answer: ${err}` : "reading herdr…" } : recordAgents(rec);
  } else agents = ps.data ? { count: (ps.data.procs.claude ?? 0) + (ps.data.procs.codex ?? 0) + (ps.data.procs.omp ?? 0), byStatus: null, byKind: ps.data.procs, source: "probe (agent processes)", note: "counted from processes: no herdr session for this machine in the catalog" } : recordAgents(rec);
  const t = here ? await tokensToday() : null;
  const dev = here ? null : deviceFor(key, v, alias);
  const urls = svc.list.filter((x) => x.url).slice(0, 3).map((x) => ({ url: x.url!, status: x.urlStatus, unit: x.unit }));
  const card = {
    key,
    name: first(v?.host ?? key, " ("),
    role: first(v?.fleet?.role, /[.:(]/),
    status: first(v?.status, /[:(;]/),
    here,
    client,
    owner: typeof v?.fleet?.owner === "string" ? v.fleet.owner : null,
    alias,
    /** On the six boxes: probed by this node (or this node's own machine). The rest are the foot line. */
    onBoard: probed,
    /** True when this app reads that machine's own herdr (only this node's machine today). */
    agentsVisible: here,
    /** The `machine` label the node puts on its agents (GET /api/agents), so the page can list them. */
    agentMachine: here ? MACHINE : null,
    /** True when the estate probes it (has a fleet record): the main grid; the rest are recorded only. */
    watched: !!rec && rec.state === "ok",
    health,
    probe: pv,
    /** The load (1 min) at each probe, oldest first, for the sparkline. */
    spark: ps.spark.map((x) => x.v),
    agents,
    /** Who runs there, for the box's stacked faces (another machine's herdr; this one's agents are the app's own). */
    agentFaces: agentList ? agentList.slice(0, 8).map((a) => ({ name: a.name, status: a.status })) : null,
    tokensToday: t ? { total: t.tokens.total, output: t.tokens.output, at: t.at } : dev && !dev.stale && dev.today !== null ? { total: dev.today, output: 0, at: dev.lastSeen ?? Date.now() } : null,
    tokensWhyNull: t ? null : dev ? (dev.stale ? `not reported since ${dev.lastSeen ? new Date(dev.lastSeen).toLocaleDateString([], { day: "numeric", month: "short" }) : "ever"}` : dev.today === null ? "the rollup gives no today figure" : null) : client ? "a client's box: this app does not read its sessions" : "not in the token rollup",
    services: svc.list.length || rec?.services ? { count: svc.list.length ? running : (rec?.services?.count ?? null), failed: svc.list.length ? failedNames.length : (rec?.services?.failed ?? null), failedNames: failedNames.slice(0, 6), source: svc.list.length ? svc.source : "fleet record" } : null,
    containers: ps.data ? ps.data.units.filter((u) => u.kind === "docker").length : typeof rec?.containers === "number" ? rec.containers : null,
    urls,
  };
  if (!full) return card;
  const missingOwner = svc.list.filter((x) => !x.owner).length;
  const missingUrl = svc.list.filter((x) => !x.url && x.ports.length > 0).length;
  return {
    ...card,
    host: String(v?.host ?? key),
    statusFull: String(v?.status ?? ""),
    roleFull: String(v?.fleet?.role ?? ""),
    usedFor: Array.isArray(v?.fleet?.for) ? v.fleet.for : [],
    fallback: Array.isArray(v?.fleet?.fallback) ? v.fleet.fallback : [],
    never: Array.isArray(v?.fleet?.never) ? v.fleet.never : [],
    os: ps.data?.os ?? rec?.os ?? (here ? os.platform() : null),
    hostname: ps.data?.host ?? rec?.hostname ?? null,
    /** For this machine, the estate's own last probe beside the live numbers. */
    record: here || ps.data ? record : null,
    top: Array.isArray(rec?.top) ? rec.top.slice(0, 6) : [],
    tokens: t ? { ...t.tokens, files: t.files, at: t.at, scanMs: t.scanMs, source: t.source } : null,
    fleetFile: FLEET_FILE,
    serviceList: svc.list,
    servicesSource: svc.source,
    agentList,
    sessions,
    missing: { owner: missingOwner, url: missingUrl },
    sources: [here ? "this machine: node:os, vm_stat, df" : alias ? `ssh ${alias} (probe/ab-probe.sh)` : "no probe alias on the estate map", `catalog: ${SERVICES_FILE}`, `fleet record: ${FLEET_FILE}`, ...(sessions.length ? [`herdr --remote ${alias} --session ${sessions.join(", ")}`] : [])],
  };
}

async function servers(full: boolean, only?: string) {
  const plan = readJson(MACHINES_FILE)?.machines ?? {};
  const fleetRec = readJson(FLEET_FILE);
  let entries = Object.entries(plan).filter(([, v]: [string, any]) => !HIDE.test(String(v?.status ?? "")));
  if (!entries.some(([k]) => k === MACHINE_KEY)) entries.unshift([MACHINE_KEY, { host: MACHINE }]);
  if (only) entries = entries.filter(([k]) => k === only);
  const list = await Promise.all(entries.map(([k, v]) => server(k, v, fleetRec, full)));
  // The foot line: every machine not on the board, and why (retired, deleted, a client's box, refuses our key).
  const offBoard = Object.entries(plan)
    .filter(([k, v]: [string, any]) => k !== MACHINE_KEY && !(typeof v?.fleet?.probe === "string" && v.fleet.probe && !HIDE.test(String(v?.status ?? ""))))
    .map(([k, v]: [string, any]) => {
      const st = String(v?.status ?? "");
      const rec = fleetRec?.machines?.[k];
      const why = /^retired/i.test(st) ? "retired" : /^deleted/i.test(st) ? "deleted" : v?.fleet?.client ? "client box" : rec && rec.state !== "ok" ? String(rec.detail ?? rec.state) : "no probe alias";
      return { key: k, name: first(v?.host ?? k, " ("), why };
    });
  return { list, offBoard, fleetAt: fleetRec?.at ? Date.parse(fleetRec.at) : null };
}

// ---------------------------------------------------------------- the kept answers

type Answer = { code: number; body: unknown; at: number };

async function buildList(): Promise<Answer> {
  const { list, offBoard, fleetAt } = await servers(false);
  const order = (s: (typeof list)[number]) => (s.here ? 0 : s.onBoard ? 1 : s.watched ? 2 : 3);
  list.sort((a, b) => order(a) - order(b));
  const at = Date.now();
  // probes: "off" on a node without AB_SERVERS_PROBE=1, "waiting" until the Servers page first asks, then "on".
  return { code: 200, body: { servers: list, offBoard, here: MACHINE_KEY, fleetAt, at, probes: !PROBE_ON ? "off" : everViewed() ? "on" : "waiting" }, at };
}

async function buildOne(key: string): Promise<Answer> {
  const { list } = await servers(true, key);
  const at = Date.now();
  return list.length ? { code: 200, body: { server: list[0], at }, at } : { code: 404, body: { error: `no machine "${key}" on the estate map` }, at };
}

/** The last answer per path; a refresh in flight is shared, and a failed one keeps the answer before it. */
const kept = new Map<string, { answer: Answer | null; run: Promise<Answer> | null; build: () => Promise<Answer>; asked: number }>();

function refresh(p: string): Promise<Answer> {
  const k = kept.get(p)!;
  k.run ??= k
    .build()
    .then((a) => (k.answer = a))
    .finally(() => (k.run = null));
  return k.run;
}

/** The kept answer at once; only the first request for a path waits for one to be built. */
async function answer(p: string, build: () => Promise<Answer>): Promise<Answer> {
  let k = kept.get(p);
  if (!k) kept.set(p, (k = { answer: null, run: null, build, asked: Date.now() }));
  k.asked = Date.now();
  if (k.answer) {
    if (Date.now() - k.answer.at > REFRESH_MS) void refresh(p).catch(() => {});
    return k.answer;
  }
  return refresh(p);
}

let ticker: NodeJS.Timeout | null = null;
// A probe answered: rebuild the kept answers now, not at the next tick (a rebuild never waits on a probe).
let soon: NodeJS.Timeout | null = null;
onProbe(() => {
  soon ??= setTimeout(() => ((soon = null), tick()), 50);
  soon.unref?.();
});
/** Every 30 s, rebuild the kept answers behind the requests: the list always, a machine's page while it was asked for in the last 10 min. */
function tick() {
  for (const [p, k] of kept) {
    if (p !== "/api/servers" && Date.now() - k.asked > 600_000) kept.delete(p);
    else void refresh(p).catch(() => {});
  }
}

/** Read everything slow once at node start (today's token scan takes seconds on a busy day), build the list, and keep it fresh. */
export function warmServers() {
  if (SERVERS_FILE) return;
  void Promise.all([liveHealth(), herdrAgents(), tokensToday()])
    .then(() => answer("/api/servers", buildList))
    .catch(() => {});
  ticker ??= setInterval(tick, REFRESH_MS);
  ticker.unref();
}

/** A unit's last lines, read-only; only a unit the last probe saw. `follow=1` streams new lines every 2 s (text/event-stream). */
async function logs(req: http.IncomingMessage, res: http.ServerResponse, url: URL, key: string) {
  const v = (readJson(MACHINES_FILE)?.machines ?? {})[key];
  const here = key === MACHINE_KEY;
  const alias: string | null = here ? null : typeof v?.fleet?.probe === "string" && v.fleet.probe ? v.fleet.probe : null;
  if (!here && !alias) return json(res, 404, { error: `no probe for "${key}"` });
  const name = url.searchParams.get("unit") ?? "";
  const kind = url.searchParams.get("kind");
  const unit = probeState(key).data?.units.find((u) => u.unit === name && (!kind || u.kind === kind));
  if (!unit || !logCommand(unit, 1)) return json(res, 404, { error: `the last probe of ${key} saw no unit "${name}"` });
  const n = Math.min(1000, Math.max(1, Number(url.searchParams.get("n")) || 200));
  const where = alias ? `ssh ${alias}` : "this machine";
  if (url.searchParams.get("follow") !== "1") {
    try {
      json(res, 200, { key, unit: unit.unit, kind: unit.kind, lines: await readLogs(alias, unit, n), at: Date.now(), command: `${alias ? `ssh ${alias} ` : ""}${logCommand(unit, n)}`, where });
    } catch (e) {
      json(res, 502, { error: String((e as Error).message), where });
    }
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  let last: string[] = [];
  let open = true;
  const started = Date.now();
  req.on("close", () => (open = false));
  while (open && Date.now() - started < 30 * 60_000) {
    try {
      const lines = await readLogs(alias, unit, n);
      // Only what is new since the last send: the lines after the last one already sent.
      let from = 0;
      if (last.length) {
        const tail = last[last.length - 1];
        const i = lines.lastIndexOf(tail);
        from = i >= 0 ? i + 1 : 0;
      }
      const fresh = lines.slice(from);
      if (fresh.length && open) res.write(`data: ${JSON.stringify({ lines: fresh, reset: from === 0, at: Date.now() })}\n\n`);
      if (lines.length) last = lines;
    } catch (e) {
      if (open) res.write(`event: failed\ndata: ${JSON.stringify({ error: String((e as Error).message) })}\n\n`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  res.end();
}

export async function handleServers(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith("/api/servers")) return false;
  if (req.method !== "GET") return json(res, 405, { error: "GET only" }), true;
  if (SERVERS_FILE) {
    const list: any[] = readJson(SERVERS_FILE)?.servers ?? [];
    const one = url.pathname.match(/^\/api\/servers\/([A-Za-z0-9_.-]+)$/)?.[1];
    if (!one) json(res, 200, { servers: list, here: MACHINE_KEY, fleetAt: null, at: Date.now() });
    else if (list.some((s) => s.key === one)) json(res, 200, { server: list.find((s) => s.key === one), at: Date.now() });
    else json(res, 404, { error: `no machine "${one}" on the estate map` });
    return true;
  }
  // Only the Servers page asks with ?view=1; Agent Zero's widgets and Stats get the kept rows and never start a probe.
  if (url.searchParams.get("view") === "1") viewing();
  const lm = url.pathname.match(/^\/api\/servers\/([A-Za-z0-9_.-]+)\/logs$/);
  if (lm) return logs(req, res, url, lm[1]), true;
  if (url.pathname === "/api/servers" || url.pathname === "/api/servers/") {
    const a = await answer("/api/servers", buildList);
    json(res, a.code, a.body);
    return true;
  }
  const m = url.pathname.match(/^\/api\/servers\/([A-Za-z0-9_.-]+)$/);
  if (!m) return false;
  const a = await answer(`/api/servers/${m[1]}`, () => buildOne(m[1]));
  json(res, a.code, a.body);
  return true;
}
