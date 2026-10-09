/** Read-only remote inventory with separate herdr, managed receipt and Codex process coverage. No polling, terminal attachment, input or session creation.
 * The integrating node must keep this behind its local access boundary. SSH authentication is
 * the existing herdr transport, not a multi-user/cloud authorization system.
 */
import { onMachine } from './servers-probe.ts';
import type http from 'node:http';

export type InventoryKind = 'herdr' | 'managed-hosts' | 'codex-processes';
export type RemoteTarget = { machineKey: string; alias: string; session: string; user?: string; source?: InventoryKind };
export type RemoteInventoryAgent = {
  id: string; machineKey: string; machineSession: string; machineUser?: string; name: string; harness: string;
  source?: InventoryKind; identity?: 'task-session' | 'process-only' | 'conflict'; runtimeId?: string; runtimeParentId?: string | null; reconciles?: string[];
  processState?: 'observed' | 'not-observed' | 'unknown'; taskSession?: string | null; reportedState?: string;
  state: string; parentId: string | null; observedAt: number; stale: boolean; readOnly: true;
};
export type RemoteInventorySource = {
  machineKey: string; session: string; machineUser?: string; source?: InventoryKind; coverage?: string; diagnostics?: Record<string, number>; state: 'fresh' | 'stale' | 'unavailable';
  attemptedAt: number; observedAt: number | null; error: string | null; agents: RemoteInventoryAgent[];
};
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const valid = (t: RemoteTarget) => !!t && typeof t.machineKey==='string' && PLAIN.test(t.machineKey) && typeof t.alias==='string' && PLAIN.test(t.alias) && typeof t.session==='string' && PLAIN.test(t.session) && (t.user===undefined || typeof t.user==='string' && USER.test(t.user)) && (t.source===undefined || ['herdr','managed-hosts','codex-processes'].includes(t.source));
const key = (t: RemoteTarget) => JSON.stringify([t.machineKey, t.alias, t.user??null, t.session, t.source??'herdr']);
const scope = (t: RemoteTarget) => JSON.stringify([t.machineKey, t.user??null, t.session]);
// Preserve IDs for legacy alias-user scopes. An explicitly selected user adds an identity dimension.
const id = (t: RemoteTarget, terminal: string) => `remote:${encodeURIComponent(JSON.stringify(t.user===undefined?[t.machineKey, t.session, terminal]:[t.machineKey, t.user, t.session, terminal]))}`;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);

/** Only estate-owned, explicitly session-configured remote machines. Never infer a session. */
export function remoteTargets(machines: unknown, catalog: unknown, localKey = 'laptop'): RemoteTarget[] {
  if (!obj(machines)) return [];
  const map = obj(machines.machines) ? machines.machines : machines;
  const sessions = obj(catalog) && obj(catalog.herdr) ? catalog.herdr : {};
  const result: RemoteTarget[] = [];
  for (const [machineKey, value] of Object.entries(map)) {
    if (!obj(value) || machineKey === localKey || /^(retired|deleted|unknown)/i.test(String(value.status ?? 'unknown'))) continue;
    const fleet = obj(value.fleet) ? value.fleet : {};
    if (fleet.client === true || typeof fleet.probe !== 'string' || fleet.probe === 'local') continue;
    const names = sessions[machineKey] ?? sessions[fleet.probe] ?? fleet.herdr;
    if (!Array.isArray(names)) continue;
    for (const entry of names) {
      const legacy=typeof entry==='string';
      if(!legacy&&(!obj(entry)||Object.keys(entry).some(k=>!['session','user'].includes(k))||typeof entry.user!=='string'))continue;
      const target:RemoteTarget = { machineKey, alias: fleet.probe, session:legacy?entry:entry.session as string, ...(!legacy?{user:entry.user as string}:{}) };
      if (valid(target)) result.push(target);
    }
  }
  return result;
}

export function parseRemoteAgents(raw: unknown, target: RemoteTarget, observedAt: number): RemoteInventoryAgent[] {
  if (!valid(target)) throw new Error('invalid target');
  const rows = obj(raw) && obj(raw.result) ? raw.result.agents : obj(raw) ? raw.agents : raw;
  if (!Array.isArray(rows) || rows.length > 2000) throw new Error('invalid inventory');
  const ids = new Set<string>();
  for (const row of rows) {
    if (!obj(row) || !text(row.terminal_id) || !text(row.name ?? row.terminal_title_stripped) || ids.has(row.terminal_id as string)) throw new Error('invalid identity');
    ids.add(row.terminal_id as string);
  }
  return rows.map((row) => ({
    id: id(target, row.terminal_id), machineKey: target.machineKey, machineSession: target.session,
    ...(target.user===undefined?{}:{machineUser:target.user}),
    name: row.name ?? row.terminal_title_stripped,
    harness: text(row.agent, 60) ? row.agent : 'unknown',
    state: text(row.agent_status, 60) ? row.agent_status : 'unknown',
    parentId: typeof row.parent_terminal_id === 'string' && row.parent_terminal_id !== row.terminal_id && ids.has(row.parent_terminal_id) ? id(target, row.parent_terminal_id) : null,
    observedAt, stale: false, readOnly: true,
  }));
}

/** Reuse the Servers authenticated SSH transport. A fixed list command never attaches or starts a session.
 * Requires the existing AB_SERVERS_PROBE opt-in as well as the inventory owner's opt-in.
 * Old local herdr releases reject `--remote ... agent list`, so execute the same read on the named machine.
 */
export async function readRemoteHerdr(target: RemoteTarget, read: typeof onMachine = onMachine): Promise<unknown> {
  if (!valid(target)) throw new Error('invalid target');
  const script = target.user===undefined ? `unset HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID HERDR_CONFIG_PATH
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
exec perl -e 'alarm 12; exec @ARGV' herdr --session '${target.session}' agent list
` : `exec perl -e 'alarm 12; exec @ARGV' /usr/bin/python3 - '${target.user}' '${target.session}' <<'AB_REMOTE_READ'
import os, pwd, sys
if sys.platform != 'linux': raise SystemExit(1)
account = pwd.getpwnam(sys.argv[1])
if account.pw_name != sys.argv[1] or not account.pw_dir.startswith('/'): raise SystemExit(1)
os.chdir(account.pw_dir)
os.execv('/usr/sbin/runuser', ['runuser', '-u', account.pw_name, '--', '/usr/bin/env', '-i', 'HOME=' + account.pw_dir, 'USER=' + account.pw_name, 'LOGNAME=' + account.pw_name, 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/perl', '-e', 'alarm 10; exec @ARGV', '/usr/local/bin/herdr', '--session', sys.argv[2], 'agent', 'list'])
AB_REMOTE_READ
`;
  try { return JSON.parse(await read(target.alias, script, 15_000, 1 << 20)); }
  catch { throw new Error('remote inventory unavailable'); }
}

const approvedCoverage = (t: RemoteTarget) =>
  t.machineKey === 'mini' && t.alias === 'mac-mini-herdr' && t.user === undefined ||
  t.machineKey === 'vps-siso' && t.alias === 'siso-vps' && t.user === 'siso';
const coverageDescription = (kind?: InventoryKind) => kind === 'managed-hosts'
  ? 'Default Agent Base hosts directory only; receipt state expires after 60 seconds; no chat logs or custom profiles'
  : kind === 'codex-processes' ? 'Selected account only; executable basename codex; process presence does not prove a task or model'
  : 'Configured herdr session only; independent jobs are outside this source';

/** No new machines/accounts are discovered: existing configured scopes authorize these fixed reads. */
export function remoteCoverageTargets(targets: RemoteTarget[]): RemoteTarget[] {
  const out = [...targets], seen = new Set<string>();
  for (const t of targets) {
    if (!valid(t) || !approvedCoverage(t) || t.source && t.source !== 'herdr') continue;
    const k = JSON.stringify([t.machineKey, t.alias, t.user ?? null]);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const source of ['managed-hosts', 'codex-processes'] as const) {
      out.push({ ...t, source, session: source === 'managed-hosts' ? 'ab-managed-hosts' : 'codex-processes' });
    }
  }
  return out;
}

/** Remote-side projection: no command lines, environment, profile trees or log contents leave the host.
 * ps reads comm (executable name), never args. Only one fixed receipt directory is inspected.
 * Account switch drops privileges before any filesystem or process read; signal alarm bounds remote work.
 */
export function remoteCoverageScript(target: RemoteTarget): string {
  if (!valid(target) || !approvedCoverage(target) || !['managed-hosts','codex-processes'].includes(target.source ?? '')) throw Error('invalid coverage target');
  return `exec /usr/bin/python3 - '${target.user ?? '-'}' '${target.source}' <<'AB_COVERAGE_READ'
import os, sys, pwd, stat, json, subprocess, signal, time, datetime, re, hashlib
signal.alarm(12)
account = pwd.getpwnam(sys.argv[1]) if sys.argv[1] != '-' else pwd.getpwuid(os.getuid())
if account.pw_uid != os.geteuid():
    if sys.platform != 'linux' or os.geteuid() != 0: raise SystemExit(1)
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
os.chdir(account.pw_dir)
os.environ.clear()
os.environ.update(HOME=account.pw_dir, PATH='/usr/bin:/bin', LC_ALL='C', TZ='UTC')
time.tzset()
kind = sys.argv[2]
def bounded_ps():
    p = subprocess.Popen(['/bin/ps', '-U', str(account.pw_uid), '-o', 'pid=,ppid=,lstart=,comm='], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        data = p.stdout.read(1048577)
        if len(data) > 1048576: raise ValueError('bound')
        if p.wait(timeout=3) != 0: raise ValueError('ps')
        return data.decode('utf8', 'strict')
    finally:
        if p.poll() is None: p.kill()
        p.wait()
procs = {}
for line in bounded_ps().splitlines():
    fields = line.split(None, 7)
    if len(fields) != 8: raise ValueError('process metadata')
    pid, ppid = int(fields[0]), int(fields[1])
    start = int(datetime.datetime.strptime(' '.join(fields[2:7]), '%a %b %d %H:%M:%S %Y').replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    procs[pid] = dict(pid=pid, ppid=ppid, start=start, executable=os.path.basename(fields[7]))
    if len(procs) > 8192: raise ValueError('process bound')
def runtime(p): return str(p['pid']) + ':' + str(p['start'])
codex = {pid:p for pid,p in procs.items() if p['executable'] == 'codex'}
if len(codex) > 512: raise ValueError('codex bound')
now = int(time.time()*1000)
diagnostics = dict(eligibleProcesses=len(codex), rejectedReceipts=0, scannedReceipts=0, conflictingIdentities=0)
rows = []
if kind == 'codex-processes':
    for pid,p in codex.items():
        parent = codex.get(p['ppid'])
        rows.append(dict(runtimeId=runtime(p), parentRuntimeId=runtime(parent) if parent else None))
else:
    directory = os.path.join(account.pw_dir, '.local/state/agent-base/hosts')
    # Reject symlinks in the fixed path, including parent components.
    cursor = account.pw_dir
    absent = False
    for part in ['.local','state','agent-base','hosts']:
        cursor = os.path.join(cursor, part)
        try: info = os.lstat(cursor)
        except FileNotFoundError: absent = True; break
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode): raise ValueError('directory')
    if absent:
        diagnostics['directoryAbsent'] = 1
    else:
        info = os.lstat(directory)
        if info.st_uid != account.pw_uid or info.st_mode & 0o022: raise ValueError('directory owner')
        with os.scandir(directory) as entries:
            names = []
            for index,entry in enumerate(entries):
                if index >= 2048 or len(names) >= 512: raise ValueError('receipt bound')
                if entry.name.endswith('.json'): names.append(entry.name)
        for name in sorted(names):
            diagnostics['scannedReceipts'] += 1
            try:
                fd = os.open(os.path.join(directory,name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    info = os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode) or info.st_uid != account.pw_uid or info.st_mode & 0o022 or info.st_size > 65536: raise ValueError('receipt file')
                    data = os.read(fd, 65537)
                    if len(data) > 65536: raise ValueError('receipt bytes')
                finally: os.close(fd)
                receipt = json.loads(data)
                if not isinstance(receipt, dict): raise ValueError('receipt')
                session = receipt.get('session')
                if not isinstance(session,str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}',session): raise ValueError('session')
                host = procs.get(receipt.get('pid'))
                started = receipt.get('startedAt')
                matched = host is not None and host['executable'] == 'node' and isinstance(started,(int,float)) and abs(host['start'] - started) <= 5000
                children = [p for p in codex.values() if matched and p['ppid'] == host['pid']]
                harness = receipt.get('harness')
                # Older Claude receipts do not identify the harness. Keep unknown rather than infer it.
                harness = harness if harness in ['codex','claude'] else 'unknown'
                updated = receipt.get('updatedAt')
                fresh = matched and isinstance(updated,(int,float)) and 0 <= now-updated < 60000
                state = receipt.get('state')
                state = state if state in ['idle','working','blocked','done','failed'] else 'unknown'
                parent = receipt.get('parentSession')
                parent = parent if isinstance(parent,str) and re.fullmatch('[A-Za-z0-9_-]{1,128}',parent) else None
                rows.append(dict(session=session, parentSession=parent, harness=harness, reportedState=state,
                    fresh=bool(fresh), processState='observed' if matched else 'not-observed',
                    runtimeId=runtime(host) if matched else None,
                    reconciles=[runtime(p) for p in children] if harness == 'codex' else []))
            except (OSError, ValueError, TypeError, OverflowError): diagnostics['rejectedReceipts'] += 1
print(json.dumps(dict(schema=1, source=kind, rows=rows, diagnostics=diagnostics), separators=(',',':')))
AB_COVERAGE_READ
`;
}

export async function readRemoteInventorySource(target: RemoteTarget, read: typeof onMachine = onMachine): Promise<unknown> {
  if (!target.source || target.source === 'herdr') return readRemoteHerdr(target, read);
  const script = remoteCoverageScript(target);
  try { return JSON.parse(await read(target.alias, script, 15_000, 1 << 20)); }
  catch { throw Error('remote coverage unavailable'); }
}
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const runtimeToken = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,9}:[0-9]{10,16}$/.test(v);
function coverageDiagnostics(raw: unknown): Record<string, number> {
  if (!obj(raw) || !obj(raw.diagnostics)) return {};
  const diagnostics = raw.diagnostics;
  return Object.fromEntries(['eligibleProcesses','rejectedReceipts','scannedReceipts','conflictingIdentities','directoryAbsent'].filter(k => Number.isSafeInteger(diagnostics[k]) && Number(diagnostics[k]) >= 0).map(k => [k, Number(diagnostics[k])]));
}

export function parseRemoteCoverage(raw: unknown, target: RemoteTarget, observedAt: number): RemoteInventoryAgent[] {
  if (!valid(target) || !approvedCoverage(target) || !['managed-hosts','codex-processes'].includes(target.source ?? '') || !obj(raw) || raw.schema !== 1 || raw.source !== target.source || !Array.isArray(raw.rows) || raw.rows.length > 512) throw Error('invalid coverage');
  const source = target.source!;
  const rows: RemoteInventoryAgent[] = [];
  const byIdentity = new Map<string, RemoteInventoryAgent>();
  for (const r of raw.rows) {
    if (!obj(r)) throw Error('invalid record');
    const processOnly = source === 'codex-processes';
    if (processOnly ? !runtimeToken(r.runtimeId) || !(r.parentRuntimeId === null || runtimeToken(r.parentRuntimeId)) :
      !token(r.session) || !(r.parentSession === null || token(r.parentSession)) || !['codex','claude','unknown'].includes(String(r.harness)) || typeof r.fresh !== 'boolean' || !['observed','not-observed'].includes(String(r.processState)) || !(r.runtimeId === null || runtimeToken(r.runtimeId)) || !Array.isArray(r.reconciles) || r.reconciles.length > 512 || !r.reconciles.every(runtimeToken)) throw Error('invalid record');
    const identity = processOnly ? r.runtimeId as string : r.session as string;
    const current = !processOnly && r.fresh === true && r.processState === 'observed' && runtimeToken(r.runtimeId);
    const row: RemoteInventoryAgent = {
      id: id(target, identity), machineKey: target.machineKey, machineSession: target.session, ...(target.user === undefined ? {} : { machineUser: target.user }), source,
      name: processOnly ? `Codex process ${identity.split(':')[0]} · task unknown` : `Managed session ${identity}`,
      harness: processOnly ? 'codex' : r.harness as string,
      identity: processOnly ? 'process-only' : 'task-session', taskSession: processOnly ? null : identity,
      state: current && ['idle','working','blocked','done','failed'].includes(String(r.reportedState)) ? r.reportedState as string : 'unknown',
      reportedState: !processOnly && ['idle','working','blocked','done','failed'].includes(String(r.reportedState)) ? r.reportedState as string : 'unknown',
      processState: processOnly ? 'observed' : r.processState as 'observed' | 'not-observed',
      runtimeId: r.runtimeId as string ?? undefined, runtimeParentId: processOnly ? r.parentRuntimeId as string | null : null,
      reconciles: processOnly ? [] : r.reconciles as string[],
      parentId: processOnly ? r.parentRuntimeId ? id(target,r.parentRuntimeId as string) : null : r.parentSession ? id(target,r.parentSession as string) : null,
      observedAt, stale: !processOnly && !current, readOnly: true,
    };
    const prior = byIdentity.get(identity);
    if (prior) {
      // Duplicate identical receipts collapse; disagreement removes every liveness/parent claim.
      if (JSON.stringify(prior) !== JSON.stringify(row)) Object.assign(prior, { identity: 'conflict', state: 'unknown', reportedState: 'unknown', processState: 'unknown', runtimeId: undefined, reconciles: [], parentId: null, stale: true });
    } else { byIdentity.set(identity,row); rows.push(row); }
  }
  const ids = new Set(rows.filter(r => r.identity !== 'conflict').map(r => r.id));
  for (const r of rows) {
    if (r.parentId === r.id || !ids.has(r.parentId ?? '')) r.parentId = null;
    let cursor = r.parentId; const seen = new Set([r.id]);
    while (cursor) { if (seen.has(cursor)) { r.parentId = null; break; } seen.add(cursor); cursor = rows.find(p => p.id === cursor)?.parentId ?? null; }
  }
  return rows;
}

/** Reconcile only exact native PID/start identities in the same account. Names never join sources. */
export function reconcileRemoteSources(sources: RemoteInventorySource[]): RemoteInventorySource[] {
  sources = sources.map(source => {
    if (source.source !== 'managed-hosts') return source;
    const counts = new Map<string, number>();
    for (const row of source.agents) for (const key of new Set([row.runtimeId, ...row.reconciles ?? []].filter(Boolean) as string[])) counts.set(key, (counts.get(key) ?? 0) + 1);
    const agents = source.agents.map(row => [row.runtimeId, ...row.reconciles ?? []].some(key => key && (counts.get(key) ?? 0) > 1)
      ? { ...row, identity: 'conflict' as const, state: 'unknown', reportedState: 'unknown', processState: 'unknown' as const, parentId: null, reconciles: [], stale: true } : row);
    const validParents = new Set(agents.filter(a => a.identity !== 'conflict').map(a => a.id));
    return { ...source, diagnostics: { ...source.diagnostics, conflictingIdentities: agents.filter(a => a.identity === 'conflict').length },
      agents: agents.map(a => ({ ...a, parentId: a.parentId && validParents.has(a.parentId) ? a.parentId : null })) };
  });
  return sources.map(source => {
    if (source.source !== 'codex-processes' || source.state !== 'fresh') return source;
    const claims = new Map<string, number>();
    for (const host of sources.filter(s => s.source === 'managed-hosts' && s.state === 'fresh' && s.machineKey === source.machineKey && s.machineUser === source.machineUser).flatMap(s => s.agents)) {
      if (host.identity !== 'task-session' || host.processState !== 'observed') continue;
      for (const runtime of host.reconciles ?? []) claims.set(runtime, (claims.get(runtime) ?? 0) + 1);
    }
    const agents = source.agents.filter(a => claims.get(a.runtimeId ?? '') !== 1);
    const ids = new Set(agents.map(a => a.id));
    return { ...source, diagnostics: { ...source.diagnostics, reconciledProcesses: source.agents.length - agents.length }, agents: agents.map(a => ({ ...a, parentId: a.parentId && ids.has(a.parentId) ? a.parentId : null })) };
  });
}

/** One reader per owning node. Config is reread on every request; revocation discards cached and in-flight data. */
export function createRemoteInventory(options: {
  targets: () => RemoteTarget[]; enabled: () => boolean;
  /** Explicit test override; production adds fixed coverage only for the two approved machine scopes. */
  expandCoverage?: boolean;
  read?: (target: RemoteTarget) => Promise<unknown>; now?: () => number; ttlMs?: number;
}) {
  const now = options.now ?? Date.now;
  const ttl = Math.max(1000, options.ttlMs ?? 30_000);
  type Entry = { target: RemoteTarget; attemptedAt: number | null; observedAt: number | null; error: string | null; agents: RemoteInventoryAgent[]; diagnostics: Record<string, number>; run: Promise<void> | null };
  const cache = new Map<string, Entry>();
  function sync() {
    let list: RemoteTarget[];
    try { list = options.enabled() ? ((options.expandCoverage ?? !options.read) ? remoteCoverageTargets(options.targets()) : options.targets()) : []; } catch { cache.clear(); return false; }
    if (!Array.isArray(list) || list.length > 32 || list.some((t) => !valid(t))) { cache.clear(); return false; }
    // An ambiguous machine/user/session -> transport mapping is refused, never merged by display name.
    const scopes = new Set<string>();
    for (const t of list) { const identity=scope(t); if (scopes.has(identity)) { cache.clear(); return false; } scopes.add(identity); }
    const allowed = new Set(list.map(key));
    for (const k of cache.keys()) if (!allowed.has(k)) cache.delete(k);
    for (const target of list) if (!cache.has(key(target))) cache.set(key(target), { target: { ...target }, attemptedAt: null, observedAt: null, error: null, agents: [], diagnostics: {}, run: null });
    return true;
  }
  async function read() {
    let configured = sync();
    const enabled = options.enabled();
    if (enabled && configured) {
      // Bounded concurrency: the configured inventory is small; at most four SSH reads at once.
      const entries = [...cache.entries()];
      for (let i = 0; i < entries.length; i += 4) await Promise.all(entries.slice(i, i + 4).map(async ([k, e]) => {
        sync();
        if (cache.get(k) !== e) return;
        if (!e.run && (e.attemptedAt === null || now() < e.attemptedAt || now() - e.attemptedAt >= ttl)) {
          e.run = (async () => {
            e.attemptedAt = now();
            try {
              const raw = await (options.read ?? readRemoteInventorySource)(e.target);
              const rows = e.target.source && e.target.source !== 'herdr' ? parseRemoteCoverage(raw, e.target, now()) : parseRemoteAgents(raw, e.target, now());
              sync();
              if (cache.get(k) !== e) return;
              e.agents = rows; e.diagnostics = coverageDiagnostics(raw); e.observedAt = now(); e.error = null;
            } catch { if (cache.get(k) === e) e.error = 'Remote inventory unavailable or invalid'; }
          })().finally(() => { e.run = null; });
        }
        await e.run;
      }));
    }
    configured = sync();
    const sources: RemoteInventorySource[] = [...cache.values()].map((e) => {
      const stale = !!e.error || e.observedAt === null || now() < e.observedAt || now() - e.observedAt >= ttl;
      return { machineKey: e.target.machineKey, session: e.target.session, source: e.target.source ?? 'herdr', coverage: coverageDescription(e.target.source), diagnostics: e.diagnostics, ...(e.target.user===undefined?{}:{machineUser:e.target.user}), state: e.observedAt === null ? 'unavailable' : stale ? 'stale' : 'fresh', attemptedAt: e.attemptedAt ?? now(), observedAt: e.observedAt, error: e.error, agents: e.agents.map((a) => ({ ...a, stale: stale || a.stale, state: stale || a.stale ? 'unknown' : a.state })) };
    });
    const reconciled = reconcileRemoteSources(sources);
    return { enabled: options.enabled(), configured, readOnly: true as const, coverage: 'configured-herdr-and-allowlisted-host-processes', coverageComplete: false, at: now(), sources: reconciled, agents: reconciled.flatMap((s) => s.agents) };
  }
  return { read };
}

/** Explicit integration seam; no registration or remote access occurs merely by importing this file. */
export function remoteInventoryRoute(inventory: ReturnType<typeof createRemoteInventory>, allowedOrigins = new Set(['http://127.0.0.1:5401', 'http://localhost:5401', 'tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost'])) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/remote/agents') return false;
    const peer = req.socket?.remoteAddress;
    const local = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    const origin = req.headers?.origin;
    const denied = !local || (origin !== undefined && (typeof origin !== 'string' || !allowedOrigins.has(origin)));
    const status = denied ? 403 : req.method !== 'GET' ? 405 : url.search ? 400 : 200;
    const body = status === 200 ? await inventory.read() : { error: status === 403 ? 'Local app access only' : status === 405 ? 'GET only' : 'No selectors accepted' };
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
    return true;
  };
}
