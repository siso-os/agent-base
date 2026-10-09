// Local private preferences, not WhatsApp account mutations. No names/bodies in logs.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export type ChatFolder = { id: string; name: string; parent?: string; chats: string[] };
export type Organisation = { revision: number; pins: Record<string, boolean>; folders: ChatFolder[]; saved: { chat: string; message: string }[] };
export const privateRoot = () => process.env.AB_WHATSAPP_STATE ?? path.join(homedir(), '.local/state/agent-base/whatsapp');
export const accountKey = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24);
export function atomicPrivate(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(tmp, file);
}
export function readOrganisation(account: string): Organisation {
  try { return JSON.parse(readFileSync(path.join(privateRoot(), account, 'organisation.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Private organisation cannot be read'); }
  return { revision: 0, pins: {}, folders: [], saved: [] };
}
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
export function organise(account: string, op: any): Organisation {
  const state = readOrganisation(account);
  if (op?.revision !== state.revision) throw Object.assign(new Error('Organisation changed; refresh and try again'), { status: 409 });
  if (op.type === 'pin' && str(op.chat) && typeof op.pinned === 'boolean') state.pins[op.chat] = op.pinned;
  else if (op.type === 'folder' && str(op.name, 80) && op.name.trim() && (!op.parent || state.folders.some(f => f.id === op.parent))) {
    state.folders.push({ id: randomUUID(), name: op.name.trim(), ...(op.parent ? { parent: op.parent } : {}), chats: [] });
  } else if (op.type === 'membership' && str(op.chat) && typeof op.member === 'boolean') {
    const folder = state.folders.find(f => f.id === op.folder);
    if (!folder) throw new Error('Folder not found');
    folder.chats = op.member ? [...new Set([...folder.chats, op.chat])] : folder.chats.filter(c => c !== op.chat);
  } else if (op.type === 'save' && str(op.chat) && str(op.message) && typeof op.saved === 'boolean') {
    state.saved = state.saved.filter(s => s.chat !== op.chat || s.message !== op.message);
    if (op.saved) state.saved.push({ chat: op.chat, message: op.message });
  } else throw new Error('Invalid organisation change');
  state.revision++;
  atomicPrivate(path.join(privateRoot(), account, 'organisation.json'), state);
  return state;
}

export type SendReceipt = { fingerprint: string; state: 'pending' | 'accepted' | 'rejected' | 'unknown'; id?: string; status?: number };
// Reserve before network IO. A pending receipt survives a crash and must never be blindly retried.
export function reserveSend(account: string, requestId: string, fingerprint: string): { file: string; previous?: SendReceipt } {
  const dir = path.join(privateRoot(), account, 'sends');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${requestId}.json`);
  const receipt: SendReceipt = { fingerprint, state: 'pending' };
  try { writeFileSync(file, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' }); return { file }; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const previous: SendReceipt = JSON.parse(readFileSync(file, 'utf8'));
    return { file, previous };
  }
}

/** Exact-only private intake resolution. Unmatched voice labels remain candidates, never guessed identities. */
export function resolveIntake(account: string, intake: any, chats: { jid: string; name: string }[]) {
  const normal = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase();
  const unique = [...new Map(chats.map(c => [c.jid, c])).values()];
  const resolve = (label: string) => unique.filter(c => normal(c.name) === normal(label));
  const state = readOrganisation(account);
  const candidates: { label: string; purpose: string; matches: string[] }[] = [];
  let resolved = 0;
  for (const label of intake.requested_pins_verbatim ?? []) {
    if (typeof label !== 'string') continue;
    const hits = resolve(label);
    if (hits.length === 1) { state.pins[hits[0].jid] = true; resolved++; }
    else candidates.push({ label, purpose: 'pin', matches: hits.map(c => c.jid) });
  }
  const folder = (name: string, parent?: string) => {
    let f = state.folders.find(f => f.name === name && f.parent === parent);
    if (!f) { f = { id: randomUUID(), name, ...(parent ? { parent } : {}), chats: [] }; state.folders.push(f); }
    return f;
  };
  for (const [label, entries] of Object.entries(intake.requested_client_labels_verbatim ?? {})) {
    if (!Array.isArray(entries)) continue;
    if (label === 'unresolved') {
      for (const name of entries) if (typeof name === 'string') candidates.push({ label: name, purpose: 'unresolved voice label', matches: [] });
      continue;
    }
    const group = folder(label, folder('Clients').id);
    for (const name of entries) {
      if (typeof name !== 'string') continue;
      const hits = resolve(name);
      const sub = folder(name, group.id);
      if (hits.length === 1) { sub.chats = [...new Set([...sub.chats, hits[0].jid])]; resolved++; }
      else candidates.push({ label: name, purpose: `folder:${sub.id}`, matches: hits.map(c => c.jid) });
    }
  }
  state.revision++;
  atomicPrivate(path.join(privateRoot(), account, 'organisation.json'), state);
  atomicPrivate(path.join(privateRoot(), account, 'intake-candidates.json'), { source: 'astra-comms-intake-20261006', observedAt: new Date().toISOString(), candidates });
  return { resolved, unresolved: candidates.length, pins: Object.values(state.pins).filter(Boolean).length, folders: state.folders.length };
}
