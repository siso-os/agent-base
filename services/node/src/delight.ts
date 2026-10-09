import { statSync } from 'node:fs';
import { evidenceFor, liveLog, notesFile, readLiveLog, readNotes, readReleaseNotes, type Note, type ReleaseEvidence } from './releases.ts';

type PromptReceipt = { id: string; at: string; source: string };
type DeliveryProvenance = { taskId: string; agentKey: string; session: string; prompt: PromptReceipt };
type DeliveryNote = Note & { delivery?: DeliveryProvenance };
export type DeliveredWork = {
  id: string; title: string; taskId: string; agentKey: string; session: string; prompt: PromptReceipt;
  live: { id: string; at: string; source: string; revision: string; verified: true };
  evidence: ReleaseEvidence;
};
type Result = { deliveries: DeliveredWork[]; error: string | null };
const bounded = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
const at = (value: unknown): number => typeof value === 'string' && value.length <= 40 ? Date.parse(value) : NaN;

/** Only an explicit original-prompt receipt joined to this session and an actual live release counts.
 * Task creation, task updated, a commit time and a finished turn are never substitutes for the user's words. */
export function readDeliveredWork(repo: string, agentKey: string, session: string, options: { notes?: string; log?: string; now?: number } = {}): Result {
  if (!bounded(agentKey, 600) || !bounded(session, 180)) return { deliveries: [], error: 'Delivery identity is unavailable.' };
  const noteFile = options.notes ?? notesFile(repo), logFile = options.log ?? liveLog(), now = options.now ?? Date.now();
  try {
    if (statSync(noteFile).size > 8_388_608 || statSync(logFile).size > 8_388_608) throw new Error('Source limit');
  } catch { return { deliveries: [], error: 'Delivery provenance is unavailable.' }; }
  const notes = (options.notes ? readNotes(noteFile) : readReleaseNotes(repo)) as DeliveryNote[];
  const lines = readLiveLog(logFile);
  // A later rollback of a revision revokes its delivered status until a later successful install.
  const live = new Map<string, { at: string; time: number }>();
  for (const line of lines) {
    const time = at(line.at);
    if (!Number.isFinite(time) || time > now) continue;
    if (line.result === 'rolled-back') live.delete(line.sha);
    if (line.result === 'live' && !live.has(line.sha)) live.set(line.sha, { at: line.at, time });
  }
  const deliveries: DeliveredWork[] = [], seen = new Set<string>();
  for (const note of notes.slice(-500)) {
    const provenance = note.delivery, release = live.get(note.sha);
    if (!provenance || provenance.agentKey !== agentKey || provenance.session !== session || !release) continue;
    if (!/^t-\d{4,}$/.test(provenance.taskId) || !bounded(note.title, 500)) continue;
    const prompt = provenance.prompt, started = at(prompt?.at);
    if (!prompt || !bounded(prompt.id, 180) || !bounded(prompt.source, 512) || !Number.isFinite(started) || started >= release.time) continue;
    const id = `${provenance.taskId}:${note.sha}:${session}`;
    if (seen.has(id)) continue;
    seen.add(id);
    deliveries.push({
      id, title: note.title, taskId: provenance.taskId, agentKey, session,
      prompt: { id: prompt.id, at: prompt.at, source: prompt.source },
      live: { id: `release:${note.sha}`, at: release.at, source: `release:${note.sha}`, revision: note.sha, verified: true },
      evidence: evidenceFor(repo, notes, note.sha),
    });
  }
  return { deliveries: deliveries.sort((a, b) => Date.parse(b.live.at) - Date.parse(a.live.at)).slice(0, 60), error: null };
}

/** Small per-recipient cache avoids reopening raster evidence on every render/poll. */
export function createDeliveryReader(repo: string) {
  const cache = new Map<string, { at: number; value: Result }>();
  return (agentKey: string, session: string): Result => {
    const key = JSON.stringify([agentKey, session]), previous = cache.get(key), now = Date.now();
    if (previous && now - previous.at < 2_000) return previous.value;
    const value = readDeliveredWork(repo, agentKey, session);
    if (cache.size >= 60 && !cache.has(key)) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, value });
    return value;
  };
}
