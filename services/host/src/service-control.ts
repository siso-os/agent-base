import { randomUUID } from 'node:crypto';
import { wakeRunner } from './idle-sleep.ts';
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readSeat, reconcileSeat, safeName } from "./service.ts";
import { validateWorkspaceReceipt } from './worktree-contract.ts';
import { selectedBackendEnvironment } from './backend-version.ts';
import { prepareInitialBackend } from './backend-service.ts';
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
export function renderPlist(o: { label: string; name: string; resume: string; cwd: string; seat: string; hosts: string; node: string; runner: string; harness?: "codex" | "claude"; model?: string; effort?: string; permissionMode?: string; keepAwake?: boolean; env?: Record<string,string> }) {
  const args = [o.node, "--experimental-strip-types", "--no-warnings", o.runner, ...(o.harness ? ["--harness", o.harness, "--model", o.model!, ...(o.effort ? ["--effort", o.effort] : [])] : []), ...(o.permissionMode ? ['--permission-mode', o.permissionMode] : []), ...(o.keepAwake ? ["--keep-awake"] : []), "--name", safeName(o.name), ...(o.resume ? ["--resume", o.resume] : [])];
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", AB_SEAT_FILE: o.seat, AB_HOSTS_DIR: o.hosts, AB_SERVICE_LABEL: o.label, ...o.env };
  const log = path.join(o.hosts, `${o.name}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xml(o.label)}</string>
<key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(o.cwd)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join("")}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n`;
}
export function control(args = process.argv.slice(2)) {
  const command = args[0];
  const flag = (key: string) => { const i = args.indexOf(`--${key}`); return i >= 0 ? args[i + 1] : undefined; };
  if (!flag("name") || (!flag("label") && command !== "send")) throw new Error("Explicit --name and --label are required");
  const name = safeName(flag("name")!);
  const label = flag("label") ?? (name === "A0" ? "com.siso.a0-host" : "com.siso.host-lab");
  if (!/^[A-Za-z0-9_.-]+$/.test(label)) throw new Error("Invalid launchd label");
  const launchctl = process.env.AB_LAUNCHCTL ?? "/bin/launchctl";
  const domain = `gui/${process.getuid!()}`;
  const dir = process.env.AB_LAUNCH_AGENTS_DIR ?? path.join(homedir(), "Library/LaunchAgents");
  const plist = path.join(dir, `${label}.plist`);
  if (command === "status") {
    try { execFileSync(launchctl, ["print", `${domain}/${label}`], { stdio: "ignore" }); console.log(JSON.stringify({ label, name, loaded: true })); }
    catch { console.log(JSON.stringify({ label, name, loaded: false })); }
    return;
  }
  if (command === "send") return void send(name, flag("prompt-file"), Number(flag("timeout") ?? 3600));
  if (command === "uninstall") {
    execFileSync(launchctl, ["bootout", `${domain}/${label}`], { stdio: "ignore" });
    rmSync(plist, { force: true }); console.log(JSON.stringify({ label, name, installed: false })); return;
  }
  if (command !== "install" && command !== 'reconcile') throw new Error("Usage: siso-host-service install|reconcile|uninstall|status --label L --name N --resume SESSION");
  const harness = flag("harness");
  if (harness && harness !== "codex" && harness !== "claude") throw new Error("Unknown harness");
  const codex = harness === "codex";
  const permissionMode = flag('permission-mode');
  if (permissionMode && (harness !== 'claude' || !['default','acceptEdits','bypassPermissions','plan'].includes(permissionMode))) throw new Error('Invalid Claude permission mode');
  const model = flag("model") ?? flag("m") ?? (args.includes("-m") ? args[args.indexOf("-m") + 1] : undefined);
  if (codex && (!model?.trim() || model.startsWith("-"))) throw new Error("Codex requires --model MODEL (or -m MODEL)");
  if (harness === 'claude' && process.env.AB_WORKSPACE_RECEIPT && (!model?.trim() || model.startsWith('-'))) throw new Error('Claude requires --model MODEL');
  const resume = flag("resume");
  const exactResume = process.env.AB_EXACT_RESUME;
  if (exactResume && (!/^[A-Za-z0-9_-]{1,128}$/.test(exactResume) || exactResume !== resume)) throw new Error('Exact resume identity disagrees with --resume');
  if ((!codex && !resume && !(harness === 'claude' && process.env.AB_WORKSPACE_RECEIPT)) || (resume && !/^[A-Za-z0-9_-]+$/.test(resume))) throw new Error("Invalid --resume");
  const cwd = path.resolve(flag("cwd") ?? process.cwd());
  if (!statSync(cwd).isDirectory()) throw new Error("--cwd must be a directory");
  const seat = process.env.AB_SEAT_FILE ?? path.join(homedir(), ".local/state/a0/seat.json");
  if (!codex && name !== "A0" && !process.env.AB_SEAT_FILE) throw new Error("Lab services require AB_SEAT_FILE");
  const hosts = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
  if (harness === 'claude' && process.env.AB_WORKSPACE_RECEIPT) {
    const s = readSeat(seat, name);
    const receipt = validateWorkspaceReceipt(process.env.AB_WORKSPACE_RECEIPT, cwd);
    if (receipt.input.harness !== harness || receipt.input.model !== model || resume && resume !== s.session) throw new Error('Service receipt launch changed');
    let saved;
    try { saved = JSON.parse(readFileSync(path.join(hosts, `name-${name}.json`), 'utf8')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    // Loaded jobs are never changed below. Dead-host adoption is validated again by the runner.
    const recovered = reconcileSeat(s, saved, { workspaceId: receipt.workspaceId, name, cwd, label, model: model! }, pid => {
      if (command === 'reconcile') return false;
      try { process.kill(pid, 0); return true; } catch (e: any) { if (e.code !== 'ESRCH') throw e; return false; }
    });
    validateWorkspaceReceipt(process.env.AB_WORKSPACE_RECEIPT, cwd, name, recovered.session ?? undefined);
  } else if (command === 'reconcile') throw new Error('Reconciliation requires an owned Claude workspace seat');
  // Do not silently replace a loaded job owned by another process.
  let loaded = false;
  try { execFileSync(launchctl, ["print", `${domain}/${label}`], { stdio: "ignore" }); loaded = true; } catch {}
  if (loaded && command === 'install') throw new Error("Job already loaded; uninstall it explicitly first");
  let backendSelection = process.env.AB_BACKEND_SELECTION;
  if (codex && command === 'install' && process.env.AB_WORKSPACE_RECEIPT) {
    const launch = validateWorkspaceReceipt(process.env.AB_WORKSPACE_RECEIPT, cwd);
    if (launch.input.backendCatalogId) {
      if (backendSelection || process.env.AB_CODEX_BIN || existsSync(plist)) throw new Error('Fresh catalog launch cannot replace an existing backend or definition');
      backendSelection = prepareInitialBackend(process.env.AB_WORKSPACE_RECEIPT, { name, label, cwd }, model!, hosts);
    }
  }
  if (backendSelection) {
    if (!codex) throw new Error('Local backend selection supports Codex only; Claude SDK remains package-owned');
    const selected = selectedBackendEnvironment(backendSelection, { name, label, cwd });
    if (process.env.AB_CODEX_BIN && process.env.AB_CODEX_BIN !== selected.AB_CODEX_BIN) throw new Error('Backend selection disagrees with explicit binary');
  }
  const content = renderPlist({ label, name, resume: resume ?? "", seat, hosts, cwd, permissionMode, keepAwake: args.includes("--keep-awake"), node: process.execPath, runner: path.join(import.meta.dirname, "service-runner.ts"), ...(codex || harness === 'claude' && model ? { harness: harness as 'codex' | 'claude', model, effort: flag("effort") } : {}), env: { ...(process.env.AB_IDLE_SLEEP_MIN ? { AB_IDLE_SLEEP_MIN: process.env.AB_IDLE_SLEEP_MIN } : {}), ...(exactResume ? { AB_EXACT_RESUME: exactResume } : {}), ...(process.env.AB_WORKSPACE_RECEIPT ? { AB_WORKSPACE_RECEIPT: process.env.AB_WORKSPACE_RECEIPT } : {}), ...(process.env.AB_SERVICE_HOST_ENTRY ? { AB_SERVICE_HOST_ENTRY: process.env.AB_SERVICE_HOST_ENTRY } : {}), ...(backendSelection ? { AB_BACKEND_SELECTION: backendSelection } : process.env.AB_CODEX_BIN ? { AB_CODEX_BIN: process.env.AB_CODEX_BIN } : {}) } });
  if (existsSync(plist)) {
    if (command !== 'reconcile' || readFileSync(plist, 'utf8') !== content) throw new Error('Existing service definition preserved; ownership/configuration differs');
    if (loaded) { console.log(JSON.stringify({ label, name, installed: true, loaded: true, changed: false })); return; }
  } else if (command === 'reconcile') throw new Error('Saved service definition is missing; retained for inspection');
  if (command === 'reconcile') {
    const saved = JSON.parse(readFileSync(path.join(hosts, `name-${name}.json`), 'utf8'));
    try { process.kill(saved.pid, 0); throw new Error('Service host is already alive'); } catch (e: any) { if (e.code !== 'ESRCH') throw e; }
  }
  mkdirSync(dir, { recursive: true }); mkdirSync(hosts, { recursive: true, mode: 0o700 });
  if (command === 'install') writeFileSync(plist, content, { mode: 0o600, flag: 'wx' });
  execFileSync(launchctl, ["bootstrap", domain, plist], { stdio: "inherit" });
  console.log(JSON.stringify({ label, name, installed: true }));
}
if (process.argv[1] === import.meta.filename) control();

/**
 * `siso-host-service send --name N --prompt-file F [--timeout S]`: one turn to a running host (Codex or Claude), through the
 * host's own socket, the way the app sends one. Prints the final assistant message when the turn ends. Exit 2: no live host;
 * 3: timed out (the turn keeps running in its chat). This is how Agent Zero gives a standing chat its next piece of work.
 */
export async function send(name: string, file: string | undefined, timeoutS: number) {
  const { readFileSync: read } = await import("node:fs");
  const { WebSocket } = await import("ws");
  if (!file) throw new Error("--prompt-file is required");
  const text = read(file === "-" ? 0 : file, "utf8");
  const hosts = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
  const hostFile = path.join(hosts, `name-${safeName(name)}.json`);
  const key = randomUUID();
  let mine = false, last = '', session: string | undefined;
  const until = Date.now() + timeoutS * 1000;
  const observe = (m: any) => {
    if (m.t === 'user' && (m.id === key || m.text === text.slice(0, 100_000))) mine = true;
    if (!mine) return false;
    if (m.t === 'text' && !m.parent) last = m.text;
    return m.t === 'result';
  };
  while (Date.now() < until) {
    let host: any;
    try { host = await wakeRunner(hostFile); }
    catch (e) { console.error(`siso-host-service: ${(e as Error).message}`); process.exitCode = 2; return; }
    if (session && host.session !== session) { console.error('siso-host-service: host identity changed'); process.exitCode = 2; return; }
    session = host.session;
    const finished = await new Promise<boolean>(resolve => {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`);
      const timer = setTimeout(() => { ws.close(); resolve(false); }, Math.max(1, until - Date.now()));
      ws.on('message', raw => {
        let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.t === 'hello') {
          // If a connection failed after admission, the durable key prevents a second turn.
          // Only our own keyed user event may select history from a reconnected hello.
          const own = (m.log ?? []).findIndex((e: any) => e.t === 'user' && e.id === key);
          if (own >= 0 && m.log.slice(own).some((e: any) => observe(e))) { clearTimeout(timer); ws.close(); resolve(true); return; }
          ws.send(JSON.stringify({ t: 'prompt', key, messageId: key, text, delivery: 'next', images: [] }));
        } else if (observe(m)) { clearTimeout(timer); ws.close(); resolve(true); }
      });
      ws.once('close', () => { clearTimeout(timer); resolve(false); });
      ws.once('error', () => { clearTimeout(timer); ws.close(); resolve(false); });
    });
    if (finished) { console.log(last); return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  console.error(`siso-host-service: ${name} still working after ${timeoutS}s; see its chat`); process.exitCode = 3;
}
