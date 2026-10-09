import { useMemo, useState } from 'react';
import { CircleDashed, Gauge } from 'lucide-react';
import { useSharedState } from '../lib/poll';
import { providerUsage, type ProviderAccount, type ProviderWindow } from '../lib/provider-usage';
import { spendDialData } from '../lib/spend-dial';
import type { useSpend } from '../lib/spend';
import type { Tokens } from './TokensSpace';
import { TodaySpendDial } from './TodaySpendDial';
import './UsageAnswer.css';

/**
 * The top of the Usage page: one calm answer to "am I about to run out, on which login, and when does it reset"
 * (Shaan, 9 Oct: the account he is on "is about to run out, resets in like an hour"; 02:10: "It's quite hard to see when my
 * 5-hour resets for multiple counts"). Each Claude login's 5-hour and week windows with their resets, Codex credits,
 * today's spend and who is burning it. A login over 85% is the one that stands out; sources that are stale or silent say so
 * in one quiet line. Reads the page's one /api/tokens poll plus the shared money and spend reads; no new endpoint.
 */
export const NEAR = 85;
type Money = { codex?: { balance: number | null; budget: number | null; reset: number | null } | null; grants?: { login: string; profile: string | null; left: number | null }[] | null };
type Spend = ReturnType<typeof useSpend>;
export type Burner = { key: string; owner: string; project: string; usd: number };

const leftWords = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(m / 60); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
const clock = (at: number, now: number) => new Date(at).toLocaleString([], new Date(now).toDateString() === new Date(at).toDateString() ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (at: number | null, now: number) => { if (at === null) return 'not read'; const m = Math.max(1, Math.round((now - at) / 60_000)), h = Math.round(m / 60); return `read ${m < 60 ? `${m}m` : h < 24 ? `${h}h` : `${Math.round(h / 24)}d`} ago`; };
const tone = (pct: number | null) => pct === null ? 'none' : pct >= NEAR ? 'bad' : pct >= 70 ? 'warn' : 'ok';
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const live = (w: ProviderWindow, now: number) => w.pct !== null && (w.resetsAt === null || w.resetsAt > now);
const worst = (a: ProviderAccount, now: number) => a.windows.reduce<ProviderWindow | null>((n, w) => live(w, now) && (!n || w.pct! > n.pct! || (w.pct === n.pct && (w.resetsAt ?? Infinity) < (n.resetsAt ?? Infinity))) ? w : n, null);
const nameOf = (a: ProviderAccount) => a.label ?? a.profile ?? a.id;

/** Owners from the spend report, one row per owner even when the ledger has it under two keys ("Agent Zero" and
 *  "agent-zero", A0 9 Oct 02:25); the name shown is the larger share's. */
export function mergedBurners(spend: Spend): Burner[] {
  if (spend?.source !== 'stack-opt') return [];
  const by = new Map<string, Burner & { lead: number }>();
  for (const p of spend.data.projects) for (const o of p.owners) {
    const key = o.owner.toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = by.get(key);
    if (!b) by.set(key, { key, owner: o.owner, project: p.project, usd: o.claude_usd_equiv, lead: o.claude_usd_equiv });
    else { b.usd += o.claude_usd_equiv; if (o.claude_usd_equiv > b.lead) Object.assign(b, { owner: o.owner, project: p.project, lead: o.claude_usd_equiv }); }
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd).map(({ lead: _, ...b }) => b);
}

function Meter({ who, w, now }: { who: string; w: ProviderWindow | undefined; now: number }) {
  const id = w?.id ?? 'five-hour', label = id === 'week' ? 'Week' : '5 hours';
  const pct = w?.pct ?? null, passed = !!w?.resetsAt && w.resetsAt <= now;
  const note = pct === null ? 'not reported' : passed ? 'reset passed · awaiting a reading' : w?.resetsAt ? <>resets in <b>{leftWords(w.resetsAt - now)}</b> · {clock(w.resetsAt, now)}</> : 'reset time unknown';
  return <div className="ul-meter" role="meter" aria-label={`${who} ${label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)} aria-valuetext={pct === null ? 'not reported' : undefined}
    data-window={id} data-tone={passed ? 'none' : tone(pct)} data-state={w?.state ?? 'unknown'}>
    <span className="ul-meter__row"><span>{label}</span><b>{pct === null ? '—' : `${Math.round(pct)}%`}</b></span>
    <i className="ul-meter__track" aria-hidden><i className="ul-meter__fill" style={{ transform: `scaleX(${pct === null || passed ? 0 : Math.max(0.02, Math.min(1, pct / 100))})` }} /></i>
    <small>{note}</small>
  </div>;
}

export function UsageAnswer({ tokens, error, fresh, spend }: { tokens: Tokens | null; error: string | null; fresh: boolean; spend: Spend }) {
  const { data: money, error: moneyError } = useSharedState<Money>('/api/tokens/money', 60_000);
  const [open, setOpen] = useState(false), [project, setProject] = useState<string | null>(null), [all, setAll] = useState(false);
  const now = Math.max(Date.now(), tokens?.at ?? 0);
  const cached = !!tokens && (tokens.cached === true || !fresh);
  const [claude, codexUsage] = useMemo(() => providerUsage(tokens as never, tokens ? null : error, now), [tokens, error, now]);
  const logins = useMemo(() => [...claude.accounts].sort((a, b) => (worst(b, now)?.pct ?? -1) - (worst(a, now)?.pct ?? -1)), [claude, now]);
  const near = logins.flatMap(a => { const w = worst(a, now); return w && w.pct! >= NEAR ? [{ a, w }] : []; });
  const reporting = logins.some(a => a.windows.some(w => w.pct !== null));
  // A silent login is never an all-clear: it may be the one he is on.
  const silent = logins.filter(a => !a.windows.some(w => w.pct !== null));
  const nextReset = logins.flatMap(a => a.windows.filter(w => w.id === 'five-hour' && live(w, now) && w.resetsAt).map(w => ({ a, at: w.resetsAt! }))).sort((x, y) => x.at - y.at)[0];
  const state = !tokens ? (error ? 'unknown' : 'loading') : near.length ? 'near' : reporting && !silent.length ? 'fine' : 'unknown';

  // Codex: the money read owns the balance and its budget; the newest Codex event's balance stands in when that read fails.
  const codexAccount = (tokens?.accounts ?? []).find(a => a.kind === 'codex');
  const eventBalance = codexAccount?.limits?.credits?.balance;
  const balance = typeof money?.codex?.balance === 'number' ? money.codex.balance : typeof eventBalance === 'number' ? eventBalance : null;
  const budget = typeof money?.codex?.budget === 'number' && money.codex.budget > 0 ? money.codex.budget : null;
  const codexReset = money?.codex?.reset ?? codexUsage.accounts[0]?.windows.find(w => w.id === 'week')?.resetsAt ?? null;
  const grant = (a: ProviderAccount) => money?.grants?.find(g => g.left !== null && (g.login === a.label || g.login.split('@')[0] === a.label || (!!g.profile && g.profile.replace(/^\./, '') === (a.profile ?? '').replace(/^[~/.]+/, ''))));

  const { headline, snapshot } = spendDialData(spend);
  const burners = useMemo(() => mergedBurners(spend), [spend]);
  const shown = all ? burners : burners.slice(0, 7), peak = Math.max(0.01, ...burners.map(b => b.usd));

  // Everything that is not reporting, or reporting late, in one quiet line.
  const quiet = [
    cached ? 'From the last run · refreshing' : '',
    ...(cached ? [] : logins.map(a => !a.windows.some(w => w.pct !== null) ? `${nameOf(a)} not reporting` : a.windows.some(w => w.state === 'stale') ? `${nameOf(a)} ${ago(a.at, now)}` : '')),
    tokens && balance === null ? 'Codex credits not reporting' : moneyError && !money ? 'Codex budget not reporting' : '',
    !spend ? '' : spend.source !== 'stack-opt' ? 'spend report not reporting' : spend.attribution?.state !== 'fresh' ? 'spend report from earlier' : '',
    tokens && spend?.source === 'stack-opt' && headline.usd === null ? "today's total not reporting" : '',
  ].filter(Boolean);

  const hot = near[0];
  return <section className="ul" data-testid="usage-answer" data-state={state} aria-labelledby="ul-headline">
    <header className="ul-head">
      <span className="ul-head__icon" data-tone={state === 'near' ? 'bad' : state === 'fine' ? 'ok' : 'none'} aria-hidden><Gauge size={18} /></span>
      <p id="ul-headline" data-testid="usage-headline" role="status">
        {state === 'loading' ? 'Reading your plans…'
          : state === 'near' ? <><b>{nameOf(hot.a)}</b> is at <b className="ul-hot">{Math.round(hot.w.pct!)}%</b> of its {hot.w.id === 'week' ? 'week' : '5 hours'}{hot.w.resetsAt ? <> · resets in <b>{leftWords(hot.w.resetsAt - now)}</b> <small>at {clock(hot.w.resetsAt, now)}</small></> : <> · reset time unknown</>}{near.length > 1 && <small> · {near.length - 1} more near its limit</small>}</>
          : state === 'fine' ? <>Every login has room{nextReset && <> · next 5-hour reset <b>{nameOf(nextReset.a)}</b> in <b>{leftWords(nextReset.at - now)}</b></>}</>
          : error && !tokens ? 'Usage unavailable · retrying'
          : reporting ? <><b>{silent.map(nameOf).join(', ')}</b> {silent.length === 1 ? 'is' : 'are'} not reporting {silent.length === 1 ? 'its' : 'their'} limits · the others have room</>
          : 'No login is reporting its limits right now'}
      </p>
    </header>
    {state === 'loading' ? <div className="ul-grid" aria-hidden>{[0, 1, 2].map(i => <div key={i} className="ul-tile is-placeholder" />)}</div> : <>
      <div className="ul-grid">
        {logins.map(a => { const w = worst(a, now), isNear = !!w && w.pct! >= NEAR, g = grant(a); return <article key={a.id} className="ul-tile ul-login" data-testid="usage-login" data-login={nameOf(a)} data-near={isNear}>
          <header><b title={nameOf(a)}>{nameOf(a)}</b>{isNear ? <span className="ul-pill">Near limit</span> : <small>{a.profile && a.profile !== nameOf(a) ? a.profile : 'Claude'}</small>}</header>
          <Meter who={nameOf(a)} w={a.windows.find(x => x.id === 'five-hour')} now={now} />
          <Meter who={nameOf(a)} w={a.windows.find(x => x.id === 'week')} now={now} />
          {g?.left != null && <small className="ul-login__extra">{usd(g.left)} cloud credit left</small>}
        </article>; })}
        {!logins.length && <article className="ul-tile ul-login is-empty" data-testid="usage-no-logins"><b>Claude</b><small>{claude.reason ?? 'No login reported'}</small></article>}
        <article className="ul-tile ul-codex" data-testid="usage-codex">
          <header><b>Codex</b><small>credits</small></header>
          {balance === null ? <p className="ul-big is-none">—</p> : <p className="ul-big">{Math.round(balance).toLocaleString('en-US')}<small> left</small></p>}
          {budget !== null && balance !== null && <i className="ul-meter__track" aria-hidden><i className="ul-meter__fill" data-tone="info" style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, balance / budget))})` }} /></i>}
          <small>{budget !== null ? `of ${budget.toLocaleString('en-US')} this week` : 'weekly budget not reported'}{codexReset && codexReset > now ? ` · resets ${clock(codexReset, now)}` : ''}</small>
        </article>
        <article className="ul-tile ul-today" data-testid="usage-today">
          <header><b>Today</b><small>Claude at API prices</small></header>
          <TodaySpendDial headline={headline} snapshot={snapshot} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} selectedProjectId={project} onSelectProject={setProject} />
        </article>
      </div>
      {burners.length > 0 && <div className="ul-burners" data-testid="usage-burners">
        <h3>Who is burning it today <small>by owner · API-equiv</small></h3>
        <ol>{shown.map((b, i) => <li key={b.key} data-testid="usage-burner" data-owner={b.owner}>
          <span className="ul-rank">{i + 1}</span>
          <span className="ul-who"><b title={b.owner}>{b.owner}</b><small title={b.project}>{b.project}</small></span>
          <i className="ul-meter__track" aria-hidden><i className="ul-meter__fill" data-tone="spend" style={{ transform: `scaleX(${Math.max(0.02, b.usd / peak)})` }} /></i>
          <span className="ul-usd">{usd(b.usd)}</span>
        </li>)}</ol>
        {burners.length > 7 && <button type="button" className="ul-more" data-testid="usage-burners-more" aria-expanded={all} onClick={() => setAll(v => !v)}>{all ? 'Show the top 7' : `and ${burners.length - 7} more`}</button>}
      </div>}
      {quiet.length > 0 && <p className="ul-quiet" data-testid="usage-quiet"><CircleDashed size={12} aria-hidden />{quiet.join(' · ')}</p>}
    </>}
  </section>;
}
