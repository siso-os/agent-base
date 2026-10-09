import { watch, lstatSync, readdirSync, readFileSync, type FSWatcher } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { readServiceHosts } from './service-hosts.ts';

export type MiniJob = { status: string; peakRss: number | null; started: string | null; ended: string | null };
export type OwnerLock = { owner: string; parent: string; repo: string; branch: string; files: string[]; mode: string };
export type HostedRuntime = {
  availability: 'online' | 'offline' | 'restarting' | 'unknown';
  activity: 'idle' | 'working' | 'needs' | 'failed' | 'unknown';
  model: string | null; observedAt: number | null; metadataUpdatedAt: number | null;
};
const unknownRuntime = (observedAt: number | null): HostedRuntime => ({ availability: 'unknown', activity: 'unknown', model: null, observedAt, metadataUpdatedAt: null });
export type Owner = {
  name: string; workspace: string; title: string; subtitle: string; status: string;
  started: string | null; updated: string | null; page: string | null; summary: string;
  findings: { title: string; impact: string; evidence: string; fix: string; effort: string }[];
  subagents: { name: string; where: string; title: string; status: string }[];
  next: string; asks: string[]; pick: string | null; readError?: boolean;
  parent: string; model: string; machine: string; fleet: string; job: string; branch: string; report: string; locks: string[];
  locked: OwnerLock[]; rules: string[]; runtime?: MiniJob; hostedRuntime?: HostedRuntime;
};
export type OwnersSnapshot = { owners: Owner[]; warnings: string[]; error: string | null; hosted?: { at: number | null; error: string | null }; mini?: { at: number | null; error: string | null }; workspaces?: { id: string; name: string; color: string }[] };
const text = (v: unknown, max = 8000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 200) : [];
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
export const webUrl = (v: unknown) => { try { const u = new URL(text(v)); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
export function parseOwner(value: unknown, filename: string): Owner {
  const d = object(value);
  const name = text(d.name, 120);
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/.test(name) || name.replaceAll('/', '--') !== filename.replace(/\.json$/, '') || !text(d.title)) throw Error('Owner name/title missing or mismatched');
  return { name, workspace: text(d.workspace, 80), title: text(d.title, 240), subtitle: text(d.subtitle, 1000),
    status: ['researching', 'building', 'synthesising', 'waiting-on-shaan', 'ready', 'blocked', 'done'].includes(text(d.status)) ? text(d.status) : 'unreported',
    started: date(d.started), updated: date(d.updated), page: webUrl(d.page), summary: text(d.summary),
    findings: list(d.findings).map(object).filter(f => text(f.title)).map(f => ({ title: text(f.title, 500), impact: ['big','medium','small'].includes(text(f.impact)) ? text(f.impact) : 'unreported', evidence: text(f.evidence), fix: text(f.fix), effort: text(f.effort, 120) })).sort((a,b) => ['big','medium','small','unreported'].indexOf(a.impact) - ['big','medium','small','unreported'].indexOf(b.impact)),
    subagents: list(d.subagents).map(object).filter(s => text(s.name)).map(s => ({ name: text(s.name, 120), where: text(s.where, 120), title: text(s.title, 500), status: text(s.status, 120) || 'unreported' })),
    parent: text(d.parent,120), model: text(d.model,120), machine: text(d.machine,80), fleet: text(d.fleet,120), job: text(d.job,120), branch: text(d.branch,500), report: text(d.report), locks: list(d.locks).map(x => text(x,1000)).filter(Boolean), locked: [], rules: [],
    next: text(d.next), asks: list(d.asks).map(x => text(x)).filter(Boolean), pick: null };
}
// Fleet's local timestamps have no offset. Infer the Mini offset from its exact start epoch.
function miniDate(value: unknown, started: unknown, epoch: number) {
  const raw = date(value);
  if (!raw || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) || !Number.isFinite(epoch)) return raw;
  const start = date(started);
  if (!start || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(start)) return raw;
  const offset = Math.round((Date.parse(`${start}Z`) - epoch) / 60_000) * 60_000;
  return new Date(Date.parse(`${raw}Z`) - offset).toISOString();
}
export function parseMini(value: unknown): Map<string, MiniJob> {
  if (!Array.isArray(value)) throw Error('Invalid fleet snapshot');
  const result = new Map<string, MiniJob>();
  for (const m of value.map(object)) for (const j of list(m.jobs).map(object)) {
    if (!text(m.name) || !text(j.id)) continue;
    const epoch = typeof j.started_ns === 'number' ? j.started_ns / 1e6 : NaN;
    result.set(`${text(m.name)}/${text(j.id)}`, {
      status: ['queued','running','done','failed','stopped','terminating','waiting'].includes(text(j.status)) ? text(j.status) : 'unreported',
      peakRss: typeof j.peak_rss_bytes === 'number' && Number.isFinite(j.peak_rss_bytes) && j.peak_rss_bytes >= 0 ? j.peak_rss_bytes : null,
      started: Number.isFinite(epoch) && Math.abs(epoch) < 8.64e15 ? new Date(epoch).toISOString() : date(j.started), ended: miniDate(j.ended, j.started, epoch),
    });
  }
  return result;
}
function fetchMini(): Promise<unknown> {
  return new Promise((resolve, reject) => execFile(path.join(homedir(), '.local/bin/fleet'), ['status', '--on', 'mini', '--json'], { timeout: 25_000, maxBuffer: 4_000_000 }, (err, stdout) => {
    if (err) return reject(Error('Mini fleet unavailable'));
    try { resolve(JSON.parse(stdout)); } catch { reject(Error('Invalid Mini fleet response')); }
  }));
}
/** Bounded reads; a partial rewrite retains the last good owner, visibly marked. Owner files use watch; Mini reads are cached and visible-view only. */
export function createOwners(root = process.env.AB_OWNERS_DIR ?? path.join(homedir(), '.local/state/a0/owners'), options: { fetchMini?: () => Promise<unknown>; readServiceHosts?: typeof readServiceHosts; now?: () => number; locksFile?: string } = {}) {
  const now = options.now ?? Date.now;
  const hostInterval = 15_000;
  let hosted = new Map<string, HostedRuntime>(), hostAt: number | null = null, hostError: string | null = null;
  let hostAttempt: number | null = null, hostFetch: Promise<void> | undefined, hostTimer: ReturnType<typeof setTimeout> | undefined;
  let miniJobs = new Map<string, MiniJob>(), miniAt: number | null = null, miniError: string | null = null;
  let attemptedAt: number | null = null, fetching = false, timer: ReturnType<typeof setTimeout> | undefined;
  const fleetListeners = new Set<(s: OwnersSnapshot) => void>();
  let lastLocks: { locks: OwnerLock[]; rules: string[] } = { locks: [], rules: [] };
  const locksFile = options.locksFile ?? process.env.AB_LOCKS_FILE ?? path.join(path.dirname(root), 'locks.json');
  const good = new Map<string, Owner>();
  let picks = new Map<string, string>();
  const listeners = new Set<(s: OwnersSnapshot) => void>();
  let locksWatcher: FSWatcher | undefined;
  let watcher: FSWatcher | undefined, watched = '', debounce: ReturnType<typeof setTimeout> | undefined;
  function read(file: string) {
    const full = path.join(root, file), stat = lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw Error('Not a bounded regular file');
    return JSON.parse(readFileSync(full, 'utf8'));
  }
  function snapshot(): OwnersSnapshot {
    const warnings: string[] = [];
    let files: string[];
    try { if (lstatSync(root).isSymbolicLink()) throw Error('Invalid root'); files = readdirSync(root); }
    catch (e) { return { owners: [], warnings, error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'Owner status folder could not be read.' }; }
    const names = files.filter(f => /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.json$/.test(f)).sort().slice(0, 200);
    for (const key of good.keys()) if (!names.includes(key)) good.delete(key);
    const owners: Owner[] = [];
    for (const file of names) {
      try { const o = parseOwner(read(file), file); good.set(file, o); owners.push({ ...o }); }
      catch { warnings.push(`${file}: status could not be read${good.has(file) ? '; showing last good update' : '; waiting for a valid update'}.`); const prev = good.get(file); if (prev) owners.push({ ...prev, readError: true }); }
    }
    if (files.includes('_a0.json')) {
      try { picks = new Map(list(object(read('_a0.json')).picks).map(object).filter(p => text(p.name)).map(p => [text(p.name,120), text(p.why,1000) || 'Recommended by Agent Zero'])); }
      catch { warnings.push("Agent Zero's picks could not be read; keeping the last recommendations."); }
    } else picks.clear();
    try {
      const stat = lstatSync(locksFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw Error('Invalid locks');
      const d = object(JSON.parse(readFileSync(locksFile, 'utf8')));
      lastLocks = { locks: list(d.locks).map(object).map(l => ({ owner: text(l.owner,120), parent: text(l.parent,120), repo: text(l.repo,500), branch: text(l.branch,500), files: list(l.files).map(x => text(x,1000)).filter(Boolean), mode: text(l.mode) })), rules: list(d.rules).map(x => text(x)).filter(Boolean) };
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('Locks could not be read; showing last good integration rules.'); else lastLocks = { locks: [], rules: [] }; }
    for (const o of owners) {
      // Exact owner identity only. Duplicate host names are deliberately unknown.
      o.hostedRuntime = hosted.get(o.name) ?? unknownRuntime(hostAt);
      o.pick = picks.get(o.name) ?? null;
      o.locked = lastLocks.locks.filter(l => l.owner === o.name || l.parent === o.name);
      const mentions = [o.name, o.fleet, ...o.locked.map(l => l.owner.split('/')[0])].filter(Boolean);
      o.rules = lastLocks.rules.filter(r => mentions.some(m => r.includes(m)));
      if (o.fleet && o.job && o.machine === 'mini') o.runtime = miniJobs.get(`${o.fleet}/${o.job}`);
    }
    owners.sort((a,b) => Number(b.pick !== null) - Number(a.pick !== null) || (Date.parse(b.updated ?? '') || 0) - (Date.parse(a.updated ?? '') || 0) || a.name.localeCompare(b.name));
    return { owners, warnings, error: null, hosted: { at: hostAt, error: hostError }, mini: { at: miniAt, error: miniError } };
  }
  function publish() { const s = snapshot(); for (const l of listeners) l(s); }
  function scheduleHosts() {
    clearTimeout(hostTimer);
    if (!listeners.size) return;
    hostTimer = setTimeout(() => void refreshHosts(), Math.max(1, hostInterval - (now() - (hostAttempt ?? now()))));
    hostTimer.unref();
  }
  function refreshHosts(): Promise<void> {
    if (hostFetch) return hostFetch;
    if (!listeners.size) return Promise.resolve();
    if (hostAttempt !== null && now() - hostAttempt < hostInterval) { scheduleHosts(); return Promise.resolve(); }
    hostAttempt = now();
    hostFetch = (async () => {
      try {
        const { hosts } = await (options.readServiceHosts ?? readServiceHosts)();
        const at = now(), next = new Map<string, HostedRuntime>();
        for (const host of hosts) {
          if (next.has(host.name)) { next.set(host.name, unknownRuntime(at)); continue; }
          // Never retain the host object or its routing credentials in this projection.
          next.set(host.name, {
            availability: host.state === 'live' ? 'online' : host.state === 'down' ? 'offline' : host.state === 'restarting' ? 'restarting' : 'unknown',
            activity: host.state === 'live' && ['idle','working','needs','failed'].includes(host.activity) ? host.activity : 'unknown',
            model: text(host.model, 120) || null, observedAt: at,
            metadataUpdatedAt: typeof host.updatedAt === 'number' && Number.isFinite(host.updatedAt) && host.updatedAt >= 0 && host.updatedAt <= 8.64e15 ? host.updatedAt : null,
          });
        }
        hosted = next; hostAt = at; hostError = null;
      } catch { hostError = 'Hosted runtime unavailable. Cached observations are stale; reported work is unchanged.'; }
      finally { hostFetch = undefined; if (listeners.size) publish(); scheduleHosts(); }
    })();
    return hostFetch;
  }
  function scheduleMini(delay?: number) {
    clearTimeout(timer);
    if (!fleetListeners.size) return;
    timer = setTimeout(() => void refreshMini(), delay ?? Math.max(1, 60_000 - (now() - (attemptedAt ?? now())))); timer.unref();
  }
  async function refreshMini() {
    if (!fleetListeners.size || fetching) return;
    if (attemptedAt !== null && now() - attemptedAt < 60_000) { scheduleMini(); return; }
    if (!snapshot().owners.some(o => o.machine === 'mini' && o.fleet && o.job)) { scheduleMini(60_000); return; }
    attemptedAt = now(); fetching = true;
    try { miniJobs = parseMini(await (options.fetchMini ?? fetchMini)()); miniAt = now(); miniError = null; }
    catch { miniError = 'Mini fleet unavailable. Cached job states may be out of date; owner reports are still shown.'; }
    finally { fetching = false; if (listeners.size) publish(); scheduleMini(); }
  }
  function arm() {
    if (!locksWatcher) try { locksWatcher = watch(path.dirname(locksFile), (_event, file) => { if (String(file) === path.basename(locksFile)) { clearTimeout(debounce); debounce = setTimeout(publish, 120); } }); locksWatcher.unref(); locksWatcher.on('error', () => { locksWatcher?.close(); locksWatcher = undefined; }); } catch {}
    let target = root;
    for (;;) { try { if (lstatSync(target).isDirectory()) break; } catch {} const parent = path.dirname(target); if (parent === target) return; target = parent; }
    if (watched === target && watcher) return;
    watcher?.close(); watched = target;
    try { watcher = watch(target, (_event, file) => { if (target !== root && file && String(file) !== path.relative(target, root).split(path.sep)[0]) return; clearTimeout(debounce); debounce = setTimeout(() => { arm(); publish(); void refreshMini(); }, 120); }); watcher.unref();
      watcher.on('error', () => { watcher?.close(); watcher = undefined; for (const l of listeners) l({ ...snapshot(), error: 'Live owner updates interrupted. Reopen Fleet to reconnect.' }); });
    } catch { watched = ''; }
  }
  return { snapshot, refreshMini, refreshHosts, subscribe(listener: (s: OwnersSnapshot) => void, mini = false) { listeners.add(listener); if (mini) fleetListeners.add(listener); arm(); listener(snapshot()); void refreshHosts(); if (mini) void refreshMini(); return () => { listeners.delete(listener); fleetListeners.delete(listener); if (!fleetListeners.size) clearTimeout(timer); if (!listeners.size) { clearTimeout(hostTimer); watcher?.close(); locksWatcher?.close(); locksWatcher = undefined; watcher = undefined; watched = ''; clearTimeout(debounce); } }; }, close() { clearTimeout(hostTimer); listeners.clear(); fleetListeners.clear(); watcher?.close(); locksWatcher?.close(); clearTimeout(timer); clearTimeout(debounce); } };
}
