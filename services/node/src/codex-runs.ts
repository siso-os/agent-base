import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type Run = { id: string; name: string; about?: string; title?: string; tickets?: { id: string; title: string }[]; pid?: number; effort?: string; why?: string; usage?: { in: number; out: number }; worker?: string; batch?: string; model: string; parent_session?: string; parent_pane?: string; dir: string; started: number; ended: number | null; running: boolean; status: string; step: string; ticket: string; tokens: number; rate: number; rateMeasured?: boolean; rateEstimated?: boolean; estimated: boolean; items: { id: string; type: string; text: string }[] };
const samples = new Map<string, { at: number; firstAt: number; chars: number; points: { start: number; at: number; tokens: number }[] }>();
const read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
export const belongs = (r: Pick<Run, 'parent_session' | 'parent_pane'>, a: { session: string | null; pane?: string }) => r.parent_session ? r.parent_session === a.session : !!(r.parent_pane && r.parent_pane === a.pane);
type RunSummary = { stamp: string; usage: number; input: number; chars: number; step: string };
type ParsedRun = RunSummary & { items: Run['items'] };
const parsed = new Map<string, ParsedRun>();
// Polling needs counts and the last line, not retained transcript bodies. Keep this
// cache separate from the small on-demand detail cache. At capacity, decline new
// admissions instead of evicting every later hit during a sequential inventory scan.
const summaries = new Map<string, RunSummary>();
const MAX_SUMMARIES = 4096;
type Sidecar = { stamp: string; hasText: boolean; ended: number | null; status?: string; tickets: string[] };
const sidecars = new Map<string, Sidecar>();
const MAX_SIDECARS = 4096, MAX_CACHED_TICKETS = 64;
const detached = (text: string) => Buffer.from(text, 'utf16le').toString('utf16le');
const taskTickets = (text: string): string[] => [...new Set((text.match(/^TASK[^\n]*/im)?.[0] ?? text).match(/t-\d{4}/g) ?? [])].map(detached);
/** Summary reads cache parsed sidecar fields, never prompt/result bodies. Missing
 * optional files use non-throwing stat; completed mtime still survives read errors. */
function sidecar(file: string, result = false): Sidecar | undefined {
  let st, statFailed = false;
  try { st = statSync(file, { throwIfNoEntry: false }); } catch { statFailed = true; }
  if (!st && !statFailed) { sidecars.delete(file); return undefined; }
  // A non-ENOENT stat failure does not establish that the body is unreadable.
  // Preserve the original read fallback, but never admit that observation.
  const stamp = st ? `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}` : '';
  const cached = sidecars.get(file);
  if (st && cached?.stamp === stamp) return cached;
  // An invalidated entry must not occupy a slot if its replacement is unreadable
  // or exceeds the ticket admission limit.
  if (st && cached) sidecars.delete(file);
  let text = '', readOk = true, stable = true, ended = st?.mtimeMs ?? null;
  try { text = readFileSync(file, 'utf8'); } catch { readOk = false; }
  if (result && st) {
    // On a miss, keep the original read-then-stat completion timestamp. If the
    // result changed during the read, return it uncached and retry next time.
    try {
      const after = statSync(file, { throwIfNoEntry: false });
      ended = after?.mtimeMs ?? null;
      stable = !!after && stamp === `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}`;
    } catch { ended = null; stable = false; }
  }
  const found = result ? text.match(/STATUS:\s*(done|failed|blocked)/i)?.[1]?.toLowerCase() : undefined;
  const status = found === undefined ? undefined : detached(found);
  const tickets = result ? [] : taskTickets(text);
  const value: Sidecar = { stamp, hasText: !!text, ended, status, tickets };
  if (st && readOk && stable && tickets.length <= MAX_CACHED_TICKETS && (sidecars.has(file) || sidecars.size < MAX_SIDECARS)) sidecars.set(file, value);
  return value;
}
// t-0534: every fleet-board read parsed every run's meta.json (253 on the laptop, 1.3 s of each 45 s). Parsed metadata
// is kept by stat stamp, small files only; callers only read it. A failed read or parse is never kept.
const metas = new Map<string, { stamp: string; meta: any }>();
const MAX_META_BYTES = 64 * 1024;
/** A run's metadata, parsed once per stat stamp; shared, so callers copy before changing it. */
export function readMeta(file: string): any {
  let st; try { st = statSync(file); } catch { metas.delete(file); return undefined; }
  const stamp = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`, hit = metas.get(file);
  if (hit?.stamp === stamp) return hit.meta;
  let meta: any; try { meta = JSON.parse(readFileSync(file, 'utf8')); } catch { metas.delete(file); return undefined; }
  if (st.size <= MAX_META_BYTES && (metas.has(file) || metas.size < MAX_SIDECARS)) metas.set(file, { stamp, meta }); else metas.delete(file);
  return meta;
}
/** Called on the existing agents refresh. Partial JSON lines are retried on the next read. */
export function readCodexRuns(now = Date.now(), root = process.env.AB_CODEX_RUNS ?? path.join(os.homedir(), '.local/state/codex-run/runs'), parent?: { session: string | null; pane?: string }, options: { includeItems?: boolean } = {}): Run[] {
  root = path.resolve(root);
  let files: string[]; try { files = readdirSync(root); } catch { return []; }
  const metadata = files.filter(f => /^[\w.-]+\.meta\.json$/.test(f));
  const liveLogs = new Set(metadata.map(f => path.join(root, f.slice(0, -10)) + '.jsonl'));
  const present = new Set(files);
  // Only successful enumeration proves deletion; scope cleanup to this root.
  for (const key of summaries.keys()) if (path.dirname(key) === root && !liveLogs.has(key)) summaries.delete(key);
  for (const key of metas.keys()) if (path.dirname(key) === root && !present.has(path.basename(key))) metas.delete(key);
  for (const key of sidecars.keys()) if (path.dirname(key) === root) {
    const name = path.basename(key), meta = name.replace(/\.(last|task|prompt)\.md$/, '.meta.json');
    if (!present.has(name) || !present.has(meta)) sidecars.delete(key);
  }
  const includeItems = options.includeItems !== false;
  const result: Run[] = [];
  for (const file of metadata) {
    const id = file.slice(0, -10), prefix = path.join(root, id);
    const meta = readMeta(path.join(root, file)); if (meta === undefined) continue;
    if (parent && !belongs(meta, parent)) continue;
    let ended: number | null = null, lastStatus: string | undefined;
    if (includeItems) {
      const last = read(prefix + '.last.md');
      try { ended = statSync(prefix + '.last.md').mtimeMs; } catch { /* unfinished */ }
      lastStatus = last.match(/STATUS:\s*(done|failed|blocked)/i)?.[1]?.toLowerCase();
    } else {
      const last = sidecar(prefix + '.last.md', true);
      ended = last?.ended ?? null; lastStatus = last?.status;
    }
    let alive = false; try { if (Number.isInteger(meta.pid) && meta.pid > 0) { process.kill(meta.pid, 0); alive = true; } } catch (e) { alive = (e as NodeJS.ErrnoException).code === 'EPERM'; }
    const running = alive && ended === null;
    const started = typeof meta.started === 'number' ? (meta.started < 1e12 ? meta.started * 1000 : meta.started) : Date.parse(meta.started);
    if (!Number.isFinite(started)) continue;
    const log=prefix+'.jsonl';let stamp='';
    try{const s=statSync(log);stamp=`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}catch{/* not written yet */}
    let hit: RunSummary | ParsedRun | undefined = includeItems ? parsed.get(log) : summaries.get(log);
    if(!hit||hit.stamp!==stamp){
    const detail = parsed.get(log);
    if (!includeItems && detail?.stamp === stamp) hit = detail;
    else {
    const stream = read(log), items = new Map<string, Run['items'][number]>();
    let usage = 0, input = 0, chars = 0;
    for (const line of stream.split('\n')) {
      let ev: any; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'turn.completed') { usage += Number(ev.usage?.output_tokens) || 0; input += Number(ev.usage?.input_tokens) || 0; }
      const it = ev.item;
      if (!it?.id) continue;
      const text = it.text ?? (it.type === 'command_execution' ? [it.command, it.aggregated_output].filter(Boolean).join('\n') : it.type === 'file_change' ? (it.changes ?? []).map((c: any) => `${c.kind}: ${c.path}`).join('\n') : '');
      items.delete(it.id); items.set(it.id, { id: it.id, type: it.type, text: String(text) });
    }
    for (const it of items.values()) if (/reasoning|agent_message/.test(it.type)) chars += it.text.length;
    const values = [...items.values()];
    // V8 can retain a whole message behind a short sliced string. Detach the
    // bounded step; UTF-16 preserves even a surrogate split at the 180-unit limit.
    const step = Buffer.from(stepLine(values.at(-1)?.text ?? ''), 'utf16le').toString('utf16le');
    const entry: ParsedRun = {stamp,items:values,usage,input,chars,step};
    hit = entry;
    if (includeItems) {
      parsed.set(log, entry);
      if(parsed.size>32)parsed.delete(parsed.keys().next().value!);
    }
    }
    if (summaries.has(log) || summaries.size < MAX_SUMMARIES) {
      const {stamp,usage,input,chars,step} = hit;
      summaries.set(log, {stamp,usage,input,chars,step});
    }
    }
    const {usage,input,chars,step}=hit;
    const items = includeItems && 'items' in hit ? hit.items : [];
    const tokens = usage || Math.ceil(chars / 4), estimated = usage === 0;
    const key = prefix, prev = samples.get(key);
    const contiguous = !!prev && now >= prev.at && now - prev.at <= 15_000 && chars >= prev.chars;
    const firstAt = contiguous ? prev.firstAt : now;
    const points = contiguous ? prev.points.filter(p => p.at > now - 5000) : [];
    // Only newly observed generated text enters this estimate. Turn-completed usage is an
    // accounting reconciliation, not a burst of output in the last five seconds.
    if (contiguous && now > prev.at && chars > prev.chars) points.push({ start: prev.at, at: now, tokens: (chars - prev.chars) / 4 });
    const output = points.reduce((sum, point) => sum + point.tokens * Math.max(0, point.at - Math.max(point.start, now - 5000)) / (point.at - point.start), 0);
    const measuredMs = Math.min(5000, Math.max(0, now - firstAt));
    const rate = contiguous && measuredMs > 0 ? output / (measuredMs / 1000) : 0;
    samples.set(key, { at: now, firstAt, chars, points });
    let taskIds: string[];
    if (includeItems) taskIds = taskTickets(read(prefix + '.task.md') || read(prefix + '.prompt.md') || String(meta.task ?? ''));
    else {
      const task = sidecar(prefix + '.task.md');
      const prompt = task?.hasText ? undefined : sidecar(prefix + '.prompt.md');
      taskIds = task?.hasText ? task.tickets : prompt?.hasText ? prompt.tickets : taskTickets(String(meta.task ?? ''));
    }
    const ids: string[] = [...new Set<string>([...(Array.isArray(meta.tickets) ? meta.tickets.filter((t: unknown) => typeof t === 'string' && /^t-\d{4}$/.test(t)) : []), ...taskIds])];
    const tickets = ids.map(id => { try { const data = JSON.parse(read(path.join(process.env.AB_A0_TASKS ?? path.join(os.homedir(), 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/tasks'), id + '.json'))); return { id, title: String(data.short ?? data.title ?? id) }; } catch { return { id, title: id }; } });
    const ticket = tickets.map(t => `${t.id} ${t.title}`).join(' · ');
    const heading = String(meta.name ?? '').replace(/^#+\s*/, '').match(/^[^:]+:\s*(.+)$/)?.[1];
    result.push({ id, title: heading, tickets, pid: Number.isInteger(meta.pid) && meta.pid > 0 ? meta.pid : undefined, effort: typeof meta.effort === 'string' ? meta.effort : undefined, why: typeof meta.why === 'string' ? meta.why : undefined, usage: usage || input ? { in: input, out: usage } : undefined, batch: typeof meta.batch === "string" ? meta.batch : undefined, about: typeof meta.about === "string" ? meta.about : undefined, name: String(meta.name ?? meta.worker ?? id), worker: typeof meta.worker === 'string' ? meta.worker : undefined, model: String(meta.model ?? 'Codex'), parent_session: meta.parent_session, parent_pane: meta.parent_pane, dir: String(meta.dir ?? ''), started, ended, running, status: running ? 'working' : lastStatus ?? 'blocked', step, ticket, tokens, rate: running ? rate : 0, rateMeasured: contiguous && measuredMs > 0, rateEstimated: true, estimated, items: [...items] });
  }
  return result.sort((a, b) => b.started - a.started);
}
export const visibleRuns = (runs: Run[], now = Date.now()) => runs.filter(r => r.running || now - (r.ended ?? r.started) < 600_000);
export function codexWorkerRows(runs: Run[], template: any) {
  return [...new Set(runs.flatMap(r => r.worker ? [r.worker] : []))].map(worker => {
    const history = runs.filter(r => r.worker === worker), current = history.find(r => r.running) ?? history[0];
    return { ...template, id: `codex-worker:${worker}`, key: `codex-worker:${worker}`, name: worker, title: [current.ticket, current.step].filter(Boolean).join(' · '), pane: '', session: null, zero: false, a0: false, host: false, chat: true, tool: 'codex', status: history.some(r => r.running) ? 'working' : 'idle', since: current.started, lastEvent: Date.now(), cwd: current.dir, row: 'live', pinned: false, owner: 'Agent Zero', lead: 'Agent Zero', kind: 'worker', codexWorker: worker, codexRuns: history, hud: null, pages: [] };
  });
}

/** Explicit batches win. Otherwise cluster launch times, only within the same parent session. */
export function groupCodexRuns(runs: Run[]) {
  const groups: { id: string; name: string; parent?: string; started: number; runs: Run[] }[] = [];
  for (const run of [...runs].sort((a,b) => a.started - b.started || a.id.localeCompare(b.id))) {
    let group = groups.find(g => g.parent === run.parent_session && (run.batch ? g.id === `${run.parent_session}:${run.batch}` : !g.runs[0].batch && run.started - g.started <= 60_000));
    if (!group) groups.push(group = { id: run.batch ? `${run.parent_session}:${run.batch}` : `${run.parent_session}:${run.id}`, name: run.batch ?? "Research run", parent: run.parent_session, started: run.started, runs: [] });
    group.runs.push(run);
  }
  return groups;
}

/** The Codex thread a run worked in (its first `thread.started`), so the app can reopen it as a live chat. */
export function runThread(id: string, root = process.env.AB_CODEX_RUNS ?? path.join(os.homedir(), '.local/state/codex-run/runs')): string | null {
  if (!/^[\w.-]+$/.test(id)) return null;
  for (const line of read(path.join(root, id + '.jsonl')).split('\n')) {
    if (!line.includes('thread.started')) continue;
    try { const ev = JSON.parse(line); if (typeof ev.thread_id === 'string') return ev.thread_id; } catch { /* partial line */ }
  }
  return null;
}

/** The row's line: the first real line of the last message, past a bare "RETURN" heading and a "STATUS:" label (5 Oct: rows read "RETURN"). */
export function stepLine(text: string): string {
  const line = text.split('\n').map(l => l.replace(/[*_`#]/g, '').trim()).find(l => l && !/^RETURN$/i.test(l)) ?? '';
  return line.replace(/^STATUS:\s*/i, '').slice(0, 180);
}
