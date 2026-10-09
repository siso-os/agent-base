// Host-owned admission/receipt ordering adapted from T3 Code and OpenCode (MIT); no donor runtime dependencies.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, existsSync } from 'node:fs';
import { dropTemp, persist } from './disk.ts';
import { homedir } from 'node:os';
import path from 'node:path';
import { validId, type QueuedPrompt, type QueueSnapshot, type PromptReceipt } from './delivery.ts';
type Saved = QueueSnapshot & { version: 1; identity: string; receipts: Record<string, { hash: string; receipt: PromptReceipt }> };
export class PromptQueue {
  private data: Saved;
  private file: string;
  constructor(identity: string, session: string) {
    const dir = process.env.AB_PROMPT_QUEUE_DIR ?? path.join(homedir(), '.local/state/agent-base/prompt-queues');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, createHash('sha256').update(identity + '\n' + session).digest('hex') + '.json');
    const lock = this.file + '.lock';
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid queue owner');
      let alive = true; try { process.kill(pid, 0); } catch (e: any) { if (e.code === 'ESRCH') alive = false; }
      if (alive) throw Error('Queue already has a writer');
      renameSync(lock, lock + '.' + Date.now() + '.retired');
    }
    const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
    this.data = { version: 1, identity, session, revision: 0, held: false, entries: [], receipts: {} };
    if (existsSync(this.file)) {
      const raw = readFileSync(this.file, 'utf8');
      if (raw.length > 16 * 1024 * 1024) throw Error('Queue store exceeds size limit');
      const d = JSON.parse(raw) as Saved;
      const phases = ['saved','dispatching','offered','accepted','started','cancelled','unknown'];
      if (d.version !== 1 || d.identity !== identity || d.session !== session || !Number.isSafeInteger(d.revision) || d.revision < 0 || typeof d.held !== 'boolean' || !Array.isArray(d.entries) || !d.receipts || typeof d.receipts !== 'object' || Array.isArray(d.receipts) ||
        new Set(d.entries.map(e => e.id)).size !== d.entries.length ||
        d.entries.some(e => !validId(e.id) || !validId(e.key) || typeof e.text !== 'string' || e.text.length > 100000 || !Array.isArray(e.images) || e.images.length > 20 || e.images.some(p => typeof p !== 'string' || p.length > 4096) || !['next','steer','auto'].includes(e.mode) || !['app','pane'].includes(e.from) || !phases.includes(e.phase) || !Object.hasOwn(d.receipts,e.key)) ||
        Object.entries(d.receipts).some(([key,r]) => !validId(key) || !r || !/^[a-f0-9]{64}$/.test(r.hash) || !r.receipt || r.receipt.key !== key || r.receipt.t !== 'prompt.receipt' || !phases.includes(r.receipt.phase))) throw Error('Invalid queue store; delivery blocked');
      d.held = d.held || d.entries.some(e => ['saved','dispatching','offered','unknown'].includes(e.phase));
      for (const e of d.entries) if (['dispatching','offered'].includes(e.phase)) {
        e.phase = 'unknown';
        if (d.receipts[e.key]) d.receipts[e.key].receipt.phase = 'unknown';
      }
      this.save(d);
    }
  }
  snapshot(): QueueSnapshot { const { session, revision, held, entries } = this.data; return structuredClone({ session, revision, held, entries }); }
  private save(d: Saved) {
    const body = JSON.stringify(d);
    if (body.length > 16 * 1024 * 1024) throw Error('queue_size_limit');
    const tmp = this.file + '.' + process.pid + '.tmp';
    // t-0504: on a full disk the queue lives in memory and is saved again when there is room; nothing he queued is lost.
    persist('queue:' + this.file, () => {
      try {
        const fd = openSync(tmp, 'w', 0o600);
        try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(tmp, this.file);
      } catch (e) { dropTemp(tmp); throw e; }
      const parent = openSync(path.dirname(this.file), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
    });
    this.data = d;
  }
  prior(m: any): PromptReceipt | null {
    const old = this.data.receipts[m.key]; if (!old) return null;
    const hash = createHash('sha256').update(JSON.stringify(m)).digest('hex');
    if (old.hash !== hash) throw Error('conflict'); return structuredClone(old.receipt);
  }
  command(m: any): PromptReceipt {
    if (!validId(m.key)) throw Error('invalid_command');
    const hash = createHash('sha256').update(JSON.stringify(m)).digest('hex');
    const old = this.data.receipts[m.key];
    if (old) { if (old.hash !== hash) throw Error('conflict'); return old.receipt; }
    // Defined replay window: every admitted command is retained; backpressure at the cap, never evict pending identities.
    if (Object.keys(this.data.receipts).length >= 10000) throw Error('receipt_limit');
    const d = structuredClone(this.data);
    let id = m.id ?? m.messageId;
    if (m.t === 'prompt') {
      if (d.entries.some(e => e.id === id)) throw Error('conflict');
      d.entries.push({ id, key: m.key, text: m.text, images: m.images, from: m.from ?? 'app', mode: m.delivery, phase: 'saved', ...(m.expectedTurnId ? { targetTurnId: m.expectedTurnId } : {}) });
    } else {
      if (m.expectedRevision !== d.revision) throw Error('conflict');
      const e = d.entries.find(e => e.id === id);
      if (m.t === 'queue.resume') {
        if (d.entries.some(e => e.phase === 'unknown')) throw Error('delivery_unknown');
        d.held = false;
      } else {
        if (!e || e.phase !== 'saved') throw Error('not_queued');
        if (m.t === 'queue.edit') {
          if (typeof m.text !== 'string' || m.text.length > 100000 || (!m.text.trim() && !(m.images ?? e.images).length)) throw Error('invalid_prompt');
          e.text = m.text; if (m.images !== undefined) e.images = m.images;
        } else if (m.t === 'queue.move') {
          if (id === m.beforeId) throw Error('invalid_target');
          if (m.beforeId !== null && !d.entries.some(x => x.id === m.beforeId && x.phase === 'saved')) throw Error('not_queued');
          // T3 queued-run.reorder: remove moving row, insert before target; null means end.
          d.entries.splice(d.entries.indexOf(e), 1);
          d.entries.splice(m.beforeId === null ? d.entries.length : d.entries.findIndex(x => x.id === m.beforeId), 0, e);
        } else if (m.t === 'queue.remove') e.phase = 'cancelled';
        else if (m.t === 'queue.steer') { e.mode = 'steer'; e.targetTurnId = m.expectedTurnId; }
        else if (m.t === 'queue.send') { e.mode = 'auto'; delete e.targetTurnId; }
        else throw Error('invalid_command');
      }
    }
    d.revision++;
    const receipt: PromptReceipt = { t: 'prompt.receipt', key: m.key, id, phase: 'saved', queueRevision: d.revision };
    d.receipts[m.key] = { hash, receipt }; this.save(d); return receipt;
  }
  claim(id?: string): QueuedPrompt | null {
    if (this.data.held && !id) return null;
    const d = structuredClone(this.data);
    const e = d.entries.find(e => e.phase === 'saved' && (id ? e.id === id : e.mode !== 'steer'));
    if (!e) return null;
    e.phase = 'dispatching'; d.revision++;
    d.receipts[e.key].receipt = { ...d.receipts[e.key].receipt,phase:'dispatching',queueRevision:d.revision };
    this.save(d); return structuredClone(e);
  }
  record(id: string, phase: QueuedPrompt['phase'], providerTurnId?: string, failure?: string) {
    const d = structuredClone(this.data), e = d.entries.find(e => e.id === id)!;
    e.phase = phase; if (providerTurnId) e.providerTurnId = providerTurnId; e.failure = failure;
    if (phase === 'saved') { e.mode = 'next'; delete e.targetTurnId; }
    if (phase === 'unknown') d.held = true;
    const r = d.receipts[e.key]; r.receipt = { ...r.receipt, phase, text: failure, queueRevision: ++d.revision };
    this.save(d); return r.receipt;
  }
  hold() { const d = structuredClone(this.data); d.held = true; d.revision++; this.save(d); }
}
