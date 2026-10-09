import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { House, Globe } from 'lucide-react';
import { AppFrame, RailButton } from '@siso/shell';
import { WorkspaceMark, LivingIcon } from '../../../packages/halo-face/living-assets';
import { HomePeek } from '../src/components/HomePeek';
import { SpendChip } from '../src/components/SpendChip';
import { VersionPulse } from '../src/components/VersionPulse';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
import { mountPage } from '../src/lib/webview';
import { localDay } from '../src/lib/spend';
import type { Agent } from '../src/lib/agents';
import type { Org, OrgProject } from '../src/lib/agents';
import '../src/index.css';
import '../src/components/BankChrome.css';

// This standalone preview owns its API adapter too; even a manually opened preview cannot reach the live node.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  let response = fixtureResponse(url.pathname);
  if (url.pathname === '/api/spend') {
    const day = localDay(), at = Date.now();
    response = { ...response, data: { ...response.data, day, claude_usd_equiv: 12, projects: [{ project: 'Agent Base', claude_usd_equiv: 12, codex_credits: [1, 2], owners: [] }] }, today: { from: 'tokens', usd: 12.84, day, observedAt: at }, attribution: { source: 'stack-opt', scope: 'report-day', state: 'fresh', observedAt: at, attemptedAt: at, day, reason: null } };
  }
  return new Response(JSON.stringify(response ?? {}), { status: response ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
};

const query = new URLSearchParams(location.search);
const initial = query.get('state') ?? 'ready';
const supplied = fixtureResponse('/api/agents').agents as Agent[];
const fixtureAgents = supplied.slice(0, 3).map((agent, index) => ({ ...agent, status: index === 2 ? 'needs' as const : 'working' as const }));
const fixtureProjects = (fixtureResponse('/api/org') as Org).groups.flatMap(group => group.projects).map(project => ({ ...project, owners: project.id === 'agent-base' ? [{ ...project.owners[0], name: 'AGENT BASE' }] : project.owners }));
function NativeFixture() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let surface: HTMLIFrameElement | undefined;
    const calls: Record<string, unknown>[] = [];
    Object.assign(window, { nativeCalls: calls, __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, any>) => {
      calls.push({ command, ...args });
      if (command === 'browser_open') {
        surface = document.createElement('iframe'); surface.title = 'Synthetic native surface';
        surface.srcdoc = '<body style="background:#242625;color:#aaa;font:14px system-ui">Synthetic native child · IPC fixture</body>';
        Object.assign(surface.style, { position: 'fixed', zIndex: '2147483647', border: '0' }); document.body.append(surface);
      }
      if ((command === 'browser_open' || command === 'browser_bounds') && surface) Object.assign(surface.style, { left: args.x + 'px', top: args.y + 'px', width: args.width + 'px', height: args.height + 'px' });
      if (command === 'browser_visible' && surface) {
        if (!args.visible) await new Promise(resolve => setTimeout(resolve, 100));
        surface.hidden = !args.visible;
      }
      if (command === 'browser_url') return 'https://example.test/fixture';
      return undefined;
    } } });
    const controller = mountPage(slot.current!, 'https://example.test/fixture', () => {}, error => { throw new Error(error); }, 'fixture-rail', 'fixture-rail');
    return () => { controller.dispose(); surface?.remove(); };
  }, []);
  return <div ref={slot} style={{ position: 'fixed', top: 105, left: 70, right: 8, bottom: 8 }}/>;
}
function Preview() {
  const [state, setState] = useState(initial);
  const [versionOpen, setVersionOpen] = useState(false);
  const [receipt, setReceipt] = useState('Your work stays in place while you look around.');
  const projects: OrgProject[] = state === 'empty' ? [] : state === 'many' ? Array.from({ length: 40 }, (_, index) => ({ ...fixtureProjects[index % 2], id: `project-${index}`, name: index === 1 ? 'A very long project name that must wrap without pushing any part of the peek outside the screen' : `${fixtureProjects[index % 2].name} ${index + 1}` })) : fixtureProjects;
  return <AppFrame top={<><span style={{ marginLeft: 8, fontSize: 12, flexShrink: 0 }}>Agent Base</span><div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
    <SpendChip/>
    <VersionPulse current={{ web: '0.8.4', node: '0.8.2', desktop: '0.6.1', sha: 'fixture' }} status="current" open={versionOpen} onOpenChange={setVersionOpen} onDismiss={() => setVersionOpen(false)}/>
  </div></>} rail={<>
    <RailButton label="Home" Icon={House} active dot renderIcon={() => <WorkspaceMark brand="agent-base" size={32}/>} line="Projects, agents and activity" peek={({ close }) => <HomePeek projects={projects} agents={state === 'empty' ? [] : fixtureAgents} loading={state === 'loading'} unavailable={state === 'unavailable'} currentProject="agent-base" close={close} onProject={id => setReceipt(`Opened project: ${id}`)} onAgent={agent => setReceipt(`Opened agent: ${agent.name}`)} onHome={() => setReceipt('Opened Home')}/>}/>
    <RailButton label="Browser" Icon={Globe} renderIcon={() => <LivingIcon name="web" size={30}/>} line="Web pages beside your agents" />
  </>}><main style={{ padding: 20, overflow: 'auto', width: '100%' }}>
    <div data-testid="top-strip" style={{ position: 'fixed', top: 48, left: 64, right: 8, height: 120, zIndex: 200, background: 'var(--crm-color-surface-raised)', padding: 16, borderBottom: '1px solid #ffffff12', fontSize: 12 }}>example.test / workspace</div>
    <div style={{ margin: '100px auto', maxWidth: 660 }}><p style={{ color: '#999', fontSize: 11 }}>SYNTHETIC PREVIEW · RAIL / TODAY / VERSIONS</p><h1 style={{ fontSize: 30, marginTop: 16 }}>A glance, then a door.</h1><p style={{ color: '#aaa', lineHeight: 1.7 }}>Hover Home to see projects, agents and activity. Click to keep the peek open. Select a project to explore its team.</p>
    <label style={{ display: 'flex', gap: 12, margin: '24px 0' }}>Fixture state<select aria-label="Fixture state" value={state} onChange={event => setState(event.target.value)}>{['ready', 'empty', 'loading', 'many', 'unavailable'].map(item => <option key={item}>{item}</option>)}</select></label>
    <p role="status" data-testid="destination">{receipt}</p>
    <iframe title="Synthetic web surface" srcDoc="<body style='background:#202321;color:#999;font:14px system-ui;padding:24px'>Embedded page · synthetic fixture only</body>" style={{ width: '100%', height: 150, marginTop: 24, border: '1px solid #ffffff12', borderRadius: 12 }}/>
    </div>{query.has('native') && <NativeFixture/>}
  </main></AppFrame>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
