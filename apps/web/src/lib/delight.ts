import type { Research, ResearchFleet } from '../../../../services/node/src/research';
import type { ReleaseEvidence } from './releases';

export type DeliveredWork = {
  id: string; title: string; taskId: string; agentKey: string; session: string;
  prompt: { id: string; at: string; source: string };
  live: { id: string; at: string; source: string; revision: string; verified: boolean };
  evidence: ReleaseEvidence;
};
export type Deliveries = { deliveries: DeliveredWork[]; error?: string | null };
const sha = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{7,40}$/i.test(s);
export function verifiedDeliveries(rows: DeliveredWork[], agentKey: string, session?: string, now = Date.now()): DeliveredWork[] {
  const seen = new Set<string>();
  return rows.filter(r => {
    if (!r || r.agentKey !== agentKey || !r.session || (session !== undefined && r.session !== session) || !r.id || !r.taskId || !r.title || r.live?.verified !== true || !r.live.id || !r.live.source || !sha(r.live.revision)) return false;
    const at = Date.parse(r.live.at);
    if (!Number.isFinite(at) || at > now) return false;
    const key = `${r.taskId}:${r.live.revision}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function deliveryPairs(r: DeliveredWork) {
  return r.evidence?.state === 'available' && Array.isArray(r.evidence.pairs) ? r.evidence.pairs.filter(p => p && sha(p.beforeSha) && p.afterSha === r.live.revision && safeEvidenceUrl(p.before) && safeEvidenceUrl(p.after) && p.before === `/api/releases/${r.live.revision}/evidence/${p.id}/before` && p.after === `/api/releases/${r.live.revision}/evidence/${p.id}/after`) : [];
}
// Evidence is served by the validated same-origin release asset route, never arbitrary receipt URLs.
export const safeEvidenceUrl = (url: string) => typeof url === 'string' && /^\/api\/releases\/[a-f0-9]{7,40}\/evidence\/[a-z0-9][a-z0-9_-]{0,63}\/(before|after)$/i.test(url) && !url.includes('..') && !url.includes('\\');
export function pipelineMedian(rows: DeliveredWork[], agentKey: string, now = Date.now()) {
  const samples = verifiedDeliveries(rows, agentKey, undefined, now).flatMap(r => {
    const start = Date.parse(r.prompt?.at), end = Date.parse(r.live.at);
    return r.prompt?.id && r.prompt.source && Number.isFinite(start) && end > start ? [{ receipt: r, ms: end - start }] : [];
  }).sort((a,b) => a.ms - b.ms);
  const mid = Math.floor(samples.length / 2);
  return { samples, median: samples.length ? samples.length % 2 ? samples[mid].ms : (samples[mid-1].ms + samples[mid].ms) / 2 : null };
}
export function runningResearch(research: Research | null | undefined, error?: string | null, now = Date.now()): { fleets: ResearchFleet[]; unavailable: boolean } {
  const source = research?.fleets;
  const unavailable = !!error || !source || !!source.error || !source.data || !Number.isFinite(source.at) || source.at > now || now - source.at > 30_000;
  return { unavailable, fleets: unavailable ? [] : source!.data!.filter(f => !f.finished && (f.jobs.some(j => j.status === 'running') || f.then?.status === 'running')) };
}

/** Grants come only from a current socket or a fresh poll transition. Consuming is one-shot across row remounts. */
export class FlightLedger {
  private seen = new Set<string>();
  private grants = new Map<string, number>();
  private observed = new Set<string>();
  reset() { this.seen.clear(); this.grants.clear(); this.observed.clear(); }
  baseline(ids: string[], active = ids) { this.grants.clear(); this.observed = new Set(active); ids.forEach(id => { this.seen.add(`${id}:spawn`); if (!this.observed.has(id)) this.seen.add(`${id}:return`); }); }
  observe(id: string) { this.observed.add(id); this.seen.add(`${id}:spawn`); }
  spawn(id: string) { this.observed.add(id); const key = `${id}:spawn`; if (!this.seen.has(key)) { this.grants.set(key, Date.now()); this.seen.add(key); } }
  returned(id: string) { const key = `${id}:return`; if (this.observed.has(id) && !this.seen.has(key)) { this.grants.set(key, Date.now()); this.seen.add(key); } }
  claim(id: string, phase: 'spawn' | 'return', now = Date.now()) { const key = `${id}:${phase}`, at = this.grants.get(key); if (at === undefined) return false; this.grants.delete(key); this.seen.add(key); return now >= at && now - at <= 2000; }
}
