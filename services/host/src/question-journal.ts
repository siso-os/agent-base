/** Private question state. Saved data is evidence, never a replacement for a provider callback. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dropTemp, persist } from './disk.ts';
import path from 'node:path';
import type { QuestionEvent, QuestionRequest } from './questions.ts';

export type QuestionOwner = { seat: string; cwd: string; provider: 'claude' | 'codex'; workspaceId?: string; serviceLabel?: string };
export type QuestionRecord = {
  request: QuestionRequest; nativeKey: string | null; fingerprint: string;
  phase: 'pending' | 'dispatching' | 'unconfirmed' | 'answered' | 'dismissed' | 'cancelled' | 'expired';
  updatedAt: number; reason?: string; reboundTo?: { id: string; hostInstance: string };
};
export type QuestionSubmission = { id: string; requestId: string; hostInstance: string; hash: string; phase: 'dispatching' | 'unconfirmed' | 'complete'; event?: Exclude<QuestionEvent, { t: 'question' }> };
export type QuestionJournalData = { version: 1; owner: QuestionOwner; session: string; revision: number; records: QuestionRecord[]; submissions: QuestionSubmission[] };
const MAX_BYTES = 8 * 1024 * 1024;
export const questionHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = (v: unknown, max = 180): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;

export class QuestionJournal {
  blocked: string | null = null;
  readonly file: string | null;
  private data: QuestionJournalData;
  private goodBody: string | null = null;
  constructor(owner: QuestionOwner, session: string, directory?: string) {
    if (!nonempty(session) || !nonempty(owner.seat) || !nonempty(owner.cwd, 4096) || !['claude', 'codex'].includes(owner.provider)) throw Error('Invalid question owner');
    this.data = { version: 1, owner: structuredClone(owner), session, revision: 0, records: [], submissions: [] };
    this.file = directory ? path.join(directory, questionHash([owner, session]) + '.json') : null;
    if (!this.file) return;
    try {
      mkdirSync(directory!, { recursive: true, mode: 0o700 });
      if (lstatSync(directory!).isSymbolicLink()) throw Error('Question directory is a symlink');
      this.lock();
      if (!existsSync(this.file)) {
        if (existsSync(this.file + '.last-good')) throw Error('Primary question state is missing');
        return;
      }
      this.data = this.read(this.file);
      this.goodBody = JSON.stringify(this.data);
    } catch {
      // A fallback can show history, but may have lost a submission reservation: never deliver from it.
      this.blocked = 'Question journal unavailable; recovered history is read-only';
      try { this.data = this.read(this.file + '.last-good'); } catch { /* No valid same-owner history. */ }
    }
  }
  snapshot() { return structuredClone(this.data); }
  private validate(value: QuestionJournalData) {
    if (value?.version !== 1 || questionHash(value.owner) !== questionHash(this.data.owner) || value.session !== this.data.session || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.records) || value.records.length > 256 || !Array.isArray(value.submissions) || value.submissions.length > 1000) throw Error('Invalid question journal');
    if (new Set(value.records.map(r => r?.request?.id)).size !== value.records.length || new Set(value.submissions.map(s => s?.id)).size !== value.submissions.length) throw Error('Duplicate question journal identity');
    for (const r of value.records) {
      const q = r?.request;
      if (!q || !nonempty(q.id) || !nonempty(q.hostInstance) || !nonempty(q.toolId) || q.session !== value.session || q.provider !== value.owner.provider || q.mode !== 'live' || !Array.isArray(q.questions) || !q.questions.length || q.questions.length > 20 || !Number.isFinite(q.createdAt) || !Number.isFinite(q.expiresAt) || q.expiresAt <= q.createdAt || !Number.isFinite(r.updatedAt) || !['pending','dispatching','unconfirmed','answered','dismissed','cancelled','expired'].includes(r.phase) || !/^[a-f0-9]{64}$/.test(r.fingerprint) || r.nativeKey !== null && !/^[a-f0-9]{64}$/.test(r.nativeKey)) throw Error('Invalid saved question');
      if (questionHash(q.questions) !== r.fingerprint || new Set(q.questions.map(x => x?.id)).size !== q.questions.length || q.questions.some(x => !nonempty(x?.id) || !nonempty(x.header, 1000) || !nonempty(x.question, 10000) || !['multiple','allowCustom','required'].every(key => typeof (x as any)[key] === 'boolean') || !Array.isArray(x.options) || x.options.length > 30 || new Set(x.options.map(o => o?.value)).size !== x.options.length || x.options.some(o => !nonempty(o?.value, 1000) || !nonempty(o.label, 1000) || typeof o.description !== 'string' || o.description.length > 5000))) throw Error('Invalid saved question body');
      if (q.nativeRequestId !== undefined && !nonempty(q.nativeRequestId) || q.turnId !== undefined && !nonempty(q.turnId)) throw Error('Invalid native question reference');
      if (q.recoveredFrom && !value.records.some(prior => prior.request.id === q.recoveredFrom!.id && prior.request.hostInstance === q.recoveredFrom!.hostInstance && prior.fingerprint === r.fingerprint && prior.nativeKey !== null && prior.nativeKey === r.nativeKey)) throw Error('Invalid question recovery reference');
      if (r.reboundTo && !value.records.some(next => next.request.id === r.reboundTo!.id && next.request.hostInstance === r.reboundTo!.hostInstance && next.fingerprint === r.fingerprint && next.nativeKey === r.nativeKey)) throw Error('Invalid question rebound reference');
    }
    for (const s of value.submissions) {
      const r = value.records.find(r => r.request.id === s?.requestId);
      if (!nonempty(s?.id) || !r || s.hostInstance !== r.request.hostInstance || !/^[a-f0-9]{64}$/.test(s.hash) || !['dispatching','unconfirmed','complete'].includes(s.phase) || s.phase === 'complete' && !s.event || s.event && (s.event.id !== s.requestId || s.event.hostInstance !== s.hostInstance || s.event.t !== 'question_done' || !['answered','dismissed','cancelled','expired'].includes(s.event.outcome) || !Number.isFinite(s.event.at))) throw Error('Invalid saved submission');
    }
  }
  private read(file: string) {
    if (lstatSync(file).isSymbolicLink() || statSync(file).size > MAX_BYTES) throw Error('Invalid question state file');
    const value = JSON.parse(readFileSync(file, 'utf8')) as QuestionJournalData;
    this.validate(value); return value;
  }
  private lock() {
    const file = this.file! + '.lock';
    if (existsSync(file)) {
      if (lstatSync(file).isSymbolicLink()) throw Error('Invalid question lock');
      const held = JSON.parse(readFileSync(file, 'utf8'));
      if (!Number.isInteger(held.pid) || held.pid <= 0) throw Error('Invalid question lock');
      try { process.kill(held.pid, 0); throw Error('Question journal already has a writer'); }
      catch (e: any) { if (e.code !== 'ESRCH') throw e; }
      renameSync(file, file + '.' + randomUUID() + '.retired');
    }
    const fd = openSync(file, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); } finally { closeSync(fd); }
  }
  private atomic(file: string, body: string) {
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw Error('Invalid question state destination');
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      const fd = openSync(tmp, 'wx', 0o600);
      try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, file);
    } catch (e) { dropTemp(tmp); throw e; }
    const parent = openSync(path.dirname(file), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  update(change: (data: QuestionJournalData) => void) {
    if (this.blocked) throw Error(this.blocked);
    const next = this.snapshot(); change(next); next.revision++;
    this.validate(next);
    const body = JSON.stringify(next);
    if (Buffer.byteLength(body) > MAX_BYTES) throw Error('Question journal size limit reached');
    if (this.file) {
      const file = this.file, good = this.goodBody ?? body;
      try {
        // t-0504: no space keeps the questions in memory and saves them when there is room; other failures still block.
        persist('questions:' + file, () => { this.atomic(file + '.last-good', good); this.atomic(file, body); });
      } catch { this.blocked = 'Question persistence failed; delivery is unavailable'; throw Error(this.blocked); }
    }
    this.data = structuredClone(next); this.goodBody = body;
  }
}
