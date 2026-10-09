import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** Private board data, never Agent Zero's source tree or another application's notes. */
export const NOTE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 5000;
export const boardNotesRoot = () => process.env.AB_A0_NOTES_ROOT ?? path.join(os.homedir(), '.local/state/agent-base/board-notes');
type Action = 'create' | 'update' | 'retire' | 'restore';
export type NoteCommand = { action: Action; requestId: string; by: string; source: string; id?: string; expectedRevision?: number; text?: string; why?: string };
export type BoardNote = { id: string; text: string; why: string; at: string; updated: string; status: 'open' | 'retired'; revision: number; by: string; source: string };
export type NoteEvent = BoardNote & { schema: 1; kind: 'agent-zero-board-note'; action: Action; requestId: string; requestHash: string; previousHash: string; hash: string };
export type NoteErrorCode = 'malformed' | 'too-large' | 'unreadable' | 'unsafe-store' | 'conflict' | 'busy' | 'invalid-command' | 'missing';
export class NoteStoreError extends Error {
  code: NoteErrorCode;
  constructor(code: NoteErrorCode, message: string = code) { super(message); this.code = code; }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const string = (value: unknown, max: number, empty = false) => typeof value === 'string' && value.length <= max && (empty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const actions = new Set(['create', 'update', 'retire', 'restore']);
const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

export function parseNoteCommand(value: unknown): NoteCommand {
  const c = value as NoteCommand;
  if (!c || Array.isArray(c) || typeof c !== 'object' || Object.keys(c).some(k => !['action','requestId','by','source','id','expectedRevision','text','why'].includes(k))
    || !actions.has(c.action) || !token(c.requestId) || !string(c.by, 200) || !string(c.source, 500)
    || (c.text !== undefined && !string(c.text, 32768)) || (c.why !== undefined && !string(c.why, 32768, true))) throw new NoteStoreError('invalid-command');
  if (c.action === 'create') {
    if (!string(c.text, 32768) || c.id !== undefined || c.expectedRevision !== undefined) throw new NoteStoreError('invalid-command');
  } else if (!token(c.id) || !Number.isSafeInteger(c.expectedRevision) || c.expectedRevision! < 1
    || (c.action === 'update' && c.text === undefined && c.why === undefined)
    || ((c.action === 'retire' || c.action === 'restore') && (c.text !== undefined || c.why !== undefined))) throw new NoteStoreError('invalid-command');
  // Canonical order makes retries independent of incoming JSON property order.
  return {action:c.action,requestId:c.requestId,by:c.by,source:c.source,
    ...(c.id !== undefined ? {id:c.id,expectedRevision:c.expectedRevision} : {}),
    ...(c.text !== undefined ? {text:c.text} : {}), ...(c.why !== undefined ? {why:c.why} : {})};
}

/** Every revision remains in the journal; no generic/private note format is accepted. */
export function parseNoteJournal(raw: string, maxBytes = NOTE_MAX_BYTES): NoteEvent[] {
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new NoteStoreError('too-large');
  if (raw && !raw.endsWith('\n')) throw new NoteStoreError('malformed', 'Incomplete note journal; preserve it and recover from last-good.');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length > MAX_EVENTS) throw new NoteStoreError('too-large');
  const latest = new Map<string, NoteEvent>(), requests = new Set<string>();
  let previousHash = '';
  return lines.map(line => {
    let e: NoteEvent;
    try { e = JSON.parse(line); } catch { throw new NoteStoreError('malformed'); }
    if (!e || Array.isArray(e) || Object.keys(e).some(k=>!['schema','kind','id','text','why','at','updated','status','revision','by','source','action','requestId','requestHash','previousHash','hash'].includes(k))
      || e.schema !== 1 || e.kind !== 'agent-zero-board-note' || !actions.has(e.action)
      || !token(e.id) || !token(e.requestId) || requests.has(e.requestId)
      || !string(e.text, 32768) || !string(e.why, 32768, true) || !string(e.by, 200) || !string(e.source, 500)
      || !Number.isSafeInteger(e.revision) || !['open','retired'].includes(e.status)
      || typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at)) || typeof e.updated !== 'string' || !Number.isFinite(Date.parse(e.updated))
      || !/^[a-f0-9]{64}$/.test(e.requestHash) || e.previousHash !== previousHash) throw new NoteStoreError('malformed');
    const {hash, ...payload} = e;
    if (hash !== digest(JSON.stringify(payload))) throw new NoteStoreError('malformed', 'Note journal integrity mismatch.');
    const prior = latest.get(e.id);
    if ((!prior && (e.action !== 'create' || e.revision !== 1 || e.status !== 'open'))
      || (prior && (e.action === 'create' || e.revision !== prior.revision + 1 || e.at !== prior.at
        || (e.action === 'update' && (prior.status !== 'open' || e.status !== 'open'))
        || (e.action === 'retire' && (prior.status !== 'open' || e.status !== 'retired'))
        || (e.action === 'restore' && (prior.status !== 'retired' || e.status !== 'open'))))) throw new NoteStoreError('malformed');
    previousHash = hash; requests.add(e.requestId); latest.set(e.id, e); return e;
  });
}

async function safeRoot(root: string, create = false): Promise<boolean> {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || root === path.parse(root).root) throw new NoteStoreError('unsafe-store');
  // Do not permit a configured runtime store within any Git checkout, including a worktree.
  for (let dir = root; ; dir = path.dirname(dir)) {
    try {
      const entry = await lstat(dir);
      // macOS exposes /var and /tmp as system aliases; all task-controlled links fail closed.
      if (entry.isSymbolicLink() && dir !== '/var' && dir !== '/tmp') throw new NoteStoreError('unsafe-store', 'Symlinked note store ancestry is not supported.');
    } catch (e) { if (!isMissing(e)) throw e; }
    try { await lstat(path.join(dir, '.git')); throw new NoteStoreError('unsafe-store', 'Board notes cannot live in a Git checkout.'); }
    catch (e) { if (!isMissing(e)) throw e; }
    if (dir === path.dirname(dir)) break;
  }
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new NoteStoreError('unsafe-store', 'Note store must be a private real directory (0700).');
  } catch (e) {
    if (!isMissing(e)) throw e;
    if (!create) return false;
    await mkdir(root, {recursive:true,mode:0o700});
    return safeRoot(root);
  }
  return true;
}

async function readFile(root: string, name: string, maxBytes: number): Promise<string | null> {
  let handle;
  try { handle = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (e) { if (isMissing(e)) return null; throw new NoteStoreError('unreadable'); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new NoteStoreError('unsafe-store');
    if (stat.size > maxBytes) throw new NoteStoreError('too-large');
    const buf = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buf.length) { const {bytesRead} = await handle.read(buf, offset, buf.length-offset, offset); if (!bytesRead) break; offset += bytesRead; }
    if (offset > maxBytes) throw new NoteStoreError('too-large');
    try { return new TextDecoder('utf-8', {fatal:true}).decode(buf.subarray(0,offset)); } catch { throw new NoteStoreError('malformed'); }
  } finally { await handle.close(); }
}

type Snapshot = { raw: string; events: NoteEvent[]; initialized: boolean; error: NoteErrorCode | null };
async function snapshot(root: string, maxBytes: number): Promise<Snapshot> {
  if (!await safeRoot(root)) return {raw:'',events:[],initialized:false,error:null};
  let main: string | null = null, events: NoteEvent[] = [], failure: NoteErrorCode | null = null;
  try { main = await readFile(root, 'notes.jsonl', maxBytes); events = parseNoteJournal(main ?? '', maxBytes); }
  catch (e) { failure = e instanceof NoteStoreError ? e.code : 'unreadable'; }
  // A persistent last-good copy also protects cold reader restarts after a torn/manual write.
  const good = await readFile(root, 'notes.last-good.jsonl', maxBytes);
  const goodEvents = good === null ? [] : parseNoteJournal(good, maxBytes);
  if (main === null && good !== null) failure ??= 'missing';
  if (!failure && good !== null && !(main ?? '').startsWith(good)) failure = 'malformed';
  if (failure) {
    if (good === null) throw new NoteStoreError(failure);
    return {raw:good,events:goodEvents,initialized:true,error:failure};
  }
  return {raw:main ?? '',events,initialized:main !== null,error:null};
}

export function projectNotes(events: NoteEvent[]) {
  const latest = new Map<string, NoteEvent>();
  for (const event of events) { latest.delete(event.id); latest.set(event.id, event); }
  const rows = [...latest.values()].reverse().map(({schema: _schema, kind: _kind, action: _action, requestId: _request, requestHash: _requestHash, previousHash: _previous, hash: _hash, ...note}) => note);
  return {items:rows.filter(x => x.status === 'open'),retired:rows.filter(x => x.status === 'retired')};
}
export async function readBoardNotes(options: {root?:string;maxBytes?:number} = {}) {
  const state = await snapshot(options.root ?? boardNotesRoot(), options.maxBytes ?? NOTE_MAX_BYTES);
  return {...projectNotes(state.events),error:state.error,initialized:state.initialized,eventCount:state.events.length};
}

async function atomicWrite(root: string, name: string, raw: string) {
  const temp = path.join(root, `.pending-${randomUUID()}`);
  const h = await open(temp, 'wx', 0o600);
  try {
    try { await h.writeFile(raw); await h.sync(); } finally { await h.close(); }
    await rename(temp,path.join(root,name)); const dir = await open(root,'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  finally { await unlink(temp).catch(e => {if (!isMissing(e)) throw e;}); }
}

/** Canonical local writer. CAS and durable request receipts apply across CLI/process restarts. */
export async function writeBoardNote(value: unknown, options: {root?:string;now?:()=>Date;maxBytes?:number} = {}) {
  const command = parseNoteCommand(value), root = options.root ?? boardNotesRoot(), maxBytes = options.maxBytes ?? NOTE_MAX_BYTES;
  const requestHash = digest(JSON.stringify(command));
  await safeRoot(root, true);
  const lockPath = path.join(root, '.writer-lock');
  let lock;
  for (let attempt=0; attempt<30; attempt++) {
    try { lock = await open(lockPath,'wx',0o600); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new NoteStoreError('unreadable'); await new Promise(r=>setTimeout(r,50)); }
  }
  if (!lock) throw new NoteStoreError('busy', 'Writer lock retained; no notes changed. Inspect a stopped writer before recovering its lock.');
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()})); await lock.sync();
    const before = await snapshot(root,maxBytes);
    if (before.error) throw new NoteStoreError(before.error, 'Damaged journal preserved. Restore its last-good copy only after archiving the damaged file.');
    const replay = before.events.find(x=>x.requestId===command.requestId);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new NoteStoreError('conflict', 'Request ID already belongs to different content.');
      // A crash may have committed the primary before its checkpoint; retry seals it.
      await atomicWrite(root,'notes.last-good.jsonl',before.raw);
      return {ok:true,replayed:true,id:replay.id,revision:replay.revision,status:replay.status,requestId:replay.requestId};
    }
    const prior = command.id ? [...before.events].reverse().find(x=>x.id===command.id) : undefined;
    if (command.action !== 'create' && (!prior || prior.revision !== command.expectedRevision)) throw new NoteStoreError('conflict', 'Note revision changed; read it again before retrying with a new request ID.');
    if (prior && ((command.action==='restore' && prior.status!=='retired') || (command.action!=='restore' && prior.status!=='open'))) throw new NoteStoreError('conflict', 'Note state changed.');
    const at = (options.now ?? (()=>new Date()))().toISOString();
    const payload: Omit<NoteEvent,'hash'> = {schema:1,kind:'agent-zero-board-note',id:prior?.id ?? `note-${digest(command.requestId).slice(0,24)}`,
      text:command.text ?? prior!.text,why:command.why ?? prior?.why ?? '',at:prior?.at ?? at,updated:at,status:command.action==='retire'?'retired':'open',
      revision:(prior?.revision ?? 0)+1,by:command.by,source:command.source,action:command.action,requestId:command.requestId,requestHash,
      previousHash:before.events.at(-1)?.hash ?? ''};
    const event: NoteEvent = {...payload,hash:digest(JSON.stringify(payload))};
    const raw = before.raw + JSON.stringify(event)+'\n';
    parseNoteJournal(raw,maxBytes);
    // A noncanonical external editor is not allowed to turn a read into a blind overwrite.
    if ((await readFile(root,'notes.jsonl',maxBytes) ?? '') !== before.raw) throw new NoteStoreError('conflict', 'Journal changed outside the writer.');
    await atomicWrite(root,'notes.jsonl',raw);
    await atomicWrite(root,'notes.last-good.jsonl',raw);
    return {ok:true,replayed:false,id:event.id,revision:event.revision,status:event.status,requestId:event.requestId};
  } finally { await lock.close(); await unlink(lockPath); }
}
