/** Account-bound Codex quota evidence. No credentials, provider calls, inferred budgets or reset projections. */
export const CODEX_QUOTA_SOURCE = 'codex-app-server/account/rateLimits/read' as const;
export const QUOTA_MAX_AGE_MS = 5 * 60_000;
export type QuotaTarget = { hostId: string; accountId: string; model: string; limitId: string };
/** hostId is supplied by the trusted transport; observedAt is the original completed read time. */
export type QuotaReading = { source: typeof CODEX_QUOTA_SOURCE; hostId: string; observedAt: number; stale?: boolean; response: unknown };
export type QuotaEvidence = QuotaTarget & {
  source: typeof CODEX_QUOTA_SOURCE; observedAt: number;
  ordinaryUsageAllowed: boolean | null; spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
  windows: { durationMins: 300 | 10080; usedPercent: number; resetsAt: number }[];
  individualLimit: { remainingPercent: number; resetsAt: number } | null;
};
type Result = { ok: true; quota: QuotaEvidence } | { ok: false; reason: string };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\s\x00-\x1f]/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validQuotaTarget(value: unknown): value is QuotaTarget {
  return object(value) && ['hostId', 'accountId', 'model', 'limitId'].every(key => identity(value[key]));
}

/**
 * Adapt the installed app-server's account/rateLimits/read response. The expected target comes from the
 * launch owner's authenticated routing binding, independently of the response or a browser request.
 * Explicit bucket IDs and exact durations replace the pooled token-cache "newest event" guess.
 */
export function codexQuotaEvidence(reading: unknown, target: QuotaTarget, now = Date.now()): Result {
  const unavailable = (reason: string): Result => ({ ok: false, reason });
  if (!validQuotaTarget(target)) return unavailable('Current Codex quota target identity is unavailable');
  if (!object(reading) || reading.source !== CODEX_QUOTA_SOURCE || reading.hostId !== target.hostId) return unavailable('Current Codex quota host or source does not match the launch target');
  if (!finite(reading.observedAt) || !finite(now) || reading.observedAt > now || now - reading.observedAt > QUOTA_MAX_AGE_MS || ('stale' in reading && reading.stale !== false)) return unavailable('Current Codex quota reading is unavailable or stale');
  const response = reading.response;
  if (!object(response) || response.accountId !== target.accountId) return unavailable('Current Codex quota account does not match the launch target');
  // Prefer the provider's explicit multi-bucket view. Do not fall back when that view omits the requested bucket.
  const buckets = response.rateLimitsByLimitId;
  if (buckets != null && !object(buckets)) return unavailable('Current Codex quota buckets are invalid');
  const bucket = buckets != null ? Object.hasOwn(buckets, target.limitId) ? buckets[target.limitId] : null : response.rateLimits;
  if (!object(bucket) || bucket.limitId !== target.limitId) return unavailable('Current Codex quota bucket does not match the launch target');
  const windows: QuotaEvidence['windows'] = [];
  if (!Object.hasOwn(bucket, 'primary') || !Object.hasOwn(bucket, 'secondary')) return unavailable('Current Codex quota windows are incomplete or invalid');
  for (const raw of [bucket.primary, bucket.secondary]) {
    // A provider-declared null window is supported (some plans expose only a weekly window).
    // An omitted/undefined window is malformed; no duration or allowance is manufactured.
    if (raw === null) continue;
    if (!object(raw) || ![300, 10080].includes(raw.windowDurationMins) || !Number.isInteger(raw.usedPercent) || raw.usedPercent < 0 || raw.usedPercent > 100 ||
      !Number.isSafeInteger(raw.resetsAt) || raw.resetsAt <= 0 || !Number.isSafeInteger(raw.resetsAt * 1000) ||
      raw.resetsAt * 1000 > reading.observedAt + raw.windowDurationMins * 60_000 + 1000) return unavailable('Current Codex quota windows are incomplete or invalid');
    if (windows.some(w => w.durationMins === raw.windowDurationMins)) return unavailable('Current Codex quota windows are ambiguous');
    windows.push({ durationMins: raw.windowDurationMins, usedPercent: raw.usedPercent, resetsAt: raw.resetsAt * 1000 });
  }
  if (!windows.length) return unavailable('Current Codex quota windows are incomplete or invalid');
  const individual = bucket.individualLimit;
  if (individual != null && (!object(individual) || !finite(individual.remainingPercent) || individual.remainingPercent < 0 || individual.remainingPercent > 100 ||
    !Number.isSafeInteger(individual.resetsAt) || individual.resetsAt <= 0 || !Number.isSafeInteger(individual.resetsAt * 1000))) return unavailable('Current Codex individual quota is incomplete or invalid');
  return { ok: true, quota: {
    ...target, source: CODEX_QUOTA_SOURCE, observedAt: reading.observedAt,
    ordinaryUsageAllowed: typeof response.ordinaryUsageAllowed === 'boolean' ? response.ordinaryUsageAllowed : null,
    spendControlReached: typeof bucket.spendControlReached === 'boolean' ? bucket.spendControlReached : null,
    rateLimitReachedType: bucket.rateLimitReachedType == null ? null : typeof bucket.rateLimitReachedType === 'string' ? bucket.rateLimitReachedType : 'unknown',
    windows,
    individualLimit: individual == null ? null : { remainingPercent: individual.remainingPercent, resetsAt: individual.resetsAt * 1000 },
  } };
}
