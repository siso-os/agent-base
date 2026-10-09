/** Read-only local allocation preflight. Provider enforcement remains authoritative at launch. */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TaskActionsOptions } from './task-actions.ts';
import { codexQuotaEvidence, validQuotaTarget, type QuotaTarget, type QuotaEvidence } from './quota-provenance.ts';
import { createCodexQuotaSource } from './codex-quota-source.ts';

const exec = promisify(execFile);
const GIB = 1024 ** 3;
type Context = Pick<Parameters<TaskActionsOptions['admit']>[0], 'repo' | 'model'>;
type Hardware = {
  at: number; pressure: string; held: boolean; availableBytes: number;
  diskFreeBytes: number; diskFloorBytes: number; rssBytes: number;
  plannedBytes: number; reserveBytes: number; budgetBytes: number;
};
type Options = {
  /** The existing fleet policy is the hardware default. Tests may supply synthetic measurements. */
  hardware?: (context: Context) => Promise<unknown>;
  /** Trusted launch-owner binding, never the quota response's account or a browser-supplied identity. */
  quotaTarget?: (context: Context) => QuotaTarget | null;
  /** Read from that exact existing authenticated transport; no daemon or provider turn is started here. */
  quota?: (target: QuotaTarget, signal: AbortSignal) => Promise<unknown>;
  quotaTimeoutMs?: number;
  now?: () => number;
};
type Admission = { ok: boolean; reason?: string; quota?: QuotaEvidence };

// Load definitions without running fleet.main, scheduler, locks, writes, launches or enforcement.
// Reuse the current reserve/budget/sample policy; intentionally do not use fleet's --max count.
const HARDWARE_PROBE = String.raw`
import json, math, os, re, runpy, shutil, subprocess, sys, time
from pathlib import Path
if sys.platform != 'darwin':
    raise RuntimeError('Current machine pressure probe unavailable')
f = runpy.run_path(sys.argv[1], run_name='agent_base_admission_readonly')
state = f['STATE']
fleets = []
for p in sorted(state.glob('*/manifest.json')):
    if p.stat().st_size > 4 * 1024 * 1024:
        raise RuntimeError('Fleet manifest exceeds read bound')
    m = json.loads(p.read_text())
    if not isinstance(m, dict) or not isinstance(m.get('jobs'), list):
        raise RuntimeError('Invalid fleet measurement source')
    fleets.append(m)
    if len(fleets) > 1000:
        raise RuntimeError('Fleet inventory exceeds read bound')
rows = f['ps']()
if not rows:
    raise RuntimeError('Missing process measurements')
rss = f['sample'](fleets, rows)
pressure, free = f['pressure']()
match = re.search(r'free percentage:\s*(\d+(?:\.\d+)?)%', free)
if not match or not 0 <= float(match[1]) <= 100:
    raise RuntimeError('Missing available memory measurement')
total = int(subprocess.check_output(['sysctl', '-n', 'hw.memsize'], text=True, timeout=5))
cap = f['budget'](fleets)
hold = Path(os.environ.get('HEAVY_DIR', str(Path.home() / '.cache/siso-heavy'))) / 'hold'
held = False
try:
    until = float(hold.read_text().split('\t', 1)[0])
    if not math.isfinite(until):
        raise RuntimeError('Invalid machine hold')
    held = until > time.time()
except FileNotFoundError:
    pass
print(json.dumps(dict(at=time.time()*1000, pressure=pressure, held=held,
    availableBytes=total*float(match[1])/100,
    diskFreeBytes=min(shutil.disk_usage(str(Path.home())).free, shutil.disk_usage(sys.argv[2]).free),
    diskFloorBytes=f['DISK_FLOOR_GB']*f['GIB'], rssBytes=rss,
    plannedBytes=f['admission_rss'](fleets, cap), reserveBytes=f['reserve'](fleets, cap), budgetBytes=cap)))
`;

async function hardware(context: Context): Promise<unknown> {
  const fleet = path.join(homedir(), 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/fleet');
  const { stdout } = await exec('python3', ['-c', HARDWARE_PROBE, fleet, context.repo], {
    timeout: 12_000, maxBuffer: 16_384,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PATH: `${process.env.PATH ?? ''}:/usr/sbin:/usr/bin:/bin:/opt/homebrew/bin` },
  });
  return JSON.parse(stdout);
}

/** Supply quotaTarget/quota from the launch owner before admission can succeed. Missing provenance fails closed. */
export function createResourceAdmission(options: Options = {}): (context: Context) => Promise<Admission> {
  const deny = (reason: string, quota?: QuotaEvidence): Admission => ({ ok: false, reason, ...(quota ? { quota } : {}) });
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const fresh = (at: unknown, now: number, age: number) => finite(at) && at <= now && now - at <= age;
  return async context => {
    // This local Codex policy must not silently authorize a future provider/model route.
    if (!/^gpt-6(?:[.-][a-z0-9]+)*$/.test(context.model)) return deny('No current API admission policy for this model');
    try {
      const target = options.quotaTarget?.(context);
      if (!validQuotaTarget(target) || target.model !== context.model || !options.quota) return deny('Current Codex quota host/account binding is unavailable for this launch');
      const binding = { ...target }, controller = new AbortController();
      const timeoutMs = options.quotaTimeoutMs ?? 5000;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000) return deny('Current Codex quota read deadline is invalid');
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Quota unavailable')); }, timeoutMs); });
      const read = Promise.race([Promise.resolve().then(() => options.quota!(binding, controller.signal)), timeout]).finally(() => clearTimeout(timer));
      const [raw, reading] = await Promise.all([(options.hardware ?? hardware)(context), read]);
      const current = options.quotaTarget?.(context);
      if (!validQuotaTarget(current) || ['hostId', 'accountId', 'model', 'limitId'].some(key => current[key as keyof QuotaTarget] !== binding[key as keyof QuotaTarget])) return deny('Current Codex quota target changed during admission');
      const now = (options.now ?? Date.now)();
      const h = raw as Hardware;
      if (!h || !fresh(h.at, now, 15_000) || typeof h.held !== 'boolean' ||
          !['availableBytes', 'diskFreeBytes', 'diskFloorBytes', 'rssBytes', 'plannedBytes', 'reserveBytes', 'budgetBytes'].every(k => finite(h[k as keyof Hardware]) && Number(h[k as keyof Hardware]) >= 0) ||
          h.budgetBytes <= 0 || h.reserveBytes <= 0 || h.diskFloorBytes <= 0) return deny('Current hardware measurements are unavailable or invalid');
      if (h.held) return deny('A current machine hold prevents new launches');
      if (h.pressure !== 'normal') return deny('Current memory pressure does not allow a launch');
      if (h.diskFreeBytes < h.diskFloorBytes) return deny('Current free disk is below the fleet admission floor');
      if (h.availableBytes < h.reserveBytes || h.rssBytes > h.budgetBytes + .5 * GIB || h.plannedBytes + h.reserveBytes > h.budgetBytes) return deny('Current measured memory has no room for another worker');
      const evidence = codexQuotaEvidence(reading, binding, now);
      if (evidence.ok === false) return deny(evidence.reason);
      const quota = evidence.quota;
      if (quota.ordinaryUsageAllowed !== true) return deny('Current Codex ordinary usage permission is unavailable or denied', quota);
      if (quota.spendControlReached !== false || quota.rateLimitReachedType !== null) return deny('Current Codex spend control is unavailable or reached', quota);
      for (const window of quota.windows) {
        if (window.resetsAt <= now) return deny('Current Codex API limit measurements are expired', quota);
        if (window.usedPercent >= 100) return deny('Current Codex API allowance is exhausted', quota);
      }
      if (quota.individualLimit && (quota.individualLimit.resetsAt <= now || quota.individualLimit.remainingPercent <= 0)) return deny('Current Codex individual allowance is exhausted or expired', quota);
      return { ok: true, quota };
    } catch { return deny('Current resource admission measurements are unavailable'); }
  };
}

/** Production default is backed by the authenticated local launch profile, not missing callbacks. */
export const currentResourceAdmission = async (context: Context) => {
  const source = createCodexQuotaSource(context);
  const admission = await createResourceAdmission(source)(context);
  if (!admission.ok) return admission;
  try { return { ...admission, launchEnvironment: source.launchEnvironment() }; }
  catch { return { ok: false, reason: 'Current Codex launch profile changed after admission' }; }
};
