import { CircleDashed, Layers3, MessageCircleMore, Sparkles, UsersRound } from 'lucide-react';
import { lazy, Suspense, useMemo, useState, type CSSProperties } from 'react';
import { AgentFace } from '../../../../packages/halo-face';
import type { Agent, Org } from '../lib/agents';
import type { HubOrg } from '../lib/hub-types';
import { buildOrgPresentation, orgName, orgSeatStatus, type OrgPresentation, type OrgSeat, type OrgWorker } from './OrgChartModel';
import { OrgTour } from './OrgTour';
import './OrgChart.css';
const Constellation = lazy(() => import('./Constellation').then(m => ({ default: m.Constellation })));

type OrgChartProps = {
  org: HubOrg;
  onOpen: (name: string) => void;
  onOpenAgent?: (id: string) => void;
  onAsk?: (question: string, node: string) => Promise<string | void> | string | void;
  agents?: Agent[];
  /** Existing /api/org projection, including planned owner seats and infrastructure. */
  roster?: Org;
};
type OrgView = 'tree' | 'constellation';
const loadView = (): OrgView => { try { return localStorage.getItem('ab-org-view') === 'constellation' ? 'constellation' : 'tree'; } catch { return 'tree'; } };
const faceState = (seat: OrgSeat) => seat.runtime ? seat.runtime.row === 'settled' ? 'offline' : seat.runtime.status === 'working' ? 'working' : seat.runtime.status === 'done' ? 'done' : 'waiting' : seat.hub?.spunUp ? seat.hub.state === 'working' ? 'working' : 'waiting' : seat.roster?.state === 'live' ? 'waiting' : 'offline';

function WorkerTree({ parent, model, onOpen, onOpenAgent, depth = 0 }: { parent: string; model: OrgPresentation; onOpen: (name: string) => void; onOpenAgent?: (id: string) => void; depth?: number }) {
  const children = model.children.get(parent) ?? [];
  if (!children.length) return null;
  const currentBranch = (w: OrgWorker): boolean => w.agent.row !== 'settled' || (model.children.get(w.key) ?? []).some(currentBranch);
  const current = children.filter(currentBranch), history = children.filter(w => !currentBranch(w));
  const row = (worker: OrgWorker) => {
    const a = worker.agent;
    const uniqueName = model.workers.filter(w => orgName(w.agent.name) === orgName(a.name)).length === 1;
    const canOpen = a.row !== 'settled' && (!!onOpenAgent || uniqueName);
    return <li key={worker.key} data-worker-id={a.id} className="hub-org__worker" style={{ '--worker-indent': `${Math.min(depth, 3) * 5}px` } as CSSProperties}>
      <button type="button" disabled={!canOpen} onClick={() => onOpenAgent ? onOpenAgent(a.id) : onOpen(a.name)}><span><b>{a.name}</b><small>{a.row === 'settled' ? 'Session settled' : a.row === 'snoozed' ? 'Snoozed' : a.status === 'done' ? 'Turn finished · still present' : a.status === 'needs' ? 'Needs attention' : a.status}</small></span></button>
      {a.role && <p>Purpose: {a.role}</p>}
      {a.title && a.title !== a.name && <p>Current task: {a.title}</p>}
      <p className="hub-org__return">Return to: {worker.returnName ?? 'Not recorded'}</p>
      {worker.reason && <p className="hub-org__relationship-note">{worker.reason}</p>}
      <WorkerTree parent={worker.key} model={model} onOpen={onOpen} onOpenAgent={onOpenAgent} depth={depth + 1} />
    </li>;
  };
  return <div className="hub-org__crew">{current.length > 0 && <ul aria-label="Current workers">{current.map(row)}</ul>}{history.length > 0 && <details className="hub-org__history"><summary>Finished history <span>{history.length}</span></summary><p>Settled sessions; this does not establish task delivery.</p><ul aria-label="Finished worker history">{history.map(row)}</ul></details>}</div>;
}

function OwnerCard({ seat, model, onOpen, onOpenAgent, tourNode }: { seat: OrgSeat; model: OrgPresentation; onOpen: (name: string) => void; onOpenAgent?: (id: string) => void; tourNode: string | null }) {
  const hub = seat.hub, runtime = seat.runtime;
  const purpose = runtime?.role || hub?.role || seat.roster?.domain || hub?.domain;
  const task = hub?.holding?.title || (runtime?.title && runtime.title !== runtime.name ? runtime.title : null);
  const returnOwner = runtime?.owner || runtime?.lead || hub?.owner;
  const selfReturn = returnOwner && orgName(returnOwner) === orgName(seat.name);
  const extraSessions = seat.runtimes.filter(a => a.id !== runtime?.id);
  const plan = hub?.plan ?? seat.roster?.plan;
  const open = runtime ? runtime.row !== 'settled' : seat.roster?.state === 'live' || hub?.spunUp;
  return <article className={`hub-org__seat${seat.infrastructure ? ' is-infrastructure' : ''}`} data-owner-name={orgName(seat.name)}>
    <button type="button" className={`hub-org__agent${open ? '' : ' is-unspun'}${tourNode === orgName(seat.name) ? ' is-tour-current' : ''}`} data-tour-node={orgName(seat.name)} disabled={!open} onClick={() => runtime && onOpenAgent ? onOpenAgent(runtime.id) : onOpen(seat.name)}>
      <span className="hub-org__avatar hub-org__avatar--face">{seat.infrastructure ? <Layers3 size={27} /> : !hub && !runtime && !seat.roster ? <CircleDashed size={28} /> : <AgentFace name={seat.name} project={runtime?.project ?? hub?.project} status={faceState(seat)} size={38} />}</span>
      <span className="hub-org__agent-main"><b className="hub-org__agent-name">{seat.name}</b><span className="hub-org__worker-count">{orgSeatStatus(seat)}</span></span>
    </button>
    <div className="hub-org__seat-context">{purpose ? <p>Purpose: {purpose}</p> : <p className="hub-org__relationship-note">Purpose not recorded</p>}{task && <p><b>Current task</b> {task}</p>}<p>{selfReturn ? `Recorded owner link: ${returnOwner} (same displayed seat)` : `Return to: ${returnOwner ?? 'Not recorded'}`}</p>{seat.recordedNames.length > 1 && <details data-testid="org-alias-provenance"><summary>Recorded identities · {seat.recordedNames.length}</summary><p>{seat.recordedNames.join(' · ')}</p>{seat.rosterRecords.map((record, i) => <p key={`${record.name}:${i}`}>{record.name}: {record.state}</p>)}</details>}{seat.recordedPlaces.some(p => p.project === 'SISO Internal Labs') && <details data-testid="org-project-provenance"><summary>Recorded folder labels</summary>{seat.recordedPlaces.map((p, i) => <p key={i}>{p.groupName} / {p.project} / {p.domain || 'General'}</p>)}</details>}{extraSessions.length > 0 && <details data-testid="org-owner-sessions"><summary>Additional sessions · {extraSessions.length}</summary>{extraSessions.map(a => <p key={a.id}><button type="button" data-owner-session-id={a.id} disabled={a.row === 'settled' || !onOpenAgent} onClick={() => onOpenAgent?.(a.id)}>{a.name} · {a.row === 'settled' ? 'Session settled' : a.status}</button>{a.title && a.title !== a.name && <span> · {a.title}</span>}</p>)}</details>}{seat.places.length > 1 && <p className="hub-org__relationship-note">Also listed: {seat.places.slice(1).map(p => `${p.project} / ${p.domain || 'General'}`).join(' · ')}</p>}{plan && plan.total > 0 && <p>{plan.checked} of {plan.total} plan items checked</p>}</div>
    <WorkerTree parent={seat.key} model={model} onOpen={onOpen} onOpenAgent={onOpenAgent} />
  </article>;
}

export function OrgChart({ org, onOpen, onOpenAgent, onAsk, agents = [], roster }: OrgChartProps) {
  const [tourNode, setTourNode] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [view, setViewState] = useState<OrgView>(loadView);
  const setView = (v: OrgView) => { setViewState(v); try { localStorage.setItem('ab-org-view', v); } catch {} };
  const model = useMemo(() => buildOrgPresentation(org, agents, roster), [org, agents, roster]);
  const { zero } = org;
  const card = (seat: OrgSeat) => <OwnerCard key={seat.key} seat={seat} model={model} onOpen={onOpen} onOpenAgent={onOpenAgent} tourNode={tourNode} />;
  const unplaced = model.owners.filter(s => !s.places.length);
  const constellationOrg = useMemo(() => {
    const seen = new Set<string>();
    return { ...org, groups: org.groups.map(g => ({ ...g, projects: g.projects.map(p => ({ ...p, domains: p.domains.filter(d => {
      if (!d.owner) return false;
      const key = orgName(d.owner.name);
      if (seen.has(key) || !model.owners.some(s => orgName(s.name) === key)) return false;
      seen.add(key); return true;
    }).map(d => ({ ...d, owner: d.owner ? { ...d.owner, workers: undefined } : null })) })) })) };
  }, [org, model]);
  const constellationWorkers = model.workers.filter(w => w.agent.row !== 'settled' && w.parent.startsWith('owner:')).map(w => ({ ...w.agent, owner: w.returnName, lead: w.returnName ?? w.agent.lead }));
  return <main className={`hub-org${tourOpen ? ' is-tour-active' : ''}`} data-tour-current={tourNode ?? undefined} aria-label="Agent organization chart">
    <section className={`hub-org__root${tourNode === 'root' ? ' is-tour-current' : ''}`} data-tour-node="root" aria-label="Agent Zero overview"><span className="hub-org__avatar hub-org__avatar--zero hub-org__avatar--face"><AgentFace name="Agent Zero" project={zero.project} status={!zero.spunUp ? 'offline' : zero.state === 'working' ? 'working' : 'waiting'} size={44} /></span><span className="hub-org__root-copy"><b>Agent Zero</b><span>{model.owners.length} owners · {model.infrastructure.length} infrastructure · {model.current} current workers · {model.history} settled</span></span><span className={`hub-org__status is-${zero.state}`}>{zero.state === 'working' ? 'Working' : zero.state === 'done' ? 'Turn finished' : zero.state === 'idle' ? 'Idle' : 'Not running'}</span><span className="hub-org__views" role="tablist" aria-label="Org view">{(['tree', 'constellation'] as const).map(v => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'is-on' : ''} data-testid={`org-view-${v}`} onClick={() => setView(v)}>{v === 'tree' ? 'Tree' : 'Constellation'}</button>)}</span>{view === 'tree' && <button className="hub-org__tour-button" type="button" onClick={() => { setTourNode('root'); setTourOpen(true); }}><MessageCircleMore size={14} />Walk me through</button>}</section>
    {!roster && <p role="status" className="hub-org__note">Folder roster is not supplied. Planned seats and infrastructure placement may be incomplete.</p>}
    {view === 'constellation' ? <><Suspense fallback={<p role="status">Loading constellation…</p>}><Constellation org={constellationOrg} agents={constellationWorkers} onOpen={onOpen} /></Suspense><p className="hub-org__note">Constellation shows owners with Hub placement. Tree contains the full supplied roster, nested workers and settled history.</p></> : <>
      <div className="hub-org__trunk" aria-hidden />
      <section className="hub-org__groups" aria-label="Persistent owners">{model.groups.map(group => { const seats = model.owners.filter(s => s.places[0]?.group === group.id); const vacancies = model.vacancies.filter(p => p.group === group.id); if (!seats.length && !vacancies.length) return null; const projects = [...new Set([...seats.map(s => s.places[0].project), ...vacancies.map(p => p.project)])]; return <div className="hub-org__group" key={group.id}><h2 className="hub-org__group-heading"><UsersRound size={15} />{group.name}</h2><div className="hub-org__projects">{projects.map(project => <section key={project} className="hub-org__project"><h3 className="hub-org__project-heading"><b>{project}</b></h3><div className="hub-org__domains">{seats.filter(s => s.places[0].project === project).map(card)}{vacancies.filter(p => p.project === project).map(p => <div key={p.domain} className="hub-org__unowned"><CircleDashed size={22} /><span><b>{p.domain}</b><small>No owner recorded</small></span></div>)}</div></section>)}</div></div>; })}</section>
      {unplaced.length > 0 && <section className="hub-org__unplaced" aria-label="Owners without folder details"><h2>Owners without folder details <span>{unplaced.length}</span></h2><p>The roster names these owners, but their folder or purpose is not recorded in the supplied view.</p><div>{unplaced.map(card)}</div></section>}
      {(model.children.get(model.zeroKey)?.length ?? 0) > 0 && <section className="hub-org__extra" aria-label="Agent Zero workers"><h2>Agent Zero's workers</h2><WorkerTree parent={model.zeroKey} model={model} onOpen={onOpen} onOpenAgent={onOpenAgent} /></section>}
      {(model.children.get('unassigned')?.length ?? 0) > 0 && <section className="hub-org__extra" aria-label="Workers with unresolved ownership"><h2>Workers with unresolved ownership</h2><p>These rows are retained without guessing a parent.</p><WorkerTree parent="unassigned" model={model} onOpen={onOpen} onOpenAgent={onOpenAgent} /></section>}
    </>}
    <section className="hub-org__infrastructure" aria-label="Agent infrastructure"><h2><Layers3 size={17} />Agent infrastructure <span>{model.infrastructure.length}</span></h2><p>Recorded infrastructure seats, separate from project owners.</p><div>{model.infrastructure.map(card)}</div>{!model.infrastructure.length && <p>No infrastructure identities were supplied.</p>}</section>
    <p className="hub-org__note"><Sparkles size={13} />Each recorded identity is shown once. Worker status describes the session; delivery still needs its task evidence.</p>
    {tourOpen && <OrgTour onStep={setTourNode} onClose={() => setTourOpen(false)} onAsk={onAsk} />}
  </main>;
}
