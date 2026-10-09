/**
 * ab-remote: hosted chats that run on another machine (the Mac mini, siso-vps) and show up in Agent Base on this laptop.
 *
 * FLEET-COST, 7 Oct 2026. Shaan, 6 Oct ~23:20: "figure out why my laptop why this app so ram heavy load heavy and the agents
 * are so load heavy and ram heavy". Measured 7 Oct 00:40-00:50 (laptop-health/bin/owners-sample): swap 8.1 of 9.2 GB used,
 * only 2 of 8 cores busy, 11 hosted Opus chats about 2.3 GB between them. The chat runs where the RAM is; the laptop keeps
 * the view.
 *
 *   ab-remote start --on MACHINE --name NAME --cwd DIR [--harness claude|codex] [--model M] [--effort E] [--prompt TEXT]
 *                   [--brief FILE]   (copies FILE to the same path there; the prompt defaults to "Read FILE and start: you are NAME.")
 *       Start siso-host on MACHINE (tmux session ab-owners, one window per chat) and make sure the bridge runs here.
 *       Claude needs a signed-in profile there (CLAUDE_CONFIG_DIR, default ~/.config/claude-siso-3); start says so if not.
 *   ab-remote bridge
 *       The LaunchAgent com.siso.ab-remote runs this. One ssh per machine streams that machine's live host records; each one
 *       becomes a pane-less host file here (hosts/remote-MACHINE-PID.json) whose pid is this bridge and whose port is a
 *       local proxy that carries each connection to the remote host over ssh -W. The app reads it like any service host
 *       (service-hosts.ts: pid alive and /health answers that pid), so it lists the chat and talks to it with no change.
 *   ab-remote list | install | uninstall | stop --on MACHINE --name NAME
 *
 *       --resume SESSION (Claude) carries a conversation over: copy its transcript to the remote's CLAUDE_CONFIG_DIR projects
 *       folder for the same cwd first (paths match on every machine).
 * Machines: mini (ssh mini-fast) and vps (ssh siso-vps); ~/.local/state/agent-base/remote/machines.json adds or overrides
 * ({"NAME": {"ssh": "alias", "root": "path under the remote home to an Agent Base checkout"}}). Env for tests: AB_HOSTS_DIR,
 * AB_REMOTE_STATE, AB_REMOTE_SSH (the ssh binary), AB_REMOTE_MACHINES (JSON, replaces the defaults).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";

type Machine = { name: string; ssh: string; root: string };
type Rec = Record<string, unknown> & { pid: number; port: number; token: string; name: string; session?: string | null; pane?: string | null };

const HOME = homedir();
const HOSTS = process.env.AB_HOSTS_DIR ?? path.join(HOME, ".local/state/agent-base/hosts");
const STATE = process.env.AB_REMOTE_STATE ?? path.join(HOME, ".local/state/agent-base/remote");
const SSH = process.env.AB_REMOTE_SSH ?? "ssh";
const LABEL = "com.siso.ab-remote";
const ROOT = "SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base/remote-host";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=auto", "-o", `ControlPath=${HOME}/.ssh/cm-ab-%C`, "-o", "ControlPersist=10m"];
const REMOTE_PATH = 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"';
const ACTIVITY = ["activityJournal", "activityVersion", "activitySeq", "activityHealthy", "activityRunId"];

const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

export function machines(): Machine[] {
  const fromEnv = process.env.AB_REMOTE_MACHINES ? JSON.parse(process.env.AB_REMOTE_MACHINES) : null;
  let extra: Record<string, Partial<Machine>> = {};
  try { extra = JSON.parse(readFileSync(path.join(STATE, "machines.json"), "utf8")); } catch { /* defaults only */ }
  const all: Record<string, Partial<Machine>> = fromEnv ?? { mini: { ssh: "mini-fast", root: ROOT }, vps: { ssh: "siso-vps", root: ROOT }, ...extra };
  return Object.entries(all).map(([name, m]) => ({ name, ssh: String(m.ssh ?? name), root: String(m.root ?? ROOT) }));
}

function sshRun(m: Machine, command: string, timeout = 60_000): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync(SSH, [...SSH_OPTS, m.ssh, command], { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e: any) {
    return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? e.message ?? "") };
  }
}

// ------------------------------------------------------------------------------------------------ the remote watcher
// Runs on the remote machine (node -e). Prints {"hosts":[...]} whenever the set of live host records changes, a beat every
// 30 s, and exits when ssh goes. Records that are themselves mirrors (they carry `remote`) are never passed on.
const WATCHER = `
const fs=require('fs'),path=require('path'),os=require('os');
const dir=process.env.AB_HOSTS_DIR||path.join(os.homedir(),'.local/state/agent-base/hosts');
let last='';
const alive=p=>{try{process.kill(p,0);return true}catch(e){return e.code==='EPERM'}};
function scan(){const out=[];try{for(const f of fs.readdirSync(dir).sort()){if(!f.endsWith('.json'))continue;try{const h=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
if(h&&!h.remote&&Number.isInteger(h.pid)&&Number.isInteger(h.port)&&typeof h.token==='string'&&typeof h.name==='string'&&alive(h.pid))out.push(h)}catch{}}}catch{}
const s=JSON.stringify(out);if(s!==last){last=s;process.stdout.write(JSON.stringify({hosts:out})+'\\n')}}
let t=null;const kick=()=>{clearTimeout(t);t=setTimeout(scan,250)};
try{fs.mkdirSync(dir,{recursive:true,mode:0o700})}catch{}
scan();try{fs.watch(dir,kick)}catch{}setInterval(scan,15000);
setInterval(()=>process.stdout.write('{"beat":1}\\n'),30000);
process.stdout.on('error',()=>process.exit(0));process.stdin.on('end',()=>process.exit(0));process.stdin.on('error',()=>process.exit(0));process.stdin.resume();
`;
const watcherCommand = () => `${REMOTE_PATH} exec node -e 'eval(Buffer.from("${Buffer.from(WATCHER).toString("base64")}","base64").toString())'`;

// ------------------------------------------------------------------------------------------------ the bridge
type Mirror = { key: string; machine: Machine; held: { rec: Rec }; server: net.Server; port: number; file: string; written: string };

export function mirrorRecord(rec: Rec, m: Machine, localPort: number, bridgePid = process.pid): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rec };
  for (const k of ACTIVITY) delete out[k];
  return { ...out, pid: bridgePid, port: localPort, pane: null, machine: m.name,
    remote: { machine: m.name, ssh: m.ssh, pid: rec.pid, port: rec.port, pane: rec.pane ?? null } };
}

function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; } };

/** A local port that answers /health as this bridge and carries everything else to the remote host. */
function proxy(m: Machine, rec: () => Rec): net.Server {
  return net.createServer((sock) => {
    sock.on("error", () => {});
    sock.once("data", (first: Buffer) => {
      const r = rec();
      if (/^GET \/health[ ?]/.test(first.toString("latin1", 0, 32))) {
        const body = JSON.stringify({ pid: process.pid, name: r.name, session: r.session ?? null, remote: { machine: m.name, pid: r.pid } });
        sock.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        return;
      }
      sock.pause();
      const tunnel = spawn(SSH, [...SSH_OPTS, m.ssh, "-W", `127.0.0.1:${r.port}`], { stdio: ["pipe", "pipe", "ignore"] });
      tunnel.stdin!.on("error", () => {});
      tunnel.stdin!.write(first);
      sock.pipe(tunnel.stdin!);
      tunnel.stdout!.pipe(sock);
      sock.resume();
      const end = () => { sock.destroy(); if (tunnel.exitCode === null) tunnel.kill(); };
      sock.on("close", end);
      tunnel.on("exit", () => sock.end());
    });
  });
}

export async function bridge(): Promise<void> {
  mkdirSync(HOSTS, { recursive: true, mode: 0o700 });
  mkdirSync(STATE, { recursive: true, mode: 0o700 });
  const pidFile = path.join(STATE, "bridge.pid");
  try {
    const other = Number(readFileSync(pidFile, "utf8"));
    if (other && other !== process.pid && alive(other)) { console.log(`bridge already running (pid ${other})`); return; }
  } catch { /* first run */ }
  writeFileSync(pidFile, String(process.pid));
  // A previous bridge's mirrors point at a dead pid: they are this bridge's files, so it clears them.
  for (const f of readdirSync(HOSTS)) {
    if (!/^remote-.*\.json$/.test(f)) continue;
    try { const h = JSON.parse(readFileSync(path.join(HOSTS, f), "utf8")); if (!alive(h.pid) || h.pid === process.pid) unlinkSync(path.join(HOSTS, f)); } catch { /* gone */ }
  }
  const mirrors = new Map<string, Mirror>();
  const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

  async function apply(m: Machine, recs: Rec[]) {
    const keep = new Set<string>();
    for (const rec of recs) {
      const key = `${m.name}:${rec.pid}:${rec.port}`;
      keep.add(key);
      let mi = mirrors.get(key);
      if (!mi) {
        const held = { rec };
        const server = proxy(m, () => held.rec);
        await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
        const port = (server.address() as net.AddressInfo).port;
        mi = { key, machine: m, held, server, port, file: path.join(HOSTS, `remote-${safe(m.name)}-${rec.pid}.json`), written: "" };
        mirrors.set(key, mi);
        log(`mirror ${rec.name} on ${m.name} (remote pid ${rec.pid}) -> 127.0.0.1:${port}`);
      }
      mi.held.rec = rec;
      const text = JSON.stringify(mirrorRecord(rec, m, mi.port));
      if (text !== mi.written) { writeAtomic(mi.file, text); mi.written = text; }
    }
    for (const [key, mi] of mirrors) {
      if (mi.machine.name !== m.name || keep.has(key)) continue;
      mi.server.close();
      try { unlinkSync(mi.file); } catch { /* already gone */ }
      mirrors.delete(key);
      log(`gone ${mi.held.rec.name} on ${m.name}`);
    }
  }

  // One update at a time per machine, so two quick messages never open two proxies for one host.
  const queue = new Map<string, Promise<void>>();
  const update = (m: Machine, recs: Rec[]) => queue.set(m.name, (queue.get(m.name) ?? Promise.resolve()).then(() => apply(m, recs)).catch((e) => log(`${m.name}: ${e}`)));

  const watchers: ChildProcess[] = [];
  function watch(m: Machine, backoff = 5_000) {
    const child = spawn(SSH, [...SSH_OPTS, m.ssh, watcherCommand()], { stdio: ["pipe", "pipe", "pipe"] });
    watchers.push(child);
    let buf = "", seen = false, err = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const msg = JSON.parse(line);
          if (Array.isArray(msg.hosts)) { seen = true; update(m, msg.hosts); }
        } catch { /* not ours */ }
      }
    });
    child.stderr!.on("data", (d) => { err = (err + d).slice(-400); });
    child.on("exit", (code) => {
      watchers.splice(watchers.indexOf(child), 1);
      update(m, []); // the link is down: its chats are not reachable from here, so they leave the app until it is back
      const wait = seen ? 5_000 : Math.min(backoff * 2, 300_000);
      log(`${m.name}: watcher ended (${code}) ${err.trim().split("\n").pop() ?? ""}; again in ${wait / 1000}s`);
      setTimeout(() => watch(m, wait), wait);
    });
  }
  for (const m of machines()) watch(m);
  const stop = () => {
    for (const mi of mirrors.values()) { try { unlinkSync(mi.file); } catch { /* gone */ } }
    for (const w of watchers) w.kill();
    try { if (Number(readFileSync(pidFile, "utf8")) === process.pid) unlinkSync(pidFile); } catch { /* gone */ }
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  log(`bridge ${process.pid} watching ${machines().map((m) => `${m.name} (${m.ssh})`).join(", ")}`);
  await new Promise(() => {});
}

// ------------------------------------------------------------------------------------------------ the commands
function flags(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "1" : argv[++i];
  return out;
}
const machine = (name: string) => {
  const m = machines().find((x) => x.name === name);
  if (!m) { console.error(`no machine "${name}"; known: ${machines().map((x) => x.name).join(", ")}`); process.exit(2); }
  return m;
};
const uid = () => (process.getuid ? process.getuid() : 0);
const plistFile = () => path.join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const bridgeLoaded = () => { try { execFileSync("launchctl", ["print", `gui/${uid()}/${LABEL}`], { stdio: "ignore" }); return true; } catch { return false; } };

function install() {
  mkdirSync(STATE, { recursive: true, mode: 0o700 });
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const args = [process.execPath, "--experimental-strip-types", "--no-warnings", path.resolve(import.meta.filename), "bridge"];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${x(a)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${x(`${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`)}</string><key>HOME</key><string>${x(HOME)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${x(path.join(STATE, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${x(path.join(STATE, "bridge.log"))}</string>
</dict></plist>
`;
  if (bridgeLoaded()) execFileSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], { stdio: "ignore" });
  writeFileSync(plistFile(), plist);
  execFileSync("launchctl", ["bootstrap", `gui/${uid()}`, plistFile()]);
  console.log(`bridge installed: ${plistFile()} (log ${path.join(STATE, "bridge.log")})`);
}

function mirrorsHere(): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  try {
    for (const f of readdirSync(HOSTS)) {
      if (!/^remote-.*\.json$/.test(f)) continue;
      try { const h = JSON.parse(readFileSync(path.join(HOSTS, f), "utf8")); if (alive(h.pid)) out.push(h); } catch { /* partial */ }
    }
  } catch { /* none */ }
  return out;
}

async function start(f: Record<string, string>) {
  const m = machine(f.on), name = f.name, cwd = f.cwd, harness = f.harness ?? "claude";
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name) || !cwd) { console.error("start needs --on MACHINE --name NAME --cwd DIR"); process.exit(2); }
  if (harness === "codex" && !f.model) { console.error("a Codex chat needs --model (never codex without -m)"); process.exit(2); }
  const configDir = f["config-dir"] ?? "$HOME/.config/claude-siso-3";
  const host = `"$HOME"/${m.root}/services/host/bin/siso-host`;
  const pre = sshRun(m, `${REMOTE_PATH}; test -x ${host} || echo NOHOST; test -d ${q(cwd)} || echo NODIR; command -v tmux >/dev/null || echo NOTMUX; ` +
    `tmux list-windows -t ab-owners -F '#W' 2>/dev/null | grep -qxF ${q(name)} && echo TAKEN; ` +
    (harness === "claude" ? `CLAUDE_CONFIG_DIR="${configDir}" claude auth status 2>/dev/null | grep -q '"loggedIn": true' || echo NOLOGIN` : `codex login status >/dev/null 2>&1 || echo NOLOGIN`));
  if (!pre.ok) { console.error(`cannot reach ${m.name} (${m.ssh}): ${pre.out.trim().split("\n").pop()}`); process.exit(1); }
  const why: Record<string, string> = {
    NOHOST: `${m.name} has no Agent Base host at ~/${m.root}: git worktree add it from origin/main and npm install in services/host`,
    NODIR: `${m.name} has no ${cwd}: restore or clone that repo there first (estate restore --only ...)`,
    NOTMUX: `${m.name} has no tmux`,
    TAKEN: `${m.name} already runs a chat called ${name} (tmux window ab-owners:${name})`,
    NOLOGIN: harness === "claude"
      ? `Claude is not signed in on ${m.name} for ${configDir}. Once, by hand: ssh -t ${m.ssh} 'CLAUDE_CONFIG_DIR=${configDir} ~/.local/bin/claude' then /login`
      : `Codex is not signed in on ${m.name}: ssh -t ${m.ssh} codex login`,
  };
  const problems = Object.keys(why).filter((k) => pre.out.includes(k));
  if (problems.length) { for (const k of problems) console.error(why[k]); process.exit(3); }
  if (f.brief) {
    const brief = path.resolve(f.brief);
    try {
      execFileSync(SSH, [...SSH_OPTS, m.ssh, `mkdir -p ${q(path.dirname(brief))} && cat > ${q(brief)}`], { input: readFileSync(brief), timeout: 60_000, stdio: ["pipe", "ignore", "pipe"] });
    } catch (e: any) { console.error(`could not copy ${brief} to ${m.name}: ${String(e.stderr ?? e.message).trim()}`); process.exit(1); }
    f.prompt ??= `Read ${brief} and start: you are ${name}.`;
  }
  const hostArgs = harness === "codex"
    ? ["--harness", "codex", "--name", name, "--model", f.model, ...(f.effort ? ["--effort", f.effort] : []), ...(f.prompt ? ["--prompt", f.prompt] : [])]
    : ["--permission-mode", f["permission-mode"] ?? "bypassPermissions", "--name", name, "--model", f.model ?? "claude-opus-5-5[1m]",
      ...(f.effort ? ["--effort", f.effort] : []), ...(f.resume ? ["--resume", f.resume] : []), ...(f.prompt ? ["--prompt", f.prompt] : [])];
  const env = harness === "claude" ? `CLAUDE_CONFIG_DIR="${configDir}" CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=${q(f.compact ?? "30")} ` : "";
  const inner = `${REMOTE_PATH} ${env}exec ${host} ${hostArgs.map(q).join(" ")}`;
  const run = sshRun(m, `${REMOTE_PATH}; tmux has-session -t ab-owners 2>/dev/null || tmux new-session -d -s ab-owners -n home; ` +
    `tmux new-window -d -t ab-owners -n ${q(name)} -c ${q(cwd)} ${q(inner)} && echo STARTED`);
  if (!run.out.includes("STARTED")) { console.error(`tmux did not start it: ${run.out.trim()}`); process.exit(1); }
  if (!bridgeLoaded() && !process.env.AB_REMOTE_NO_INSTALL) install();
  for (let i = 0; i < 60; i++) {
    const hit = mirrorsHere().find((h) => h.machine === m.name && h.name === name);
    if (hit) { console.log(`${name} is live on ${m.name} (remote pid ${hit.remote.pid}) and in Agent Base as ${name} (127.0.0.1:${hit.port}). Watch it: ssh -t ${m.ssh} tmux attach -t ab-owners`); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`${name} started on ${m.name} but no host record reached this laptop in 60 s. Look: ssh -t ${m.ssh} tmux attach -t ab-owners; ${path.join(STATE, "bridge.log")}`);
  process.exit(1);
}

function stopChat(f: Record<string, string>) {
  const m = machine(f.on);
  if (!f.name) { console.error("stop needs --on MACHINE --name NAME"); process.exit(2); }
  const r = sshRun(m, `${REMOTE_PATH}; tmux kill-window -t ${q(`ab-owners:${f.name}`)} && echo STOPPED`);
  console.log(r.out.includes("STOPPED") ? `${f.name} stopped on ${m.name}` : `nothing stopped: ${r.out.trim()}`);
}

function list() {
  const rows = mirrorsHere();
  if (!rows.length) console.log(`no remote chats here${bridgeLoaded() ? "" : " (bridge not running: ab-remote install)"}`);
  for (const h of rows) console.log(`${h.machine.padEnd(6)} ${String(h.name).padEnd(22)} ${String(h.state ?? "-").padEnd(8)} ctx ${h.ctx?.pct ?? "-"}%  remote pid ${h.remote?.pid}  local 127.0.0.1:${h.port}`);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? "")) {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  if (cmd === "bridge") await bridge();
  else if (cmd === "start") await start(f);
  else if (cmd === "stop") stopChat(f);
  else if (cmd === "list") list();
  else if (cmd === "install") install();
  else if (cmd === "uninstall") { if (bridgeLoaded()) execFileSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`]); console.log("bridge unloaded (plist left in place)"); }
  else { console.log(readFileSync(import.meta.filename, "utf8").split("*/")[0]); process.exit(cmd ? 2 : 0); }
}
