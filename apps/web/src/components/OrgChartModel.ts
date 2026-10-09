import type { Agent, Org, OrgOwner } from '../lib/agents';
import type { HubAgent, HubOrg } from '../lib/hub-types';

export const orgName = (name: string) => {
  const key = name.trim().toUpperCase();
  // Exact approved display alias: base-card/SPEC.md sections 6 and 8. Other punctuation is significant.
  return key === 'STACK-OPT' ? 'EFFICIENCY' : key === 'AGENT ZERO' ? 'A0' : key === 'AGENT BASE' ? 'AGENT-BASE' : key;
};
export type Placement = { group: string; groupName: string; project: string; domain: string };
// services/node/src/org.ts:migrate and agent-nav.ts approve this exact legacy project label.
// SISO Labs remains distinct: ALEX-SETUP has no recorded replacement placement.
export const orgProjectName = (name: string) => name === 'SISO Internal Labs' ? 'Agent Base' : name;
export type OrgSeat = { key: string; name: string; hub?: HubAgent; roster?: OrgOwner; runtime?: Agent; runtimes: Agent[]; recordedNames: string[]; rosterRecords: OrgOwner[]; recordedPlaces: Placement[]; places: Placement[]; infrastructure: boolean };
export type OrgWorker = { key: string; agent: Agent; parent: string; returnName: string | null; reason?: string };
export type OrgPresentation = { owners: OrgSeat[]; infrastructure: OrgSeat[]; workers: OrgWorker[]; children: Map<string, OrgWorker[]>; current: number; history: number; groups: { id: string; name: string }[]; zeroKey: string; vacancies: Placement[] };

/** A read-only projection of recorded identities and relationships; never rewrites registry placement. */
export function buildOrgPresentation(org: HubOrg, agents: Agent[], roster?: Org): OrgPresentation {
  const seats = new Map<string, OrgSeat>();
  const zeroKey = `owner:${orgName(org.zero.name)}`;
  const runtimeById = new Map<string, Agent>();
  for (const a of agents) { const previous = runtimeById.get(a.id); if (!previous || previous.row === 'settled' && a.row !== 'settled') runtimeById.set(a.id, a); }
  const runtime = [...runtimeById.values()];
  const infrastructureNames = new Set((roster?.bottom ?? []).map(a => orgName(a.name)));
  for (const a of runtime) if (a.infrastructureRole || a.project === 'Agent Infrastructure' && a.kind === 'owner') infrastructureNames.add(orgName(a.name));
  const add = (name: string, context?: Placement) => {
    const key = `owner:${orgName(name)}`;
    if (key === zeroKey) return null;
    let seat = seats.get(key);
    if (!seat) { seat = { key, name, runtimes: [], recordedNames: [], rosterRecords: [], recordedPlaces: [], places: [], infrastructure: infrastructureNames.has(orgName(name)) }; seats.set(key, seat); }
    if (!seat.recordedNames.includes(name)) seat.recordedNames.push(name);
    if (context) {
      if (!seat.recordedPlaces.some(p => p.group === context.group && p.project === context.project && p.domain === context.domain)) seat.recordedPlaces.push(context);
      const normalized = { ...context, project: orgProjectName(context.project) };
      if (!seat.places.some(p => p.group === normalized.group && p.project === normalized.project && p.domain === normalized.domain)) seat.places.push(normalized);
    }
    return seat;
  };
  // The supported org roster includes planned/offline seats that may be absent from live agent rows.
  for (const group of roster?.groups ?? []) for (const project of group.projects) for (const owner of project.owners) {
    const seat = add(owner.name, { group: group.id, groupName: group.name, project: project.name, domain: owner.domain ?? '' });
    if (seat) { seat.roster = owner; seat.rosterRecords.push(owner); }
  }
  for (const group of org.groups) for (const project of group.projects) for (const domain of project.domains) if (domain.owner) {
    const seat = add(domain.owner.name, { group: group.id, groupName: group.name, project: project.name, domain: domain.name });
    if (!seat) continue;
    seat.hub = domain.owner;
    // Explicit folder roster comes first; all raw Hub placements remain in recordedPlaces.
  }
  for (const name of org.top) add(name);
  for (const owner of roster?.bottom ?? []) { const seat = add(owner.name); if (seat) { seat.roster = owner; seat.rosterRecords.push(owner); } }
  for (const a of runtime) if (a.kind === 'owner' || a.navOwner || a.a0 || infrastructureNames.has(orgName(a.name))) add(a.name);
  for (const seat of seats.values()) {
    seat.runtimes = runtime.filter(a => orgName(a.name) === orgName(seat.name)).sort((a, b) => Number(a.row === 'settled') - Number(b.row === 'settled') || Number(!!b.main) - Number(!!a.main) || (b.lastEvent ?? b.since ?? 0) - (a.lastEvent ?? a.since ?? 0));
    seat.runtime = seat.runtimes[0];
    for (const a of seat.runtimes) if (!seat.recordedNames.includes(a.name)) seat.recordedNames.push(a.name);
  }

  const ownerRuntime = new Map<string, string>();
  for (const a of runtime) {
    const key = a.zero ? zeroKey : `owner:${orgName(a.name)}`;
    if (key === zeroKey || seats.has(key)) ownerRuntime.set(a.id, key);
  }
  const rows = runtime.filter(a => !ownerRuntime.has(a.id));
  const byId = new Map(rows.map(a => [a.id, a]));
  const names = new Map<string, Agent[]>();
  for (const a of runtime) names.set(orgName(a.name), [...(names.get(orgName(a.name)) ?? []), a]);
  const workers: OrgWorker[] = rows.map(a => {
    const recordedName = a.owner || a.lead || null;
    const declaredOwner = recordedName ? `owner:${orgName(recordedName)}` : null;
    const candidate = (a as Agent & { ownershipResolved?: boolean }).ownershipResolved === false ? null : a.navParentId || a.parentId;
    let parent = candidate && ownerRuntime.get(candidate) || (candidate && byId.has(candidate) ? `worker:${candidate}` : null);
    if (!parent && declaredOwner && (seats.has(declaredOwner) || declaredOwner === zeroKey)) parent = declaredOwner;
    if (!parent && recordedName) {
      const matches = names.get(orgName(recordedName)) ?? [];
      if (matches.length === 1 && byId.has(matches[0].id)) parent = `worker:${matches[0].id}`;
    }
    const parentRuntime = candidate ? runtime.find(r => r.id === candidate) : null;
    return { key: `worker:${a.id}`, agent: a, parent: parent || 'unassigned', returnName: parentRuntime?.name ?? recordedName, ...(!parent ? { reason: recordedName ? 'Recorded parent is not present in this view' : 'Return owner not recorded' } : {}) };
  });
  const indexed = new Map(workers.map(w => [w.key, w]));
  for (const worker of workers) {
    const seen = new Set([worker.key]); let parent = worker.parent;
    while (indexed.has(parent)) {
      if (seen.has(parent)) { worker.parent = 'unassigned'; worker.reason = 'Parent relationship is cyclic'; break; }
      seen.add(parent); parent = indexed.get(parent)!.parent;
    }
  }
  const children = new Map<string, OrgWorker[]>();
  for (const worker of workers) children.set(worker.parent, [...(children.get(worker.parent) ?? []), worker]);
  const all = [...seats.values()];
  const vacancies = org.groups.flatMap(g => g.projects.flatMap(p => p.domains.filter(d => !d.owner && !all.some(s => s.places.some(c => c.project.toLowerCase() === orgProjectName(p.name).toLowerCase() && c.domain === d.name))).map(d => ({ group: g.id, groupName: g.name, project: orgProjectName(p.name), domain: d.name }))));
  const groups = [...new Map([...org.groups.map(g => [g.id, { id: g.id, name: g.name }] as const), ...all.flatMap(s => s.places.slice(0, 1).map(p => [p.group, { id: p.group, name: p.groupName }] as const))]).values()];
  return { owners: all.filter(s => !s.infrastructure), infrastructure: all.filter(s => s.infrastructure), workers, children, current: workers.filter(w => w.agent.row !== 'settled').length, history: workers.filter(w => w.agent.row === 'settled').length, groups, zeroKey, vacancies };
}

export function orgSeatStatus(seat: OrgSeat) {
  if (seat.runtime) return seat.runtime.row === 'settled' ? 'Session settled' : seat.runtime.status === 'done' ? 'Turn finished' : seat.runtime.status === 'needs' ? 'Needs attention' : seat.runtime.status;
  if (seat.roster) return seat.roster.state === 'planned' ? 'Planned seat' : seat.roster.state === 'offline' ? 'Not running' : 'Live';
  if (seat.hub) return !seat.hub.spunUp || seat.hub.state === 'off' ? 'Not running' : seat.hub.state === 'done' ? 'Turn finished' : seat.hub.state;
  return 'State not recorded';
}
