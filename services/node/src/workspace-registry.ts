import path from "node:path";
import { homedir } from "node:os";
/** Workspace identity and dashboard layout share the user's existing registry. */
export type Workspace = { id: string; name: string; owner: string; group: string; color: string; order: number; logo?: string; nav?: boolean; parent?: string; size?: 'S' | 'M' | 'L' };
export function seedWorkspaces(value: Workspace[] = []): Workspace[] {
  const seeds: Workspace[] = [
    { id: 'kikas', name: "Kika's", owner: 'KIKAS', group: 'Clients', color: '#e6a46a', order: 0 },
    { id: 'halo-operator', name: 'HALO Operator', owner: 'OPERATOR-DESIGN', group: 'HALO', color: '#b19aff', order: 1 },
    { id: 'agent-base', name: 'Agent Base', owner: 'AGENT BASE', group: 'SISO Labs', color: '#6aaeff', order: 2 },
    { id: 'fahmy', name: 'Fahmy', owner: 'FAHMY', group: 'Clients', color: '#eb879e', order: 3 },
    { id: 'app-atlas', name: 'App Atlas', owner: 'APP-ATLAS', group: 'SISO Labs', color: '#69cfc4', order: 4 },
    { id: 'tasks', name: 'Tasks', owner: 'TASK-LANES', group: 'SISO Labs', color: '#c2ca70', order: 5 },
    { id: 'zero', name: 'Agent Zero', owner: 'Agent Zero', group: 'SISO Labs', color: '#f1bd65', order: 6 },
    { id: 'unassigned', name: 'Unassigned', owner: '', group: 'SISO Labs', color: '#9b9ba6', order: 7 },
  ];
  const all = [...value.map(w => ({ ...w })), ...seeds.filter(s => !value.some(w => w.id === s.id))];
  const nav = [
    { id: 'halo', name: 'HALO', owner: '', group: 'HALO', color: '#b19aff', order: 0, nav: true },
    { id: 'agent-base', name: 'Agent Base', owner: 'AGENT BASE', group: 'SISO Labs', color: '#6aaeff', order: 1, nav: true },
    { id: 'siso-agency', name: 'SISO Agency', owner: '', group: 'Clients', color: '#e6a46a', order: 2, nav: true },
    // Side nav v4 (t-0563, Shaan 8 Oct 23:52): UI Hub is a sub-project of SISO Agency beside Agent Base; Clients, Research and
    // Playground are folder rows. Playground shows the owners no record places.
    { id: 'ui-hub', name: 'UI Hub', owner: 'UI-HUB', group: 'Clients', color: '#7fb8ff', order: 6, nav: true },
    { id: 'clients', name: 'Clients', owner: '', group: 'Clients', color: '#e6a46a', order: 3, nav: true },
    { id: 'research', name: 'Research', owner: 'RESEARCH', group: 'SISO Labs', color: '#22d3ee', order: 4, nav: true },
    { id: 'playground', name: 'Playground', owner: '', group: 'SISO Labs', color: '#a0a0aa', order: 5, nav: true },
  ];
  for (const seed of nav) {
    const logo = path.join(process.env.AB_WORKSPACE_LOGOS_DIR ?? path.join(homedir(), "SISO_Workspace/_data/faces/logos"), `${seed.id}.svg`);
    const existing = all.find(w => w.id === seed.id);
    if (existing) Object.assign(existing, { logo: existing.logo ?? logo, nav: true, ...(!existing.nav ? { order: seed.order } : {}) }); else all.push({ ...seed, logo });
  }
  if (!all.some(w => w.id === 'halo-streaming')) all.push({ id: 'halo-streaming', name: 'HALO Streaming', owner: 'STREAM-QUALITY', group: 'HALO', color: '#b19aff', order: 8 });
  for (const w of all) if (!w.parent) w.parent = ({ 'halo-operator': 'halo', 'halo-streaming': 'halo', kikas: 'siso-agency', fahmy: 'siso-agency', 'app-atlas': 'agent-base', tasks: 'agent-base', 'agent-base': 'siso-agency', 'ui-hub': 'siso-agency' } as Record<string,string>)[w.id];
  return all;
}
export function editWorkspace(workspaces: Workspace[], body: Record<string, unknown>): string | null {
  const updates = Array.isArray(body.workspaces) ? body.workspaces : [body];
  const staged = workspaces.map(w => ({ ...w }));
  for (const patch of updates) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'workspace must be an object';
    const p = patch as Record<string, unknown>;
    if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.id)) return 'workspace id required';
    let w = staged.find(w => w.id === p.id);
    if (!w) { w = { id: p.id, name: '', owner: '', group: '', color: '#9b9ba6', order: staged.length }; staged.push(w); }
    for (const key of ['name', 'owner', 'group'] as const) {
      if (p[key] !== undefined) {
        if (typeof p[key] !== 'string' || !(p[key] as string).trim() || (p[key] as string).length > 120) return `${key} must be a nonempty string`;
        w[key] = (p[key] as string).trim();
      }
    }
    if (p.logo !== undefined) {
      const base = path.resolve(process.env.AB_WORKSPACE_LOGOS_DIR ?? path.join(homedir(), "SISO_Workspace/_data/faces/logos"));
      if (typeof p.logo !== "string" || path.dirname(path.resolve(p.logo)) !== base || !p.logo.endsWith(".svg")) return "logo must be an SVG in the workspace logos directory";
      w.logo = path.resolve(p.logo);
    }
    if (p.nav !== undefined) { if (typeof p.nav !== 'boolean') return 'nav must be boolean'; w.nav = p.nav; }
    if (p.parent !== undefined) { if (typeof p.parent !== 'string' || p.parent === w.id || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.parent)) return 'invalid workspace parent'; w.parent = p.parent; }
    if (!w.name || !w.group || (!w.owner && w.id !== 'unassigned' && !w.nav)) return 'name, owner and group required';
    if (p.color !== undefined) { if (typeof p.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(p.color)) return 'color must be #rrggbb'; w.color = p.color; }
    if (p.order !== undefined) { if (!Number.isSafeInteger(p.order) || Number(p.order) < 0) return 'order must be a nonnegative integer'; w.order = Number(p.order); }
    if (p.size !== undefined) { if (!['S', 'M', 'L'].includes(String(p.size))) return 'size must be S, M or L'; w.size = p.size as Workspace['size']; }
  }
  for (const w of staged) {
    const seen = new Set([w.id]); let parent = w.parent;
    while (parent) { if (seen.has(parent)) return 'workspace parent cycle'; seen.add(parent); const p = staged.find(x => x.id === parent); if (!p) return 'unknown workspace parent'; parent = p.parent; }
  }
  workspaces.splice(0, workspaces.length, ...staged);
  return null;
}

export function projectWorkspace(project: unknown): string | null {
  if (typeof project !== 'string') return null;
  if (/halo/i.test(project)) return 'halo';
  if (/client|fahmy|siso agency/i.test(project)) return 'siso-agency';
  if (/agent base|siso internal labs/i.test(project)) return 'agent-base';
  return null;
}
