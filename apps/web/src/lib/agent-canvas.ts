import type { Agent } from './agents';
import type { ResearchFleet } from '../../../../services/node/src/research';

export type CanvasPoint = { x: number; y: number };
export type CanvasCamera = CanvasPoint & { z: number };
export type CanvasLayout = { version: 1; positions: Record<string, CanvasPoint>; camera?: CanvasCamera };
export type CanvasNode = { id: string; label: string; x: number; y: number; w: number; h: number; agent?: Agent; crew?: Agent[]; fleet?: ResearchFleet };
export const CANVAS_STORAGE_KEY = 'ab.canvas.v1';
export const canvasZoom = (z: number) => Math.max(.08, Math.min(1.8, z));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000;
const point = (v: unknown): v is CanvasPoint => !!v && typeof v === 'object' && finite((v as CanvasPoint).x) && finite((v as CanvasPoint).y);
const blank = (): CanvasLayout => ({ version: 1, positions: {} });
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readCanvasLayout(store: Store | null, key = CANVAS_STORAGE_KEY): { layout: CanvasLayout; error: string | null } {
  try {
    if (!store) return { layout: blank(), error: 'Layout is available for this visit; local storage is unavailable.' };
    const raw = store.getItem(key);
    if (raw === null) return { layout: blank(), error: null };
    if (raw.length > 128_000) throw Error();
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions)) throw Error();
    const entries = Object.entries(value.positions);
    if (entries.length > 1000 || !entries.every(([id,p]) => id.length <= 500 && id !== '__proto__' && id !== 'constructor' && point(p))) throw Error();
    if (value.camera && (!point(value.camera) || !Number.isFinite(value.camera.z) || value.camera.z < .08 || value.camera.z > 1.8)) throw Error();
    return { layout: { version: 1, positions: Object.fromEntries(entries as [string, CanvasPoint][]), ...(value.camera ? { camera: value.camera } : {}) }, error: null };
  } catch { return { layout: blank(), error: 'Saved layout could not be read. Its stored data has been kept.' }; }
}

/** Patch current data, retaining positions for agents that are temporarily absent from the roster. */
export function saveCanvasLayout(store: Store | null, patch: { id?: string; point?: CanvasPoint; camera?: CanvasCamera }, key = CANVAS_STORAGE_KEY): string | null {
  const old = readCanvasLayout(store, key);
  if (old.error) return old.error;
  if (patch.id && (!patch.point || !point(patch.point) || patch.id.length > 500 || ['__proto__', 'constructor'].includes(patch.id))) return 'Layout position is invalid.';
  if (patch.camera && (!point(patch.camera) || !Number.isFinite(patch.camera.z) || patch.camera.z !== canvasZoom(patch.camera.z))) return 'Canvas view is invalid.';
  const next = { ...old.layout, positions: { ...old.layout.positions, ...(patch.id ? { [patch.id]: patch.point! } : {}) }, ...(patch.camera ? { camera: patch.camera } : {}) };
  const raw = JSON.stringify(next);
  if (raw.length > 128_000 || Object.keys(next.positions).length > 1000) return 'Local layout is full. This visit’s arrangement is still visible.';
  try { if (!store) throw Error(); store.setItem(key, raw); return null; }
  catch { return 'Layout could not be saved. This visit’s arrangement is still visible.'; }
}

export function canvasNodes(agents: Agent[], fleets: ResearchFleet[], positions: CanvasLayout['positions']): CanvasNode[] {
  const unique = [...new Map(agents.map(a => [a.key, a])).values()];
  const parent = (a: Agent) => unique.find(p => p.key !== a.key && (a.parentId === p.id || a.navParentId === p.id || a.owner === p.name || a.lead === p.name));
  const primary = (a: Agent) => a.zero || a.main || a.navOwner || a.kind === 'owner';
  const roots = unique.filter(a => primary(a) || !parent(a) || (() => {
    const seen = new Set([a.key]); let p = parent(a);
    while (p) { if (seen.has(p.key)) return true; seen.add(p.key); p = parent(p); }
    return false;
  })()).sort((a,b) => Number(Boolean(b.zero)) - Number(Boolean(a.zero)) || Number(b.kind === 'owner') - Number(a.kind === 'owner'));
  const rootKeys = new Set(roots.map(a => a.key));
  const nodes: CanvasNode[] = roots.map((agent,i) => {
    const crew = unique.filter(a => {
      if (rootKeys.has(a.key)) return false;
      const seen = new Set<string>(); let p = parent(a);
      while (p && !seen.has(p.key)) { if (p.key === agent.key) return true; if (rootKeys.has(p.key)) return false; seen.add(p.key); p = parent(p); }
      return false;
    });
    const id = `agent:${agent.key}`, at = positions[id] ?? { x: (i % 3) * 380, y: Math.floor(i / 3) * 300 };
    return { id, label: agent.label || agent.name, ...at, w: 320, h: agent.zero ? 258 : 248, agent, crew };
  });
  const baseY = Math.ceil(roots.length / 3) * 300 + 50;
  fleets.forEach((fleet,i) => {
    const id = `fleet:${fleet.machine ?? 'local'}:${fleet.name}`, at = positions[id] ?? { x: (i % 2) * 600, y: baseY + Math.floor(i / 2) * 380 };
    nodes.push({ id, label: fleet.name, ...at, w: 540, h: 340, fleet });
  });
  return nodes;
}
export function fitCanvas(nodes: Pick<CanvasNode,'x' | 'y' | 'w' | 'h'>[], width: number, height: number): CanvasCamera {
  if (!nodes.length) return { x: 24, y: 24, z: 1 };
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const w = Math.max(...nodes.map(n => n.x + n.w)) - left, h = Math.max(...nodes.map(n => n.y + n.h)) - top;
  const z = canvasZoom(Math.min(1, Math.max(1,width - 48) / w, Math.max(1,height - 48) / h));
  return { z, x: (width - w*z)/2 - left*z, y: (height - h*z)/2 - top*z };
}
export function zoomCanvas(camera: CanvasCamera, value: number, anchor: CanvasPoint): CanvasCamera {
  const z = canvasZoom(value);
  return { z, x: anchor.x - (anchor.x - camera.x)*z/camera.z, y: anchor.y - (anchor.y - camera.y)*z/camera.z };
}
