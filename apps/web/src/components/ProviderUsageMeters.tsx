import { useClaudeAccounts, accountName, accountIdFromProfile } from './ClaudeAccounts';
import type { ClaudeAccounts as AccountSnapshot } from '../../../../services/node/src/claude-accounts';
import {useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {useSharedState} from '../lib/poll';
import {freshWords, useUsageRefresh} from '../lib/usage-refresh';
import {RefreshCwIcon} from 'lucide-react';
import {providerTone, providerUsage, type ProviderUsage, type ProviderWindow, type UsageSnapshot} from '../lib/provider-usage';
import './ProviderUsageMeters.css';

/** The usage orb (6 Oct 22:10: "the pie orbs ... that Astra made"): TodaySpendIcon's metal rim and dark disc, the used part
 *  of the window as its arc, the number inside when there is room. Unknown stays an empty ring. */
export function UsageOrb({pct, size = 16, stale = false, label}: {pct: number | null; size?: number; stale?: boolean; label?: boolean}) {
  const id = useId().replace(/:/g, '');
  const tone = providerTone(pct), arc = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100 * 87.965;
  return <svg className={`ab-usage-orb is-${tone}${stale ? ' is-stale' : ''}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <defs><linearGradient id={`${id}-metal`} x2="1" y2="1"><stop stopColor="#9aa8b9"/><stop offset=".45" stopColor="#293447"/><stop offset="1" stopColor="#68788d"/></linearGradient></defs>
    <circle cx="20" cy="20" r="18.5" fill="#101826" stroke={`url(#${id}-metal)`}/>
    <circle cx="20" cy="20" r="14" fill="none" stroke="#2c394b" strokeWidth="4"/>
    {arc > 0 && <circle className="ab-usage-orb__arc" cx="20" cy="20" r="14" fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${arc} 87.965`} transform="rotate(-90 20 20)"/>}
    {label && <text x="20" y="24.5" textAnchor="middle" className="ab-usage-orb__n">{pct === null ? '—' : Math.round(pct)}</text>}
  </svg>;
}
/** This chat's own Claude account, from its status-line HUD: the most exact Claude reading there is while it is fresh. */
export type SessionUsage = { accountId?: string | null; fiveHour: { pct: number; resetsAt: number | null } | null; week: { pct: number; resetsAt: number | null } | null; at: number | null; limitsAt?: number | null; limitsStale?: boolean } | null;

export function freshSessionUsage(session: SessionUsage | undefined, now: number): number[] {
  const at=session?.limitsAt ?? session?.at;
  if(!session || session.limitsStale !== false || at==null || at>now || now-at>300_000)return [];
  const windows=[session.fiveHour,session.week];
  if(windows.some(w=>w && w.resetsAt!==null && w.resetsAt<=now))return [];
  return windows.flatMap(w=>w && Number.isFinite(w.pct) && w.pct>=0 && w.pct<=100?[w.pct]:[]);
}
const H = 3_600_000, SPAN = { 'five-hour': 5 * H, week: 7 * 24 * H } as const;
const leftWords = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(m / 60); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
const clockWords = (at: number, now: number) => { const d = new Date(at), same = new Date(now).toDateString() === d.toDateString(); return d.toLocaleString([], same ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }); };
type Win = { id: 'five-hour' | 'week'; pct: number | null; resetsAt: number | null; state: ProviderWindow['state'] };
/** One window at a glance (t-0570, Shaan 9 Oct: "It's quite hard to see when my 5-hour resets for multiple counts"; 10 Oct:
 *  "make it nicer and clearer"): the orb, the window by name, how much is used in big type, a bar of what is used with a tick
 *  at how much of the window has run (fill past the tick = burning faster than it resets), and when it resets. */
function WindowCell({ w, now, note }: { w: Win | null; now: number; note?: string }) {
  const id = w?.id ?? 'five-hour', passed = !!w?.resetsAt && w.resetsAt <= now;
  const elapsed = w?.resetsAt && !passed ? Math.max(0, Math.min(100, 100 - (w.resetsAt - now) / SPAN[id] * 100)) : null;
  const used = w?.pct ?? null;
  return <span className="ab-uw" data-window={id} data-state={used == null ? 'unknown' : w!.state} data-tone={providerTone(used)} title={w?.resetsAt ? `Resets ${new Date(w.resetsAt).toLocaleString()}` : undefined}>
    <UsageOrb pct={used} size={34} stale={!!w && w.state !== 'fresh'} label/>
    <span className="ab-uw__text"><b>{id === 'week' ? 'Weekly limit' : '5-hour limit'}</b>
      {used == null ? <small>{note ?? 'not reported'}</small> : <>
        <span className="ab-uw__pct">{Math.round(used)}%<em> used</em></span>
        <i className="ab-uw__bar" aria-hidden><u style={{ width: `${Math.min(100, used)}%` }}/>{elapsed !== null && <s style={{ left: `${elapsed}%` }}/>}</i>
        {!w!.resetsAt ? <small>reset unknown</small> : passed ? <small>reset passed · awaiting a reading</small>
          : <small>resets in <strong className="ab-uw__left">{leftWords(w!.resetsAt - now)}</strong> · {clockWords(w!.resetsAt, now)}</small>}
      </>}
    </span>
  </span>;
}
const ageWords = (at: number | null, now: number) => at === null ? 'not read' : `read ${leftWords(Math.max(60_000, now - at))} ago`;
const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);

/**
 * One usage item for both providers (Shaan, 6 Oct 21:00: "the codex and claude limit on the bottom nav ... should just be
 * merged ... too much words"): a ring and a number each, no names or "stale" words in the bar. Stale reads are dimmed with
 * a dashed rim; click or Enter opens Usage (AB-09); the card (hover, ↓) still says which provider, which account, how fresh and when each window resets.
 */
export function UsageMeter({providers, now, session, accounts}: {providers:ProviderUsage[];now:number;session?:SessionUsage;accounts?:AccountSnapshot}) {
  const [open,setOpen] = useState(false), [position,setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), closeTimer = useRef<number | undefined>(undefined), keyboard = useRef(false);
  const id = useId();
  const {snapshot,failed}=useClaudeAccounts(open,accounts);
  const usage = useUsageRefresh();
  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current=undefined; };
  const close = (restore=false) => { cancelClose();setOpen(false);if(restore)trigger.current?.focus(); };
  const leave = () => { cancelClose();closeTimer.current=window.setTimeout(()=>{ if (!panel.current?.contains(document.activeElement) && document.activeElement !== trigger.current) setOpen(false); },160); };
  useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(560,innerWidth-16),above=rect.top>innerHeight/2;setPosition({width,left:Math.max(8,Math.min(innerWidth-width-8,rect.left)),...(above?{bottom:innerHeight-rect.top+8,maxHeight:Math.max(80,rect.top-16)}:{top:rect.bottom+8,maxHeight:Math.max(80,innerHeight-rect.bottom-16)})});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    if(keyboard.current)panel.current?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();close(true);}};
    const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))close();};
    const hidden=()=>{if(document.hidden)close();};
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);document.addEventListener('visibilitychange',hidden);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);document.removeEventListener('visibilitychange',hidden);};
  },[open]);
  // Session activity cannot freshen an old or failed account reading.
  const own = freshSessionUsage(session,now);
  providers = providers.map(p => p.id === 'claude' && own.length ? {...p, pct: Math.max(...own), state: 'fresh' as const, partial: false} : p);
  const say=(p:ProviderUsage)=>`${p.label} ${p.pct===null?'unknown':`${Math.round(p.pct)}%`}${p.state==='stale'?' (stale)':''}`;
  const worst=providers.reduce<number|null>((n,p)=>p.pct===null?n:Math.max(n??0,p.pct),null);
  return <>
    <button ref={trigger} type="button" className="ab-provider-meter" data-no-tip data-testid="provider-usage" data-tone={providerTone(worst)} aria-label={`Usage: ${providers.map(say).join(', ')}`} aria-haspopup="dialog" aria-controls={open?id:undefined} aria-expanded={open} onPointerEnter={e=>{if(e.pointerType==='mouse'&&matchMedia('(hover:hover)').matches){cancelClose();keyboard.current=false;setOpen(true);}}} onPointerLeave={leave} onClick={()=>{close();window.location.hash='at='+encodeURIComponent(JSON.stringify({s:'tokens',v:{kind:'chat'},a:null,o:null}));}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();keyboard.current=true;setOpen(true);}}}>
      {providers.map(p=><span key={p.id} className="ab-provider-meter__one" data-testid={`provider-${p.id}`} data-state={p.state} data-tone={providerTone(p.pct)}><UsageOrb pct={p.pct} stale={p.state!=='fresh'}/><b>{p.pct===null?'—':`${Math.round(p.pct)}%`}</b></span>)}
    </button>
    {open&&createPortal(<section ref={panel} id={id} tabIndex={-1} role="dialog" aria-label="Usage accounts" className="ab-provider-card" style={position} onPointerEnter={cancelClose} onPointerLeave={leave} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)&&e.relatedTarget!==trigger.current)leave();}}>
      {/* 10 Oct: the header names what this is, says how old the reading is, and ↻ reads it from Anthropic now. */}
      <header><strong>Claude and Codex usage</strong><span className="ab-provider-card__fresh" data-testid="usage-fresh">{freshWords(usage.busy, usage.failed, Math.max(0, session?.limitsAt ?? 0, ...(providers.find(p => p.id === 'claude')?.accounts ?? []).map(a => a.at ?? 0)) || null, now)}
        <button type="button" className={usage.busy ? 'is-busy' : undefined} aria-label="Refresh usage now" data-testid="usage-refresh" disabled={usage.busy} onClick={() => void usage.run()}><RefreshCwIcon size={13} aria-hidden/></button>
        <button type="button" aria-label="Close usage" onClick={()=>close(true)}>×</button></span></header>
      {(() => {
        const claude = providers.find(p => p.id === 'claude'), codex = providers.find(p => p.id === 'codex');
        const win = (a: ProviderUsage['accounts'][number] | undefined, id: Win['id']): Win | null => { const w = a?.windows.find(x => x.id === id); return w ? { id, pct: w.pct, resetsAt: w.resetsAt, state: w.state } : null; };
        const chatId = session?.accountId ?? (own.length ? 'this-chat' : null);
        // A row per Claude account: the usage cache's windows, this chat's own fresher reading for its account, and the
        // account reader's week, renewal and cloud credit.
        const ids = [...new Set([...(chatId && own.length ? [chatId] : []), ...(claude?.accounts ?? []).map(a => accountIdFromProfile(a.id)), ...(snapshot?.accounts ?? []).map(a => a.id)])];
        const rows = ids.map(id => {
          const a = claude?.accounts.find(x => accountIdFromProfile(x.id) === id), acct = snapshot?.accounts.find(x => x.id === id);
          let five = win(a, 'five-hour'), week = win(a, 'week');
          if (id === chatId && own.length && session) {
            if (session.fiveHour) five = { id: 'five-hour', pct: session.fiveHour.pct, resetsAt: session.fiveHour.resetsAt, state: 'fresh' };
            if (session.week) week = { id: 'week', pct: session.week.pct, resetsAt: session.week.resetsAt, state: 'fresh' };
          } else if (acct?.week && !acct.usageStale && (!week || week.state !== 'fresh')) week = { id: 'week', pct: acct.week.pct, resetsAt: acct.week.resetsAt, state: 'fresh' };
          const known = accountName(id);
          return { id, why: acct?.usageWhy ?? null, name: id === 'this-chat' ? 'This chat' : known === 'account not reported' ? a?.label ?? a?.profile ?? id : known, chat: id === chatId, readOnly: !!acct?.readOnly, at: id === chatId && own.length ? (session?.limitsAt ?? session?.at ?? null) : a?.at ?? null, five, week, credit: acct?.credits?.find(c => c.left !== null) ?? null, renews: acct?.renewsAt ?? null, stale: [five, week].some(w => w && w.pct !== null && w.state !== 'fresh') };
        });
        const soon = rows.flatMap(r => r.five?.pct != null && r.five.resetsAt && r.five.resetsAt > now && r.five.state === 'fresh' ? [{ r, at: r.five.resetsAt }] : []).sort((x, y) => x.at - y.at)[0];
        return <>
          {soon && <p className="ab-usage-next" data-testid="usage-next">Next 5-hour reset · <b>{soon.r.name}</b> in <b>{leftWords(soon.at - now)}</b> <small>at {clockWords(soon.at, now)}</small></p>}
          <div className="ab-provider-card__provider" data-testid="provider-card-claude">
            <h2>Claude</h2>
            {claude?.reason && <p role="status" className="ab-provider-card__note">{claude.reason}</p>}
            {failed && <p role="status" className="ab-provider-card__note">Account readings unavailable · renewal and credit not shown</p>}
            {rows.map(r => <div key={r.id} className={`ab-usage-row${r.stale ? ' is-stale' : ''}${r.chat ? ' is-chat' : ''}`} data-testid="usage-account" data-account={r.id}>
              <span className="ab-usage-row__who"><b>{r.name}</b><small>{[r.chat ? 'this chat' : '', r.readOnly ? 'read-only' : '', r.stale || !r.chat ? ageWords(r.at, now) : ''].filter(Boolean).join(' · ')}</small>
                {(r.credit || r.renews) && <small className="ab-usage-row__money">{r.credit?.left != null ? `${money(r.credit.left)} credit` : ''}{r.credit?.left != null && r.renews ? ' · ' : ''}{r.renews ? `renews ${new Date(r.renews).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}</small>}{r.why && r.five?.state !== 'fresh' && r.week?.state !== 'fresh' && <small className="ab-usage-row__why" data-testid="usage-why">{r.why}</small>}</span>
              <WindowCell w={r.five} now={now}/>
              <WindowCell w={r.week} now={now}/>
            </div>)}
            {!rows.length && <p className="ab-provider-card__note">Not reported.</p>}
          </div>
          {codex && <div className="ab-provider-card__provider" data-testid="provider-card-codex">
            <h2>Codex</h2>
            {codex.reason && <p role="status" className="ab-provider-card__note">{codex.reason}</p>}
            {codex.accounts.map(a => { const five = win(a, 'five-hour'), week = win(a, 'week'), weekOnly = five?.pct == null && week?.pct != null; return <div key={a.id} className={`ab-usage-row${a.windows.some(w => w.state === 'stale') ? ' is-stale' : ''}`} data-testid="provider-account">
              <span className="ab-usage-row__who"><b>{a.label ?? a.profile ?? 'Codex'}</b><small>{ageWords(a.at, now)}</small></span>
              {/* Codex's own events carry one window on this plan, seven days long; there is no 5-hour limit to read. */}
              {weekOnly ? <span className="ab-uw is-note" data-window="five-hour" data-state="none"><span className="ab-uw__text"><b>5 hours</b><small>Codex reports its weekly window only; no 5-hour limit</small></span></span> : <WindowCell w={five} now={now}/>}
              <WindowCell w={week} now={now}/>
            </div>; })}
            {!codex.accounts.length && !codex.reason && <p className="ab-provider-card__note">Not reported.</p>}
          </div>}
          <p className="ab-provider-card__legend"><i aria-hidden/> the tick on each bar is how much of that window has passed: a fill past it is using the limit faster than it resets</p>
        </>;
      })()}
    </section>,document.body)}
  </>;
}
/** One shared read across every mounted footer; the existing poller stops while the document is hidden. */
export function ProviderUsageMeters({now, session}: {now:number; session?: SessionUsage}) {
  const {data,error}=useSharedState<UsageSnapshot>('/api/tokens',60_000);
  const at = Math.max(now, Date.now());
  return <span className="ab-provider-meters" data-testid="provider-meters"><UsageMeter providers={providerUsage(data,error,at)} now={at} session={session}/></span>;
}
