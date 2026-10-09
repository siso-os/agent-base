/** Public account projection: stable aliases only; never serialize source records or errors. */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { claudeUsage, type ClaudeUsage } from './claude-usage.ts';

export const CLAUDE_ACCOUNTS = [
  { id: 'claude-siso-3', name: 'lordsisodia', readOnly: false },
  { id: 'claude-siso', name: 'fuzeheritage', readOnly: false },
  { id: 'claude-fahmy', name: "Fahmy’s", readOnly: true },
] as const;
export type ClaudeAccountId = typeof CLAUDE_ACCOUNTS[number]['id'];
export type ClaudeAccount = {
  id: ClaudeAccountId; name: string; readOnly: boolean;
  fiveHour: { pct: number; resetsAt: number | null } | null;
  week: { pct: number; resetsAt: number | null } | null; usageAt: number | null; usageStale: boolean;
  renewsAt: number | null; renewalStatus: string | null;
  credits: { left: number | null; endsAt: number | null }[] | null;
  billingAt: number | null; billingStale: boolean;
};
export type ClaudeAccounts = { accounts: ClaudeAccount[]; refreshing: boolean };
/** Identity requires an explicit profile under the user's home. Never infer from the model or default login. */
export function claudeAccountId(config: unknown, home = homedir()): ClaudeAccountId | null {
  if (typeof config !== 'string' || !config) return null;
  const expanded = config.startsWith('~/') ? path.join(home, config.slice(2)) : config;
  const resolved = path.resolve(expanded);
  for (const account of CLAUDE_ACCOUNTS) {
    if ([path.join(home, '.config', account.id), path.join(home, `.${account.id}`)].includes(resolved)) return account.id;
  }
  return null;
}
const time = (v: unknown): number | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
/** Only these columns cross the API boundary, including when a command returns unexpected fields. */
export function projectAccounts(raw: any, usage: (id: ClaudeAccountId) => ClaudeUsage | null, at: number | null, stale: boolean): ClaudeAccount[] {
  return CLAUDE_ACCOUNTS.map(account => {
    const reading = account.readOnly ? null : usage(account.id);
    const renewal = !account.readOnly && Array.isArray(raw?.renewals) ? raw.renewals.find((r: any) => r?.id === account.id) : null;
    const credit = !account.readOnly && Array.isArray(raw?.credits) ? raw.credits.find((r: any) => r?.id === account.id) : null;
    return { ...account,
      fiveHour: reading?.fiveHour ? { pct: reading.fiveHour.pct, resetsAt: reading.fiveHour.resetsAt } : null,
      week: reading?.week ? { pct: reading.week.pct, resetsAt: reading.week.resetsAt } : null,
      usageAt: reading?.at ?? null, usageStale: reading?.stale ?? true,
      renewsAt: time(renewal?.renews), renewalStatus: ['active','past_due','canceled','unpaid','trialing'].includes(renewal?.renewalStatus) ? renewal.renewalStatus : null,
      credits: Array.isArray(credit?.credits) ? credit.credits.slice(0, 12).map((g: any) => ({ left: number(g?.left), endsAt: time(g?.ends) })) : null,
      billingAt: account.readOnly ? null : [renewal?.at ?? (renewal ? at : null), credit?.at ?? (credit?.credits ? at : null)].filter((v): v is number => typeof v === 'number').sort((a,b)=>a-b)[0] ?? null,
      billingStale: account.readOnly || stale || !renewal || !credit || renewal.stale === true || credit.stale === true || credit.credits === null,
    };
  });
}
function readBilling(): Promise<unknown> {
  if (process.env.NODE_ENV === "test" || process.env.AB_HERDR || (process.env.AB_HOME && path.resolve(process.env.AB_HOME) !== homedir())) return Promise.reject(new Error("Billing disabled in fixture nodes"));
  return new Promise((resolve, reject) => {
    execFile('python3', [path.resolve(import.meta.dirname, '../../../tools/claude-account-readings.py')], { timeout: 55_000, maxBuffer: 128 * 1024 }, (err, stdout) => {
      if (err) { reject(new Error('Account billing unavailable')); return; }
      try { const raw = JSON.parse(stdout); if (!Array.isArray(raw.renewals) || !Array.isArray(raw.credits)) throw new Error(); resolve(raw); }
      catch { reject(new Error('Account billing unavailable')); }
    });
  });
}
/** Preserve each account's last successful source independently when a donor fails. */
export function mergeBilling(previous: any, incoming: any, now: number) {
  const merge = (source: 'renewals' | 'credits') => CLAUDE_ACCOUNTS.filter(a=>!a.readOnly).flatMap(account => {
    const next = Array.isArray(incoming?.[source]) ? incoming[source].find((row: any)=>row?.id===account.id) : null;
    const old = Array.isArray(previous?.[source]) ? previous[source].find((row: any)=>row?.id===account.id) : null;
    const valid = source === 'credits' ? Array.isArray(next?.credits) : time(next?.renews) !== null || ['active','past_due','canceled','unpaid','trialing'].includes(next?.renewalStatus);
    if (!valid) return old ? [{...old,stale:true}] : [];
    // Keep only needed columns, even inside the cache.
    return source === 'credits' ? [{id:account.id,credits:next.credits.map((g:any)=>({left:number(g?.left),ends:time(g?.ends)===null?null:g.ends})),at:now,stale:false}]
      : [{id:account.id,renews:time(next.renews)===null?null:next.renews,renewalStatus:next.renewalStatus,at:now,stale:false}];
  });
  return {renewals:merge('renewals'),credits:merge('credits')};
}
export function createAccountReader(read = readBilling, now = Date.now) {
  let data: unknown = null, at: number | null = null, attempted: number | null = null, pending = false, failed = false;
  return (usage: (id: ClaudeAccountId) => ClaudeUsage | null): ClaudeAccounts => {
    if (!pending && (attempted === null || now() - attempted >= 300_000)) {
      attempted = now(); pending = true;
      void read().then(value => { data = mergeBilling(data, value, now()); at = now(); failed = false; }, () => { failed = true; }).finally(() => { pending = false; });
    }
    return { accounts: projectAccounts(data, usage, at, failed || at === null || now() - at > 300_000), refreshing: pending };
  };
}
const readAccounts = createAccountReader();
export function claudeAccounts(): ClaudeAccounts {
  return readAccounts(id => {
    const candidates = [path.join(homedir(), '.config', id), path.join(homedir(), `.${id}`)];
    const readings = candidates.map(config => claudeUsage.get(config)).filter((v): v is ClaudeUsage => v !== null);
    return readings.sort((a,b) => b.at - a.at)[0] ?? null;
  });
}
