import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceChoices } from '../src/components/WorkspaceChoices';
import { OrgChart } from '../src/components/OrgChart';
import type { WorkspaceChoice, Agent, Org } from '../src/lib/agents';
import type { HubOrg, HubAgent } from '../src/lib/hub-types';
import '../../../packages/siso-tokens/siso.css';
import './launch-org.css';
const params = new URLSearchParams(location.search);
let repoFailure = params.get('repos') === 'error';
window.fetch = (async (input: RequestInfo | URL) => {
  if (String(input) !== '/api/workspaces/repos') throw new Error('Fixture blocks other API calls');
  await new Promise(r => setTimeout(r, params.get('repos') === 'slow' ? 1800 : 40));
  if (repoFailure) return new Response('{}', { status: 503 });
  return new Response(JSON.stringify({ repos: params.get('repos') === 'empty' ? [] : [{ id: 'one', name: 'Example application', path: '/fixture/example-application' }, { id: 'two', name: 'Research with a deliberately long repository name', path: '/fixture/projects/research-with-a-deliberately-long-repository-name' }] }), { headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
const hub = (name: string, extra = {}): HubAgent => ({ name, kind: 'owner', project: 'Example', domain: 'Build', icon: 'layers', accent: '#ffb000', harness: 'codex', model: 'fixture', machine: 'fixture', state: 'idle', spunUp: true, ...extra });
const zero = hub('A0', { kind: 'zero' }), owner = hub('OWNER', { role: 'Keep the project ready', holding: { id: 'task', title: 'Verify the current release', status: 'building' } }), infra = hub('EFFICIENCY', { role: 'Maintain the agent runtime' });
const org: HubOrg = { zero, top: ['OWNER', 'EFFICIENCY', 'MISSING'], groups: [{ id: 'labs', name: 'Labs', icon: 'layers', projects: [{ name: 'Example', icon: 'layers', accent: '#ffb000', domains: [{ name: 'Build', owner }, { name: 'Alias', owner }, { name: 'Infrastructure', owner: infra }, { name: 'Documentation', owner: null }] }] }] };
const roster = { groups: [{ id: 'labs', name: 'Labs', projects: [{ id: 'example', name: 'Example', owners: [{ name: 'OWNER', domain: 'Build', state: 'live', working: 1, plan: null }, { name: 'PLANNED', domain: 'Research', state: 'planned', working: 0, plan: null }] }] }], bottom: [{ name: 'EFFICIENCY', state: 'live', working: 0, plan: null }] } as Org;
const row = (id: string, name: string, extra = {}) => ({ id, key: id, name, title: '', row: 'live', status: 'idle', project: 'Example', owner: 'OWNER', lead: null, role: null, ...extra }) as Agent;
const agents = [row('owner', 'OWNER', { kind: 'owner', owner: 'A0', role: 'Keep the project ready' }), row('a', 'ACTIVE', { parentId: 'owner', status: 'working', title: 'Check the layout at three widths', role: 'Verify the release' }), row('b', 'TURN-DONE', { parentId: 'owner', status: 'done' }), row('c', 'SETTLED', { parentId: 'owner', row: 'settled' }), row('d', 'NESTED', { parentId: 'a', owner: 'ACTIVE', title: 'Review keyboard navigation' }), row('e', 'UNRESOLVED', { owner: null, parentId: 'owner', ownershipResolved: false }), row('service', 'EFFICIENCY', { kind: 'owner', infrastructureRole: 'EFFICIENCY', owner: 'A0' }), row('a', 'ACTIVE', { parentId: 'owner', status: 'working' })];
if (params.get('aliases') === '1') {
  org.top.push('AGENT-BASE', 'AGENT BASE');
  org.groups[0].projects.push({ name: 'SISO Internal Labs', icon: 'layers', accent: '#ffb000', domains: [{ name: 'Integration', owner: hub('AGENT BASE') }] });
  org.groups[0].projects.push({ name: 'Agent Base', icon: 'layers', accent: '#ffb000', domains: [{ name: 'Integration', owner: hub('AGENT-BASE') }] });
  roster.groups[0].projects[0].owners.push({ name: 'AGENT-BASE', domain: 'Integration', state: 'offline', working: 0, plan: null }, { name: 'AGENT BASE', domain: 'Integration', state: 'live', working: 1, plan: null });
  agents.push(row('base-old', 'AGENT-BASE', { kind: 'owner', row: 'settled', owner: 'A0' }), row('base-main', 'AGENT BASE', { kind: 'owner', main: true, status: 'working', owner: 'AGENT-BASE' }), row('base-other', 'AGENT-BASE', { kind: 'owner', owner: 'A0' }));
}
function Preview() {
  const [choice, setChoice] = useState<WorkspaceChoice>({ repo: '', workspace: { type: 'isolated' } });
  const [busy, setBusy] = useState(false), [disabled, setDisabled] = useState(false), [calls, setCalls] = useState(0), [opened, setOpened] = useState('No agent opened');
  const inFlight = useRef(false);
  return <><header className="launch-org-review"><b>Synthetic launch and organization review</b><output data-testid="opened">{opened}</output><button type="button" onClick={() => setDisabled(v => !v)} data-testid="disable">Toggle disabled</button><button type="button" onClick={() => { repoFailure = false; }} data-testid="restore-repos">Restore repository fixture</button></header><div className="launch-org-preview"><section className="launch-org-form"><h1>New Codex chat</h1><form onSubmit={e => { e.preventDefault(); if (inFlight.current || !choice.repo || choice.workspace.type === 'shared' && !choice.workspace.reason.trim()) return; inFlight.current = true; setBusy(true); setCalls(n => n + 1); setTimeout(() => { setBusy(false); inFlight.current = false; }, 600); }}><WorkspaceChoices value={choice} onChange={setChoice} disabled={disabled || busy} /><button type="submit" disabled={disabled || busy || !choice.repo || choice.workspace.type === 'shared' && !choice.workspace.reason.trim()} data-testid="launch">{busy ? 'Starting…' : 'Start fixture chat'}</button></form><output data-testid="launch-count">{calls}</output><output data-testid="choice">{JSON.stringify(choice)}</output></section><section className="launch-org-chart"><OrgChart org={org} roster={roster} agents={agents} onOpen={name => setOpened(name)} onOpenAgent={id => setOpened(`ID: ${id}`)} /></section></div></>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
