import type { SpendResponse } from '../components/SpendPanel';
import type { TodaySpendHeadline, TodaySpendSnapshot } from '../components/TodaySpendDial';
import { localDay } from './spend';
const stamp = (at: number | null | undefined) => typeof at === 'number' && Number.isFinite(at) && Number.isFinite(new Date(at).getTime()) ? new Date(at).toISOString() : null;
/** Tokens owns the headline. STACK-OPT owns its independently dated attribution. */
export function spendDialData(response: SpendResponse | null, today = localDay()): { headline: TodaySpendHeadline; snapshot: TodaySpendSnapshot | null } {
  const token = response?.today;
  const known = token?.from === 'tokens' && token.day === today && Number.isFinite(token.usd) && token.usd >= 0 && stamp(token.observedAt) !== null;
  const headline = { day: today, usd: known ? token!.usd : null, observedAt: known ? stamp(token!.observedAt) : null };
  if (response?.source !== 'stack-opt') return { headline, snapshot: null };
  const data = response.data, attribution = response.attribution;
  return { headline, snapshot: {
    id: `${data.day}:${attribution?.observedAt ?? 'unknown'}:${attribution?.state ?? 'unknown'}`,
    day: data.day, observedAt: stamp(attribution?.observedAt) ?? 'Observation time unavailable',
    state: attribution?.state === 'fresh' && data.day === today ? 'current' : 'stale',
    claudeUsdEquivalent: data.claude_usd_equiv, codexCredits: data.codex_credits,
    projects: data.projects.map(p => ({ id: p.project, name: p.project, claudeUsdEquivalent: p.claude_usd_equiv, codexCredits: p.codex_credits })),
    note: [data.note, data.day !== today ? 'This report is for a different day.' : '', attribution?.reason ? `Attribution refresh: ${attribution.reason}.` : ''].filter(Boolean).join(' '),
  } };
}
