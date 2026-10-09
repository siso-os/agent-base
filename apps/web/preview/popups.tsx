// Lane popups (9 Oct): a sealed fixture for the agent card, the notification stack, the toast stack and the popped page.
// Ten side-nav rows in the real AgentHoverCard, with the states Shaan's fleet produces: no chat yet, a very long last
// message, a working agent whose report changes while its card is open. ?native mounts the real mountPage with a synthetic
// IPC (browser_visible takes ?ipc ms, default 30) so the native-view layering is exercised. No network: fetch is refused.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentHoverCard, type AgentHoverCardAgent } from '../src/components/AgentHoverCard';
import { AgentNotificationStack, type AgentStackNotification } from '../src/components/AgentNotificationStack';
import { Toast } from '../src/components/ToastStack';
import { PagePop } from '../src/components/PagePop';
import { mountPage } from '../src/lib/webview';
import '../src/index.css';

window.fetch = async () => new Response('{}', { status: 410 });
const q = new URLSearchParams(location.search);
const LONG = 'Recovery test passes on the attended restart path. ' + 'The operator reconnect loop now waits for the encoder heartbeat before it re-arms the scene switcher, which removes the double-start we saw on Tuesday; the remaining risk is the RTMP ingest timing out on the first reconnect when the VPS is under load, which I am measuring now with a synthetic 40-minute stream and will report back with numbers. '.repeat(3);
const base: AgentHoverCardAgent = { name: '', kind: 'owner', project: 'HALO Go-live', accent: 'rgb(245,180,0)', harness: 'claude', model: 'Opus 5.5', machine: 'mac-mini', state: 'idle', holding: null, lastReport: null, plan: null };
const report = (text: string, ageMin = 4) => ({ at: '06:58', ageMin, text, log: 'owners.log' });
const AGENTS: AgentHoverCardAgent[] = [
  { ...base, name: 'Agent Zero', kind: 'zero', project: 'Agent Base', accent: 'rgb(167,139,250)', harness: 'siso', lastReport: report('Ten lanes dispatched for the Opus UI wave; reviewing branches as they land.', 2) },
  { ...base, name: 'STREAMING', state: 'working', holding: { id: 'S-8', title: 'Recover an interrupted stream and prove the operator can restart cleanly', status: 'building' }, lastReport: report('Starting the 40-minute synthetic stream.', 0), plan: { checked: 4, total: 8, counts: { asked: 1, specced: 0, allocated: 1, building: 2, built: 0, checked: 4, parked: 0, dropped: 0 } } },
  { ...base, name: 'FRESH-WORKER', kind: 'worker', owner: 'STREAMING', harness: 'codex', model: 'GPT Luna', machine: 'laptop' },
  { ...base, name: 'LONG-REPORT-OWNER-WITH-A-VERY-LONG-NAME', project: 'SISO Internal Labs', accent: 'rgb(53,212,155)', state: 'done', lastReport: report(LONG, 75), holding: { id: 'L-2', title: 'A plan item whose title is also long enough to wrap onto a second line in the card', status: 'checked' } },
  { ...base, name: 'AGENT-BASE', project: 'Agent Base', accent: 'rgb(167,139,250)', state: 'working', lastReport: report('Reviewing the popups lane.', 1) },
  { ...base, name: 'OPERATOR-UI', kind: 'worker', owner: 'STREAMING', harness: 'codex', model: 'GPT Sol', state: 'working', lastReport: report('Operator status view: two of three panels built.', 6) },
  { ...base, name: 'EFFICIENCY', project: 'Agent stack', accent: 'rgb(96,165,250)', lastReport: report('Load is 4.1 on the mini; heavy slots 2 of 5 in use.', 12) },
  { ...base, name: 'ESTATE', project: 'Agent stack', accent: 'rgb(96,165,250)', lastReport: report('Archived 3 stray worktrees under _archive.', 31) },
  { ...base, name: 'ROLODEX', project: 'Life', accent: 'rgb(244,114,182)', state: 'done', lastReport: report('WhatsApp import mapped 812 chats onto six levels.', 44) },
  { ...base, name: 'HEALTH', project: 'Agent stack', accent: 'rgb(96,165,250)', lastReport: report('All five machines answered in under 200 ms.', 3) },
];
const NOTES: AgentStackNotification[] = Array.from({ length: Number(q.get('notes') ?? 0) }, (_, i) => ({ id: `n${i}`, at: `2026-10-09T07:0${i}:00Z`, title: ['STREAMING needs a restart window', 'Popups lane pushed', 'Estate archived 3 worktrees', 'Health: mini load back to normal', 'Rolodex import finished'][i % 5], body: i === 0 ? 'Pick a 10-minute window today; the stream drops for about 40 s.' : undefined, needs: i === 0 ? 'Choose a restart window' : undefined, read: i > 2, react: null, owner: { id: `o${i}`, name: AGENTS[(i + 1) % 10].name, project: AGENTS[(i + 1) % 10].project } }));

function NativeFixture() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let surface: HTMLDivElement | undefined;
    const ipc = Number(q.get('ipc') ?? 30);
    const calls: Record<string, unknown>[] = [];
    Object.assign(window, { nativeCalls: calls, __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, any>) => {
      calls.push({ command, at: performance.now(), ...args });
      if (command === 'browser_open') {
        surface = document.createElement('div'); surface.dataset.testid = 'native-surface'; surface.textContent = 'Synthetic native browser view · IPC fixture';
        Object.assign(surface.style, { position: 'fixed', zIndex: '2147483647', background: '#2a2d2b', color: '#999', font: '13px system-ui', padding: '18px' }); document.body.append(surface);
      }
      if ((command === 'browser_open' || command === 'browser_bounds') && surface) Object.assign(surface.style, { left: args.x + 'px', top: args.y + 'px', width: args.width + 'px', height: args.height + 'px' });
      if (command === 'browser_visible' && surface) { if (!args.visible) await new Promise(r => setTimeout(r, ipc)); surface.hidden = !args.visible; }
      if (command === 'browser_url') return 'https://example.test/fixture';
      return undefined;
    } } });
    const c = mountPage(slot.current!, 'https://example.test/fixture', () => {}, e => { throw new Error(e); }, 'fixture-popups', 'fixture-popups');
    return () => { c.dispose(); surface?.remove(); };
  }, []);
  return <div ref={slot} style={{ position: 'fixed', top: 56, left: 300, right: 8, bottom: 8 }}/>;
}

function Preview() {
  const [agents, setAgents] = useState(AGENTS);
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState(Number(q.get('toasts') ?? 0));
  // A working agent's report changes while its card is open (the test calls __tick; a person can press the button).
  useEffect(() => { Object.assign(window, { __tick: () => setTick(t => t + 1), __toasts: setToasts }); }, []);
  useEffect(() => { if (tick) setAgents(list => list.map(a => a.name === 'STREAMING' ? { ...a, lastReport: report(`Synthetic stream minute ${tick * 5}: ${tick % 2 ? 'no drops, encoder steady at 6 Mb/s.' : 'one reconnect at minute ' + tick + ', recovered in 2.1 s; checking the RTMP ingest logs to see whether the VPS load caused it.'}`, 0) } : a)); }, [tick]);
  return <div style={{ display: 'flex', height: '100vh', background: 'var(--crm-color-canvas)', color: 'var(--crm-color-text)', fontFamily: 'var(--crm-font-sans)' }}>
    <nav aria-label="Agents" data-testid="fixture-nav" style={{ width: 280, flex: 'none', padding: '56px 8px 8px', borderRight: '1px solid var(--crm-color-line-subtle)' }}>
      {agents.map((a, i) => <AgentHoverCard key={a.name} agent={a} row>
        <div data-testid="agent-row" data-i={i} tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', borderRadius: 8, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 4, background: a.state === 'working' ? 'var(--crm-color-brand)' : 'var(--crm-color-text-faint)' }}/>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
        </div>
      </AgentHoverCard>)}
    </nav>
    <main style={{ position: 'relative', flex: 1, minWidth: 0, padding: '56px 24px 24px', overflow: 'auto' }}>
      <div data-testid="url-strip" style={{ position: 'fixed', top: 8, left: 300, right: 8, height: 40, zIndex: 200, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 10, background: 'var(--crm-color-surface-raised, #202124)', fontSize: 12 }}>example.test / the URL bar (z-index 200)</div>
      <p style={{ color: 'var(--crm-color-text-muted)', fontSize: 11 }}>SYNTHETIC FIXTURE · lane popups · rows on the left open their agent card</p>
      <button type="button" onClick={() => setTick(t => t + 1)}>Tick STREAMING's report</button>
      {NOTES.length > 0 && <div style={{ width: 420, marginTop: 16 }}><AgentNotificationStack agent={{ id: 'fixture', name: 'Agents' }} notifications={NOTES} onMark={() => {}} /></div>}
      {q.has('pop') && <div style={{ display: 'flex', height: 420, marginTop: 16 }}><PagePop page="tasks" title="Tasks" answer="3 building" onExpand={() => {}} onClose={() => {}}><p style={{ padding: 16 }}>Popped page body</p></PagePop></div>}
    </main>
    {Array.from({ length: toasts }, (_, i) => <Toast key={i} kind={`fixture-${i}`}><div data-testid="fixture-toast" style={{ width: 340, padding: '12px 14px', border: '1px solid var(--crm-color-line-subtle)', borderRadius: 12, background: 'var(--crm-color-surface-raised, #202124)', fontSize: 12 }}><b>{AGENTS[i % 10].name}</b> · note {i + 1} of {toasts}</div></Toast>)}
    {q.has('native') && <NativeFixture/>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
