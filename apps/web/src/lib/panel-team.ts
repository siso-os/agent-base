import type { Agent, Org } from "./agents";

export type PanelTeamNode = {
  id: string; name: string; group: string; agent: Agent | null;
  state: string; owner: boolean; children: PanelTeamNode[];
};
const nameKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** One identity per row. Only recorded parent links or an unambiguous lead create a reporting line. */
export function panelTeam(parent: Agent, agents: Agent[], org: Org | null): PanelTeamNode[] {
  const live = [...new Map([...agents.filter(a => a.row === "live"), parent].map(a => [a.id, a])).values()];
  const byId = new Map(live.map(a => [a.id, a]));
  const byName = new Map<string, Agent[]>();
  live.forEach(a => byName.set(nameKey(a.name), [...(byName.get(nameKey(a.name)) ?? []), a]));
  const nodes = new Map<string, PanelTeamNode>();
  const registered = new Set<string>();
  const register = (name: string, state: string, group: string) => {
    const key = nameKey(name);
    if (registered.has(key)) return;
    registered.add(key);
    const matches = byName.get(key) ?? [];
    const agent = matches.length === 1 ? matches[0] : null;
    if (agent?.zero) return;
    const id = agent?.id ?? `seat:${key}`;
    nodes.set(id, { id, name, group, agent, state: agent?.status ?? (matches.length > 1 ? "unresolved" : state === "planned" ? "planned" : "offline"), owner: true, children: [] });
  };
  for (const g of org?.groups ?? []) for (const p of g.projects) for (const o of p.owners) register(o.name, o.state, p.name);
  for (const o of org?.bottom ?? []) register(o.name, o.state, "Operations");
  for (const a of live) {
    if (a.zero && parent.zero) continue;
    if (!nodes.has(a.id)) nodes.set(a.id, { id: a.id, name: a.name, group: a.project || "Unassigned", agent: a, state: a.status, owner: !!a.navOwner || a.kind === "owner" || (!a.parentId && !a.navParentId && !a.lead && a.kind !== "worker"), children: [] });
  }
  const links = new Map<string, string>();
  for (const node of nodes.values()) {
    const a = node.agent;
    if (!a || a.id === parent.id && !parent.zero) continue;
    const explicit = a.parentId || a.navParentId;
    const leads = a.lead ? byName.get(nameKey(a.lead)) ?? [] : [];
    const leadSeat = a.lead ? [...nodes.values()].filter(n => n.owner && nameKey(n.name) === nameKey(a.lead!)) : [];
    const target = explicit ? (byId.has(explicit) ? explicit : null) : leads.length === 1 ? leads[0].id : leads.length === 0 && leadSeat.length === 1 ? leadSeat[0].id : null;
    if (target && target !== a.id && nodes.has(target)) links.set(a.id, target);
    else if ((explicit || a.lead) && target !== parent.id) node.group = "Unassigned";
  }
  // Broken cycles become visible roots, never recursion or silently missing rows.
  for (const id of links.keys()) {
    const seen = new Set([id]); let cursor = links.get(id);
    while (cursor) { if (seen.has(cursor)) { links.delete(id); const node = nodes.get(id); if (node) node.group = "Unassigned"; break; } seen.add(cursor); cursor = links.get(cursor); }
  }
  const roots: PanelTeamNode[] = [];
  for (const node of nodes.values()) {
    const owner = nodes.get(links.get(node.id) ?? "");
    if (owner) owner.children.push(node); else roots.push(node);
  }
  const rank = (n: PanelTeamNode) => n.state === "needs" || n.state === "failed" ? 0 : n.state === "working" ? 1 : n.agent ? 2 : 3;
  const sort = (list: PanelTeamNode[]) => { list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)); list.forEach(n => sort(n.children)); };
  sort(roots);
  return parent.zero ? roots : nodes.has(parent.id) ? [nodes.get(parent.id)!] : [];
}

export function flattenPanelTeam(nodes: PanelTeamNode[]): PanelTeamNode[] {
  return nodes.flatMap(n => [n, ...flattenPanelTeam(n.children)]);
}
