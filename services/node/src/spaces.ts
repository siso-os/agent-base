/** Project pinboards: file-authored pins and atomic, independently patched placement. */
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { jsonStore, type Store } from './store.ts';
/** The fields a space reads from a nav row; kept local so the node never compiles the web app's modules. */
type Agent = { id: string; name: string; project?: string | null; domain?: string | null; owner?: string | null; lead?: string | null; parentId?: string | null; [k: string]: unknown };

export type Point = { x: number; y: number };
export type SpaceLayout = { positions: Record<string, Point>; collapsed: Record<string, boolean> };
export type SpacePin = { id: string; title: string; kind: 'note' | 'doc' | 'image' | 'link'; by: string; at: string; markdown: string; error?: string };
const safe = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9 _.'-]{0,159}$/.test(s) && s !== '.' && s !== '..';
const own = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function layout(raw: unknown): SpaceLayout {
  if (!own(raw)) throw new TypeError('Layout is an object');
  if (raw.positions !== undefined && !own(raw.positions) || raw.collapsed !== undefined && !own(raw.collapsed)) throw new TypeError('Positions and collapsed are objects');
  const positions: Record<string, Point> = Object.create(null), collapsed: Record<string, boolean> = Object.create(null);
  for (const [key, p] of Object.entries(raw.positions ?? {})) {
    if (key.length > 240 || !own(p) || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7) throw new TypeError('Positions require finite x and y');
    positions[key] = { x: p.x, y: p.y };
  }
  for (const [key, value] of Object.entries(raw.collapsed ?? {})) {
    if (key.length > 240 || typeof value !== 'boolean') throw new TypeError('Collapsed values are booleans');
    collapsed[key] = value;
  }
  if (Object.keys(positions).length > 2000 || Object.keys(collapsed).length > 2000) throw new TypeError('Too many frames');
  return { positions, collapsed };
}
const canon = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function spaceAgents<T extends Agent>(project: string, name: string, all: T[]): T[] {
  const selected = new Set(all.filter(a => [project, name].some(p => canon(p) === canon(a.project) || canon(p) === canon(a.domain))).map(a => a.id));
  // Workers with an owner/parent inherit membership, even when the worker's registry row is incomplete.
  for (let i = 0; i < all.length; i++) {
    const previous = selected.size;
    for (const a of all) if (all.some(p => selected.has(p.id) && (a.parentId === p.id || canon(a.owner ?? a.lead) === canon(p.name)))) selected.add(a.id);
    if (previous === selected.size) break;
  }
  return all.filter(a => selected.has(a.id));
}
/** Catalog identity is not a filesystem path. Resolve membership before selecting a storage key.
 * Registry IDs keep their existing layout/pins; catalog aliases of a registry path share that key. */
export function resolveSpace(requested: string, projects: { id: string; name: string; path?: string }[], items: { id: string; name: string; project?: string }[]) {
  if (!requested || requested.length > 1000 || /[\\\x00-\x1f]/.test(requested) || requested.split('/').some(s => s === '.' || s === '..')) throw new TypeError('Invalid project');
  const relative = (p: string) => p.replace(/^.*?SISO_Workspace\//, '').replace(/\/$/, '');
  const exact = projects.filter(p => p.id === requested || (p.path && relative(p.path) === requested));
  const named = exact.length ? exact : projects.filter(p => p.name.toLowerCase() === requested.toLowerCase());
  if (named.length > 1) throw new TypeError('Ambiguous project');
  let project: (typeof projects)[number] | undefined = named[0];
  const exactItems = items.filter(i => i.id === requested);
  const matches = exactItems.length ? exactItems : items.filter(i => i.name.toLowerCase() === requested.toLowerCase() || i.id.split('/').at(-1)?.toLowerCase() === requested.toLowerCase());
  if (!project && matches.length > 1 && new Set(matches.map(i => i.project ?? i.id)).size > 1) throw new TypeError('Ambiguous project');
  const item = matches[0];
  if (!project && item?.project) project = projects.find(p => p.id === item.project);
  if (!project && !item) throw new TypeError('Unknown project');
  const id = project?.id ?? item!.id;
  const leaf = id.split('/').at(-1)!;
  const legacyLeaf = !project && safe(leaf) && !projects.some(p => p.id === leaf) && items.filter(i => i.id.split('/').at(-1) === leaf).every(i => i.id === id);
  const key = safe(id) ? id : legacyLeaf ? leaf : `catalog-${createHash('sha256').update(id).digest('hex')}`;
  if (key !== id && projects.some(p => p.id === key)) throw new TypeError('Project storage collision');
  return { id, key, name: project?.name ?? item!.name, repo: project?.path && !/(^|\/)personal(\/|$)/.test(project.path) ? project.path : undefined };
}

export function createSpaces(root = process.env.AB_SPACES_DIR ?? path.join(homedir(), '.local/state/agent-base/spaces')) {
  const stores = new Map<string, Store<SpaceLayout>>();
  function base(project: string) {
    if (!safe(project)) throw new TypeError('Invalid project');
    mkdirSync(root, { recursive: true });
    const dir = path.join(root, project);
    // Refuse redirects outside this state root, including an agent-authored symlink directory.
    if (lstatExists(dir) && lstatSync(dir).isSymbolicLink()) throw new TypeError('Project directory must not be a symlink');
    return dir;
  }
  function store(project: string) {
    base(project);
    const file = path.join(root, `${project}.json`);
    if (lstatExists(file) && lstatSync(file).isSymbolicLink()) throw new TypeError('Layout must not be a symlink');
    let s = stores.get(project);
    if (!s) { s = jsonStore(file, layout); stores.set(project, s); }
    s.fresh(); return s;
  }
  function pins(project: string, repo?: string): SpacePin[] {
    const dir = path.join(base(project), 'pins');
    if (!lstatExists(dir)) return [];
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new TypeError('Pins must be a directory');
    return readdirSync(dir).filter(n => safe(n) && n.endsWith('.md')).sort().slice(0, 200).flatMap(file => {
      const full = path.join(dir, file), stat = lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) return [];
      const text = readFileSync(full, 'utf8'), match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const meta: Record<string, string> = Object.create(null);
      for (const line of (match?.[1] ?? '').split('\n')) {
        const m = /^(title|kind|by|at|path):\s*(.*?)\s*$/.exec(line);
        if (m) { try { const value = JSON.parse(m[2]); meta[m[1]] = typeof value === 'string' ? value : m[2]; } catch { meta[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } }
      }
      let markdown = text.slice(match?.[0].length ?? 0), error: string | undefined;
      if (meta.kind === 'doc' && meta.path) {
        try {
          if (!repo || path.isAbsolute(meta.path) || meta.path.split(/[\\/]/).some(p => p.startsWith('.') || /^(private|secrets|credentials)$/i.test(p)) || !/\.(md|txt)$/i.test(meta.path)) throw Error('Use a relative .md or .txt repo document');
          const rootPath = realpathSync(repo), source = realpathSync(path.join(rootPath, meta.path));
          if (!source.startsWith(rootPath + path.sep) || lstatSync(source).size > 1_000_000) throw Error('Document is outside the repo or too large');
          markdown = readFileSync(source, 'utf8');
        } catch (e) { error = (e as Error).message; }
      }
      return [{ id: file.slice(0, -3), title: meta.title || file.slice(0, -3), kind: ['doc','image','link'].includes(meta.kind) ? meta.kind as SpacePin['kind'] : 'note', by: meta.by || 'Agent', at: meta.at || stat.mtime.toISOString(), markdown, ...(error ? { error } : {}) }];
    });
  }
  return {
    read(project: string, agents: unknown[], repo?: string) { return { project, agents, layout: store(project).data, pins: pins(project, repo) }; },
    patch(project: string, raw: unknown) { const next = layout(raw), s = store(project); Object.assign(s.data.positions, next.positions); Object.assign(s.data.collapsed, next.collapsed); s.save(); return s.data; },
    addPin(project: string, raw: unknown) {
      if (!own(raw) || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200 || typeof raw.markdown !== 'string' || raw.markdown.length > 3_000_000) throw new TypeError('Pin requires a title and markdown');
      const dir = path.join(base(project), 'pins');
      if (lstatExists(dir) && lstatSync(dir).isSymbolicLink()) throw new TypeError('Pins must not be a symlink');
      mkdirSync(dir, { recursive: true });
      const id = randomUUID(), kind = ['doc', 'image', 'link'].includes(String(raw.kind)) ? raw.kind : 'note';
      writeFileSync(path.join(dir, `${id}.md`), `---\ntitle: ${JSON.stringify(raw.title.trim())}\nkind: ${kind}\nby: Shaan\nat: ${JSON.stringify(new Date().toISOString())}\n${typeof raw.path === 'string' ? `path: ${JSON.stringify(raw.path)}\n` : ''}---\n${raw.markdown}`, { flag: 'wx', mode: 0o600 });
      return { id };
    },
  };
}
function lstatExists(file: string) { try { lstatSync(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
