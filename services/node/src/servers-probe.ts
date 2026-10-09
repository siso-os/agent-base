/**
 * The Servers page's live look at each machine (spec 2026-10-03 servers-tokens §5.1): one read-only probe per machine over
 * ssh, a shared ControlMaster, one probe per machine at a time, the last answer kept. Nothing is installed remotely: the
 * probe is probe/ab-probe.sh piped to `sh -s`; this node's own machine runs the same script locally.
 *
 *   AB_SERVERS_PROBE  `1` turns all of it on (the desktop app's and the node service's launch set it). Without it this
 *                   node never runs the probe, ssh, `herdr --remote` or a URL check: it never leaves the machine. Checks
 *                   leave it unset, except the ones that point AB_SSH at the fake.
 *   AB_SSH          the ssh command (default `ssh`); checks point it at a fake that prints fixture output
 *   AB_PROBE_LOCAL  how this machine runs a script (default `sh -s`)
 *   AB_PROBE_MS     how often a machine is probed while a Servers view is open (30 s), AB_PROBE_IDLE_MS otherwise (5 min)
 *   AB_URL_CHECK    `off` skips the 5-minute HTTP status check of each known URL
 *
 * Logs (GET /api/servers/:key/logs) run only `journalctl -u`, `docker logs` or the launchd job's StandardOutPath tail, for
 * a unit the last probe saw, and lines naming a key, token, secret or password are replaced before they leave the node.
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The opt-in: no probe, ssh or remote read happens on a node started without it. */
export const PROBE_ON = process.env.AB_SERVERS_PROBE === "1";
const SSH = (process.env.AB_SSH ?? "ssh").split(" ").filter(Boolean);
function sshControlOptions(): string[] {
  if (!PROBE_ON) return ["-o", "ControlMaster=no"];
  // macOS's per-user temp path plus OpenSSH's %C hash can exceed the Unix socket limit.
  // Keep the socket in a short private directory; an unsafe pre-existing path disables sharing.
  const uid = process.getuid?.();
  if (uid === undefined) return ["-o", "ControlMaster=no"];
  const directory = path.join("/tmp", `ab-ssh-${uid}`);
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error: any) { if (error.code !== 'EEXIST') return ["-o", "ControlMaster=no"]; }
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o077) !== 0) return ["-o", "ControlMaster=no"];
    return ["-o", "ControlMaster=auto", "-o", `ControlPath=${path.join(directory, "socket-%C")}`, "-o", "ControlPersist=120"];
  } catch { return ["-o", "ControlMaster=no"]; }
}
const SSH_OPTS = [...sshControlOptions(), "-o", "ConnectTimeout=5", "-o", "BatchMode=yes"];
const LOCAL = (process.env.AB_PROBE_LOCAL ?? "sh -s").split(" ").filter(Boolean);
const OPEN_MS = Math.max(1000, Number(process.env.AB_PROBE_MS) || 30_000);
const IDLE_MS = Math.max(OPEN_MS, Number(process.env.AB_PROBE_IDLE_MS) || 300_000);
const URL_CHECK = process.env.AB_URL_CHECK !== "off";
const SCRIPT = readFileSync(new URL("./probe/ab-probe.sh", import.meta.url), "utf8");

// ---------------------------------------------------------------- running a script there

/** `sh -s` on a machine (alias null: this one) with `script` on stdin; its stdout, or an error with the reason. */
export function onMachine(alias: string | null, script: string, timeoutMs = 20_000, maxBytes = 4 << 20): Promise<string> {
  if (!PROBE_ON) return Promise.reject(new Error("probes are off on this node (AB_SERVERS_PROBE is not 1)"));
  const argv = alias ? [...SSH, ...SSH_OPTS, alias, "sh -s"] : LOCAL;
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const finish = (e: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      e ? reject(e) : resolve(out);
    };
    const timer = setTimeout(() => (child.kill("SIGKILL"), finish(new Error(alias ? "ssh timed out" : "timed out"))), timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > maxBytes) (child.kill("SIGKILL"), finish(new Error("too much output")));
    });
    child.stderr.on("data", (b: Buffer) => (err = (err + b.toString("utf8")).slice(-2000)));
    child.on("error", (e) => finish(new Error(`could not start ${argv[0]}: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return finish(null);
      const why = err.trim().split("\n").filter(Boolean).at(-1) ?? `exit ${code}`;
      finish(new Error(code === 255 && alias && !why.startsWith("ssh:") ? `ssh: ${why}` : why));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}

// ---------------------------------------------------------------- what the probe says

export type Unit = { unit: string; kind: "systemd" | "user" | "launchd" | "docker"; user: string | null; state: string; failed: boolean; since: number | null; description: string | null; ports: number[]; image?: string };
export type Route = { host: string; path: string; port: number };
export type Probe = {
  os: string;
  host: string | null;
  load: number[] | null;
  cpus: number | null;
  memTotal: number | null;
  memAvail: number | null;
  diskTotal: number | null;
  diskFree: number | null;
  upSecs: number | null;
  units: Unit[];
  routes: Route[];
  tailscale: string | null;
  procs: Record<string, number>;
};

const num = (s: string | undefined) => (s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

/** "Fri 2026-10-02 07:33:12 +07" (systemd) as ms. */
function systemdTime(s: string): number | null {
  const m = s.match(/(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?: ([+-]\d\d)(\d\d)?| (UTC))?/);
  if (!m) return null;
  const tz = m[5] ? "Z" : m[3] ? `${m[3]}:${m[4] ?? "00"}` : "";
  const t = Date.parse(`${m[1]}T${m[2]}${tz}`);
  return Number.isFinite(t) ? t : null;
}

const UNIT_STATES = new Set(["active", "failed", "activating", "deactivating", "reloading"]);

export function parseProbe(text: string): Probe {
  const sec = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^@@ (.+)$/);
    if (h) sec.set(h[1].trim(), (cur = []));
    else if (cur && line.trim()) cur.push(line.replace(/\s+$/, ""));
  }
  if (!sec.has("end")) throw new Error("the probe stopped part way");
  const one = (k: string) => sec.get(k)?.[0]?.trim();
  const osName = one("os") ?? "unknown";
  const load = one("loadavg")?.trim().split(/\s+/).slice(0, 3).map(Number);
  const [memTotal, memAvail] = (one("mem") ?? "").split(/\s+/).map(num);
  const [diskTotal, diskFree] = (one("disk") ?? "").split(/\s+/).map(num);
  const units: Unit[] = [];
  const parseUnits = (lines: string[], kind: "systemd" | "user", user: string | null) => {
    for (const l of lines) {
      const [unit, , active, sub, ...desc] = l.trim().split(/\s+/);
      if (!unit?.endsWith(".service") || !UNIT_STATES.has(active)) continue;
      units.push({ unit, kind, user, state: active === "active" ? sub : active, failed: active === "failed", since: null, description: desc.join(" ") || null, ports: [] });
    }
  };
  parseUnits(sec.get("units") ?? [], "systemd", null);
  for (const [k, lines] of sec) if (k.startsWith("user-units ")) parseUnits(lines, "user", k.slice(11));
  // When the failed ones failed.
  let id: string | null = null;
  for (const l of sec.get("failed-since") ?? []) {
    const [k, v = ""] = l.split(/=(.*)/);
    if (k === "Id") id = v;
    else if (k === "StateChangeTimestamp" && id) {
      const u = units.find((x) => x.unit === id && x.kind === "systemd");
      if (u) u.since = systemdTime(v);
    }
  }
  // launchd: PID Status Label; a job with no PID and a non-zero last exit failed.
  for (const l of sec.get("launchd") ?? []) {
    const [pid, status, label] = l.trim().split(/\s+/);
    if (!label) continue;
    const running = /^\d+$/.test(pid);
    const failed = !running && status !== "0" && status !== "-";
    units.push({ unit: label, kind: "launchd", user: null, state: running ? "running" : failed ? `exited ${status}` : "loaded", failed, since: null, description: null, ports: [], ...(running ? { pid: Number(pid) } : {}) } as Unit);
  }
  // Ports: Linux "port addr unit", macOS "port pid command".
  for (const l of sec.get("ports") ?? []) {
    const [p, b, c] = l.trim().split(/\s+/);
    const port = num(p);
    if (port === null) continue;
    const owner = osName === "Linux" ? units.find((u) => u.unit === c) : units.find((u) => (u as Unit & { pid?: number }).pid === Number(b));
    if (owner && !owner.ports.includes(port)) owner.ports.push(port);
  }
  // Docker containers: name|state|status|ports|image.
  for (const l of sec.get("docker") ?? []) {
    const [name, state, status, ports = "", image = ""] = l.split("|");
    if (!name) continue;
    const hostPorts = [...new Set([...ports.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])))];
    units.push({ unit: name, kind: "docker", user: null, state: state || status, failed: (state === "exited" && !/Exited \(0\)/.test(status)) || state === "dead", since: null, description: status || null, ports: hostPorts, image });
  }
  for (const u of units) delete (u as Unit & { pid?: number }).pid;
  return {
    os: osName,
    host: one("host") ?? null,
    load: load && load.length === 3 && load.every(Number.isFinite) ? load.map((x) => Math.round(x * 100) / 100) : null,
    cpus: num(one("cpus")),
    memTotal,
    memAvail,
    diskTotal,
    diskFree,
    upSecs: num(one("uptime")),
    units,
    routes: parseCaddy(sec.get("caddy") ?? []),
    tailscale: one("tailscale") ?? null,
    procs: Object.fromEntries((sec.get("procs") ?? []).map((l) => l.trim().split(/\s+/)).filter(([, n]) => num(n) !== null).map(([k, n]) => [k, Number(n)])),
  };
}

/** Caddy's host → upstream map from the probe's lines: site blocks, handle/handle_path blocks, reverse_proxy to a local port. */
export function parseCaddy(lines: string[]): Route[] {
  const out: Route[] = [];
  let hosts: string[] = [];
  const paths: (string | null)[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l.endsWith("{")) {
      const head = l.slice(0, -1).trim();
      if (paths.length === 0) {
        hosts = head.startsWith("(") || head === "" ? [] : head.split(/[,\s]+/).filter(Boolean);
        paths.push(null);
      } else {
        const m = head.match(/^handle(?:_path)?\s+(\S+)/);
        paths.push(m ? m[1].replace(/\*$/, "") : paths.at(-1) ?? null);
      }
    } else if (l === "}" || l.startsWith("}")) {
      paths.pop();
      if (paths.length === 0) hosts = [];
    } else {
      const m = /^reverse_proxy\s/.test(l) ? l.match(/\s(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])?:(\d+)\b/) : null;
      if (m && hosts.length) for (const h of hosts) out.push({ host: h, path: paths.at(-1) ?? "/", port: Number(m[1]) });
    }
  }
  return out;
}

/** A Caddy site address as a URL: bare names are https; an address with a scheme or a port stays as written. */
export function siteUrl(host: string, p: string): string {
  const base = /^https?:\/\//.test(host) ? host : /:\d+$/.test(host) ? `http://${host}` : `https://${host}`;
  return base.replace(/\/$/, "") + (p === "/" ? "" : p.startsWith("/") ? p : `/${p}`);
}

// ---------------------------------------------------------------- per machine: the kept probe

export type ProbeState = { at: number | null; okAt: number | null; data: Probe | null; error: string | null; fails: number; running: boolean; spark: { t: number; v: number }[] };
const states = new Map<string, ProbeState & { run: Promise<void> | null }>();
let viewAt = 0;

/** The Servers page itself asked (`?view=1`): probe at the open pace for the next 90 s. Other readers of /api/servers never call this. */
export function viewing() {
  viewAt = Date.now();
}
export const isViewing = () => Date.now() - viewAt < 90_000;
/** Nothing is probed until a Servers view has asked once: a node started for a check that never opens Servers never runs ssh. */
export const everViewed = () => viewAt > 0;
const listeners = new Set<() => void>();
/** Called after every probe, so the kept answers pick the new reading up at once. */
export function onProbe(fn: () => void) {
  listeners.add(fn);
}

export function probeState(key: string): ProbeState {
  const s = states.get(key);
  if (!s) return { at: null, okAt: null, data: null, error: null, fails: 0, running: false, spark: [] };
  return { at: s.at, okAt: s.okAt, data: s.data, error: s.error, fails: s.fails, running: !!s.run, spark: s.spark };
}

/** Start a probe of `key` when one is due (never two at once); returns at once. */
export function probeIfDue(key: string, alias: string | null) {
  if (!PROBE_ON || !everViewed()) return;
  let s = states.get(key);
  if (!s) states.set(key, (s = { at: null, okAt: null, data: null, error: null, fails: 0, running: false, spark: [], run: null }));
  const every = isViewing() ? OPEN_MS : IDLE_MS;
  if (s.run || (s.at !== null && Date.now() - s.at < every)) return;
  const st = s;
  st.run = onMachine(alias, SCRIPT)
    .then((text) => {
      const d = parseProbe(text);
      st.data = d;
      st.okAt = Date.now();
      st.error = null;
      st.fails = 0;
      if (d.load) st.spark = [...st.spark, { t: st.okAt, v: d.load[0] }].slice(-60);
    })
    .catch((e: Error) => {
      st.error = String(e.message).slice(0, 200);
      st.fails += 1;
    })
    .finally(() => {
      st.at = Date.now();
      st.run = null;
      for (const f of listeners) f();
    });
}

// ---------------------------------------------------------------- URL status (5 min)

const urlStatus = new Map<string, { at: number; code: number | null; run: boolean }>();
/** The last HTTP status of a URL: 0 for no answer, null not checked yet. Checks again behind the call after 5 min. */
export function statusOf(url: string): number | null {
  if (!URL_CHECK || !PROBE_ON) return null;
  let s = urlStatus.get(url);
  if (!s) urlStatus.set(url, (s = { at: 0, code: null, run: false }));
  if (!s.run && Date.now() - s.at > 300_000) {
    const st = s;
    st.run = true;
    fetch(url, { redirect: "manual", signal: AbortSignal.timeout(4000) })
      .then((r) => ((st.code = r.status), r.body?.cancel().catch(() => {})))
      .catch(() => (st.code = 0))
      .finally(() => ((st.at = Date.now()), (st.run = false)));
  }
  return s.code;
}

// ---------------------------------------------------------------- logs

const SAFE = /^[A-Za-z0-9@._:-]+$/;
const SECRET = /(key|token|secret|password)\s*[=:]/i;
export const REDACTED = "··· line hidden: it names a key, token, secret or password ···";

/** The read-only command that prints a unit's last `n` lines; null when the unit's name is not plain. */
export function logCommand(u: Pick<Unit, "unit" | "kind" | "user">, n: number): string | null {
  if (!SAFE.test(u.unit) || (u.user && !/^[a-z_][a-z0-9_-]*$/.test(u.user))) return null;
  const q = `'${u.unit}'`;
  if (u.kind === "systemd") return `journalctl -u ${q} -n ${n} --no-pager -o short-iso 2>&1`;
  if (u.kind === "user") return `if [ "$(id -un)" = '${u.user}' ]; then journalctl --user -u ${q} -n ${n} --no-pager -o short-iso; else sudo -n -u '${u.user}' XDG_RUNTIME_DIR=/run/user/$(id -u '${u.user}') journalctl --user -u ${q} -n ${n} --no-pager -o short-iso; fi 2>&1`;
  if (u.kind === "docker") return `docker logs --tail ${n} ${q} 2>&1`;
  return `f=$(plutil -extract StandardOutPath raw "$HOME/Library/LaunchAgents/${u.unit}.plist" 2>/dev/null) && tail -n ${n} "$f" 2>&1 || echo "no StandardOutPath for ${u.unit}"`;
}

export function redact(lines: string[]): string[] {
  return lines.map((l) => (SECRET.test(l) ? REDACTED : l));
}

export async function readLogs(alias: string | null, u: Unit, n: number): Promise<string[]> {
  const cmd = logCommand(u, n);
  if (!cmd) throw new Error("not a plain unit name");
  const out = await onMachine(alias, `${cmd}\n`, 15_000, 2 << 20);
  return redact(out.replace(/\n$/, "").split("\n")).slice(-n);
}
