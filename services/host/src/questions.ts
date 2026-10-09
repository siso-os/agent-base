// Question adapters/lifecycle adapted from T3 Code (MIT) and OpenCode (MIT); timeout policy studied in Vibe Kanban (Apache-2.0).
import { randomUUID } from 'node:crypto';
import { QuestionJournal, questionHash, type QuestionOwner, type QuestionRecord } from './question-journal.ts';
export type QuestionSpec = { id: string; header: string; question: string; options: { value: string; label: string; description: string }[]; multiple: boolean; allowCustom: boolean; required: boolean };
export type QuestionAnswers = Record<string, string[]>;
export type QuestionRequest = { id: string; hostInstance: string; session: string; turnId?: string; toolId: string; nativeRequestId?: string; provider: 'codex' | 'claude'; mode: 'live'; questions: QuestionSpec[]; createdAt: number; expiresAt: number; recoveredFrom?: { id: string; hostInstance: string } };
export type QuestionEvent = { t: 'question'; request: QuestionRequest } | { t: 'question_done'; id: string; hostInstance: string; outcome: 'answered' | 'dismissed' | 'cancelled' | 'expired'; at: number; reason?: string } | { t: 'question_failed'; id: string; hostInstance: string; submissionId: string; code: string; text: string };
function text(x: unknown, max = 10000): string { if (typeof x !== 'string' || !x.length || x.length > max) throw Error('Invalid question text'); return x; }
export function normalizeQuestions(raw: any, provider: 'codex' | 'claude'): QuestionSpec[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw Error('Invalid questions');
  const ids = new Set<string>(), nativeText = new Set<string>();
  return raw.map((q, i) => {
    if (!q || q.isSecret === true) throw Error('Secret questions are unsupported');
    const id = provider === 'codex' ? text(q.id, 180) : `q${i}`;
    const question = text(q.question);
    if (ids.has(id) || (provider === 'claude' && nativeText.has(question))) throw Error('Duplicate question identity');
    ids.add(id); nativeText.add(question);
    if (q.options != null && (!Array.isArray(q.options) || q.options.length > 30)) throw Error('Invalid question options');
    const values = new Set<string>();
    const options = (q.options ?? []).map((o: any) => {
      const label = text(o.label, 1000), value = o.value === undefined ? label : text(o.value, 1000);
      if (values.has(value)) throw Error('Duplicate option value'); values.add(value);
      return { value, label, description: o.description === undefined || o.description === '' ? '' : text(o.description, 5000) };
    });
    return { id, question, header: q.header ? text(q.header, 1000) : 'Question', options, multiple: provider === 'claude' ? q.multiSelect === true : q.multiSelect === true, allowCustom: provider === 'claude' || q.isOther !== false, required: true };
  });
}
export function validateAnswers(r: QuestionRequest, a: any): QuestionAnswers {
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).length !== r.questions.length || Object.keys(a).some(id => !r.questions.some(q => q.id === id))) throw Error('Invalid answer IDs');
  return Object.fromEntries(r.questions.map(q => {
    const v = a[q.id];
    if (!Array.isArray(v) || !v.length || v.length > 30 || (!q.multiple && v.length !== 1) || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 10000 || (!q.allowCustom && !q.options.some(o => o.value === x))) || new Set(v).size !== v.length) throw Error('Incomplete or invalid answer');
    return [q.id, [...v]];
  }));
}
type Done = Extract<QuestionEvent, { t: 'question_done' }>;
type Pending = { request: QuestionRequest; journal: QuestionJournal; settle: (a: QuestionAnswers | null, reason?: string) => Promise<void>; timer: ReturnType<typeof setTimeout>; cleanup?: () => void; settling: boolean; suspended?: boolean; event?: Done; submissionId?: string };
export type QuestionPersistence = { owner: QuestionOwner; directory: string };
export type QuestionRecoverySnapshot = {
  version: 1; hostInstance: string; session: string | null; status: 'ready' | 'unavailable' | 'memory-only'; reason?: string;
  records: (QuestionRecord & { actionable: false })[];
  submissions: { id: string; requestId: string; hostInstance: string; phase: 'dispatching' | 'unconfirmed' | 'complete'; event?: Exclude<QuestionEvent, { t: 'question' }> }[];
};
export class Questions {
  readonly hostInstance = randomUUID();
  private pending = new Map<string, Pending>();
  private journals = new Map<string, QuestionJournal>();
  private emit: (e: QuestionEvent) => void;
  private persistence?: QuestionPersistence;
  constructor(emit: (e: QuestionEvent) => void, persistence?: QuestionPersistence) { this.emit = e => emit(structuredClone(e)); this.persistence = persistence ? structuredClone(persistence) : undefined; }
  private journal(session: string, provider: 'claude' | 'codex') {
    if (this.persistence && provider !== this.persistence.owner.provider) throw Error('Question provider identity changed');
    const key = provider + '\n' + session;
    let journal = this.journals.get(key);
    if (!journal) {
      journal = new QuestionJournal(this.persistence?.owner ?? { seat: this.hostInstance, cwd: process.cwd(), provider }, session, this.persistence?.directory);
      this.journals.set(key, journal);
      if (!journal.blocked && journal.snapshot().records.some(r => r.request.hostInstance !== this.hostInstance && ['pending','dispatching'].includes(r.phase))) {
        try { journal.update(d => {
          for (const r of d.records) if (r.request.hostInstance !== this.hostInstance && ['pending','dispatching'].includes(r.phase)) { r.phase = 'unconfirmed'; r.reason = 'Host restarted; provider has not rebound this request'; r.updatedAt = Date.now(); }
          for (const s of d.submissions) if (s.phase === 'dispatching') s.phase = 'unconfirmed';
        }); } catch { /* Keep last-good evidence visible; blocked journal prevents delivery. */ }
      }
    }
    return journal;
  }
  snapshot() { return structuredClone([...this.pending.values()].map(p => p.request)); }
  /** A fresh hello separates real callbacks from recovered evidence. None of these records is actionable. */
  recoverySnapshot(session: string | null): QuestionRecoverySnapshot {
    const journals = session ? this.persistence ? [this.journal(session, this.persistence.owner.provider)] : [...this.journals.values()].filter(j => j.snapshot().session === session) : [];
    const blocked = journals.find(j => j.blocked)?.blocked;
    return {
      version: 1, hostInstance: this.hostInstance, session, status: blocked ? 'unavailable' : this.persistence ? 'ready' : 'memory-only', ...(blocked ? { reason: blocked } : {}),
      records: journals.flatMap(j => j.snapshot().records.filter(r => !this.pending.has(r.request.id)).map(r => ({ ...r, phase: ['pending','dispatching'].includes(r.phase) ? 'unconfirmed' as const : r.phase, actionable: false as const }))),
      submissions: journals.flatMap(j => j.snapshot().submissions.map(({ hash: _hash, ...s }) => ({ ...s, phase: s.phase === 'dispatching' && s.hostInstance !== this.hostInstance ? 'unconfirmed' as const : s.phase }))),
    };
  }
  get size() { return this.pending.size; }
  add(input: Omit<QuestionRequest,'id'|'hostInstance'|'mode'|'createdAt'|'expiresAt'|'recoveredFrom'>, settle: Pending['settle'], signal?: AbortSignal) {
    const journal = this.journal(input.session, input.provider);
    if (journal.blocked) throw Error(journal.blocked);
    if (input.nativeRequestId !== undefined && (typeof input.nativeRequestId !== 'string' || !input.nativeRequestId || input.nativeRequestId.length > 180)) throw Error('Invalid native question identity');
    const nativeKey = input.nativeRequestId ? questionHash([input.provider, input.nativeRequestId, input.toolId, input.provider === 'codex' ? input.turnId : null]) : null;
    const fingerprint = questionHash(input.questions), records = journal.snapshot().records;
    const sameNative = nativeKey ? records.filter(r => r.nativeKey === nativeKey) : [];
    const live = sameNative.find(r => this.pending.has(r.request.id));
    if (live) {
      if (live.fingerprint !== fingerprint) throw Error('Native question identity changed');
      return structuredClone(live.request); // Duplicate provider envelope, not a second callback to answer.
    }
    const prior = sameNative.filter(r => r.fingerprint === fingerprint).at(-1);
    if (prior?.request.hostInstance === this.hostInstance && ['answered','dismissed','cancelled','expired'].includes(prior.phase)) return structuredClone(prior.request);
    const now = Date.now(), duration = Number(process.env.AB_QUESTION_TIMEOUT_MS ?? 36000000);
    const request: QuestionRequest = { ...structuredClone(input), id: 'q:' + randomUUID(), hostInstance: this.hostInstance, mode: 'live', createdAt: now, expiresAt: now + (Number.isFinite(duration) && duration > 0 ? duration : 36000000), ...(prior ? { recoveredFrom: { id: prior.request.id, hostInstance: prior.request.hostInstance } } : {}) };
    journal.update(d => {
      if (d.records.length >= 256) throw Error('Question history limit reached; identities retained');
      d.records.push({ request, nativeKey, fingerprint, phase: 'pending', updatedAt: now });
      if (prior) d.records.find(r => r.request.id === prior.request.id)!.reboundTo = { id: request.id, hostInstance: this.hostInstance };
    });
    const p: Pending = { request, journal, settle, settling: false, timer: setTimeout(() => { void this.finish(p, null, 'expired'); }, request.expiresAt - now) };
    this.pending.set(request.id, p);
    if (signal) {
      const abort = () => { void this.finish(p, null, 'cancelled'); };
      signal.addEventListener('abort', abort, { once: true }); p.cleanup = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) { abort(); return structuredClone(request); }
    }
    this.emit({ t: 'question', request }); return structuredClone(request);
  }
  async answer(m: any) {
    const fail = (code: string, message: string) => this.emit({ t: 'question_failed', id: m.id, hostInstance: this.hostInstance, submissionId: m.submissionId, code, text: message });
    if (m.hostInstance !== this.hostInstance || typeof m.submissionId !== 'string' || !m.submissionId.trim() || m.submissionId.length > 180 || !['answer','dismiss'].includes(m.action)) return fail('stale','This question is unavailable');
    const p = this.pending.get(m.id);
    const journal = p?.journal ?? [...this.journals.values()].find(j => j.snapshot().records.some(r => r.request.id === m.id));
    const hash = questionHash([m.id, m.hostInstance, m.session, m.action, m.action === 'dismiss' ? null : Object.entries(m.answers ?? {}).sort(([a],[b]) => a.localeCompare(b))]);
    // Reservations precede provider I/O, including concurrent answers to different questions.
    const old = journal?.snapshot().submissions.find(s => s.id === m.submissionId);
    if (old) {
      if (old.hash !== hash) return fail('invalid','Submission identity conflict');
      if (old.event) { this.emit(old.event); return old.event; }
      if (old.phase === 'dispatching' && this.pending.has(old.requestId)) return;
      return fail('unconfirmed','Previous answer delivery is unconfirmed; wait for a newly emitted provider question');
    }
    if (!p || p.request.session !== m.session || p.settling) return fail('stale','This question is no longer pending');
    let a: QuestionAnswers | null;
    try { a = m.action === 'dismiss' ? null : validateAnswers(p.request, m.answers); } catch (e) { return fail('invalid',(e as Error).message); }
    try {
      p.journal.update(d => {
        if (d.submissions.length >= 1000) throw Error('Question submission limit reached; identities retained');
        d.submissions.push({ id: m.submissionId, requestId: p.request.id, hostInstance: this.hostInstance, hash, phase: 'dispatching' });
        d.records.find(r => r.request.id === p.request.id)!.phase = 'dispatching';
      });
      p.submissionId = m.submissionId;
      return await this.finish(p, a, m.action === 'dismiss' ? 'dismissed' : 'answered');
    } catch { fail('unavailable','Answer delivery unavailable; do not resend without a live snapshot'); }
  }
  private async finish(p: Pending, a: QuestionAnswers | null, outcome: 'answered'|'dismissed'|'cancelled'|'expired', send = true) {
    if (p.settling || !this.pending.has(p.request.id)) return;
    p.settling = true; clearTimeout(p.timer); p.cleanup?.();
    let uncertain = false;
    try { if (send) await p.settle(a, outcome); }
    catch { uncertain = true; outcome = 'cancelled'; }
    if (p.suspended) return p.event;
    this.pending.delete(p.request.id);
    let event: Done = { t: 'question_done', id: p.request.id, hostInstance: this.hostInstance, outcome, at: Date.now(), ...(uncertain ? { reason: 'delivery-unconfirmed' } : {}) };
    try {
      p.journal.update(d => {
        const r = d.records.find(r => r.request.id === p.request.id)!;
        r.phase = uncertain ? 'unconfirmed' : outcome; r.updatedAt = event.at; r.reason = event.reason;
        const s = d.submissions.find(s => s.id === p.submissionId);
        if (s) { s.phase = uncertain ? 'unconfirmed' : 'complete'; s.event = event; }
      });
    } catch { event = { ...event, outcome: 'cancelled', reason: 'delivery-unconfirmed' }; }
    this.emit(event); return event;
  }
  /** Loss of a process/transport is not a provider cancellation or a recoverable JS callback. */
  suspend() {
    for (const p of this.pending.values()) {
      p.suspended = true; clearTimeout(p.timer); p.cleanup?.();
      p.event = { t: 'question_done', id: p.request.id, hostInstance: this.hostInstance, outcome: 'cancelled', at: Date.now(), reason: 'delivery-unconfirmed' };
      try {
        p.journal.update(d => {
          const r = d.records.find(r => r.request.id === p.request.id)!; r.phase = 'unconfirmed'; r.updatedAt = Date.now(); r.reason = 'Provider callback unavailable; wait for native re-emission';
          const s = d.submissions.find(s => s.id === p.submissionId); if (s) s.phase = 'unconfirmed';
        });
      } catch { /* Snapshot reports storage unavailable; never send a replacement answer. */ }
      this.emit(p.event);
    }
    this.pending.clear();
  }
  cancel(turnId?: string, send = false) { for (const p of this.pending.values()) if (!turnId || p.request.turnId === turnId) void this.finish(p, null, 'cancelled', send); }
}
