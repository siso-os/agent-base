/** Navigation-only hierarchy; inventory and project dashboards keep every row. */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { projectWorkspace } from "./workspace-registry.ts";
import { readMeta } from "./codex-runs.ts";
type Row = Record<string, any> & { id: string; name: string };
export type RunParent = { name?: string; workspace?: string; parent?: string; worker?: string; pane?: string; parent_session?: string; parent_pane?: string; started?: number | string };
export const MAIN_NAMES = ["AGENT BASE", "AGENT BASE UI", "OPERATOR-DESIGN", "AGENT ZERO"];
export function readRunParents(): RunParent[] {
  const dir = process.env.AB_CODEX_RUNS ?? path.join(homedir(), ".local/state/codex-run/runs");
  try { return readdirSync(dir).filter(n => n.endsWith(".meta.json")).flatMap(n => {
    const meta = readMeta(path.join(dir, n));
    return meta && typeof meta === "object" ? [{ ...meta } as RunParent] : [];
  }).sort((a, b) => (Number(b.started) || Date.parse(String(b.started)) || 0) - (Number(a.started) || Date.parse(String(a.started)) || 0)); } catch { return []; }
}
export function agentNavigation(rows: Row[], workers: Row[], registry: Record<string, Record<string, any>>, runs: RunParent[]): Row[] {
  const name = (s: unknown) => typeof s === "string" ? s.trim().toUpperCase() : "";
  // A worker can have several run records (a resume writes its own); the newest one that names a parent decides.
  // Indexed once per call: on 9 Oct the nested scans (about 300 agents by 259 runs, twice per read) were a quarter of the
  // node's CPU on the laptop. Lists keep the runs' newest-first order, so each lookup returns what the scans returned.
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  const runsByName = new Map<string, number[]>(), runsByPane = new Map<string, number[]>(), workerPanes = new Map<string, Set<unknown>>();
  runs.forEach((r, i) => {
    push(runsByName, name(r.worker || r.name), i);
    if (r.pane) push(runsByPane, r.pane, i);
    const w = name(r.worker); if (!workerPanes.has(w)) workerPanes.set(w, new Set()); workerPanes.get(w)!.add(r.pane);
  });
  const runOf = (a: Row) => {
    const at = [...new Set([...(runsByName.get(name(a.name)) ?? []), ...(a.pane ? runsByPane.get(a.pane) ?? [] : [])])].sort((x, y) => x - y);
    const mine = at.map(i => runs[i]);
    return mine.find(r => r.parent_session || r.parent_pane) ?? mine[0];
  };
  const registryByName = new Map<string, Record<string, any>>();
  for (const [n, who] of Object.entries(registry)) if (!registryByName.has(name(n))) registryByName.set(name(n), who);
  const whoOf = (a: Row) => registry[a.name] ?? registryByName.get(name(a.name)) ?? {};
  // Keep the existing terminal route when a job also has a read-only worker row.
  const rowNames = new Set(rows.map(a => name(a.name)));
  const all = [...rows, ...workers.filter(w => !rowNames.has(name(w.name)) && !rows.some(a => !!a.pane && !!workerPanes.get(name(w.name))?.has(a.pane)))];
  const out: Row[] = all.map(a => {
    const who = whoOf(a);
    return { ...a, ...Object.fromEntries(["project", "domain", "owner", "kind", "icon", "role", "workspace", "lead"].filter(k => who[k] !== undefined && (a.project !== "Agent Infrastructure" || k === "workspace")).map(k => [k, who[k]])), zero: !!(a.zero || who.zero), a0: !!(a.a0 || who.zero), main: a.zero || who.zero || (typeof who.main === "boolean" ? who.main : MAIN_NAMES.includes(name(a.name))) };
  });
  for (const a of out) if (a.project === "SISO Internal Labs") a.project = "Agent Base";
  for (const a of out) {
    const run = runOf(a);
    const who = whoOf(a);
    const standing = !!who.workspace && who.kind === 'owner' && workers.some(w => w.infrastructureRole && name(w.name) === name(a.name));
    a.navOwner = !a.zero && (!a.codexWorker || standing) && !a.fleet && (!run || standing) && (a.project !== 'Agent Infrastructure' || !!a.workspace) && (a.kind === 'owner' || a.main === true || !!who.lead);
    a.workspace = a.workspace || projectWorkspace(a.project);
  }
  const zero = out.find(a => a.zero);
  const byId = new Map<unknown, number[]>(), byName = new Map<string, number[]>(), bySession = new Map<unknown, number[]>(), byPane = new Map<unknown, number[]>();
  out.forEach((a, i) => { push(byId, a.id, i); push(byName, name(a.name), i); if (a.session) push(bySession, a.session, i); if (a.pane) push(byPane, a.pane, i); });
  // The first row, in order, other than the child itself, whose id, name, session or pane is the value.
  const first = (child: Row, ...lists: (number[] | undefined)[]) => { let best = -1; for (const l of lists) { const i = l?.find(i => out[i].id !== child.id); if (i !== undefined && (best < 0 || i < best)) best = i; } return best < 0 ? undefined : out[best]; };
  const resolve = (value: unknown, child: Row) => first(child, byId.get(value), byName.get(name(value)), value ? bySession.get(value) : undefined, value ? byPane.get(value) : undefined);
  for (const a of out) {
    if (a.main) { a.parentId = null; continue; }
    if (a.project === "Agent Infrastructure") continue;
    const run = runOf(a);
    const hostParent = a.hostParent;
    const parent = resolve(hostParent, a)
      ?? (run?.parent_session ? first(a, bySession.get(run.parent_session)) : undefined)
      ?? (run?.parent_pane ? first(a, byPane.get(run.parent_pane)) : undefined)
      ?? resolve(a.owner, a);
    a.ownershipResolved = !!parent;
    a.parentId = parent?.id ?? zero?.id ?? null;
  }
  // Broken or cyclic ownership goes to Agent Zero rather than hiding a row.
  for (const a of out) {
    const rowOf = (id: unknown) => { const i = byId.get(id)?.[0]; return i === undefined ? undefined : out[i]; };
    const seen = new Set([a.id]); let parent = rowOf(a.parentId);
    while (parent && !parent.main) {
      if (seen.has(parent.id)) { a.parentId = zero?.id ?? null; break; }
      seen.add(parent.id); parent = rowOf(parent.parentId);
    }
  }
  for (const a of out) {
    const lead = resolve(a.lead || a.owner || a.hostParent, a);
    a.navParentId = a.navOwner && lead?.navOwner ? lead.id : null;
    if (!a.workspace && lead) a.workspace = lead.workspace;
  }
  return out;
}
