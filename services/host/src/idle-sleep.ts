/** Opt-in, event-driven host sleep. No timer scans other seats. */
import { appendFileSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export type IdleState = { state: string; queue: number; questions: number; approvals: number; children: number; keepAwake: boolean; idleSince: number | null; now: number; minutes: number };
export function shouldSleep(s: IdleState): boolean {
  return s.state === 'idle' && s.queue === 0 && s.questions === 0 && s.approvals === 0 && s.children === 0 && !s.keepAwake
    && s.idleSince !== null && Number.isFinite(s.minutes) && s.minutes > 0 && s.now - s.idleSince >= s.minutes * 60_000;
}
export function alive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 1) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}
export function readSleepHost(file: string): any {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Invalid host descriptor');
  const host = JSON.parse(readFileSync(file, 'utf8'));
  if (!host || typeof host !== 'object' || Array.isArray(host)) throw Error('Invalid host descriptor');
  return host;
}
/** Signal only a positively identified runner, never an arbitrary reused PID. */
export function signalRunner(host: any): void {
  if (!alive(host.runnerPid) || typeof host.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(host.name)) throw Error(`Could not wake: runner not responding (pid ${host.runnerPid ?? 'unknown'})`);
  const command = execFileSync('/bin/ps', ['-p', String(host.runnerPid), '-o', 'command='], { encoding: 'utf8', timeout: 2000 });
  const words = command.trim().split(/\s+/), i = words.indexOf('--name');
  if (!words.some(w => w.endsWith('/service-runner.ts')) || i < 0 || words[i + 1] !== host.name) throw Error('Could not wake: runner identity changed');
  process.kill(host.runnerPid, 'SIGUSR1');
}
/** Bounded on-demand wait; opening/reading a sleeping chat never calls this. */
export async function wakeRunner(file: string, timeoutMs = 15_000): Promise<any> {
  const original = readSleepHost(file);
  if (original.state !== 'asleep' && alive(original.pid)) return original;
  signalRunner(original);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const host = readSleepHost(file);
    if (host.name !== original.name || host.session !== original.session || host.runnerPid !== original.runnerPid) throw Error('Could not wake: host identity changed');
    if (host.state !== 'asleep' && alive(host.pid) && host.port > 0) return host;
    if (!alive(original.runnerPid)) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error(`Could not wake: runner not responding (pid ${original.runnerPid})`);
}

export function createIdleSleep(options: {
  name: string; file: string; keepAwake: boolean;
  busy: () => Pick<IdleState, 'state' | 'queue' | 'questions' | 'approvals' | 'children'>;
  sleep: (fields: Record<string, unknown>) => void;
}) {
  // Rollout gate: absent/zero is disabled. Direct hosts cannot sleep without a supervising runner.
  const runnerPid = Number(process.env.AB_RUNNER_PID);
  const minutes = runnerPid === process.ppid && process.env.AB_HOST_PROCESS_GROUP === '1' ? Number(process.env.AB_IDLE_SLEEP_MIN ?? 0) : 0;
  let idleSince: number | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let keepAwake = options.keepAwake, stopped = false;
  function cancel() { if (timer) clearTimeout(timer); timer = undefined; }
  function changed(answered = false) {
    cancel();
    if (answered) idleSince = Date.now();
    if (stopped || !Number.isFinite(minutes) || minutes <= 0 || keepAwake || idleSince === null) return;
    const state = { ...options.busy(), keepAwake, idleSince, now: Date.now(), minutes };
    // Check blockers now, but use the real deadline for the final check.
    if (!shouldSleep({ ...state, now: idleSince + minutes * 60_000 })) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!shouldSleep({ ...options.busy(), keepAwake, idleSince, now: Date.now(), minutes })) return;
      let rssAtSleep: number | undefined;
      try {
        const rows = execFileSync('/bin/ps', ['-axo', 'pgid=,rss='], { encoding: 'utf8', timeout: 2000 });
        rssAtSleep = rows.trim().split('\n').reduce((sum, line) => { const [group, rss] = line.trim().split(/\s+/).map(Number); return sum + (group === process.pid ? rss : 0); }, 0) / 1024;
      } catch { /* Memory measurement is optional; never invent it. */ }
      const asleepAt = Date.now();
      options.sleep({ state: 'asleep', asleepAt, runnerPid, idleSince, keepAwake, rssAtSleep });
    }, Math.max(1, idleSince + minutes * 60_000 - Date.now()));
    timer.unref();
  }
  return {
    changed,
    fields: () => ({ ...(runnerPid === process.ppid ? { runnerPid } : {}), keepAwake, idleSince, idleSleepMin: Number.isFinite(minutes) ? minutes : 0 }),
    keepAwake(value: boolean) { keepAwake = value; changed(); },
    stop() { stopped = true; cancel(); },
    record(fields: Record<string, unknown>) {
      // Called only after the host's atomic asleep descriptor is durable.
      try { appendFileSync(path.join(path.dirname(options.file), '..', 'sleep.jsonl'), JSON.stringify({ name: options.name, at: fields.asleepAt, idleMin: minutes, rssMB: fields.rssAtSleep }) + '\n', { mode: 0o600 }); } catch { /* Descriptor remains the authority. */ }
    },
  };
}
