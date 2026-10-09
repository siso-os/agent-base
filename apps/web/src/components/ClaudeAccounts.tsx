// uihub: arc:popover; account rows extend the existing composer model panel.
import { useEffect, useState } from 'react';
import './ClaudeAccounts.css';
import { every } from '../lib/poll';
import type { ClaudeAccounts as AccountSnapshot } from '../../../../services/node/src/claude-accounts';
export const accountName = (id?: string | null) => ({ 'claude-siso-3': 'lordsisodia', 'claude-siso': 'fuzeheritage', 'claude-fahmy': 'Fahmy’s' }[id ?? ''] ?? 'account not reported');
export const accountIdFromProfile = (id: string) => id.replace(/^claude:/, '').split(/[\\/]/).at(-1)?.replace(/^\./, '') ?? '';
const date = (at: number | null) => at === null ? 'not read' : new Date(at).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const age = (at: number) => new Date(at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
export function validAccountSnapshot(value: unknown): value is AccountSnapshot {
  const d=value as AccountSnapshot | null;
  const number=(v:unknown)=>v===null || typeof v==='number' && Number.isFinite(v) && v>=0;
  if(!d || typeof d.refreshing!=='boolean' || !Array.isArray(d.accounts) || d.accounts.length>3 || new Set(d.accounts.map(a=>a?.id)).size!==d.accounts.length)return false;
  return d.accounts.every(a=>a && ['claude-siso','claude-siso-3','claude-fahmy'].includes(a.id) && a.name===accountName(a.id) && a.readOnly===(a.id==='claude-fahmy') &&
    [a.usageAt,a.billingAt,a.renewsAt].every(number) && typeof a.usageStale==='boolean' && typeof a.billingStale==='boolean' &&
    (a.week===null || a.week && number(a.week.pct) && a.week.pct!==null && a.week.pct<=100 && number(a.week.resetsAt)) &&
    (a.credits===null || Array.isArray(a.credits) && a.credits.length<=12 && a.credits.every(g=>g && number(g.left) && number(g.endsAt))) &&
    (a.renewalStatus===null || ['active','past_due','canceled','unpaid','trialing'].includes(a.renewalStatus)) &&
    (!a.readOnly || a.week===null && a.credits===null && a.renewsAt===null));
}
export function useClaudeAccounts(open: boolean, supplied?: AccountSnapshot) {
  const [snapshot,setSnapshot] = useState<AccountSnapshot | null>(null);
  const [failed,setFailed] = useState(false);
  useEffect(() => {
    if (!open || supplied) return;
    let alive = true, controller: AbortController | undefined;
    const read = async () => {
      controller?.abort(); controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8000);
      try { const r = await fetch('/api/claude-accounts', {cache:'no-store',signal:controller.signal}); if(!r.ok) throw new Error(); const d = await r.json(); if(!validAccountSnapshot(d)) throw new Error(); if(alive) { setSnapshot(d); setFailed(false); } }
      catch { if(alive) setFailed(true); }
      finally { window.clearTimeout(timeout); }
    };
    const stop = every(() => { void read(); }, 10_000);
    return () => { alive = false; controller?.abort(); stop(); };
  },[open,supplied]);
  return { snapshot: supplied ?? snapshot, failed };
}
export function ClaudeAccounts({ snapshot, currentId, failed = false, compact = false }: { snapshot: AccountSnapshot | null; currentId?: string | null; failed?: boolean; compact?: boolean }) {
  // t-0570: in the model selector the accounts are one line each; the usage pop-up carries the windows, renewals and credit.
  if (compact) return <section className="ab-accounts is-compact" aria-label="Claude accounts">
    <div className="ab-accounts__heading"><b>Account</b><span>week used</span></div>
    {!snapshot && <p role="status">{failed ? 'Account readings unavailable.' : 'Reading accounts…'}</p>}
    {snapshot?.accounts.map(account => <div key={account.id} className="ab-account-line" data-current={account.id === currentId || undefined}>
      <b>{account.name}</b><span data-stale={account.usageStale || account.billingStale || undefined}>{[account.readOnly ? 'read-only' : account.id === currentId ? 'this chat' : '', account.usageStale && 'Usage stale', account.billingStale && 'Billing stale'].filter(Boolean).join(' · ')}</span>
      {account.week ? <><meter min={0} max={100} value={account.week.pct} aria-label={`${account.name} week used`}/><i>{account.week.pct}%</i></> : <i className="is-none">not read</i>}
    </div>)}
    <p className="ab-accounts__note">Model changes keep this chat’s account.</p>
  </section>;
  return <section className="ab-accounts" aria-label="Claude accounts">
    <div className="ab-accounts__heading"><b>Claude accounts</b><span>usage · billing</span></div>
    {!snapshot && <p role="status">{failed ? 'Account readings unavailable.' : 'Reading accounts…'}</p>}
    {failed && snapshot && <p role="status">Refresh unavailable · previous readings below</p>}
    {snapshot?.accounts.map(account => <article key={account.id} className="ab-account" data-current={account.id === currentId || undefined}>
      <div className="ab-account__title"><b>{account.name}</b><span>{account.readOnly ? 'His · read-only' : account.id === currentId ? 'This chat' : 'Your account'}</span></div>
      {account.readOnly ? <p>Usage, renewal and cloud credit: not read</p> : <>
        <div className="ab-account__usage"><span>Week <b>{account.week === null ? 'not read' : `${account.week.pct}% used`}</b></span>{account.week && <meter min={0} max={100} value={account.week.pct} aria-label={`${account.name} week used`}/>}</div>
        <dl><div><dt>Week resets</dt><dd>{date(account.week?.resetsAt ?? null)}</dd></div><div><dt>Renewal estimate</dt><dd>{date(account.renewsAt)}</dd></div><div><dt>Cloud credit left</dt><dd>{account.credits === null ? 'not read' : !account.credits.length ? 'No grant reported' : account.credits.map((credit,i)=><span key={i}>{i > 0 && ' · '}{credit.left === null ? 'not read' : new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(credit.left)}{credit.endsAt !== null && <small> until {date(credit.endsAt)}</small>}</span>)}</dd></div></dl>
        {(account.usageAt !== null || account.billingAt !== null) && <small className="ab-account__freshness">{account.usageAt !== null && `Usage ${account.usageStale || failed || Date.now() - account.usageAt > 300_000 ? 'stale · ' : ''}${age(account.usageAt)}`}{account.usageAt !== null && account.billingAt !== null && ' / '}{account.billingAt !== null && `Billing ${account.billingStale || failed || Date.now() - account.billingAt > 300_000 ? 'stale · ' : ''}${age(account.billingAt)}`}</small>}
        {account.renewalStatus && account.renewalStatus !== 'active' && <small className="ab-account__warning">Plan: {account.renewalStatus.replaceAll('_',' ')}</small>}
      </>}
    </article>)}
    <p className="ab-accounts__note">Model changes keep this chat’s account. Renewal uses the plan’s billing anchor.</p>
  </section>;
}
