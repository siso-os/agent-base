import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_STARTING_AGE_MS = 30_000;
const healthCache = new Map<string, { until: number; result: Promise<boolean> }>();
const launchdCache = new Map<string, { until: number; result: Promise<boolean> }>();

export type ServiceHostState = "live" | "asleep" | "restarting" | "down";

/** The private shape used by the node when it opens a host websocket. */
export type ServiceHost = {
  activity: "idle" | "working" | "needs" | "failed";
  model: string | null;
  effort?: string | null;
  models?: { id: string; label: string; description: string; efforts: string[] }[];
  tokensIn: number | null;
  tokensOut: number | null;
  tokensPerSecond: number | null;
  updatedAt: number | null;
  harness?: "codex";
  /** Private routing proof: unknown explicit harness metadata must never become Claude authority. */
  conversationHarness?: "claude" | "codex" | null;
  /** Who started it ("Agent Zero" for its own research and sub-agent chats). */
  lead?: string | null;
  name: string;
  session: string | null;
  context: unknown;
  port: number;
  token: string;
  pid: number;
  pane: string | null;
  cwd: string | null;
  state: ServiceHostState;
  file: string;
  startedAt: number | null;
  runnerPid?: number | null;
  asleepAt?: number | null;
  rssAtSleep?: number | null;
  keepAwake?: boolean;
  idleSince?: number | null;
  idleSleepMin?: number | null;
  /** The machine a mirrored host runs on (ab-remote's `remote.machine`, e.g. "mini"); null for this machine's own hosts. */
  remoteMachine?: string | null;
  /** The SSH alias and PID for a remote host (ab-remote's `remote.ssh` and `remote.pid`); null for local hosts. */
  remote?: { ssh: string; pid: number } | null;
};

/** Safe to put in an API response. The websocket token deliberately is not copied. */
export type PublicServiceHost = Pick<ServiceHost, "name" | "state" | "session" | "context" | "activity" | "model" | "tokensPerSecond" | "asleepAt" | "rssAtSleep" | "keepAwake" | "idleSince" | "idleSleepMin">;

type HostFile = {
  runnerPid?: unknown; asleepAt?: unknown; rssAtSleep?: unknown; keepAwake?: unknown; idleSince?: unknown; idleSleepMin?: unknown;
  state?: unknown;
  remote?: { machine?: unknown; ssh?: unknown; pid?: unknown } & Record<string, unknown>;
  child?: unknown;
  model?: unknown;
  effort?: unknown;
  models?: unknown;
  tokensIn?: unknown;
  tokensOut?: unknown;
  tokensPerSecond?: unknown;
  updatedAt?: unknown;
  harness?: unknown;
  lead?: unknown;
  parent?: unknown;
  name?: unknown;
  session?: unknown;
  context?: unknown;
  port?: unknown;
  token?: unknown;
  pid?: unknown;
  pane?: unknown;
  cwd?: unknown;
  startedAt?: unknown;
  label?: unknown;
};

export type ServiceHostReaderOptions = {
  dir?: string;
  now?: number;
  maxStartingAgeMs?: number;
  /** Injectable for tests and for machines where launchctl is not available. */
  processAlive?: (pid: number) => boolean | Promise<boolean>;
  /** Return whether HTTP health confirms the expected host process. */
  portHealthy?: (port: number, expectedPid: number) => boolean | Promise<boolean>;
  /** Return whether the host's launchd job is loaded. */
  launchdLoaded?: (name: string, host: HostFile) => boolean | Promise<boolean>;
};

const number = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);
const text = (value: unknown) => (typeof value === "string" && value.length ? value : null);
const safeName = (value: string) => /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$/.test(value);

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Probe the port without sending the host websocket token. */
function defaultPortHealthy(port: number, expectedPid: number): Promise<boolean> {
  const key=`${port}:${expectedPid}`,now=Date.now(),hit=healthCache.get(key);
  if(hit&&now<hit.until)return hit.result;
  for(const [k,v] of healthCache)if(v.until<=now)healthCache.delete(k);
  const result = new Promise<boolean>((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; if (body.length > 16384) { req.destroy(); resolve(false); } });
      res.once("end", () => {
        if (res.statusCode !== 200) return resolve(false);
        try { resolve(JSON.parse(body)?.pid === expectedPid); } catch { resolve(false); }
      });
    });
    req.once("error", () => resolve(false));
    req.once("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
  healthCache.set(key,{until:now+3000,result});
  return result;
}

async function defaultLaunchdLoaded(name: string, host: HostFile): Promise<boolean> {
  const command = process.env.AB_LAUNCHCTL ?? "launchctl";
  const label = text(host.label) ?? (name.toUpperCase() === "A0" ? "com.siso.a0-host" : "com.siso.host-lab");
  try {
    const uid = String(typeof process.getuid === "function" ? process.getuid() : 0);
    const key=`${command}:${uid}:${label}`,now=Date.now(),hit=launchdCache.get(key);
    if(hit&&now<hit.until)return hit.result;
    for(const [k,v] of launchdCache)if(v.until<=now)launchdCache.delete(k);
    const result=run(command, ["print", `gui/${uid}/${label}`], { timeout: 1200, maxBuffer: 256 * 1024 }).then(()=>true,()=>false);
    launchdCache.set(key,{until:now+3000,result});
    return result;
  } catch {
    return false;
  }
}

function publicHost(host: ServiceHost): PublicServiceHost {
  return { name: host.name, state: host.state, session: host.session, context: host.context, activity: host.activity, model: host.model, tokensPerSecond: host.tokensPerSecond, asleepAt: host.asleepAt, rssAtSleep: host.rssAtSleep, keepAwake: host.keepAwake, idleSince: host.idleSince, idleSleepMin: host.idleSleepMin };
}

/** Read the host files written by siso-host and classify their current state. */
export async function readServiceHosts(options: ServiceHostReaderOptions = {}): Promise<{ hosts: ServiceHost[]; publicHosts: PublicServiceHost[] }> {
  const dir = options.dir ?? process.env.AB_HOSTS_DIR ?? path.join(os.homedir(), ".local/state/agent-base/hosts");
  const now = options.now ?? Date.now();
  const maxStartingAgeMs = options.maxStartingAgeMs ?? MAX_STARTING_AGE_MS;
  const processAlive = options.processAlive ?? defaultProcessAlive;
  const portHealthy = options.portHealthy ?? defaultPortHealthy;
  const launchdLoaded = options.launchdLoaded ?? defaultLaunchdLoaded;
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  } catch {
    return { hosts: [], publicHosts: [] };
  }

  const hosts = (await Promise.all(files.map(async (file): Promise<ServiceHost | null> => {
    const full = path.join(dir, file);
    let raw: HostFile;
    let mtime = 0;
    try {
      raw = JSON.parse(await readFile(full, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      mtime = (await stat(full)).mtimeMs;
    } catch {
      return null;
    }
    const pid = number(raw.pid);
    const port = number(raw.port);
    const token = text(raw.token);
    if (pid === null || port === null || port > 65535 || token === null) return null;
    const fileName = file.startsWith("name-") ? file.slice(5, -5) : file.slice(0, -5);
    const rawName = text(raw.name);
    if (file.startsWith("name-") && rawName && rawName !== fileName) return null;
    const name = rawName ?? fileName;
    if (!safeName(name)) return null;
    const runnerPid = number(raw.runnerPid);
    const asleep = raw.state === 'asleep' && runnerPid !== null && await Promise.resolve(processAlive(runnerPid)).catch(() => false);
    const [alive, healthy] = await Promise.all([
      Promise.resolve(processAlive(pid)).catch(() => false),
      asleep ? false : Promise.resolve(portHealthy(port, pid)).catch(() => false),
    ]);
    // launchd only distinguishes restarting from down; a proven live host needs no subprocess.
    const loaded = asleep || alive && healthy ? false : await Promise.resolve(launchdLoaded(name, raw)).catch(() => false);
    const recent = now - mtime < maxStartingAgeMs;
    const state: ServiceHostState = asleep ? "asleep" : raw.state === "asleep" ? "down" : alive && healthy ? "live" : loaded || recent ? "restarting" : "down";
    return {
      activity: asleep ? "idle" : raw.child === "stopped" ? "failed" : raw.state === "blocked" ? "needs" : raw.state === "working" ? "working" : "idle",
      model: text(raw.model),
      effort: text(raw.effort),
      models: Array.isArray(raw.models) ? raw.models.filter(m => m && typeof m.id === "string" && typeof m.label === "string" && typeof m.description === "string" && Array.isArray(m.efforts) && m.efforts.every((e: unknown) => typeof e === "string")).map(m => ({ id: m.id, label: m.label, description: m.description, efforts: m.efforts })) : [],
      tokensIn: finite(raw.tokensIn), tokensOut: finite(raw.tokensOut), tokensPerSecond: finite(raw.tokensPerSecond), updatedAt: finite(raw.updatedAt),
      ...(raw.harness === "codex" ? { harness: "codex" as const } : {}),
      conversationHarness: raw.harness === undefined || raw.harness === "claude" ? "claude" : raw.harness === "codex" ? "codex" : null,
      lead: text(raw.lead) ?? text(raw.parent),
      name,
      session: text(raw.session),
      context: raw.context ?? null,
      port,
      token,
      pid,
      pane: text(raw.pane),
      cwd: text(raw.cwd),
      state,
      file: full,
      runnerPid, asleepAt: finite(raw.asleepAt), rssAtSleep: finite(raw.rssAtSleep), keepAwake: raw.keepAwake === true, idleSince: finite(raw.idleSince), idleSleepMin: finite(raw.idleSleepMin),
      startedAt: typeof raw.startedAt === "number" && Number.isFinite(raw.startedAt) ? raw.startedAt : null,
      remoteMachine: raw.remote && typeof raw.remote === "object" && safeName(text((raw.remote as any).machine) ?? "") ? text((raw.remote as any).machine) : null,
      remote: raw.remote && typeof raw.remote === "object" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(text((raw.remote as any).ssh) ?? "") && Number.isInteger((raw.remote as any).pid) && (raw.remote as any).pid > 0 ? { ssh: text((raw.remote as any).ssh)!, pid: (raw.remote as any).pid as number } : null, // an alias that could read as an ssh option, or a non-integer pid, is no remote
    };
  }))).filter((host): host is ServiceHost => host !== null);
  const resolved = resolveLive(hosts).sort((a, b) => a.name.localeCompare(b.name));
  return { hosts: resolved, publicHosts: resolved.map(publicHost) };
}

/**
 * t-0569, the one resolver for live state (Shaan, 9 Oct 01:44: "the research agent stopped, but it still shows ... the
 * operator UI is working, but it doesn't show"). A record yields to any record of the same name or session in a better
 * state (live or asleep, then restarting, then down): a stale w7_p49.json from 7 Oct shared OPERATOR-UI's name and
 * session with its live w7_p52.json, sorted first and was bound to the row, so the live chat read "down, idle", and two
 * records of one name made /api/owners say "unreported". Two live chats of one name (two panes) both stay; of several
 * dead records for one name, the newest stays (it is still down).
 */
export function resolveLive(hosts: ServiceHost[]): ServiceHost[] {
  const rank = (h: ServiceHost) => h.state === "live" || h.state === "asleep" ? 0 : h.state === "restarting" ? 1 : 2;
  const same = (a: ServiceHost, b: ServiceHost) => a.name === b.name || (a.session !== null && a.session === b.session);
  const stamp = (h: ServiceHost) => h.updatedAt ?? h.startedAt ?? 0;
  return hosts.filter(h => {
    if (hosts.some(o => o !== h && same(o, h) && rank(o) < rank(h))) return false;
    if (h.state !== "down") return true;
    return !hosts.some(o => o !== h && o.state === "down" && o.name === h.name && (stamp(o) > stamp(h) || (stamp(o) === stamp(h) && o.file > h.file)));
  });
}

/** Array form for callers that only need the private routing records. */
export async function listServiceHosts(options: ServiceHostReaderOptions = {}): Promise<ServiceHost[]> {
  return (await readServiceHosts(options)).hosts;
}

/** Array form for API handlers; this projection cannot carry a websocket token. */
export async function listPublicServiceHosts(options: ServiceHostReaderOptions = {}): Promise<PublicServiceHost[]> {
  return (await readServiceHosts(options)).publicHosts;
}

export { publicHost as toPublicServiceHost };

/** Add service-host metadata to an existing API row while keeping its token private. */
export function bindServiceHost<T extends Record<string, unknown>>(row: T, host: ServiceHost | null): T & { host: boolean; serviceHost: PublicServiceHost | null } {
  return { ...row, host: !!host, serviceHost: host ? publicHost(host) : null };
}

/** Join services onto normal agent rows and create rows for pane-less hosts such as Agent Zero. */
type ServiceRow = Record<string, any> & { id: string; name: string; cwd: string; pane: string };
export function bindServiceRows(rows: ServiceRow[], hosts: ServiceHost[], defaults: { machine?: string; machineKey?: string; registry?: Record<string, Record<string, unknown>> } = {}): ServiceRow[] {
  const used = new Set<ServiceHost>();
  const boundHosts = new Map<ServiceRow, ServiceHost>();
  const bound: ServiceRow[] = rows.map((row) => {
    // A display name is not a chat identity. A reused pane must not overwrite a
    // different sealed session, and one host may bind only one row.
    const host = hosts.find((h) => !used.has(h) &&
      ((h.session && h.session === row.session) ||
       (h.pane && h.pane === row.pane && (!row.session || !h.session || h.session === row.session))));
    if (!host) return row;
    used.add(host);
    // A live seat's own activity is its status even without a harness name: herdr reads the host pane as "working" while
    // the chat is idle, and that counted Agent Base's quiet UI seat as a second worker (Shaan, 6 Oct 21:00: "two working").
    const liveActivity = host.state === "live" && ["idle", "working", "needs", "failed"].includes(String(host.activity)) ? { status: host.activity } : {};
    const boundRow = { ...row, ...liveActivity, ...(host.harness ? { tool: host.harness, status: host.activity } : {}), hud: host.harness === "codex" ? codexHud(host) : { ...row.hud, model: host.model, effort: host.effort, models: host.models ?? [] }, host: publicHost(host), serviceHost: publicHost(host), chat: true, session: host.session ?? row.session, context: contextPercent(host.context) ?? row.context };
    boundHosts.set(boundRow, host);
    return boundRow;
  });
  for (const host of hosts) {
    if (used.has(host) || host.pane) continue;
    const zero = host.name.toUpperCase() === "A0";
    bound.push({
      id: `service-${host.name}`, key: `service/${host.name}`, pane: "", name: zero ? "Agent Zero" : host.name,
      title: "", row: "live", status: host.state === "live" ? host.activity : "idle", since: host.updatedAt ?? host.startedAt ?? Date.now(),
      tool: host.harness ?? "claude", cwd: host.cwd ?? "", folder: "", machine: host.remoteMachine ? (host.remoteMachine === "mini" ? "Mac mini" : host.remoteMachine) : defaults.machine ?? "",
      machineKey: host.remoteMachine ?? defaults.machineKey ?? "", ...(host.remoteMachine ? { away: true } : {}), zero,
      host: publicHost(host), serviceHost: publicHost(host), chat: true, session: host.session,
      context: contextPercent(host.context), hud: codexHud(host), pinned: false, pages: [],
      // Agent Infrastructure's three chats are filed there (4 Oct), never "Unsorted".
      // Agent Zero's own chats (research, sub-agents) sit under Agent Zero, never in the nav list (Shaan, 4 Oct: "These are Agent
      // Zero's personal agents. They shouldn't come in the side nav").
      ...(INFRA.includes(host.name.toUpperCase()) ? { project: "Agent Infrastructure", domain: host.name[0] + host.name.slice(1).toLowerCase(), lead: null, role: "Agent Infrastructure" } : host.lead ? { lead: host.lead, zeroAgent: true, domain: null, role: null } : { domain: null, lead: null, role: null }),
    });
    boundHosts.set(bound.at(-1)!, host);
  }
  for (const row of bound) {
    const host = boundHosts.get(row);
    if (!host) continue;
    if (host.lead) row.hostParent = host.lead;
    if (INFRA.includes(host.name.toUpperCase()) || row.zero) continue;
    const who = defaults.registry?.[host.name] ?? Object.entries(defaults.registry ?? {}).find(([name]) => name.toLowerCase() === host.name.toLowerCase())?.[1];
    if (who) for (const key of ["project", "domain", "owner", "kind", "icon", "role", "main"]) if (who[key] !== undefined) row[key] = who[key];
    // t-0562: a helper whose host has stopped is finished, not idle. 104 dead codex hosts read "live, idle" on 9 Oct, so every
    // count and its owner's crew showed them. Its row stays (settled) so its chat is still readable; owners keep their place.
    if (host.state === "down" && host.lead && !host.pane && row.kind !== "owner" && !row.main) Object.assign(row, { row: "settled", status: "done", settledAt: host.updatedAt ?? null, finished: true });
  }
  return bound;
}

const INFRA = ["HEALTH", "EFFICIENCY", "ESTATE"];
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
function codexHud(host: ServiceHost) {
  return { model: host.model, effort: host.effort ?? null, models: host.models ?? [], context: contextPercent(host.context), tokensIn: host.tokensIn, tokensOut: host.tokensOut, tokensPerSecond: host.tokensPerSecond, at: host.updatedAt, cachePct: null, costUsd: null, fiveHour: null, week: null };
}

function contextPercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const used = typeof v.used === "number" ? v.used : typeof v.used_percentage === "number" ? v.used_percentage : null;
  const cap = typeof v.cap === "number" ? v.cap : typeof v.capacity === "number" ? v.capacity : null;
  if (used === null) return null;
  if (cap && cap > 0) return Math.round((used / cap) * 100);
  return used;
}
