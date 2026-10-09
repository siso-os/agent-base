import { useEffect, useState, type CSSProperties } from 'react';
import { formatDuration } from '@siso/side-nav';
import { AgentFace } from '../lib/face';
import { clock } from '../lib/poll';
import { openOwner, openOwnerLink, useOwners, type Owner, type OwnersSnapshot } from '../lib/owners';
import { ArrowUpRightIcon } from 'lucide-react';
import { WidgetCard } from './widgets/WidgetCard';
import './OwnerBoard.css';
import { OwnerSpaceWork } from './OwnerSpaceWork';
import type { OwnerQuestionConnection } from './OwnerSpaceModel';
type Workspace = { id: string; name: string; color: string };
const state = (o: Owner) => o.status;
export const model = (o: Owner) => /astra/i.test(o.model) ? 'Astra' : /sol/i.test(o.model) ? 'Sol' : /luna/i.test(o.model) ? 'Luna' : o.model || 'Model unreported';
const rss = (o: Owner) => o.runtime?.peakRss == null ? 'Peak RSS unreported' : `Peak ${(o.runtime.peakRss / 1024**2).toFixed(0)} MiB`;
export const active = (o: Owner) => ['researching','building','synthesising','running','queued','terminating'].includes(state(o));
/** One truth (Shaan, 6 Oct 22:00: "the working, not working, I don't think it actually is accurate"): what its runtime is
 *  doing now. Hosted owners read their live seat; a Mini job its manifest; only with neither does the card's word stand. */
export const live = (o: Owner): 'working' | 'idle' | 'needs' | 'failed' | 'offline' | null => {
  const h = o.hostedRuntime;
  if (h && h.availability === 'online' && ['working','idle','needs','failed'].includes(h.activity)) return h.activity as 'working' | 'idle' | 'needs' | 'failed';
  if (h && h.availability === 'offline') return 'offline';
  if (o.runtime) return ['running','terminating','queued'].includes(o.runtime.status) ? 'working' : o.runtime.status === 'failed' ? 'failed' : 'idle';
  return null;
};
export const working = (o: Owner) => (live(o) ?? (active(o) ? 'working' : 'idle')) === 'working';
export const LIVE_WORD = { working: 'Working', idle: 'Idle', needs: 'Needs you', failed: 'Failed', offline: 'Offline' } as const;
export const STATUS_WORD: Record<string, string> = { ready: 'preview ready', done: 'done', blocked: 'blocked', 'waiting-on-shaan': 'waiting on you', researching: 'researching', building: 'building', synthesising: 'synthesising', unreported: 'no report' };
/** Overdue only while it is actually running a turn with no card update for 30 min, never while idle waiting for him. */
export const overdue = (o: Owner, now: number) => working(o) && (!o.updated || now - Date.parse(o.updated) > 30 * 60_000);
function StateWord({ o }: { o: Owner }) {
  const now = live(o) ?? (active(o) ? 'working' : 'idle');
  return <em className={`ab-owner__state is-${now}`} data-testid="owner-state"><i aria-hidden />{LIVE_WORD[now]}<small> · {STATUS_WORD[o.status] ?? o.status.replaceAll('-', ' ')}</small></em>;
}
/** Its latest link (the card's `page`) as a chip (6 Oct 22:00: "he's messaged me a link, because the links are cool"). */
export function LinkChip({ o }: { o: Owner }) {
  if (!o.page) return null;
  let label = o.page; try { const u = new URL(o.page); label = `Latest link · ${/^(127\.0\.0\.1|localhost)$/.test(u.hostname) ? `:${u.port}` : u.hostname.replace(/^www\./, '')}`; } catch { /* shown raw */ }
  return <button type="button" className="ab-owner__link" data-testid={`owner-link-${o.name}`} title={o.page} onClick={() => openOwnerLink(o.page!, `${o.name} · ${o.subtitle || o.title}`.slice(0, 80))}><ArrowUpRightIcon size={12} aria-hidden /><span>{label}</span></button>;
}
export const ago = (date: string | null, now: number) => date ? `${formatDuration(Math.max(0,now-Date.parse(date)))} ago` : 'unreported';
export const face = (o: Owner) => ({ name: o.name, project: o.workspace, status: ['blocked','failed'].includes(state(o)) || live(o) === 'failed' ? 'blocked' as const : o.status === 'waiting-on-shaan' || live(o) === 'needs' ? 'needs-shaan' as const : working(o) ? 'working' as const : ['done','ready'].includes(state(o)) ? 'done' as const : 'waiting' as const });
const accent = (o: Owner, ws: Workspace[]) => ({ '--owner-color': ws.find(w => w.id === o.workspace)?.color ?? '#9b9ba6' } as CSSProperties);
function useNow() { const [now,setNow] = useState(Date.now()); useEffect(() => clock(() => setNow(Date.now())), []); return now; }
const miniStatus = (o: Owner) => o.runtime?.status === 'done' ? 'execution finished · delivery acceptance not established' : o.runtime?.status ?? 'unknown';
function RuntimeStatus({ o, now, data }: { o: Owner; now: number; data: OwnersSnapshot | null }) {
  const runtime = o.hostedRuntime;
  const stale = !!(data?.error || data?.hosted?.error || (runtime?.observedAt != null && now - runtime.observedAt > 45_000));
  const status = runtime?.availability === 'online' ? runtime.activity : runtime?.availability ?? 'unknown';
  // The state word says what it is doing; this line shows only when that reading is stale or missing (fewer words).
  if (!stale && runtime?.availability === 'online' && !(o.fleet && o.job)) return null;
  return <span className={`ab-owner__runtime${stale ? ' is-stale' : ''}`}>
    <span>Runtime: {status}{stale ? ' · stale observation' : ''}{runtime?.model ? ` · ${runtime.model}` : ''}</span>
    <small>Hosted runtime · observed {runtime?.observedAt != null ? ago(new Date(runtime.observedAt).toISOString(), now) : 'not yet'} · metadata {runtime?.metadataUpdatedAt != null ? ago(new Date(runtime.metadataUpdatedAt).toISOString(), now) : 'unreported'}</small>
    {o.fleet && o.job && <small>Mini manifest: {miniStatus(o)} · checked {data?.mini?.at != null ? ago(new Date(data.mini.at).toISOString(), now) : 'not yet'}{data?.mini?.error || data?.error || (data?.mini?.at != null && now - data.mini.at > 90_000) ? ' · stale observation' : ''}</small>}
  </span>;
}
function OwnerCard({ o, owners, workspaces, now, data, path = [] }: { o: Owner; owners: Owner[]; workspaces: Workspace[]; now: number; data: OwnersSnapshot | null; path?: string[] }) {
  const children = owners.filter(c => c.parent === o.name && ![...path,o.name].includes(c.name));
  const workers = [...children.map(c => ({name:c.name,status:state(c)})), ...o.subagents.filter(s => !children.some(c => c.name === s.name))];
  const started = o.runtime?.started ?? o.started;
  const ended = o.runtime?.ended ?? (state(o) === 'done' ? o.updated : null);
  if (path.length) return <div className="ab-owner-family is-child"><div className="ab-owner-wrap"><button type="button" className={`ab-owner ab-owner--compact${o.readError || overdue(o,now) ? ' is-stale' : ''}`} style={accent(o,workspaces)} onClick={() => openOwner(o.name)} data-testid={`owner-${o.name}`}>
    <span className="ab-owner__identity"><AgentFace {...face(o)} size={24}/><span><strong title={o.title}>{o.title}</strong><small>{model(o)} · {o.machine === 'mini' ? 'Mac Mini' : o.machine || o.workspace}</small></span><StateWord o={o}/></span>
    <span className="ab-owner__subtitle" title={o.subtitle}>{o.subtitle || 'Current step unreported'}</span>
    <span className="ab-owner__facts"><span>{started ? formatDuration(Math.max(0,(ended ? Date.parse(ended) : now)-Date.parse(started))) + (ended ? ' worked' : ' on task') : 'Start unreported'}</span><span>{workers.filter(s => ['researching','building','synthesising','running'].includes(s.status)).length}/{workers.length} workers</span><span>{o.runtime ? rss(o) : 'Fleet unverified'}</span></span>
    <RuntimeStatus o={o} now={now} data={data}/>
    <span className="ab-owner__updated">{o.readError ? 'Last good report · ' : overdue(o,now) ? 'Update overdue · ' : 'Report · '}{ago(o.updated,now)}{o.pick !== null && ` · ✦ A0 pick: ${o.pick}`}</span>
  </button><LinkChip o={o}/></div>{!!children.length && <div className="ab-owner__children">{children.map(c => <OwnerCard key={c.name} o={c} owners={owners} workspaces={workspaces} now={now} data={data} path={[...path,o.name]}/>)}</div>}</div>;
  return <div className={`ab-owner-family${path.length ? ' is-child' : ''}`}>
    <div className="ab-owner-wrap">
    <button type="button" className={`ab-owner${o.pick !== null ? ' is-pick' : ''}${overdue(o,now) || o.readError ? ' is-stale' : ''}`} style={accent(o,workspaces)} onClick={() => openOwner(o.name)} data-testid={`owner-${o.name}`}>
      {o.pick !== null && <span className="ab-owner__pick">✦ Agent Zero’s pick <small>{o.pick}</small></span>}
      <span className="ab-owner__identity"><AgentFace {...face(o)} size={path.length ? 28 : 40}/><span><b title={o.name}>{path.length ? o.job || o.name : o.name}</b><small>{workspaces.find(w => w.id === o.workspace)?.name ?? (o.workspace || 'Workspace unreported')} · {model(o)}</small></span><StateWord o={o}/></span>
      <strong className="ab-owner__title">{o.title}</strong><span className="ab-owner__subtitle">{o.subtitle || 'Current step not reported yet'}</span>
      <span className="ab-owner__facts"><span>{started ? `${formatDuration(Math.max(0,(ended ? Date.parse(ended) : now)-Date.parse(started)))} ${ended ? 'worked' : 'on task'}` : 'Start unreported'}</span><span>{workers.filter(s => ['researching','building','synthesising','running'].includes(s.status)).length}/{workers.length} workers reported active</span>{o.machine && <span>{o.machine === 'mini' ? 'Mac Mini' : o.machine}</span>}</span>
      <RuntimeStatus o={o} now={now} data={data}/>
      <span className="ab-owner__updated" title={o.updated ?? undefined}>{o.readError ? 'Unreadable update · last good status ' : overdue(o,now) ? 'Update overdue · ' : 'Report updated '}{ago(o.updated,now)}</span>
    </button>
    <LinkChip o={o}/>
    </div>
    {!!children.length && <div className="ab-owner__children" aria-label={`${o.name} build owners`}><span className="ab-owner__crew">{children.length} build owners · {children.filter(active).length} reported active</span>{children.map(c => <OwnerCard key={c.name} o={c} owners={owners} workspaces={workspaces} now={now} data={data} path={[...path,o.name]}/>)}</div>}
  </div>;
}
export function OwnerBoard({ workspaces = [] }: { workspaces?: Workspace[] }) {
  const data = useOwners(true), now = useNow();
  workspaces = workspaces.length ? workspaces : data?.workspaces ?? [];
  const owners = data?.owners ?? [];
  // Missing parents and malformed cycles stay visible rather than silently losing work.
  const roots = owners.filter(o => { let current = o; const seen = new Set([o.name]); for (;;) { const p = owners.find(c => c.name === current.parent); if (!p) return current === o; if (seen.has(p.name)) return true; seen.add(p.name); current = p; } });
  return <section className="ab-owners" aria-label="Long-running owners" data-testid="owner-board">
    <header className="ab-owners__heading"><div><span>Working for you</span><h3>Your owners</h3></div><small>{data ? `${owners.length} reporting` : 'Connecting…'}</small></header>
    {data?.error && <p role="status" className="ab-owners__notice">{data.error}</p>}
    {data?.hosted?.error && <p role="status" className="ab-owners__notice">{data.hosted.error}</p>}
    {data?.mini?.error && <p role="status" className="ab-owners__notice">{data.mini.error}</p>}
    {data?.mini?.at && <p className="ab-owners__checked">Mini checked {ago(new Date(data.mini.at).toISOString(),now)} · refreshes once a minute while this view is visible</p>}
    {!!data?.warnings.length && <details className="ab-owners__notice"><summary>{data.warnings.length} status {data.warnings.length === 1 ? 'file needs' : 'files need'} attention</summary>{data.warnings.map(w => <p key={w}>{w}</p>)}</details>}
    {!data && <p className="ab-owners__notice">Reading owner updates…</p>}
    {data && !owners.length && <p className="ab-owners__notice">No owner has reported yet. Their status cards will appear here as soon as they publish an update.</p>}
    <div className="ab-owners__cards">{roots.map(o => <OwnerCard key={o.name} o={o} owners={owners} workspaces={workspaces} now={now} data={data}/>)}</div>
  </section>;
}
export function OwnerPage({ name, workspaces, onBack, onPage, onChat, chatAvailable, questions }: { name: string; workspaces: Workspace[]; onBack: () => void; onPage: (url: string, title: string) => void; onChat: () => void; chatAvailable: boolean; questions?: OwnerQuestionConnection }) {
  const data = useOwners(true), now = useNow(), o = data?.owners.find(o => o.name === name);
  const children = data?.owners.filter(c => c.parent === name) ?? [];
  const workers = [...children.map(c => ({name:c.name,status:state(c)})), ...(o?.subagents ?? []).filter(s => !children.some(c => c.name === s.name))];
  return <section className="ab-owner-page" aria-label={`${name} progress`} data-testid="owner-page">
    <button type="button" className="ab-owner-page__back" onClick={onBack}>← Back to Fleet</button>
    {!o ? <p role="status">{data?.error || (data ? `${name} has no readable status card. Return to Fleet to see who is reporting.` : 'Reading owner progress…')}</p> : <>
      <header style={accent(o,workspaces)} className="ab-owner-page__hero"><AgentFace {...face(o)} size={72}/><div><span>{o.name} · {workspaces.find(w => w.id === o.workspace)?.name ?? o.workspace}</span><h1>{o.title}</h1><p>{o.subtitle}</p><StateWord o={o}/><small>Reported: {state(o).replaceAll('-',' ')} · Updated {ago(o.updated,now)}{overdue(o,now) ? ' · Update overdue (30+ minutes)' : ''}</small><RuntimeStatus o={o} now={now} data={data}/></div></header>
      {data?.hosted?.error && <p role="status" className="ab-owners__notice">{data.hosted.error}</p>}
      {o.pick !== null && <p className="ab-owner-page__recommend">✦ Agent Zero’s pick · {o.pick}</p>}
      {(data?.error || o.readError) && <p role="status" className="ab-owners__notice">{data?.error || 'Latest file unreadable. This is the last good update.'}</p>}
      <div className="ab-owner-page__actions"><button type="button" disabled={!o.page} onClick={() => o.page && onPage(o.page,`${o.name} · latest page`)}>{o.page ? 'Open latest page in Web' : 'No page published yet'}</button><button type="button" disabled={!chatAvailable} onClick={onChat}>{chatAvailable ? 'Open owner chat' : 'Owner chat is not connected'}</button></div>
      {!!(o.model || o.fleet || o.branch || o.report || o.locks.length || o.locked.length) && <WidgetCard size="M" title="Build context" description={`${model(o)} · ${o.machine || 'Machine unreported'}`} icon="clipboard-check"><dl className="ab-owner-page__context">
        {o.parent && <><dt>Lead owner</dt><dd><button onClick={() => openOwner(o.parent)}>{o.parent} ↗</button></dd></>}
        {o.fleet && <><dt>Fleet / job</dt><dd>{o.fleet} / {o.job}</dd><dt>Manifest status</dt><dd>{o.runtime ? `${miniStatus(o)} · ${rss(o)}` : 'Not verified yet · owner report shown'}{data?.mini?.at && ` · Checked ${ago(new Date(data.mini.at).toISOString(),now)}`}{data?.mini?.error && <p role="status">{data.mini.error}</p>}</dd><dt>Started / ended</dt><dd>{o.runtime?.started ?? 'Not observed'} / {o.runtime?.ended ?? 'Not observed'}</dd></>}
        {o.branch && <><dt>Branch</dt><dd>{o.branch}</dd></>}{o.report && <><dt>Report path</dt><dd>{o.report}<button onClick={() => void navigator.clipboard.writeText(o.report)}>Copy path</button></dd></>}
      </dl><details className="ab-owner-page__locks"><summary>Locked files · {new Set([...o.locks,...o.locked.flatMap(l => l.files)]).size}</summary>{o.locked.map((l,i) => <div key={i}><p>{l.owner} · {l.repo}<br/>{l.branch}<br/>{l.mode}</p><ul>{l.files.map(f => <li key={f}>{f}</li>)}</ul></div>)}{!!o.locks.length && <ul>{o.locks.filter(f => !o.locked.some(l => l.files.includes(f))).map(f => <li key={f}>{f}</li>)}</ul>}</details>{!!o.rules.length && <div className="ab-owner-page__rules"><h3>Integration rules</h3><ul>{o.rules.map(r => <li key={r}>{r}</li>)}</ul></div>}</WidgetCard>}
      <OwnerSpaceWork name={name} onChat={onChat} chatAvailable={chatAvailable} questions={questions} />
      <WidgetCard size="M" title="Where it stands" description="The owner’s latest report" icon="clipboard-check"><p>{o.summary || 'Summary not reported yet.'}</p></WidgetCard>
      <WidgetCard size="M" title="Findings" description="Biggest impact first" icon="brain" count={o.findings.length}><div className="ab-owner-page__findings">{o.findings.map((f,i) => <article key={i}><span className={`ab-owner-page__impact is-${f.impact}`}>{f.impact} impact</span><h3>{f.title}</h3><p>{f.fix || 'Next action not reported.'}</p><small>{f.effort ? `Effort · ${f.effort}` : 'Effort unreported'}</small>{f.evidence && (/^https?:\/\//i.test(f.evidence) ? <button type="button" onClick={() => onPage(f.evidence, f.title)}>View evidence ↗</button> : <details className="ab-owner-page__evidence"><summary>Local evidence · {f.evidence}</summary><p>The owner supplied a local path. Copy it to inspect the source.</p><button type="button" onClick={() => void navigator.clipboard.writeText(f.evidence)}>Copy evidence path</button></details>)}</article>)}{!o.findings.length && <p>No findings published yet. This section fills as evidence lands.</p>}</div></WidgetCard>
      <WidgetCard size="M" title="Its sub-agents" description="Reported by this owner" icon="users-round" count={`${workers.filter(s => ['researching','building','synthesising','running'].includes(s.status)).length}/${workers.length} reported active`}><div className="ab-owner-page__workers">{data?.owners.filter(c => c.parent === o.name).map(c => <button className="ab-owner-page__worker" key={c.name} onClick={() => openOwner(c.name)}><b>{c.title}</b><span>{model(c)} · {c.machine}</span><small>Reported: {state(c)}</small></button>)}{o.subagents.filter(s => !data?.owners.some(c => c.parent === o.name && c.name === s.name)).map((s,i) => <div key={i}><b>{s.name}</b><span>{s.title}</span><small>{s.where || 'Machine unreported'} · {s.status}</small></div>)}{!o.subagents.length && !data?.owners.some(c => c.parent === o.name) && <p>No sub-agents reported. This owner may be working directly.</p>}</div></WidgetCard>
      <div className="ab-owner-page__bottom"><WidgetCard size="M" title="Up next" description="Where the work goes from here" icon="rocket"><p>{o.next || 'Next step not reported yet.'}</p></WidgetCard><WidgetCard size="M" title="Needs you" description="Decisions and access" icon="badge-alert"><ul>{o.asks.map((ask,i) => <li key={i}>{ask}</li>)}</ul>{!o.asks.length && <p>Nothing requested from you.</p>}</WidgetCard></div>
    </>}
  </section>;
}
