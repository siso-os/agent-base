/** Explicit workspace ownership. Prefixes are confined to the one-time dispatch backfill. */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { type Workspace } from './workspace-registry.ts';
import { type RunParent } from './agent-nav.ts';
type Row = Record<string, any> & { id: string; name: string };
export type Manifest = { name: string; parent?: string; workspace?: string; machine?: string; created?: string; why?: string; jobs: Record<string, any>[]; then?: Record<string, any> };
export type Dispatch = { at: string; kind: string; name: string; workspace?: string; parent?: string; machine: string; brief?: string; out?: string };
export function readDispatch(): Dispatch[] {
  try { return readFileSync(process.env.AB_DISPATCH_FILE || path.join(homedir(), '.local/state/a0/dispatch.jsonl'), 'utf8').split('\n').flatMap(line => {
    try { const d = JSON.parse(line); return typeof d.name === 'string' ? [d] : []; } catch { return []; }
  }); } catch { return []; }
}
const canon = (s: unknown) => typeof s === 'string' ? s.trim().toUpperCase() : '';
const machineOf = (r: Row) => /mini/i.test(r.machineKey || r.machine || '') ? 'mini' : 'laptop';
export function groupFleet(rows: Row[], manifests: Manifest[], workspaces: Workspace[], ledger: Dispatch[] = [], runs: RunParent[] = []) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const ownerWorkspace = (name: unknown) => workspaces.find(w => canon(w.owner) === canon(name) && !!w.owner)
    ?? (canon(name) === 'AGENT BASE UI' ? workspaces.find(w => w.id === 'agent-base') : undefined);
  const dispatch = (name: string, machine: string) => [...ledger].reverse().find(d => canon(d.name) === canon(name) && (d.machine === machine || d.machine === 'local' && machine === 'laptop'));
  const find = (value: unknown) => rows.find(r => r.id === value || canon(r.name) === canon(value) || !!value && (r.session === value || r.pane === value));
  const resolve = (r: Row, seen = new Set<string>()): { workspace: string; dispatcher: string | null } => {
    if (seen.has(r.id)) return { workspace: 'unassigned', dispatcher: null };
    seen.add(r.id);
    const d = dispatch(r.name, machineOf(r));
    const run = runs.find(run => canon(run.worker || run.name) === canon(r.name) || !!run.pane && run.pane === r.pane);
    const explicit = r.workspace || d?.workspace || run?.workspace;
    const own = ownerWorkspace(r.zero ? 'Agent Zero' : r.name);
    const parentName = d?.parent || run?.parent || r.hostParent || (r.host ? r.lead : null) || r.owner;
    const parent = find(parentName) || find(run?.parent_session) || find(run?.parent_pane) || (r.ownershipResolved !== false ? byId.get(r.parentId) : undefined);
    const dispatcher = parentName || parent?.name || null;
    const workspace = explicit ? (workspaces.some(w => w.id === explicit) ? explicit : 'unassigned')
      : own?.id || ownerWorkspace(parentName)?.id || (parent ? resolve(parent, seen).workspace : 'unassigned');
    return { workspace, dispatcher };
  };
  const groups = workspaces.map(w => ({ ...w, ownerId: rows.find(r => canon(r.name) === canon(w.owner) || w.id === 'zero' && r.zero || w.id === 'agent-base' && canon(r.name) === 'AGENT BASE UI')?.id ?? null, rows: [] as Row[] }));
  const add = (workspace: string, row: Row) => {
    const g = groups.find(g => g.id === workspace) || groups.find(g => g.id === 'unassigned');
    if (g && !g.rows.some(r => r.id === row.id)) g.rows.push(row);
  };
  for (const row of rows) {
    // Infrastructure roles (Efficiency, Estate, Health) live under Agent Infrastructure only, never a workspace's Fleet (6 Oct 22:35).
    if (row.project === 'Agent Infrastructure' && !row.workspace || /^Agent Infrastructure\b/.test(String(row.role ?? ''))) continue;
    const resolved = resolve(row);
    add(resolved.workspace, { ...row, dispatcher: resolved.dispatcher, machineKey: machineOf(row) });
  }
  for (const m of manifests) {
    const machine = m.machine === 'mini' ? 'mini' : 'laptop';
    const d = dispatch(m.name, machine);
    const parentName = d?.parent || m.parent;
    const parent = find(parentName);
    const workspace = d?.workspace || m.workspace || ownerWorkspace(parentName)?.id || (parent ? resolve(parent).workspace : 'unassigned');
    for (const j of [...(m.jobs || []), ...(m.then ? [m.then] : [])]) {
      const jobName = j.worker || `${m.name}/${j.id}`;
      const jd = dispatch(jobName, machine);
      const existing = rows.find(r => canon(r.name) === canon(jobName) && machineOf(r) === machine);
      if (existing) continue;
      add(jd?.workspace || workspace, { id: `fleet:${machine}:${m.name}:${j.id}`, name: jobName, title: j.step || j.title || m.why || 'Fleet job',
        status: ['running','terminating'].includes(j.status) ? 'working' : ['failed','stopped'].includes(j.status) ? 'failed' : j.status === 'done' ? 'done' : 'idle',
        since: Date.parse(j.started || m.created || '') || null, machineKey: machine, fleet: true, parentId: parent?.id || null,
        dispatcher: jd?.parent || parentName || null, job: j.id, fleetName: m.name, out: jd?.out });
    }
  }
  return groups.sort((a,b) => a.order - b.order);
}
let mini: Manifest[] = [], at = 0, error: string | null = null;
let pending: Promise<void> | null = null;
let seen = false;
export async function fleetManifests() {
  const dir = process.env.AB_FLEET_STATE || path.join(homedir(), '.local/state/fleet');
  let local: Manifest[] = [];
  try { local = readdirSync(dir).flatMap(n => { try { return [JSON.parse(readFileSync(path.join(dir,n,'manifest.json'),'utf8'))]; } catch { return []; } }); } catch {}
  const enabled = process.env.AB_MINI_LANES !== '0';
  if (enabled && !pending && Date.now() - at >= 30_000) {
    at = Date.now();
    pending = new Promise<void>(resolve => execFile(process.env.AB_FLEET_SSH || 'ssh', ['-o','RemoteCommand=none','-o','BatchMode=yes','-o','ConnectTimeout=8', 'shaansisodia@100.66.34.21', 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/fleet status --on local --json'], { timeout: 15_000, maxBuffer: 2 << 20 }, (err, out) => {
      try { if (err) throw err; const data = JSON.parse(out); if (!Array.isArray(data)) throw Error('invalid snapshot'); mini = data.map(m => ({ ...m, machine: 'mini' })); error = null; } catch { error = 'Mini fleet unavailable · last snapshot retained'; }
      resolve();
    })).finally(() => { pending = null; });
  }
  // Only the first read waits for the mini (t-0497: every 30 s each /api/fleet-board waited on ssh, ~5 s); later reads get
  // the last snapshot at once while the next one is fetched behind them.
  if (pending && !seen) await pending;
  seen = true;
  return { manifests: [...local, ...(enabled ? mini : [])], miniEnabled: enabled, miniAt: at || null, error };
}

/** Job output is admitted only through an inventoried manifest/job, never an arbitrary client path. */
export async function fleetJobOutput(id: string): Promise<string | null> {
  const { manifests } = await fleetManifests();
  for (const m of manifests) for (const j of [...(m.jobs || []), ...(m.then ? [m.then] : [])]) {
    const machine = m.machine === 'mini' ? 'mini' : 'laptop';
    if (id !== `fleet:${machine}:${m.name}:${j.id}` || !/^[a-z0-9_.-]+$/i.test(m.name) || !/^[a-z0-9_.-]+$/i.test(j.id)) continue;
    if (machine === 'laptop') {
      const dir = process.env.AB_FLEET_STATE || path.join(homedir(), '.local/state/fleet');
      try { return readFileSync(path.join(dir,m.name,`${j.id}.out`),'utf8').slice(-64_000); } catch { return 'No output yet'; }
    }
    return new Promise((resolve,reject) => execFile(process.env.AB_FLEET_SSH || 'ssh', ['-o','RemoteCommand=none','-o','BatchMode=yes','-o','ConnectTimeout=8','shaansisodia@100.66.34.21', `tail -c 64000 .local/state/fleet/${m.name}/${j.id}.out`], {timeout:15_000,maxBuffer:128_000}, (err,out) => err ? reject(Error('Mini output unavailable')) : resolve(out)));
  }
  return null;
}
