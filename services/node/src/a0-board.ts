import { open } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ROOT as TASKS_ROOT } from './a0-tasks.ts';
import { boardNotesRoot, readBoardNotes, NoteStoreError } from './a0-board-notes.ts';

export type BoardItem = { id: string; text: string; why?: string; at?: string; updated?: string; revision?: number; source?: string; status?: string; by?: string; score?: number; integrated?: boolean };
export type BoardError = 'missing' | 'malformed' | 'too-large' | 'unreadable' | 'timeout' | 'unsafe-store' | 'conflict' | 'busy' | 'invalid-command';
export type BoardSource = { items: BoardItem[]; retired?: BoardItem[]; store?: 'agent-base-board-notes-v1'; initialized?: boolean; eventCount?: number; error: BoardError | null; state: 'fresh' | 'stale' | 'unavailable'; observedAt: number | null; attemptedAt: number };
export type BoardData = { ideas: BoardSource; notes: BoardSource };
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;
class SourceError extends Error { kind: BoardError; constructor(kind: BoardError) { super(kind); this.kind = kind; } }

/** Same root configuration as the task reader; no second hard-coded Agent Zero location. */
export function boardRoot() { return path.dirname(process.env.AB_A0_TASKS ?? TASKS_ROOT); }

async function readBounded(file: string, limit: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new SourceError('unreadable');
    if (stat.size > limit) throw new SourceError('too-large');
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset <= limit) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new SourceError('too-large');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
  } finally { await handle.close(); }
}
const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;
const timestamp = (value: unknown) => value == null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
/** Whole-file validation prevents one torn line from quietly retiring the rest of a board. */
export function parseBoardSource(raw: string, kind: 'ideas' | 'notes'): BoardItem[] {
  const lines = raw.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > MAX_ROWS) throw new SourceError('too-large');
  const latest = new Map<string, { row: Record<string, unknown>; revision: number; at: number; index: number }>();
  for (const [index, line] of lines.entries()) {
    let row: Record<string, unknown>;
    try { row = JSON.parse(line); } catch { throw new SourceError('malformed'); }
    if (!row || Array.isArray(row) || typeof row !== 'object' || !text(row.id, 200) || !(row.id as string).trim() || !text(row.text, 32768) || !(row.text as string).trim()
      || !timestamp(row.at) || !timestamp(row.updated)
      || ['why', 'status', 'by'].some(key => row[key] != null && !text(row[key], key === 'why' ? 32768 : 200))
      || (row.score != null && (typeof row.score !== 'number' || !Number.isFinite(row.score)))
      || (row.revision != null && (!Number.isSafeInteger(row.revision) || (row.revision as number) < 0))
      || (row.integrated != null && typeof row.integrated !== 'boolean')) throw new SourceError('malformed');
    const next = { row, revision: typeof row.revision === 'number' ? row.revision : 0, at: Date.parse((row.updated ?? row.at ?? '') as string) || 0, index };
    const prior = latest.get(row.id as string);
    if (!prior || next.revision > prior.revision || (next.revision === prior.revision && (next.at > prior.at || (next.at === prior.at && index > prior.index)))) latest.set(row.id as string, next);
  }
  return [...latest.values()]
    .filter(({row}) => !['retired', 'rejected'].includes(String(row.status ?? '').toLowerCase()))
    .sort((a,b) => kind === 'ideas' ? Number(b.row.by === 'Shaan') - Number(a.row.by === 'Shaan') || Number(b.row.score ?? 0) - Number(a.row.score ?? 0) || b.at - a.at || b.index - a.index : b.at - a.at || b.index - a.index)
    .map(({row}) => ({ id: row.id as string, text: row.text as string,
      ...Object.fromEntries(['why', 'at', 'status', 'by', 'score'].filter(key => row[key] != null).map(key => [key, row[key]])),
      ...(row.integrated != null || row.status === 'integrated' ? {integrated: row.integrated === true || row.status === 'integrated'} : {}),
    }));
}

/** One bounded in-flight read per source. Cache and last success are independent for ideas and notes. */
export function createA0BoardReader(options: { root?: string; notesRoot?: string; ttlMs?: number; timeoutMs?: number; maxBytes?: number; now?: () => number; read?: (file: string, limit: number) => Promise<string> } = {}) {
  const root = options.root ?? boardRoot(), ttl = options.ttlMs ?? 5000, timeout = options.timeoutMs ?? 2000, limit = options.maxBytes ?? MAX_BYTES;
  const notesRoot = options.notesRoot ?? boardNotesRoot();
  const now = options.now ?? Date.now, read = options.read ?? readBounded;
  const entries = new Map<'ideas' | 'notes', { cached: BoardSource | null; pending: Promise<void> | null }>();
  async function source(kind: 'ideas' | 'notes'): Promise<BoardSource> {
    let entry = entries.get(kind);
    if (!entry) entries.set(kind, entry = {cached:null,pending:null});
    if (entry.cached && (entry.pending || now() - entry.cached.attemptedAt < ttl)) return entry.cached;
    const cell = entry;
    const attemptedAt = now();
    const fail = (error: BoardError) => {
      cell.cached = {...cell.cached,items:cell.cached?.items ?? [],error,state:cell.cached?.observedAt != null ? 'stale' : 'unavailable',observedAt:cell.cached?.observedAt ?? null,attemptedAt};
    };
    if (!cell.pending) cell.pending = (async () => {
      try {
        if (kind === 'notes' && !options.read) {
          const notes = await readBoardNotes({root:notesRoot,maxBytes:limit});
          cell.cached = {...notes,store:'agent-base-board-notes-v1',state:notes.error ? 'stale' : 'fresh',observedAt:notes.error ? cell.cached?.observedAt ?? null : now(),attemptedAt};
          return;
        }
        const raw = await read(path.join(root,kind,`${kind}.jsonl`),limit);
        if (Buffer.byteLength(raw,'utf8') > limit) throw new SourceError('too-large');
        const items = parseBoardSource(raw,kind);
        cell.cached = {items,error:null,state:'fresh',observedAt:now(),attemptedAt};
      } catch (error) {
        fail(error instanceof SourceError ? error.kind : error instanceof NoteStoreError ? error.code : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : error instanceof TypeError ? 'malformed' : 'unreadable');
      } finally { cell.pending = null; }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([cell.pending,new Promise<void>(resolve => {timer=setTimeout(()=>{fail('timeout');resolve();},timeout);})]);
    if (timer) clearTimeout(timer);
    return cell.cached!;
  }
  return async (): Promise<BoardData> => { const [ideas,notes] = await Promise.all([source('ideas'),source('notes')]); return {ideas,notes}; };
}
