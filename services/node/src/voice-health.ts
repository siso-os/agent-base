/**
 * Keep SISO Voice running (t-0271, Shaan 3 Oct 01:5x: "our agent base is always open. It should ... manage this voice
 * agent app. So it's always running"). On start and every 60 s the node asks launchd about SISO Voice's two services
 * (`launchctl print gui/$UID/<label>`); one that should be up and is not gets `launchctl kickstart`, at most once per
 * 5 minutes per label, and every kick is logged. SISO Voice's plists and code are never touched, and nothing it
 * recorded is read: "last dictation" is the newest write time of its history store's files.
 *
 *   GET /api/voice/status   {services: [{label, running, ok, lastKick, ...}], lastDictationAt}
 *
 * com.siso.voice.runtime is the app (KeepAlive): healthy means running. com.siso.voice-sync runs once an hour and
 * exits: healthy means loaded and its last run exited 0, so the node does not turn an hourly job into a 5-minute one;
 * it is kicked only when its last run failed, and then at most once per its own interval.
 *
 * A service launchd does not know at all (booted out, or never loaded since login) cannot be kickstarted: it is
 * bootstrapped from its own plist in ~/Library/LaunchAgents instead (read by launchd, never written). After a kick
 * that worked the node looks again a few seconds later, so the status (and the Voice dot) shows it back up at once
 * rather than a minute later.
 *
 *   POST /api/voice/restart   check now and restart what is down, outside the 5-minute gap (his presses at most
 *                             once per 20 s per label); answers with the status after a second look
 *
 * The watch runs in the node the desktop app starts (port 5401, macOS) and nowhere else, so a test node never kicks
 * Shaan's real services. AB_VOICE_WATCH=1 turns it on elsewhere, AB_VOICE_WATCH=0 off; AB_LAUNCHCTL is the launchctl a
 * test fakes; AB_LAUNCH_AGENTS the plists' folder; AB_VOICE_RECHECK_MS the look after a kick; AB_VOICE_DB (voice.ts)
 * is the history store.
 */
import { dictationOwner, nativeState, voiceWatchPaused } from "./dictation-owner.ts";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const VOICE_LABELS = ["com.siso.voice.runtime", "com.siso.voice-sync"];
/**
 * Since 8 Oct 21:18 (t-0539) the hotkey lives in Agent Base's own helper, its own launchd job; the old runtime has no job
 * any more. While Agent Base holds the hotkey the watch looks at that helper and the sync job (9 Oct: the status had
 * read `watching: false` and kicked the gone `com.siso.voice.runtime`).
 */
export const HELPER_LABEL = "com.siso.agent-base.voice";
export const AGENT_BASE_LABELS = [HELPER_LABEL, "com.siso.voice-sync"];
const labels = () => (dictationOwner() === "agent-base" ? AGENT_BASE_LABELS : VOICE_LABELS);
const DICTATION_DB = path.join(process.env.AB_DICTATION_DIR || path.join(homedir(), ".local/state/agent-base/dictation"), "history.sqlite");const LAUNCHCTL = process.env.AB_LAUNCHCTL || "launchctl";
const HISTORY_DB = process.env.AB_VOICE_DB || path.join(homedir(), "Library", "Application Support", "SISO Voice", "PipelineHistory.sqlite");
const EVERY_MS = Number(process.env.AB_VOICE_WATCH_MS) || 60_000;
const KICK_GAP_MS = 5 * 60_000;
const MANUAL_GAP_MS = 20_000;
const RECHECK_MS = Number(process.env.AB_VOICE_RECHECK_MS) || 4000;
const AGENTS_DIR = process.env.AB_LAUNCH_AGENTS || path.join(homedir(), "Library", "LaunchAgents");
const uid = () => (typeof process.getuid === "function" ? process.getuid() : 501);

export type ServiceStatus = {
  label: string;
  /** launchd knows it (it is bootstrapped). */
  loaded: boolean;
  running: boolean;
  /** Up as it should be: running for a KeepAlive service; for an interval job, its last run exited 0. */
  ok: boolean;
  kind: "keepalive" | "interval" | "unknown";
  pid: number | null;
  lastExit: string | null;
  /** When the node last kicked it (ISO), whether that kick worked, and how many times since the node started. */
  lastKick: string | null;
  lastKickOk: boolean | null;
  kicks: number;
  checkedAt: string;
};

/** What `launchctl print` says about one service; null when launchd does not know it. */
export function parsePrint(out: string): { running: boolean; pid: number | null; lastExit: string | null; kind: ServiceStatus["kind"]; intervalS: number | null } {
  const field = (name: string) => new RegExp(`^\\s*${name} = (.+)$`, "m").exec(out)?.[1]?.trim() ?? null;
  const state = field("state");
  const pid = Number(field("pid"));
  const interval = /run interval = (\d+) seconds/.exec(out);
  const props = field("properties") ?? "";
  const kind = interval ? "interval" : /keepalive/.test(props) || /^\s*keepalive = 1/m.test(out) ? "keepalive" : "unknown";
  return { running: state === "running", pid: Number.isFinite(pid) && pid > 0 ? pid : null, lastExit: field("last exit code"), kind, intervalS: interval ? Number(interval[1]) : null };
}

function launchctl(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(LAUNCHCTL, args, { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: `${stdout ?? ""}${stderr ?? ""}` });
    });
  });
}

const state = new Map<string, ServiceStatus>();
const kicked = new Map<string, { at: number; ok: boolean; n: number }>();
/** When he last pressed Restart, per label. */
const asked = new Map<string, number>();

/** One look at one service, and a kick when it should be up and is not (rate-limited; `manual` is his press). */
async function checkOne(label: string, manual = false): Promise<ServiceStatus> {
  const target = `gui/${uid()}/${label}`;
  const p = await launchctl(["print", target]);
  const loaded = p.code === 0;
  const info = loaded ? parsePrint(p.out) : { running: false, pid: null, lastExit: null, kind: "unknown" as const, intervalS: null };
  // An interval job between runs is fine; one whose last run failed (or that never ran) is not.
  const exitOk = info.lastExit === null || info.lastExit === "0" || /never exited/.test(info.lastExit);
  // The helper can be alive and deaf (stuck): running but no heartbeat for a minute, while this node has been up long
  // enough to have heard one, counts as down, and its kick restarts it (`kickstart -k`).
  const hung = label === HELPER_LABEL && info.running && process.uptime() > 90 && Date.now() - nativeState.updatedAt > 60_000;
  const ok = loaded && !hung && (info.running || (info.kind === "interval" && exitOk));
  const now = Date.now();
  const prev = kicked.get(label);
  const gap = info.kind === "interval" && info.intervalS ? Math.max(KICK_GAP_MS, info.intervalS * 1000) : KICK_GAP_MS;
  // His press is spaced from his last press only (the watch may have kicked a moment ago and failed to keep it up).
  const due = manual ? now - (asked.get(label) ?? 0) >= MANUAL_GAP_MS : !prev || now - prev.at >= gap;
  const plistPath = path.join(AGENTS_DIR, `${label}.plist`);
  // The helper outside the app's own machine (a lab node, a test) has no plist: there is nothing to start.
  const reachable = label !== HELPER_LABEL || loaded || existsSync(plistPath);
  if (!voiceWatchPaused() && !ok && due && reachable) {
    if (manual) asked.set(label, now);
    // Not loaded: kickstart cannot reach it, so launchd loads it from its own plist (which also starts a RunAtLoad one).
    const how = !loaded && existsSync(plistPath) ? "bootstrap" : "kickstart";
    const k = await launchctl(how === "bootstrap" ? ["bootstrap", `gui/${uid()}`, plistPath] : hung ? ["kickstart", "-k", target] : ["kickstart", target]);
    const n = (prev?.n ?? 0) + 1;
    kicked.set(label, { at: now, ok: k.code === 0, n });
    console.log(`voice watch: ${label} ${loaded ? (info.running ? (hung ? "running but silent for a minute" : "running") : `not running (last exit ${info.lastExit ?? "none"})`) : "not loaded"}; ${how} ${k.code === 0 ? "ok" : `failed (exit ${k.code}): ${k.out.trim().split("\n")[0].slice(0, 160)}`} · kick ${n}${manual ? " (asked for)" : ""}`);
    // Look again shortly, so a service that came back shows as up without waiting for the next round.
    if (k.code === 0) setTimeout(() => void checkVoiceServices(), RECHECK_MS).unref();
  }
  const kick = kicked.get(label);
  const s: ServiceStatus = {
    label,
    loaded,
    running: info.running,
    ok,
    kind: info.kind,
    pid: info.pid,
    lastExit: info.lastExit,
    lastKick: kick ? new Date(kick.at).toISOString() : null,
    lastKickOk: kick ? kick.ok : null,
    kicks: kick?.n ?? 0,
    checkedAt: new Date(now).toISOString(),
  };
  state.set(label, s);
  return s;
}

let inFlight: Promise<ServiceStatus[]> | null = null;
/** Checks every service once; overlapping calls share the one run. */
export function checkVoiceServices(): Promise<ServiceStatus[]> {
  if (voiceWatchPaused()) return inFlight ?? Promise.resolve([]);
  inFlight ??= Promise.all(labels().map((l) => checkOne(l))).finally(() => (inFlight = null));
  return inFlight;
}

/** POST /api/voice/restart: his press on "Restart" (a fresh look, and a kick for what is down, 20 s apart at most). */
export async function restartVoice() {
  // While the hotkey is moving between owners nothing is restarted; otherwise a press restarts the owner's own jobs.
  if (!watching() || voiceWatchPaused()) return { watching: false, services: [], lastDictationAt: lastDictationAt() };
  await inFlight?.catch(() => {});
  const watched = labels();
  const before = watched.map((l) => kicked.get(l)?.at);
  let services = await Promise.all(watched.map((l) => checkOne(l, true)));
  // Something was restarted: give it a moment and look again, so the answer (and his dot) says whether it came back.
  if (watched.some((l, i) => kicked.get(l)?.at !== before[i] && kicked.get(l)?.ok)) {
    await new Promise((r) => setTimeout(r, Math.min(RECHECK_MS, 3000)));
    services = await checkVoiceServices();
  }
  return { watching: true, services, lastDictationAt: lastDictationAt() };
}

/** The newest write to the history store (the WAL holds the latest until a checkpoint), as ISO; null when absent. */
export function lastDictationAt(): string | null {
  let ms = 0;
  const db = dictationOwner() === "agent-base" ? DICTATION_DB : HISTORY_DB;
  for (const f of [db, `${db}-wal`]) {
    try {
      ms = Math.max(ms, statSync(f).mtimeMs);
    } catch {
      /* absent */
    }
  }
  return ms ? new Date(ms).toISOString() : null;
}

export function watching() {
  const flag = process.env.AB_VOICE_WATCH;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.platform === "darwin" && Number(process.env.AB_PUBLIC_PORT ?? process.env.AB_PORT ?? 5401) === 5401;
}

/** GET /api/voice/status: the last check (a fresh one when none has run yet). */
export async function voiceStatus() {
  const on = watching() && !voiceWatchPaused();
  const watched = labels();
  const services = on ? (watched.every((l) => state.has(l)) ? watched.map((l) => state.get(l)!) : await checkVoiceServices()) : [];
  return { watching: on, services, lastDictationAt: lastDictationAt() };
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Starts the watch: a check now, then one every 60 s. */
export function startVoiceWatch() {
  if (timer || !watching()) return;
  void checkVoiceServices();
  timer = setInterval(() => void checkVoiceServices(), EVERY_MS);
  timer.unref();
}
