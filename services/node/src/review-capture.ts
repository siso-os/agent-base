/** Capture links at an existing chat delivery boundary, never by scanning private transcripts. */
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type ReviewDeliveryRef = { adapter: 'native' | 'legacy'; agentId: string; sessionId: string; messageId: string };
export type VerifiedReviewDelivery = ReviewDeliveryRef & {
  by: string;
  /** Server-observed delivery completion, not a client timestamp or an inferred user open. */
  deliveredAt: number;
  boundary: 'assistant-message-complete';
  event: { t: string; id?: unknown; text?: unknown; at?: unknown; parent?: unknown };
};
export type CapturedReview = {
  id: string; title: string; url: string; agent: string; ts: string;
  provenance: ReviewDeliveryRef & { deliveredAt: string; messageAt: string; contentHash: string };
};
type Options = {
  /** Resolve from this caller's verified, actually delivered event buffer. Never echo request text or claimed identity. */
  resolve: (ref: ReviewDeliveryRef) => Promise<VerifiedReviewDelivery | null>;
  file?: string;
  now?: () => number;
};
const MAX_TEXT = 128 * 1024, MAX_URLS = 24, MAX_ROWS = 4000, MAX_BYTES = 8 * 1024 * 1024;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,191}$/.test(v) && !/^(?:undefined|null)(?::|$)/.test(v);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identity = (ref: ReviewDeliveryRef) => [ref.adapter, ref.agentId, ref.sessionId, ref.messageId];
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 8.64e15;
const SECRET = /(?:token|secret|password|passwd|credential|signature|api[-_]?key|auth|access[-_]?key|session[-_]?key|code|jwt)/i;

/** URLs stay local; credential-bearing or ambiguous opaque-query links are deliberately excluded. */
export function safeReviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password) return null;
    // Restrict query data to simple navigation. Do not collect signed download/login URLs or search prompts.
    for (const [key, value] of u.searchParams) {
      if (SECRET.test(key) || !/^(?:page|tab|view|section|sort|order|mode|lang)$/.test(key) || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
    }
    if (u.hash && !/^#[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(u.hash)) return null;
    if (u.hash && SECRET.test(u.hash)) return null;
    return u.href;
  } catch { return null; }
}

/** Only visible prose links: exclude code, quotes, images and HTML blocks; never fetch a target. */
export function assistantReviewUrls(text: string): string[] {
  if (Buffer.byteLength(text) > MAX_TEXT) throw new Error('Assistant delivery exceeds capture bound');
  let fence: string | null = null;
  const prose = text.split('\n').filter(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (fence === marker[0]) fence = null; return false; }
    return !fence && !/^\s*(?:>|<(?!https?:\/\/)| {4}|\t)/.test(line);
  }).join('\n').replace(/`+[^`]*`+/g, '').replace(/!\[[^\]]*\]\([^\n]*?\)/g, '');
  const urls = new Set<string>();
  for (const match of prose.matchAll(/https?:\/\/[^\s<>"'`\[\]]+/g)) {
    let candidate = match[0].replace(/[.,;:!?]+$/, '');
    while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length ?? 0) > (candidate.match(/\(/g)?.length ?? 0)) candidate = candidate.slice(0,-1);
    const url = safeReviewUrl(candidate);
    if (url) urls.add(url);
    if (urls.size > MAX_URLS) throw new Error('Assistant delivery has too many review links');
  }
  return [...urls];
}

export function reviewCaptureFile(opened?: string): string {
  if (process.env.AB_REVIEWS_DELIVERED) return process.env.AB_REVIEWS_DELIVERED;
  return join(dirname(opened ?? process.env.AB_REVIEWS_OPENED ?? join(homedir(), '.local/state/agent-base/reviews-opened.json')), 'reviews-delivered.json');
}

function validRef(v: unknown): v is ReviewDeliveryRef {
  return object(v) && (v.adapter === 'native' || v.adapter === 'legacy') && [v.agentId,v.sessionId,v.messageId].every(id);
}
function validRow(v: unknown): v is CapturedReview {
  const extra: Record<string, unknown> = object(v) && object(v.provenance) ? v.provenance : {};
  if (!object(v) || !object(v.provenance) || !validRef(v.provenance) || !/^chat-[a-f0-9]{40}$/.test(v.id) || safeReviewUrl(v.url) !== v.url ||
      typeof v.title !== 'string' || v.title.length > 240 || typeof v.agent !== 'string' || v.agent.length > 120 ||
      typeof extra.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(extra.contentHash) || ![v.ts,extra.deliveredAt,extra.messageAt].every(t => typeof t === 'string' && timestamp(Date.parse(t)))) return false;
  return v.id === `chat-${hash([...identity(v.provenance),v.url]).slice(0,40)}` && v.ts === extra.deliveredAt;
}
export async function readReviewCaptures(file = reviewCaptureFile()): Promise<CapturedReview[]> {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (e: any) { if (e.code === 'ENOENT') return []; throw new Error('Captured review history is unavailable'); }
  try {
    const size = (await handle.stat()).size;
    if (size <= 0 || size > MAX_BYTES) throw new Error('Captured review history exceeds its read bound');
    const buffer = Buffer.alloc(size); let offset=0;
    while (offset<size) { const {bytesRead}=await handle.read(buffer,offset,size-offset,offset); if (!bytesRead) throw new Error('Captured review history changed'); offset+=bytesRead; }
    const data = JSON.parse(buffer.toString('utf8'));
    if (data?.version !== 1 || !Array.isArray(data.reviews) || data.reviews.length>MAX_ROWS || !data.reviews.every(validRow) || new Set(data.reviews.map((r: CapturedReview)=>r.id)).size!==data.reviews.length) throw new Error('Invalid captured review history');
    // The capture store cannot smuggle approval/answer fields into the console projection.
    return data.reviews.map((r: CapturedReview) => ({id:r.id,title:r.title,url:r.url,agent:r.agent,ts:r.ts,
      provenance:{adapter:r.provenance.adapter,agentId:r.provenance.agentId,sessionId:r.provenance.sessionId,messageId:r.provenance.messageId,
        deliveredAt:r.provenance.deliveredAt,messageAt:r.provenance.messageAt,contentHash:r.provenance.contentHash}}));
  } finally { await handle.close(); }
}

const queues = new Map<string, Promise<unknown>>();
async function append(file: string, incoming: CapturedReview[]) {
  const prior = queues.get(file) ?? Promise.resolve();
  const job = prior.catch(()=>{}).then(async () => {
    await mkdir(dirname(file), {recursive:true,mode:0o700});
    // Cross-process exclusion; a stale lock fails closed and never overwrites history.
    let lock;
    try { lock = await open(`${file}.lock`, 'wx', 0o600); } catch { throw new Error('Captured review history is busy; delivery can be retried'); }
    try {
      const rows = await readReviewCaptures(file);
      for (const entry of incoming) {
        const sameMessage = rows.filter(r=>JSON.stringify(identity(r.provenance))===JSON.stringify(identity(entry.provenance)));
        if (sameMessage.some(r=>r.provenance.contentHash!==entry.provenance.contentHash)) throw new Error('Delivered message identity changed; capture refused');
      }
      const existing = new Set(rows.map(r=>r.id));
      const additions = incoming.filter(r=>!existing.has(r.id));
      if (!additions.length) return {captured:0,ids:incoming.map(r=>r.id)};
      if (rows.length+additions.length>MAX_ROWS) throw new Error('Captured review history is full; no records removed');
      const data=JSON.stringify({version:1,reviews:[...rows,...additions]})+'\n';
      if (Buffer.byteLength(data)>MAX_BYTES) throw new Error('Captured review history exceeds its write bound');
      const temporary=`${file}.${randomUUID()}.tmp`;
      const out=await open(temporary,'wx',0o600);
      try { await out.writeFile(data); await out.sync(); } finally { await out.close(); }
      try { await rename(temporary,file); } catch { await unlink(temporary).catch(()=>{}); throw new Error('Captured review history could not be saved'); }
      return {captured:additions.length,ids:incoming.map(r=>r.id)};
    } finally { await lock.close(); await unlink(`${file}.lock`); }
  });
  queues.set(file,job);
  try { return await job; } finally { if(queues.get(file)===job)queues.delete(file); }
}

/** Accept only a reference from clients. The required resolver supplies content and provenance from server authority. */
export function createReviewCapture(options: Options) {
  return async (request: unknown): Promise<{captured:number;ids:string[]}> => {
    if (!validRef(request) || Object.keys(request).some(k=>!['adapter','agentId','sessionId','messageId'].includes(k))) throw new Error('Invalid review delivery reference');
    const ref: ReviewDeliveryRef = {adapter:request.adapter,agentId:request.agentId,sessionId:request.sessionId,messageId:request.messageId};
    const delivery=await options.resolve(ref);
    const now=(options.now ?? Date.now)();
    if (!delivery || !validRef(delivery) || JSON.stringify(identity(delivery))!==JSON.stringify(identity(ref)) || delivery.boundary!=='assistant-message-complete' ||
        !timestamp(delivery.deliveredAt) || delivery.deliveredAt>now || typeof delivery.by!=='string' || !delivery.by.trim() || delivery.by.length>120 || /[\u0000-\u001f\u007f]/.test(delivery.by)) throw new Error('Assistant delivery provenance is unverified');
    const e=delivery.event;
    if (!e || e.t!=='text' || e.id!==ref.messageId || e.parent || typeof e.text!=='string' || !timestamp(e.at) || e.at>delivery.deliveredAt) throw new Error('Only a delivered assistant text message can be captured');
    const urls=assistantReviewUrls(e.text);
    if (!urls.length) return {captured:0,ids:[]};
    const at=new Date(delivery.deliveredAt).toISOString();
    const provenance={...ref,deliveredAt:at,messageAt:new Date(e.at).toISOString(),contentHash:hash(e.text)};
    const entries=urls.map(url=>({id:`chat-${hash([...identity(ref),url]).slice(0,40)}`,title:`${new URL(url).hostname}${new URL(url).pathname}`.slice(0,240),url,agent:delivery.by,ts:at,provenance}));
    return append(options.file ?? reviewCaptureFile(),entries);
  };
}
