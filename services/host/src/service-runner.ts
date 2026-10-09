/** launchd keeps this runner alive; it owns only the SDK child it starts. */
import { guardWorkspace } from "./worktree-contract.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { configDir, moveSession, readSeat, reconcileSeat, safeName, saveHost, sessionFiles } from "./service.ts";
import { lockBackendSelection, backendChildEnvironment } from './backend-version.ts';
const args = process.argv.slice(2).filter(a => a !== "--service");
const flag = (key: string) => args[args.indexOf(`--${key}`) + 1];
if (!args.includes("--name")) throw new Error("Explicit --name is required");
const name = safeName(flag("name"));
const seatFile = process.env.AB_SEAT_FILE ?? path.join(homedir(), ".local/state/a0/seat.json");
const codex = args.includes("--harness") && flag("harness") === "codex";
if (args.includes('--harness') && !['codex', 'claude'].includes(flag('harness'))) throw new Error('Unknown harness');
if (codex && (!args.includes("--model") || !flag("model")?.trim())) throw new Error("Codex requires --model");
if (!codex && name !== "A0" && !process.env.AB_SEAT_FILE) throw new Error("Lab services require AB_SEAT_FILE");
const hosts = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
const hostFile = path.join(hosts, `name-${name}.json`);
// A hosted child keeps the inherited native binary, not its parent's service lease/identity.
const backendSelection = process.env.AB_CHILD_ID ? undefined : process.env.AB_BACKEND_SELECTION;
const backendOwner = { name, label: process.env.AB_SERVICE_LABEL ?? '', cwd: process.cwd() };
if (backendSelection && !codex) throw new Error('Local backend selection supports Codex only');
// Held across every child restart, so an active service can never change its selected backend.
const releaseBackend = backendSelection ? lockBackendSelection(backendSelection) : undefined;
if (releaseBackend) process.once('exit', releaseBackend);
let stopping = false, child: ChildProcess | undefined;
let wakePending = false, releaseSleep: (() => void) | undefined;
process.on('SIGUSR1', () => {
  // A send can arrive after the asleep write but before exit 75. Remember that wake.
  try {
    const saved = JSON.parse(readFileSync(hostFile, 'utf8'));
    if (saved.state !== 'asleep' || saved.runnerPid !== process.pid || child && saved.pid !== child.pid) return;
    wakePending = true; releaseSleep?.();
  } catch { /* Not our sleeping seat. */ }
});
async function childExited(owned: ChildProcess): Promise<number | null> {
  const code = await new Promise<number | null>((resolve, reject) => { owned.once('exit', resolve); owned.once('error', reject); });
  // Each child has its own group. Reap only descendants of the child this runner started.
  if (owned.pid) {
    try { process.kill(-owned.pid, 'SIGTERM'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    try { process.kill(-owned.pid, 'SIGKILL'); } catch {}
  }
  child = undefined;
  if (code === 75 && !stopping) {
    quick = 0;
    if (!wakePending) await new Promise<void>(resolve => {
      // A suspended runner needs one referenced handle; no filesystem/process polling.
      const hold = setInterval(() => {}, 2_147_483_647);
      releaseSleep = () => { clearInterval(hold); releaseSleep = undefined; resolve(); };
      if (stopping || wakePending) releaseSleep();
    });
    wakePending = false;
  }
  return code;
}
const stop = () => { stopping = true; releaseSleep?.(); child?.kill("SIGTERM"); };
process.once("SIGTERM", stop); process.once("SIGINT", stop);
let previousConfig: string | undefined;
let previousSession: string | undefined;
let initial = true;
let firstLaunch = true;
let quick = 0;
while (!stopping) {
  guardWorkspace(process.cwd());
  if (codex) {
    let saved: any;
    try { saved = JSON.parse(readFileSync(hostFile, "utf8")); } catch {}
    const requested = args.includes("--resume") ? flag("resume") : undefined;
    if (saved?.session && requested && saved.session !== requested) throw new Error("Host thread disagrees with --resume");
    if (saved?.pid) {
      try { process.kill(saved.pid, 0); throw new Error("Service host is already alive"); } catch (e: any) { if (e.code !== "ESRCH") throw e; }
    }
    const session = saved?.session ?? requested;
    guardWorkspace(process.cwd(),name,session);
    const childArgs = args.filter((_, i) => args[i] !== "--harness" && args[i - 1] !== "--harness" && args[i] !== "--resume" && args[i - 1] !== "--resume");
    restoreSettings(childArgs, saved);
    child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(import.meta.dirname, "codex-host.ts"), ...childArgs, ...(session ? ["--resume", session] : [])], { cwd: process.cwd(), env: { ...(backendSelection ? backendChildEnvironment(process.env, backendSelection, backendOwner) : process.env), HERDR_ENV: "0", AB_RUNNER_PID: String(process.pid), AB_HOST_PROCESS_GROUP: "1" }, detached: true, stdio: ["ignore", "inherit", "inherit"] });
    firstLaunch = false;
    const began = Date.now();
    const exitCode = await childExited(child);
    // A host that dies within a minute (login lapsed, bad thread) backs off up to 5 minutes instead of spinning.
    quick = Date.now() - began < 60_000 ? quick + 1 : 0;
    if (!stopping && exitCode !== 75) await new Promise(r => setTimeout(r, Math.min(300_000, 1000 * 2 ** quick)));
    continue;
  }
  let seat = readSeat(seatFile, name);
  let session = seat.session;
  if (initial && args.includes("--resume") && flag("resume") !== session) throw new Error("--resume disagrees with seat session");
  if (previousSession && previousSession !== session) throw new Error("Seat session changed; refusing to replace conversation");
  // On runner restart the file is the authority for the session and previous profile, even after SIGKILL.
  let saved: any;
  try { saved = JSON.parse(readFileSync(hostFile, "utf8")); } catch (e: any) { if (seat.workspaceId && e.code !== 'ENOENT') throw e; }
  if (seat.workspaceId) {
    if (!process.env.AB_WORKSPACE_RECEIPT || !args.includes('--harness') || flag('harness') !== 'claude' || !args.includes('--model')) throw new Error('Owned Claude service requires receipt, harness and model');
    const receipt = guardWorkspace(process.cwd());
    if (receipt?.workspaceId !== seat.workspaceId || receipt.input.harness !== 'claude' || receipt.input.model !== flag('model')) throw new Error('Service receipt ownership changed');
    seat = reconcileSeat(seat, saved, { workspaceId: receipt.workspaceId, name, cwd: process.cwd(), label: process.env.AB_SERVICE_LABEL ?? '', model: flag('model') }, pid => {
      try { process.kill(pid, 0); return true; } catch (e: any) { if (e.code !== 'ESRCH') throw e; return false; }
    });
    session = seat.session;
    saveHost(seatFile, seat);
  }
  guardWorkspace(process.cwd(),name,session ?? undefined);
  const target = configDir(seat.login_launcher);
  const source = previousConfig ?? saved?.configDir;
  if (saved?.session && saved.session !== session) throw new Error("Host session disagrees with seat");
  if (initial && saved?.pid) {
    // Refuse a second service instance rather than killing an unknown process.
    try { process.kill(saved.pid, 0); throw new Error("Service host is already alive"); } catch (e: any) { if (e.code !== "ESRCH") throw e; }
  }
  if (session && source && source !== target) moveSession(session, source, target);
  if (session && !source) {
    // First install may resume a transcript held by another supported login.
    const roots = ["claude", "claude-siso", "claude-siso-3"].map(l => configDir(l));
    if (!sessionFiles(session, target).length) {
      for (const root of roots.filter(r => r !== target)) {
        try { moveSession(session, root, target); break; } catch (e: any) { if (e.message !== "Session transcript missing in source login") throw e; }
      }
    }
  }
  const env = { ...process.env, CLAUDE_CONFIG_DIR: target, AB_SERVICE_NAME: name, HERDR_ENV: "0", AB_RUNNER_PID: String(process.pid), AB_HOST_PROCESS_GROUP: "1" };
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES"]) delete (env as Record<string, string | undefined>)[key];
  const childArgs = args.filter((_, i) => !['--resume', '--harness'].includes(args[i]) && !['--resume', '--harness'].includes(args[i - 1]));
  restoreSettings(childArgs, saved);
  if (!session) {
    // Record before spawning: a crash in the identity handoff must not start a second fresh chat.
    saveHost(seatFile, { ...seat, startAttempted: true });
    const prompt = guardWorkspace(process.cwd())?.input.prompt;
    if (prompt?.trim()) childArgs.push('--prompt', prompt);
  }
  const began = Date.now();
  child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", process.env.AB_SERVICE_HOST_ENTRY ?? path.join(import.meta.dirname, "host.ts"), ...childArgs, ...(session ? ["--resume", session] : [])], { cwd: process.cwd(), env, detached: true, stdio: ["ignore", "inherit", "inherit"] });
  firstLaunch = false;
  previousConfig = target; previousSession = session ?? undefined; initial = false;
  let switching = false;
  const timer = setInterval(() => {
    try {
      const next = readSeat(seatFile, name);
      if (next.session !== session) { console.error("Seat session changed; stopping service"); stop(); }
      else if (!switching && configDir(next.login_launcher) !== target) { switching = true; child?.kill("SIGTERM"); }
    } catch { console.error("Seat unreadable; keeping current host"); }
  }, 1000);
  child.once('exit', () => clearInterval(timer));
  const exitCode = await childExited(child);
  clearInterval(timer);
  quick = Date.now() - began < 60_000 ? quick + 1 : 0;
  if (!stopping && exitCode !== 75) await new Promise(r => setTimeout(r, seat.workspaceId ? Math.min(300_000, 1000 * 2 ** quick) : 1000));
}

function restoreSettings(childArgs: string[], saved: any) {
  if ((saved?.harness === "codex") !== codex) return;
  if (typeof saved?.keepAwake === 'boolean' && !(firstLaunch && args.includes('--keep-awake'))) {
    const at = childArgs.indexOf('--keep-awake');
    if (saved.keepAwake && at < 0) childArgs.push('--keep-awake');
    else if (!saved.keepAwake && at >= 0) childArgs.splice(at, 1);
  }
  for (const key of ["model", "effort"]) {
    if (typeof saved?.[key] !== "string" || !saved[key]) continue;
    const i = childArgs.indexOf(`--${key}`);
    if (i >= 0) childArgs[i + 1] = saved[key]; else childArgs.push(`--${key}`, saved[key]);
  }
}
