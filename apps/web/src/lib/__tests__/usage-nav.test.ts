// @ts-nocheck
import { describe, it, expect, vi } from "vitest";
import { ClaudeUsagePoller, credentialService, USAGE_INTERVAL, claudeUsage, usageAccounts } from '../../../../../services/node/src/claude-usage';
import { bindServiceRows, type ServiceHost } from '../../../../../services/node/src/service-hosts';
import { usageAge } from '../usage-age';
describe('live Claude usage', () => {
  it.each([401, 429])('retains last good values on HTTP %s and recovers on demand', async (status) => {
    let now = 1000, failure = false, reads = 0;
    const poll = new ClaudeUsagePoller(async () => { reads++; if (failure) throw Error(`HTTP ${status}`); return { fiveHour: { pct: 92, resetsAt: null }, week: { pct: 45, resetsAt: null } }; }, () => now);
    expect(poll.get('/profile')).toBeNull();
    await Promise.all([poll.refresh('/profile'), poll.refresh('/profile')]);
    expect(reads).toBe(1); expect(poll.get('/profile')?.stale).toBe(false);
    failure = true; now += 60_000; await poll.refresh('/profile');
    expect(poll.get('/profile')).toMatchObject({ fiveHour: { pct: 92 }, at: 1000, stale: true, ageMs: 60_000 });
    failure = false; await poll.refresh('/profile'); expect(poll.get('/profile')?.stale).toBe(false);
    now += USAGE_INTERVAL + 1; expect(poll.get('/profile')?.stale).toBe(true);
    expect(usageAge({ limitsAt: 1000, limitsStale: true }, now)).toContain('as of');
  });
  it('polls immediately and every five minutes, and stops its timer', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => ({ fiveHour: { pct: 9, resetsAt: null }, week: { pct: 92, resetsAt: null } }));
      const poll = new ClaudeUsagePoller(read); const stop = poll.start(() => ['/profile', '/profile']);
      await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(USAGE_INTERVAL); expect(read).toHaveBeenCalledTimes(2);
      stop(); await vi.advanceTimersByTimeAsync(USAGE_INTERVAL); expect(read).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('overlays warm Tokens snapshots per profile and labels HUD fallbacks stale', () => {
    const spy = vi.spyOn(claudeUsage, 'get').mockImplementation(dir => dir === '/home/.config/claude-siso-3' ? { fiveHour: { pct: 9, resetsAt: null }, week: { pct: 92, resetsAt: null }, at: Date.now(), stale: false, ageMs: 0 } : null);
    try {
      const out = usageAccounts({ accounts: [{ id: 'claude:claude-siso-3', kind: 'claude', limits: null }, { id: 'claude:.claude', kind: 'claude', limits: { at: 1000 } }] }, '/home');
      expect(out.accounts[0].limits).toMatchObject({ weekly: { usedPct: 92, expired: false }, fiveHour: { usedPct: 9 }, source: 'live Claude OAuth usage', stale: false });
      expect(out.accounts[1].limits.stale).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it('maps config directories exactly and separates profiles', () => {
    expect(credentialService('/home/test/.claude', '/home/test')).toBe('Claude Code-credentials');
    expect(credentialService('/config/a')).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
    expect(credentialService('/config/a')).not.toBe(credentialService('/config/b'));
  });
});
const host = (name: string, lead?: string): ServiceHost => ({ name, lead, state: 'live', session: null, context: null, activity: 'idle', model: null, tokensIn: null, tokensOut: null, tokensPerSecond: null, updatedAt: null, port: 1, pid: 1, token: 'private-fixture', pane: null, cwd: '', file: '', startedAt: null });
describe('hosted registry navigation', () => {
  it('projects pane-less owners/workers and preserves infra/lead precedence', () => {
    const registry = { SCOUT: { project: 'Agent Base', domain: 'Research', owner: 'BASE', kind: 'worker', icon: 'search' }, 'OPERATOR-DESIGN': { project: 'HALO', domain: 'Design', kind: 'owner' }, HEALTH: { project: 'Wrong' }, CHILD: { project: 'Wrong' } };
    const rows = bindServiceRows([], [host('SCOUT'), host('OPERATOR-DESIGN'), host('HEALTH'), host('CHILD', 'Agent Zero')], { registry });
    expect(rows[0]).toMatchObject(registry.SCOUT); expect(rows[1]).toMatchObject(registry['OPERATOR-DESIGN']);
    expect(rows[2].project).toBe('Agent Infrastructure'); expect(rows[3].zeroAgent).toBe(true); expect(rows[3].project).toBe('Wrong'); expect(rows[3].hostParent).toBe('Agent Zero');
    expect(JSON.stringify(rows)).not.toContain('private-fixture');
  });
  it('applies registry to an existing joined host row case insensitively', () => {
    const rows = bindServiceRows([{ id: 'scout', name: 'scout', session: 'scout-session', cwd: '', pane: '' }], [{ ...host('SCOUT'), session: 'scout-session' }], { registry: { scout: { project: 'Agent Base', kind: 'owner' } } });
    expect(rows).toHaveLength(1); expect(rows[0].project).toBe('Agent Base');
  });
});

import { agentNavigation } from '../../../../../services/node/src/agent-nav';
const navFixture = () => [
  { id: 'zero', name: 'Agent Zero', zero: true },
  { id: 'base', name: 'AGENT BASE UI', session: 'fd10d9db', pane: 'base-pane', project: 'Agent Base' },
  { id: 'design', name: 'OPERATOR-DESIGN', pane: 'design-pane', project: 'HALO' },
];
describe('main agents and parent rules', () => {
  it('keeps only flagged main agents at the top; explicit false overrides seeded names', () => {
    const out = agentNavigation(navFixture(), [], { 'OPERATOR-DESIGN': { main: false } }, []);
    expect(out.filter(a => a.main).map(a => a.id)).toEqual(['zero', 'base']);
    expect(out.find(a => a.id === 'design')?.parentId).toBe('zero');
  });
  it('uses host lead/parent ahead of run metadata and registry owner', () => {
    const out = agentNavigation([...navFixture(), { id: 'child', name: 'CHILD', hostParent: 'OPERATOR-DESIGN' }], [], { CHILD: { owner: 'AGENT BASE UI' } }, [{ worker: 'CHILD', parent_session: 'fd10d9db' }]);
    expect(out.find(a => a.id === 'child')?.parentId).toBe('design');
  });
  it('matches codex-run parent_session', () => {
    const out = agentNavigation([...navFixture(), { id: 'pack', name: 'PACK-NAV' }], [], {}, [{ worker: 'PACK-NAV', parent_session: 'fd10d9db' }]);
    expect(out.find(a => a.id === 'pack')?.parentId).toBe('base');
  });
  it('matches codex-run parent_pane when session is absent', () => {
    const out = agentNavigation([...navFixture(), { id: 'pack', name: 'PACK-TOP' }], [], {}, [{ worker: 'PACK-TOP', parent_session: 'missing', parent_pane: 'design-pane' }]);
    expect(out.find(a => a.id === 'pack')?.parentId).toBe('design');
  });
  it('uses registry owner and allows another sub-agent as parent', () => {
    const out = agentNavigation([...navFixture(), { id: 'scout', name: 'SCOUT' }, { id: 'miner', name: 'MINER' }], [], { SCOUT: { owner: 'AGENT BASE UI', project: 'Agent Base' }, MINER: { owner: 'SCOUT', project: 'Agent Base' } }, []);
    expect(out.find(a => a.id === 'scout')?.parentId).toBe('base');
    expect(out.find(a => a.id === 'miner')?.parentId).toBe('scout');
    expect(out.filter(a => a.project === 'Agent Base').map(a => a.name)).toContain('MINER');
  });
  it('falls back to Agent Zero for missing owners and breaks cycles', () => {
    const out = agentNavigation([...navFixture(), { id: 'unknown', name: 'UNKNOWN' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [], { A: { owner: 'B' }, B: { owner: 'A' } }, []);
    expect(out.find(a => a.id === 'unknown')?.parentId).toBe('zero');
    expect(out.find(a => a.id === 'a')?.parentId).toBe('zero');
  });
  it.each(['name', 'pane'])('deduplicates job terminal and worker by %s, retaining terminal route', mode => {
    const out = agentNavigation([...navFixture(), { id: 'terminal', name: mode === 'name' ? 'PACK-NAV' : 'OTHER', pane: 'job-pane' }], [{ id: 'worker', name: 'PACK-NAV', codexWorker: true }], {}, [{ worker: 'PACK-NAV', pane: 'job-pane', parent_session: 'fd10d9db' }]);
    expect(out).toHaveLength(4); expect(out.find(a => a.id === 'worker')).toBeUndefined();
    expect(out.find(a => a.id === 'terminal')?.parentId).toBe('base');
  });
});


import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../../../packages/halo-face', () => ({ AgentFace: () => null, projectHue: () => 0 }));
vi.mock('../chatLive', () => ({ useLive: () => null }));
import { Sidebar } from '../../components/Sidebar';
describe('retired standing-owner rows', () => {
  it('keeps non-running owners in the org data but never renders Start rows in HALO, Clients or Labs', async () => {
    const registry = {
      projects: [
        { id: 'halo', name: 'HALO', group: 'agency', shown: true, order: 0 },
        { id: 'client', name: 'Client', group: 'agency', shown: true, order: 1 },
        { id: 'labs', name: 'LABS', group: 'labs', shown: true, order: 0 },
      ],
      agents: {
        'STREAMING-CLAUDE': { kind: 'owner', project: 'HALO' },
        'OPS-BUILD': { kind: 'owner', project: 'HALO', state: 'planned' },
        'HALO-UI': { kind: 'owner', project: 'HALO' },
        'CLIENT-OWNER': { kind: 'owner', project: 'Client' },
        'LABS-OWNER': { kind: 'owner', project: 'LABS' },
      },
    };
    const org = { top: [], bottom: [], groups: [
      { id: 'agency', name: 'SISO Agency', icon: 'briefcase-business', order: 0 },
      { id: 'labs', name: 'SISO Labs', icon: 'flask', order: 1 },
    ].map(g => ({ ...g, folders: [], projects: registry.projects.filter(p => p.group === g.id).map(p => ({
      ...p, owners: Object.entries(registry.agents).filter(([, a]) => a.kind === 'owner' && a.project === p.name).map(([name, a]) => ({
        name, domain: name, icon: 'bot', state: a.state === 'planned' ? 'planned' : 'live', working: 0, plan: null,
      })),
    })) })) };
    expect(org.groups.flatMap(g => g.projects.flatMap(p => p.owners)).map(o => o.name)).toEqual(expect.arrayContaining(Object.keys(registry.agents)));
    // Open all stored folds so a hidden placeholder cannot make this assertion pass.
    vi.stubGlobal('localStorage', { getItem: () => 'true' });
    vi.stubGlobal('window', { localStorage: globalThis.localStorage });
    try {
      const html = renderToStaticMarkup(createElement(Sidebar, {
        agents: [], domains: [], error: null, activeId: null, org,
        onStart: async () => null,
        ...Object.fromEntries(['onOpen', 'onAct', 'onEdit', 'onReorder', 'onReorderProjects', 'onWorkers', 'onRename', 'onOrg', 'onPage', 'onEndedPage', 'onDashboard'].map(k => [k, () => {}])),
      }));
      for (const name of Object.keys(registry.agents)) expect(html).not.toContain(name);
      expect(html).not.toContain('data-testid="offline-row"');
      expect(html).not.toContain('data-testid="seat-start"');
      for (const name of ['HALO', 'Client', 'LABS']) expect(html).toContain(name);
    } finally { vi.unstubAllGlobals(); }
  });
});

import { buildOrg, migrate, agencyFolders } from '../../../../../services/node/src/org';
describe('5 Oct nav iteration', () => {
  it('keeps flagged Zeros out of crew and rows, with compact new-chat controls', () => {
    vi.stubGlobal('localStorage', { getItem: () => null }); vi.stubGlobal('window', { localStorage: globalThis.localStorage });
    try {
      const agents = [{ id: 'zero', name: 'Agent Zero', zero: true, main: true, row: 'live', status: 'idle' }, { id: 'sol', name: 'OTHER-ZERO', zero: true, main: true, tool: 'codex', row: 'live', status: 'idle', parentId: 'zero', owner: 'Agent Zero' }];
      const html = renderToStaticMarkup(createElement(Sidebar, { agents, domains: [], error: null, activeId: 'zero', org: null, ...Object.fromEntries(['onOpen', 'onAct', 'onEdit', 'onReorder', 'onReorderProjects', 'onWorkers', 'onRename', 'onOrg', 'onPage', 'onEndedPage', 'onDashboard'].map(k => [k, () => {}])) }));
      expect(html).toContain('aria-label="New chat"'); expect(html).toContain('aria-haspopup="dialog"');
      expect(html).not.toContain('2 chats'); expect(html).not.toContain('OTHER-ZERO'); expect(html).not.toContain('zero-top-session'); expect(html).not.toContain('data-item="sol"');
    } finally { vi.unstubAllGlobals(); }
  });

  it('promotes a registry Zero independently of its name and host parent', () => {
    const out = agentNavigation([...navFixture(), { id: 'sol', name: 'OTHER-ZERO', hostParent: 'Agent Zero' }], [], { 'OTHER-ZERO': { zero: true, main: true } }, []);
    expect(out.find(a => a.id === 'sol')).toMatchObject({ zero: true, a0: true, main: true, parentId: null });
  });
  it('reconciles the Labs umbrella with Agent Base and retains the main owner flag', async () => {
    const reg = { projects: [{ id: 'agent-base', name: 'Agent Base', group: 'labs' }, { id: 'old-labs', name: 'SISO Internal Labs', group: 'labs' }], agents: { 'AGENT BASE UI': { project: 'SISO Internal Labs', kind: 'owner', main: true } } };
    expect(migrate(reg).projects.filter(p => p.name === 'Agent Base')).toHaveLength(1);
    const org = await buildOrg(reg, { doors: async () => ({}), plan: async () => null, ownersLog: async () => [] });
    expect(org.groups.flatMap(g => g.projects).find(p => p.name === 'Agent Base').owners[0]).toMatchObject({ name: 'AGENT BASE UI', main: true });
  });
  it('shows a closed main owner, hides closed non-main owners and folds all non-friend clients', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'true' });
    vi.stubGlobal('window', { localStorage: globalThis.localStorage });
    try {
      const folders = agencyFolders({ clients: [{ folder: 'kikas', name: "Kika’s Coffee & Co.", kind: 'friend-favour' }, { folder: 'old', kind: 'client' }, { folder: 'lead', kind: 'lead' }] }, [], []);
      const org = { top: [], bottom: [], groups: [{ id: 'agency', name: 'Agency', icon: 'briefcase-business', projects: [], folders }, { id: 'labs', name: 'Labs', icon: 'flask', folders: [], projects: [{ id: 'agent-base', name: 'Agent Base', shown: true, owners: [{ name: 'AGENT BASE UI', main: true }, { name: 'OPS-BUILD', main: false }] }] }] };
      const html = renderToStaticMarkup(createElement(Sidebar, { agents: [], domains: [], error: null, activeId: null, org, onStart: async () => null, ...Object.fromEntries(['onOpen', 'onAct', 'onEdit', 'onReorder', 'onReorderProjects', 'onWorkers', 'onRename', 'onOrg', 'onPage', 'onEndedPage', 'onDashboard'].map(k => [k, () => {}])) }));
      expect(html).toContain('Start AGENT BASE UI'); expect(html).toContain('not open'); expect(html).not.toContain('OPS-BUILD');
      expect(html).toContain('Kika’s Coffee &amp; Co.'); expect(html).toContain('Inactive (2)'); expect(html).toMatch(/<details data-testid="inactive-clients"><summary>/);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps a main owner row without exposing worker folds or counts', () => {
    vi.stubGlobal('localStorage', { getItem: () => null }); vi.stubGlobal('window', { localStorage: globalThis.localStorage });
    try {
      const agents = [{ id: 'design', name: 'OPERATOR-DESIGN', main: true, row: 'live', status: 'idle', project: 'HALO' }, { id: 'worker', name: 'WORKER', parentId: 'design', row: 'live', status: 'idle' }];
      const html = renderToStaticMarkup(createElement(Sidebar, { agents, domains: ['HALO'], error: null, activeId: null, org: null, ...Object.fromEntries(['onOpen', 'onAct', 'onEdit', 'onReorder', 'onReorderProjects', 'onWorkers', 'onRename', 'onOrg', 'onPage', 'onEndedPage', 'onDashboard'].map(k => [k, () => {}])) }));
      expect(html).toContain('ab-main-agent'); expect(html).toContain('OPERATOR-DESIGN'); expect(html).not.toContain('siso-thread__fold'); expect(html).not.toContain('siso-thread__count');
    } finally { vi.unstubAllGlobals(); }
  });
});

import { seedWorkspaces, editWorkspace, projectWorkspace } from '../../../../../services/node/src/workspace-registry';
import { workspaceOwners, inWorkspace } from '../workspace-nav';
import { groupFleet } from '../../../../../services/node/src/fleet-board';
describe('workspace navigation contract', () => {
  it('seeds the ordered nav workspaces (t-0563: sub-projects and folders) and preserves child workspace identities', () => {
    const ws = seedWorkspaces();
    expect(ws.filter(w => w.nav).sort((a,b) => a.order-b.order).map(w => w.name)).toEqual(['HALO','Agent Base','SISO Agency','Clients','Research','Playground','UI Hub']);
    for (const [child,parent] of [['halo-operator','halo'],['halo-streaming','halo'],['kikas','siso-agency'],['fahmy','siso-agency'],['app-atlas','agent-base'],['tasks','agent-base'],['agent-base','siso-agency'],['ui-hub','siso-agency']]) expect(inWorkspace(child,parent,ws)).toBe(true);
    expect(seedWorkspaces(ws)).toEqual(ws);
    expect(ws.filter(w => w.nav).every(w => w.logo?.endsWith(`${w.id}.svg`))).toBe(true);
    expect(editWorkspace(ws,{id:'halo',logo:'/etc/private.svg'})).toContain('workspace logos directory');
    expect(editWorkspace(ws,{id:'halo',logo:ws.find(w => w.id === 'halo')!.logo})).toBeNull();
    expect(editWorkspace(ws,{id:'halo',parent:'halo-operator'})).toBe('workspace parent cycle');
    expect(editWorkspace(ws,{id:'halo',nav:true,color:'#abcdef'})).toBeNull();
  });
  it('uses registry workspace before project, nests only lasting owners, and excludes all job sources', () => {
    const rows = [{id:'zero',name:'A0',zero:true}, {id:'design',name:'DESIGN',project:'HALO'}, {id:'child',name:'CHILD'}, {id:'worker',name:'WORKER'}, {id:'run',name:'RUN'}, {id:'base',name:'BASE',project:'HALO'}];
    const reg = { DESIGN:{kind:'owner',workspace:'halo-operator'}, CHILD:{kind:'worker',lead:'DESIGN'}, WORKER:{kind:'worker',owner:'DESIGN'}, RUN:{kind:'owner',workspace:'halo'}, BASE:{kind:'owner',workspace:'agent-base'} };
    const out = agentNavigation(rows,[{id:'job',name:'JOB',codexWorker:true}],reg,[{worker:'RUN',parent:'DESIGN'}]);
    out.forEach(a => a.row='live');
    expect(workspaceOwners(out,seedWorkspaces(),'halo').map(a => a.name)).toEqual(['DESIGN','CHILD']);
    expect(out.find(a => a.id==='child')).toMatchObject({navParentId:'design',workspace:'halo-operator'});
    expect(workspaceOwners(out,seedWorkspaces(),'agent-base').map(a => a.name)).toEqual(['BASE']);
    expect(groupFleet(out,[],seedWorkspaces()).find(w => w.id==='agent-base').rows.map(a => a.name)).toContain('BASE');
    expect(projectWorkspace('Clients')).toBe('siso-agency'); expect(projectWorkspace("Fahmy's agency")).toBe('siso-agency'); expect(projectWorkspace('SISO Internal Labs')).toBe('agent-base');
  });
  it('renders workspace cards without any agent-dot rows and leaves empty cards with add-owner', () => {
    vi.stubGlobal('localStorage',{getItem:()=>null}); vi.stubGlobal('window',{localStorage:globalThis.localStorage});
    try {
      const ws=seedWorkspaces(); const agents=[{id:'zero',name:'Agent Zero',zero:true,main:true,row:'live',status:'idle'}, {id:'design',name:'DESIGN',navOwner:true,workspace:'halo-operator',row:'live',status:'working'}];
      const html=renderToStaticMarkup(createElement(Sidebar,{agents,workspaces:ws,domains:[],error:null,activeId:'zero',org:null,...Object.fromEntries(['onOpen','onAct','onEdit','onReorder','onReorderProjects','onWorkers','onRename','onOrg','onPage','onEndedPage','onDashboard'].map(k=>[k,()=>{}]))}));
      // t-0563: Agent Base is a sub-project inside SISO Agency, so it renders after (and within) it.
      expect(html.indexOf('data-workspace="halo"')).toBeLessThan(html.indexOf('data-workspace="siso-agency"')); expect(html.indexOf('data-workspace="siso-agency"')).toBeLessThan(html.indexOf('data-workspace="agent-base"'));
      expect(html).toContain('ab-workspace-panel'); expect(html).toContain('data-brand="halo"'); expect(html).toContain('data-brand="siso-agency"'); expect(html).toContain('data-brand="agent-base"'); expect(html).toContain('Toggle HALO owners'); expect(html).toContain('Add an owner to Agent Base'); expect(html).not.toContain('zero-crew-face'); expect(html).not.toContain('ab-card-crew');
    } finally {vi.unstubAllGlobals();}
  });
});

 it('places an explicitly registered infrastructure owner in its nav workspace', () => {
 const out=agentNavigation([{id:'eff',name:'EFFICIENCY',project:'Agent Infrastructure'}],[{id:'eff-role',name:'EFFICIENCY',infrastructureRole:'EFFICIENCY',codexWorker:true}],{EFFICIENCY:{workspace:'agent-base',main:true,kind:'owner'}},[{name:'role-efficiency',worker:'EFFICIENCY'}]);
 expect(out[0]).toMatchObject({workspace:'agent-base',navOwner:true}); expect(groupFleet(out,[],seedWorkspaces()).find(w=>w.id==='agent-base').rows).toHaveLength(1);
 });
