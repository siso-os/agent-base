import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readComponentCatalog } from './component-catalog.ts';

export type SurfaceRating = { value: 'good' | 'ok' | 'shit'; at: string; note: string; source: 'user-input' };
export type SurfaceTask = { id: string; title?: string; stage?: string; agent?: string | null; updated?: string; links?: { surface?: string; url?: string | null } };
export type ProductMapOptions = { hubRoot?: string; tasks?: SurfaceTask[]; tasksError?: string | null };
const defaultRoot = path.resolve(import.meta.dirname, '../../../ui-hub');
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z_][a-z0-9_-]{0,79}$/.test(v);
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
const assetUrl = (file: string) => `/api/product-map/files/${file.split('/').map(encodeURIComponent).join('/')}`;
/** No links, dot segments, absolute paths or symlink components, including the root. */
export function productMapPath(root: string, relative: string): string {
  if (!relative || relative.length > 500 || relative.split('/').some(p => !p || p === '.' || p === '..' || !/^[\w .()-]+$/.test(p))) throw new Error('Invalid catalog path');
  const base = path.resolve(root);
  const parts = base.split(path.sep).filter(Boolean);
  let checked = path.parse(base).root;
  for (const p of [...parts, ...relative.split('/')]) {
    checked = path.join(checked, p);
    try { if (lstatSync(checked).isSymbolicLink()) throw new Error('Symbolic links are not catalog files'); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  return checked;
}
function json(root: string, relative: string, optional = false): Record<string, any> {
  try {
    const file = productMapPath(root, relative);
    if (lstatSync(file).size > 256_000) throw new Error('Catalog record is too large');
    return object(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e: any) { if (optional && e.code === 'ENOENT') return {}; throw e; }
}
function catalog(root: string) {
  return readComponentCatalog(root).components;
}
function rating(v: unknown): SurfaceRating | null {
  const r = object(v);
  return ['good', 'ok', 'shit'].includes(r.value) && date(r.at) && r.source === 'user-input' ? { value: r.value, at: r.at, note: typeof r.note === 'string' ? r.note.slice(0, 4000) : '', source: 'user-input' } : null;
}
function files(root: string, id: string) {
  const found: { file: string; modifiedAt: string; ms: number }[] = [];
  let visited = 0, truncated = false;
  function walk(relative: string, depth: number) {
    if (depth > 5) { truncated = true; return; }
    let entries;
    try { entries = readdirSync(productMapPath(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const entry of entries) {
      if (++visited > 1800) { truncated = true; return; }
      if (entry.isSymbolicLink() || /^(?:_archive|node_modules|\.)/.test(entry.name)) continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (/\.(?:png|webp|jpe?g)$/i.test(entry.name) && !/(?:before|pass1|reference)/i.test(file)) {
        try { const s = lstatSync(productMapPath(root, file)); found.push({ file, modifiedAt: s.mtime.toISOString(), ms: s.mtimeMs }); } catch { /* Invalid filenames are not served. */ }
      }
    }
  }
  walk(id, 0);
  return { latest: found.sort((a,b) => b.ms - a.ms || a.file.localeCompare(b.file))[0] ?? null, truncated };
}
/** Explicit capture records bind an image to a dated source snapshot; they never supply a rating. */
function capture(root: string, id: string) {
  const record = json(root, `${id}/capture.json`, true);
  if (!Object.keys(record).length) return null;
  const interval = object(record.captureInterval);
  const hasInterval = Object.keys(interval).length > 0;
  const validTime = hasInterval
    ? interval.precision === 'interval' && date(interval.startAt) && date(interval.endAt) && Date.parse(interval.startAt) <= Date.parse(interval.endAt) && !record.capturedAt
    : date(record.capturedAt);
  if (record.schema !== 1 || !['synthetic', 'installed'].includes(record.mode) || !validTime
    || !/^[a-f0-9]{40}$/.test(record.sourceRevision) || !/^[a-f0-9]{64}$/.test(record.sha256)
    || typeof record.file !== 'string' || !record.file.startsWith(`${id}/`) || !/\.(png|webp|jpe?g)$/i.test(record.file)
    || !Array.isArray(record.sources) || !record.sources.length || record.sources.length > 500
    || record.sources.some((s: any) => typeof s.file !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256))) throw new Error('Invalid capture record');
  const file = productMapPath(root, record.file), stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 8_000_000 || createHash('sha256').update(readFileSync(file)).digest('hex') !== record.sha256) throw new Error('Capture image hash mismatch');
  let gallery: { id: string; title: string; url: string; kind: string } | null = null;
  if (typeof record.gallery === 'string' && record.gallery.startsWith(`${id}/`) && lstatSync(productMapPath(root, record.gallery)).isFile())
    gallery = { id: 'capture-gallery', title: 'Dated capture gallery', url: assetUrl(record.gallery), kind: 'gallery' };
  const capturedAt = hasInterval ? undefined : record.capturedAt;
  const captureInterval = hasInterval ? { precision: 'interval', startAt: interval.startAt, endAt: interval.endAt } : undefined;
  const timeEvidence = hasInterval ? `Captured during ${interval.startAt}–${interval.endAt}.` : `Captured ${record.capturedAt}.`;
  return { screenshot: { url: assetUrl(record.file), file: record.file, modifiedAt: stat.mtime.toISOString(), ...(capturedAt ? { capturedAt } : {}), ...(captureInterval ? { captureInterval } : {}),
    sourceRevision: record.sourceRevision, sha256: record.sha256, mode: record.mode,
    provenanceUrl: assetUrl(`${id}/capture.json`),
    evidence: `${record.mode === 'synthetic' ? 'Synthetic component render; installed behavior unverified' : 'Installed capture; current live status unverified'}. ${timeEvidence} Source ${record.sourceRevision.slice(0, 12)}; image SHA-256 verified` }, gallery };
}
export function readProductMap(options: ProductMapOptions = {}) {
  const root = options.hubRoot ?? defaultRoot;
  const entries = catalog(root);
  const rows = entries.filter(c => c.kind !== 'manual').map(c => {
    const issues: string[] = [];
    let meta: Record<string, any> = {};
    try { meta = json(root, `${c.id}/surface.json`, true); } catch { issues.push('Surface metadata unavailable'); }
    // A page can point to its existing round under a shared component, without copying proof.
    const references = (Array.isArray(c.proofRefs) ? c.proofRefs : []).slice(0, 12).flatMap((p: any) => {
      if (!p || !validId(p.component) || !validId(p.id) || !entries.some(entry => entry.id === p.component) || typeof p.file !== 'string') return [];
      const relative = `${p.component}/${p.file.replace(/\/$/, '')}`;
      try { if (!lstatSync(productMapPath(root, relative)).isDirectory()) return []; } catch { return []; }
      return [{ id:p.id, title:String(p.title ?? p.id).slice(0,160), url:assetUrl(relative)+'/', kind:'gallery', relative }];
    });
    let explicit: ReturnType<typeof capture> = null;
    try { explicit = capture(root, c.id); } catch { issues.push('Capture provenance invalid or image hash changed; legacy image is unverified'); }
    const scans = [files(root, c.id), ...references.map((p: { relative: string }) => files(root, p.relative))];
    const scan = { latest:scans.flatMap(s=>s.latest ? [s.latest] : []).sort((a,b)=>b.ms-a.ms || a.file.localeCompare(b.file))[0] ?? null, truncated:scans.some(s=>s.truncated) };
    if (scan.truncated) issues.push('Screenshot scan bounded; latest among scanned files');
    const pages = (Array.isArray(c.pages) ? c.pages : []).slice(0, 60).flatMap((p: any) => {
      if (!p || !validId(p.id) || typeof p.file !== 'string') return [];
      try {
        const file = `${c.id}/${p.file.replace(/\/$/, '')}`;
        const exists = lstatSync(productMapPath(root, file));
        return [{ id: p.id, title: String(p.title ?? p.id).slice(0,160), url: assetUrl(file) + (exists.isDirectory() ? '/' : ''), kind: p.kind ?? 'document' }];
      } catch { return []; }
    });
    if (explicit?.gallery) pages.push(explicit.gallery);
    if (explicit) pages.push({ id:'capture-provenance', title:'Capture provenance and source hashes', url:explicit.screenshot.provenanceUrl, kind:'document' });
    pages.push(...references.map(({ relative: _relative, ...p }: { relative: string; id: string; title: string; url: string; kind: string }) => p));
    const tasks = (options.tasks ?? []).filter(t => t.links?.surface === c.id && typeof t.id === 'string' && /^t-\d+$/.test(t.id)).slice(0, 80).map(t => ({ id: t.id, title: String(t.title ?? t.id).slice(0,250), stage: String(t.stage ?? 'unknown'), agent: typeof t.agent === 'string' ? t.agent : null, updated: date(t.updated), url: `/api/product-map/tasks/${t.id}` }));
    const active = tasks.filter(t => ['running', 'working', 'in-progress', 'building'].includes(t.stage));
    const feedback = pages.find((p: any) => p.id === 'feedback') ?? null;
    const rounds = pages.filter((p: any) => p.kind === 'gallery');
    return { id: c.id, name: String(c.name ?? c.id), kind: c.kind === 'page' ? 'page' : 'component', summary: String(c.summary ?? ''), status: String(c.status ?? 'Not recorded'), rating: rating(meta.rating), lane: ['now', 'next', 'later'].includes(meta.lane) ? meta.lane : null, lastWorked: date(meta.lastWorked), landedAt: date(meta.landedAt), screenshot: explicit?.screenshot ?? (scan.latest ? { url: assetUrl(scan.latest.file), file: scan.latest.file, modifiedAt: scan.latest.modifiedAt, evidence: 'Stored hub image; capture time and live status unverified' } : null), feedback, openFeedback: Number.isSafeInteger(meta.openFeedback) && meta.openFeedback >= 0 ? meta.openFeedback : null, rounds, pages, tasks, active, issues };
  });
  return { at: new Date().toISOString(), rows, taskAvailability: options.tasksError ? 'unavailable' : options.tasks ? 'available' : 'unavailable', taskError: options.tasksError ?? (options.tasks ? null : 'Task source not connected'), ratingGate: 'Ratings are entered by the user. Unrated surfaces have no recorded user verdict.' };
}
export function saveSurfaceRating(id: string, input: unknown, options: ProductMapOptions = {}) {
  const root = options.hubRoot ?? defaultRoot;
  if (!validId(id) || !catalog(root).some(c => c.id === id && c.kind !== 'manual')) throw new Error('Unknown surface');
  const body = object(input);
  if (!['good', 'ok', 'shit'].includes(body.rating) || typeof body.note !== 'string' || body.note.length > 4000) throw new Error('Expected good, ok or shit and a note of at most 4000 characters');
  const relative = `${id}/surface.json`, file = productMapPath(root, relative);
  // The catalog owns directories. A write cannot create arbitrary filesystem paths.
  const directory = productMapPath(root, id);
  try { mkdirSync(directory); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  if (!lstatSync(directory).isDirectory()) throw new Error('Surface directory unavailable');
  const existing = json(root, relative, true);
  const saved: SurfaceRating = { value: body.rating, note: body.note, at: new Date().toISOString(), source: 'user-input' };
  const encoded = JSON.stringify({ ...existing, rating: saved }, null, 2) + '\n';
  if (Buffer.byteLength(encoded) > 256_000) throw new Error('Surface record is too large');
  const tmp = productMapPath(root, `${id}/surface-${randomUUID()}.tmp`);
  writeFileSync(tmp, encoded, { flag: 'wx', mode: 0o600 });
  renameSync(tmp, file);
  return saved;
}
const types: Record<string,string> = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.md': 'text/plain; charset=utf-8', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
/** Invoke after the application's origin/auth gate. Handles only /api/product-map paths. */
export async function handleProductMap(req: IncomingMessage, res: ServerResponse, options: ProductMapOptions = {}): Promise<boolean> {
  const raw = (req.url ?? '').split('?')[0];
  if (raw !== '/api/product-map' && !raw.startsWith('/api/product-map/')) return false;
  const send = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    if (req.method === 'GET' && raw === '/api/product-map') { send(200, readProductMap(options)); return true; }
    const taskId = raw.match(/^\/api\/product-map\/tasks\/(t-\d+)$/)?.[1];
    if (req.method === 'GET' && taskId) {
      const task = options.tasks?.find(t => t.id === taskId && validId(t.links?.surface) && catalog(options.hubRoot ?? defaultRoot).some(c => c.id === t.links?.surface));
      if (!task) { send(404, { error: 'Linked task unavailable' }); return true; }
      // Explicit field projection: never serialize private task history or unrelated links.
      send(200, { id: task.id, title: task.title, stage: task.stage, agent: task.agent, updated: task.updated, surface: task.links?.surface }); return true;
    }
    const id = raw.match(/^\/api\/product-map\/([a-z_][a-z0-9_-]{0,79})\/rating$/)?.[1];
    if (req.method === 'POST' && id) {
      req.setEncoding('utf8');
      let body = ''; for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 8192) { send(413, { error: 'Rating is too large' }); return true; } }
      send(200, { rating: saveSurfaceRating(id, JSON.parse(body), options) }); return true;
    }
    if (req.method === 'GET' && raw.startsWith('/api/product-map/files/')) {
      let relative = decodeURIComponent(raw.slice('/api/product-map/files/'.length)).replace(/\/$/, '');
      const root = options.hubRoot ?? defaultRoot, id = relative.split('/')[0];
      if (!catalog(root).some(c => c.id === id)) throw new Error('Unknown surface');
      let file = productMapPath(root, relative);
      if (lstatSync(file).isDirectory()) {
        try { const index = productMapPath(root, `${relative}/index.html`); lstatSync(index); relative += '/index.html'; file = index; }
        catch {
          const entries = readdirSync(file, { withFileTypes: true }).filter(e => !e.isSymbolicLink() && /^[\w .()-]+$/.test(e.name)).slice(0, 200);
          const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
          res.end(`<title>Hub evidence</title><h1>Hub evidence</h1><ul>${entries.map(e=>`<li><a href="${assetUrl(`${relative}/${e.name}`)}${e.isDirectory()?'/':''}">${escape(e.name)}</a></li>`).join('')}</ul>`); return true;
        }
      }
      const type = types[path.extname(file).toLowerCase()];
      if (!type || lstatSync(file).size > 8_000_000) throw new Error('Unsupported catalog file');
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(type.startsWith('text/html') ? { 'Content-Security-Policy': "sandbox allow-scripts; default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" } : {}) });
      res.end(readFileSync(file)); return true;
    }
    send(404, { error: 'Product map route not found' });
  } catch { send(req.method === 'POST' ? 400 : 503, { error: req.method === 'POST' ? 'Rating was not saved: invalid input or unavailable surface' : 'Product map source unavailable' }); }
  return true;
}
