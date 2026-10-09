import { EllipsisIcon } from 'lucide-react';
import { HaloRim, MenuButton, type MenuItem } from '@siso/shell';
import { formatAge } from '@siso/side-nav';
import type { Agent, OrgProject } from '../lib/agents';
import { AgentFace, faceFor, projectHue } from '../lib/face';
import { hoverAgent, useHubAgents } from '../lib/hub';
import { crewTitle, projectPreviewCount } from '../lib/project-crew';
import { useProjectCrew } from '../lib/use-project-crew';
import { AgentHoverCard } from './AgentHoverCard';
import { CardCrew } from './CardCrew';
import './PinnedProjectCard.css';

export function PinnedProjectCard({ project: p, agents, activeId, menu, onOpen, onDashboard, onStart, starting }: {
  project: OrgProject; agents: Agent[]; activeId?: string | null; menu: MenuItem[]; onOpen: (a: Agent) => void; onDashboard: () => void; onStart?: (name: string) => void; starting?: boolean;
}) {
  const { owner, members, tasks, tasksReady, error } = useProjectCrew(p, agents), hub = useHubAgents();
  const offline = p.owners.find(o => o.main) ?? p.owners[0];
  const working = members.filter(a => a.status === 'working').length;
  const toRate = projectPreviewCount(p, tasks);
  const state = owner?.status ?? 'offline';
  const age = owner ? formatAge(owner.status === 'idle' ? owner.lastEvent ?? owner.since : owner.since, Date.now()) : '';
  const stateLine = owner ? `${owner.status === 'working' ? 'Working ·' : owner.status === 'idle' ? 'quiet' : owner.status} ${age}` : 'not open';
  // Only crew working now get a face inside the card; the rest is one quiet "+N" (5 Oct).
  const crewFaces = members.filter(a => a.status === 'working').slice(0, 5).map(a => <AgentHoverCard key={a.id} agent={{ ...hoverAgent(a, hub), model: a.workerSummary?.model ?? hoverAgent(a, hub).model }} details={<section className="ab-hover-section"><div className="ab-hover-label">Current work</div><p className="ab-codex-hoverline">{crewTitle(a)}</p>{a.workerSummary && <p className="ab-codex-hoverline">{a.workerSummary.message}</p>}</section>} row>
    <button type="button" data-testid="project-crew-face" className={`ab-card-crew__face${a.id === activeId ? ' is-active' : ''}`} aria-label={`Open ${a.name}`} onClick={e => (e.stopPropagation(), onOpen(a))}><span className="ab-ring is-working"><AgentFace {...faceFor(a)} size={16} /></span></button>
  </AgentHoverCard>);
  const open = () => owner ? onOpen(owner) : offline && onStart?.(offline.name);
  // The rim stays still (5 Oct: "everything else above that is a bit like washed"): two always-glowing project cards
  // washed out the top of the nav. Working shows on the owner's face ring and the crew faces instead.
  const card = <HaloRim className="ab-zero__rim ab-project-card__rim" hue={`hsl(${projectHue(p.name)} 85% 62%)`} state="idle">
    <div className={`ab-zero__row ab-project-card__row${owner?.id === activeId ? ' is-active' : ''}${owner ? '' : ' is-offline'}`} role="button" tabIndex={owner || onStart && offline ? 0 : -1} aria-label={`${p.name}, ${stateLine}`} aria-current={owner?.id === activeId ? 'page' : undefined} aria-disabled={!owner && (!onStart || starting || !offline) || undefined} onClick={e => { if (!(e.target as HTMLElement).closest('button') && !starting) open(); }} onKeyDown={e => { if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) { e.preventDefault(); if (!starting) open(); } }}>
      <span className={`ab-ring is-${state}`}><AgentFace {...(owner ? faceFor(owner) : { name: offline?.name ?? p.name, project: p.name, status: 'offline' as const })} size={32} /></span>
      <span className="ab-pin__text"><b className="ab-zero__name">{p.name}</b><span className="ab-project-card__line ab-zero__line" title={`${stateLine}${working ? ` · ${working} working` : ''}`}>
        <CardCrew faces={crewFaces} quiet={members.length - crewFaces.length} quietTitle={`${members.length - crewFaces.length} crew not working now: open the dashboard`} onQuiet={onDashboard} empty={stateLine} />
      </span></span>
      {tasksReady && toRate > 0 && <span className="ab-project-card__rate" data-testid="project-to-rate">{toRate} to rate</span>}
      <MenuButton label={`More for ${p.name}`} menuClassName="siso-rail-menu" items={() => menu}><EllipsisIcon size={14} /></MenuButton>
    </div>
  </HaloRim>;
  return <div className="ab-project-card" data-testid="pinned-project-card" data-project-card={p.id}>
    {owner ? <AgentHoverCard agent={hoverAgent(owner, hub)} row>{card}</AgentHoverCard> : card}
    {error && <p className="ab-project-card__unavailable" role="status">Crew refresh unavailable</p>}
  </div>;
}
