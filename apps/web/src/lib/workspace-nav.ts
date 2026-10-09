import type { Agent } from './agents';
export type NavWorkspace = { id: string; name: string; color: string; order: number; logo?: string; nav?: boolean; parent?: string; owner?: string };
export function inWorkspace(id: string, target: string, workspaces: NavWorkspace[]): boolean {
  const seen = new Set<string>();
  while (id && !seen.has(id)) { if (id === target) return true; seen.add(id); id = workspaces.find(w => w.id === id)?.parent ?? ''; }
  return false;
}
/** The nav workspace an id shows under: itself if it is in the nav, else its nearest nav ancestor (HALO Operator under HALO,
 * Agent Base under itself, not under SISO Agency). */
export function navHome(id: string | null | undefined, workspaces: NavWorkspace[]): string | null {
  const seen = new Set<string>();
  while (id && !seen.has(id)) { const w = workspaces.find(x => x.id === id); if (!w) return null; if (w.nav) return w.id; seen.add(id); id = w.parent; }
  return null;
}
export const isInfra = (a: Pick<Agent, 'project' | 'role'>) => a.project === 'Agent Infrastructure' || /^Agent Infrastructure\b/.test(a.role ?? '');
export function workspaceOwners(agents: Agent[], workspaces: NavWorkspace[], id: string): Agent[] {
  // Infrastructure roles (Efficiency, Estate, Health) live under Agent Infrastructure only (Shaan, 6 Oct 22:35).
  // A nested nav workspace keeps its own owners (t-0563: Agent Base inside SISO Agency), so this is its nearest nav home.
  const owners = agents.filter(a => a.navOwner && a.row === 'live' && !isInfra(a) && navHome(a.workspace, workspaces) === id);
  const roots = owners.filter(a => !owners.some(p => p.id === a.navParentId));
  return roots.flatMap(a => [a, ...owners.filter(c => c.navParentId === a.id)]);
}
