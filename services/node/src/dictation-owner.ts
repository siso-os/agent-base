/** Durable, transactional ownership of the macOS dictation hotkey. Never changes the default owner at startup. */
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.env.AB_DICTATION_DIR || path.join(homedir(), ".local/state/agent-base/dictation");
const file = path.join(root, "owner.json");
const launchctl = process.env.AB_LAUNCHCTL || "/bin/launchctl";
const domain = `gui/${process.getuid?.() ?? 501}`;
export type DictationOwner = "siso-voice" | "agent-base";
type Job = { label: string; plist?: string; argv?: string[]; pid?: number };
type State = { owner: DictationOwner; jobs: Job[]; transition?: boolean; bar?: boolean };
let state: State = { owner: "siso-voice", jobs: [] };
try {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  if (["siso-voice", "agent-base"].includes(saved.owner) && Array.isArray(saved.jobs)) state = saved;
} catch { /* First launch: SISO Voice keeps its hotkey. */ }
let busy = false;
/**
 * The helper's word on itself, with each heartbeat. Since 9 Oct it also says whether its hotkey tap is live, the mic's
 * permission ("authorized", "denied", ...), the input device by name, and the last thing its self-check fixed or found.
 */
export let nativeState: { registered: boolean; permission: boolean; error: string; updatedAt: number; tap?: boolean; mic?: string; device?: string; issue?: string } = { registered: false, permission: false, error: "", updatedAt: 0 };
export function updateNative(value: { registered: boolean; permission?: boolean; error?: string; tap?: boolean; mic?: string; device?: string; issue?: string }) {
  const short = (v?: string) => (v ? v.slice(0, 250) : undefined);
  nativeState = { registered: value.registered, permission: value.permission === true, error: (value.error || "").slice(0, 250), updatedAt: Date.now(), tap: value.tap, mic: short(value.mic), device: short(value.device), issue: short(value.issue) };
}
export const dictationOwner = () => state.owner;
/** The floating voice bar (t-0500): on unless he hid it. */
export const barShown = () => state.bar !== false;
export function setBar(on: boolean) { state.bar = on; save(); }
/*
 * The helper waits on `rev` instead of polling: GET /api/dictation/status?rev=N is held until the owner or the bar
 * changes (every save) or 10 s pass, so an idle desktop costs one request per 10 s.
 */
export let rev = 0;
const waiters = new Set<() => void>();
export function waitForChange(since: number, ms = 10_000) {
  if (since !== rev) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    waiters.add(done);
  });
}
/** The watch stands still only while the hotkey is moving between owners; otherwise it watches whichever owner holds it. */
export const voiceWatchPaused = () => busy || state.transition === true;
export const ownershipBusy = () => busy || state.transition === true;
function save() {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  rev += 1;
  for (const wake of [...waiters]) wake();
}
function log(from: string, to: string, outcome: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  appendFileSync(path.join(root, "ownership.jsonl"), JSON.stringify({ at: new Date().toISOString(), from, to, outcome }) + "\n", { mode: 0o600 });
}
async function ctl(...args: string[]) {
  try { return (await run(launchctl, args, { timeout: 8000, maxBuffer: 512 * 1024 })).stdout; }
  catch { throw new Error(`launchd ${args[0]} failed; ownership was not changed`); }
}
// The hotkey owners only: com.siso.voice-sync drains text to JARVIS and owns no key, so a switch never stops it.
const OWNER = /^com\.siso\.voice(\.[\w-]+)?$/;
async function discover(): Promise<Job[]> {
  const dirs = process.env.AB_VOICE_LAUNCH_AGENTS ? [process.env.AB_VOICE_LAUNCH_AGENTS] : [path.join(homedir(), "Library/LaunchAgents"), "/Library/LaunchAgents"];
  const plists = dirs.flatMap((dir) => {
    try { return readdirSync(dir).filter((f) => /^com\.siso\.voice.*\.plist$/.test(f)).map((f) => path.join(dir, f)); }
    catch { return []; }
  });
  // Read configuration only, never SISO Voice's history, recordings, or credential record.
  const jobs: Job[] = [];
  for (const plist of plists) {
    const { stdout } = await run("python3", ["-c", "import plistlib,sys; print(plistlib.load(open(sys.argv[1],'rb')).get('Label',''))", plist], { timeout: 3000 });
    const label = stdout.trim();
    if (!OWNER.test(label)) continue;
    try {
      const info = await ctl("print", `${domain}/${label}`);
      const pid = Number(/^\s*pid = (\d+)/m.exec(info)?.[1]);
      jobs.push({ label, plist, ...(pid > 0 ? { pid } : {}) });
    } catch { /* Already unloaded. */ }
  }
  const loaded = await ctl("list");
  const labels = loaded.split("\n").map((line) => line.trim().split(/\s+/).at(-1) || "").filter((label) => OWNER.test(label));
  for (const label of labels.filter((l) => !jobs.some((j) => j.label === l))) {
    // SISO Internal starts SISO Voice with `launchctl submit` (no plist): its program and arguments are what restores it.
    const info = await ctl("print", `${domain}/${label}`);
    const program = /^\s*program = (.+)$/m.exec(info)?.[1]?.trim();
    const args = /^\s*arguments = \{\n([\s\S]*?)\n\s*\}/m.exec(info)?.[1].split("\n").map((a) => a.trim()).filter(Boolean);
    if (!/\btype = Submitted\b/.test(info) || !program) throw new Error("A SISO Voice job has no restorable plist; takeover refused");
    const pid = Number(/^\s*pid = (\d+)/m.exec(info)?.[1]);
    jobs.push({ label, argv: args?.length ? args : [program], ...(pid > 0 ? { pid } : {}) });
  }
  return jobs;
}
async function restore() {
  for (const job of state.jobs) {
    try { await ctl("print", `${domain}/${job.label}`); continue; } catch { /* Not loaded: put it back. */ }
    if (job.argv?.length) {
      if (!existsSync(job.argv[0])) throw new Error("SISO Voice's app is gone (retired); recovery is required");
      await ctl("submit", "-l", job.label, "--", ...job.argv);
    } else {
      if (!job.plist || !existsSync(job.plist)) throw new Error("A SISO Voice launchd plist is missing; recovery is required");
      await ctl("bootstrap", domain, job.plist);
    }
  }
}
async function nativeAck(registered: boolean, since: number) {
  const deadline = Date.now() + (Number(process.env.AB_DICTATION_ACK_MS) || 12000);
  while (Date.now() < deadline) {
    if (nativeState.updatedAt >= since && nativeState.registered === registered) return;
    if (registered && nativeState.updatedAt >= since && nativeState.error) throw new Error(nativeState.error);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The desktop dictation hotkey did not acknowledge the switch");
}
async function waitForExit(pid?: number) {
  if (!pid) return;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw new Error("Could not verify SISO Voice stopped"); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("SISO Voice has not stopped; takeover refused");
}
export async function switchOwner(next: DictationOwner, drain: () => Promise<unknown> = async () => {}) {
  if (busy || state.transition) throw new Error("A dictation ownership switch is already in progress");
  if (next === state.owner) return;
  if (process.platform !== "darwin" && !process.env.AB_LAUNCHCTL) throw new Error("Global dictation requires macOS");
  if (next === "agent-base" && Date.now() - nativeState.updatedAt > 25000) throw new Error("Open the updated Agent Base desktop app before switching");
  busy = true;
  const previous = state.owner;
  let exposed = previous === "agent-base";
  try {
    await drain();
    if (next === "agent-base") {
      state.jobs = await discover();
      state.transition = true; save();
      for (const job of state.jobs) await ctl("bootout", `${domain}/${job.label}`);
      for (const job of state.jobs) await waitForExit(job.pid);
      // Only expose ownership after every old hotkey owner has exited.
      exposed = true; state.owner = next; save();
      await nativeAck(true, Date.now());
    } else {
      state.transition = true; state.owner = next; save();
      await nativeAck(false, Date.now());
      await restore();
    }
    state.transition = false; save(); log(previous, next, "complete");
  } catch (error) {
    // Never reload SISO Voice until the new hotkey has released, even on a failed takeover.
    const since = Date.now(); state.owner = "siso-voice"; save();
    try {
      if (exposed) await nativeAck(false, since);
      await restore(); state.transition = false; save();
      log(previous, next, "rolled-back");
    } catch { log(previous, next, "recovery-required"); }
    throw error;
  } finally { busy = false; }
}
/** An interrupted switch is recovered after the helper has started disabled. */
export async function recoverOwnership() {
  if (!state.transition) return;
  busy = true; state.owner = "siso-voice"; save();
  try { await nativeAck(false, Date.now()); await restore(); state.transition = false; save(); log("interrupted", "siso-voice", "recovered"); }
  catch { log("interrupted", "siso-voice", "recovery-required"); }
  finally { busy = false; }
}
