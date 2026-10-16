import type { Agent, Org } from './agents';
import type { HubOrg } from './hub-types';
import { buildOrgPresentation, orgName } from '../components/OrgChartModel';

/** The org chart owns seat identity and aliases; only recorded direct relationships belong in this menu. */
export function directZeroReports(org: HubOrg, agents: Agent[], roster?: Org) {
  const model = buildOrgPresentation(org, agents, roster);
  const zero = orgName(org.zero.name);
  const owners = [...model.owners, ...model.infrastructure].filter(seat => {
    const runtimeParent = agents.find(a => a.id === seat.runtime?.navParentId);
    const parent = runtimeParent?.name || seat.runtime?.owner || seat.runtime?.lead || seat.hub?.owner;
    // The registry contract makes owners without an explicit owner Agent Zero's reports.
    return !parent || orgName(parent) === zero;
  }).map(seat => ({ key: seat.key, name: seat.name, agent: seat.runtime }));
  const workers = (model.children.get(model.zeroKey) ?? []).map(worker => ({ key: worker.key, name: worker.agent.name, agent: worker.agent }));
  return [...owners, ...workers];
}
