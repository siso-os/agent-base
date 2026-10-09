import type { ResearchFleet, ResearchJob } from '../../../../services/node/src/research';

/** A readable form of the existing ID is a fallback, never an invented person's name. */
export function researchJobName(job: Pick<ResearchJob, 'id' | 'name'>): string {
  if (job.name?.trim()) return job.name.trim();
  const words = job.id.replace(/^\d+[-_]+/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : job.id;
}
export const reportedTokens = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const researchTokenLabel = (job: Pick<ResearchJob, 'tokens'>) => reportedTokens(job.tokens) ? `${job.tokens.toLocaleString()} tokens` : 'Tokens unavailable';
export function researchFleetUsage(fleet: Pick<ResearchFleet, 'jobs'>): string {
  const known = fleet.jobs.filter(j => reportedTokens(j.tokens));
  if (!known.length) return 'Tokens unavailable';
  const total = known.reduce((n, j) => n + j.tokens!, 0), missing = fleet.jobs.length - known.length;
  if (!Number.isSafeInteger(total)) return 'Tokens unavailable';
  return `${total.toLocaleString()} reported tokens${missing ? ` · ${missing} job${missing === 1 ? '' : 's'} unavailable` : ''}`;
}
export const researchFaceStatus = (status: string) => status === 'running' ? 'working' as const : status === 'done' ? 'done' as const : ['failed', 'blocked', 'stopped'].includes(status) ? 'blocked' as const : ['queued', 'waiting'].includes(status) ? 'waiting' as const : 'offline' as const;
export const researchFaceName = (fleet: Pick<ResearchFleet, 'name' | 'machine'>, job: Pick<ResearchJob, 'id'>) => `research:${fleet.machine ?? 'local'}:${fleet.name}:${job.id}`;
