import type { ReactNode } from 'react';
/** Read-only projection of the existing /api/tokens cache. Never joins login credentials to usage events. */
export type Provider = 'claude' | 'codex';
export type ProviderWindow = { id: 'five-hour' | 'week'; label: string; shortLabel: string; pct: number | null; resetsAt: number | null; state: 'fresh' | 'stale' | 'unknown'; reason: string | null };
export type ProviderAccount = { id: string; label: string | null; profile: string | null; at: number | null; source: string | null; windows: ProviderWindow[] };
export type ProviderUsage = { id: Provider; label: string; accounts: ProviderAccount[]; pct: number | null; state: 'fresh' | 'stale' | 'unknown'; partial: boolean; reason: string | null };
export type UsageSnapshot = { accounts?: unknown[]; cached?: boolean; scanning?: boolean };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim().slice(0,240) : null;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const timestamp = (v: unknown): number | null => number(v) && v > 0 && v <= 8.64e15 ? v : null;
export const providerTone = (pct: number | null) => pct === null ? 'none' : pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';

/** Match the existing account-usage freshness policy; reset passing never silently turns a used reading into zero. */
export function providerUsage(snapshot: UsageSnapshot | null, error: string | null, now = Date.now()): ProviderUsage[] {
  const valid = snapshot && Array.isArray(snapshot.accounts);
  const sourceError = error || (snapshot && !valid ? 'Usage response unavailable' : null);
  return (['claude','codex'] as const).map(id => {
    const accounts = new Map<string, ProviderAccount>();
    for (const raw of valid ? snapshot.accounts! : []) {
      if (!record(raw) || raw.kind !== id || !text(raw.id) || record(raw.person) && raw.person.mine === false) continue;
      const limits = record(raw.limits) ? raw.limits : null, person = record(raw.person) ? raw.person : null;
      const at = timestamp(limits?.at);
      const stale = sourceError ? 'Usage refresh unavailable' : snapshot?.cached ? 'Cached snapshot; awaiting a current reading' : !at ? 'Usage timestamp not reported' : at > now ? 'Usage timestamp is in the future' : limits?.stale === true || now - at > 300_000 ? 'Usage reading is stale' : null;
      const windows = ([['fiveHour','five-hour','5 hours','5h'],['weekly','week','Week','wk']] as const).map(([key,windowId,label,shortLabel]): ProviderWindow => {
        const value = limits && record(limits[key]) ? limits[key] : null;
        const pct = value && number(value.usedPct) && value.usedPct >= 0 && value.usedPct <= 100 ? value.usedPct : null;
        const resetsAt = timestamp(value?.resetsAt);
        const reason = pct === null ? 'Usage not reported' : stale || (value?.expired === true || resetsAt !== null && resetsAt <= now ? 'Reset passed; awaiting a new reading' : null);
        return {id:windowId,label,shortLabel,pct,resetsAt,state:pct === null ? 'unknown' : reason ? 'stale' : 'fresh',reason};
      });
      const account: ProviderAccount = {id:text(raw.id)!,label:text(person?.label) ?? text(person?.email),profile:text(raw.folder) ?? text(raw.name),at,source:text(limits?.source),windows};
      const previous = accounts.get(account.id);
      if (!previous || (account.at ?? 0) > (previous.at ?? 0)) accounts.set(account.id,account);
    }
    const values = [...accounts.values()], windows = values.flatMap(a=>a.windows), reported = windows.filter(w=>w.pct !== null);
    // The headline is the fresh readings only (6 Oct 22:10, "I don't even think is accurate": an account last read on 3 Oct
    // was setting Claude's number); only when nothing is fresh does the newest stale reading stand, marked stale.
    const newest = values.reduce<ProviderAccount | null>((n,a) => a.windows.some(w=>w.pct !== null) && (!n || (a.at ?? 0) > (n.at ?? 0)) ? a : n, null);
    const fresh = reported.filter(w=>w.state === 'fresh'), pool = fresh.length ? fresh : (newest?.windows ?? []).filter(w=>w.pct !== null);
    const pct = pool.length ? Math.max(...pool.map(w=>w.pct!)) : null;
    values.sort((a,b) => Number(b.windows.some(w=>w.state === 'fresh')) - Number(a.windows.some(w=>w.state === 'fresh')) || (b.at ?? 0) - (a.at ?? 0));
    return {id,label:id === 'claude' ? 'Claude' : 'Codex',accounts:values,pct,state:pct === null ? 'unknown' : fresh.length ? 'fresh' : 'stale',partial:reported.length > 0 && windows.some(w=>w.pct === null),reason:sourceError ? 'Usage refresh unavailable' : !valid ? 'Usage has not been read yet' : !values.length ? 'No account usage reported' : null};
  });
}
export function resetDescription(window: ProviderWindow, now = Date.now()): ReactNode {
  if (!window.resetsAt) return 'reset unknown';
  const time = new Date(window.resetsAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
  if (window.resetsAt <= now) return 'reset passed';
  const minutes = Math.ceil((window.resetsAt - now) / 60_000), hours = Math.floor(minutes / 60);
  const left = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes % 60}m`;
  return <span title={`Resets ${time}`}>resets in {left}</span>;
}
