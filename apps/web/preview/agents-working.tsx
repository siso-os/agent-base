import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SubagentsPopover } from '../src/components/SubagentsPopover';
import type { SubagentRowData } from '../src/components/SubagentRow';
import type { Agent } from '../src/lib/agents';
import { AgentFace } from '../src/lib/face';
import './agents-working.css';

type Scene = 'working' | 'finished' | 'blocked' | 'unknown' | 'partial' | 'stale' | 'empty' | 'offline' | 'busy';
let scene: Scene = 'working';
const fixtureAgent = { id: 'fixture-zero', name: 'Agent Zero', project: 'Agent Base', status: 'working', tool: 'codex', session: null, cwd: '/synthetic/agent-base' } as Agent;
const identity = [
  { name: 'SOL · INTERFACE', model: 'gpt-6.1-sol', about: 'Refining the composer and its connected agent activity pop-up.', rate: 63.8, tokens: 84200 },
  { name: 'ASTRA · VERIFICATION', model: 'gpt-6-astra', about: 'Checking output rates, keyboard controls, and the narrow layout.', rate: 41.2, tokens: 170500 },
  { name: 'SOL · COMPONENTS', model: 'gpt-6.1-sol', about: 'Bringing the approved workspace materials into the shared composer.', rate: 48.6, tokens: 93500 },
];
function fixtureRows(): SubagentRowData[] {
  const now = Date.now();
  if (scene === 'empty') return [];
  const make = (i: number, done = false): SubagentRowData => {
    const source = identity[i % identity.length];
    const running = !done && scene !== 'finished';
    return { ...source, name: scene === 'busy' ? `${source.name} ${i + 1}` : source.name,
      id: `fixture-${i}`, agentId: `fixture-${i}`, kind: 'codex', type: 'Codex', what: source.about, spec: '',
      running, background: true, start: new Date(now - (i + 3) * 60000).toISOString(), end: running ? null : new Date(now - 90000).toISOString(), tools: i * 4 + 8,
      rate: scene === 'unknown' || (scene === 'partial' && i === 0) ? undefined : source.rate, rateAt: scene === 'stale' ? now - 60_000 : now, rateWindowMs: 30_000,
      estimated: i === 2, status: scene === 'blocked' && i === 1 ? 'blocked' : running ? 'working' : 'done',
      batch: done ? 'Workspace handoff' : 'Composer refinement', batchId: done ? 'fixture-finished' : 'fixture-working' };
  };
  return [...Array.from({ length: scene === 'busy' ? 16 : 3 }, (_, i) => make(i)), make(3, true), make(4, true)];
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/')) {
    if (url === '/api/agents/fixture-zero/subagents' && (!init?.method || init.method === 'GET')) {
      if (scene === 'offline') return new Response('{}', { status: 503 });
      const rows = fixtureRows();
      return new Response(JSON.stringify({ rows, tokens: rows.reduce((sum, row) => sum + row.tokens, 0), running: rows.filter(row => row.running).length }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error('This preview only reads its synthetic activity fixture.');
  }
  return originalFetch(input, init);
};
function Preview() {
  const [mode, setMode] = useState<Scene>('working');
  const [opened, setOpened] = useState('');
  const [revision, setRevision] = useState(0);
  const rows = fixtureRows();
  const crew = rows.map(row => ({ ...fixtureAgent, id: row.agentId!, name: row.name!, status: row.status === 'blocked' ? 'needs' : row.running ? 'working' : 'done' } as Agent));
  const reveal = () => document.querySelector<HTMLButtonElement>('[data-testid="faces-pill"]')?.click();
  useEffect(() => { const id = window.setTimeout(reveal, 160); return () => clearTimeout(id); }, [mode, revision]);
  const change = (next: Scene) => { scene = next; setMode(next); setOpened(''); };
  return <main className="aw-preview">
    <header className="aw-top"><a className="aw-brand" href="#"><span aria-hidden>✳</span> AGENT BASE <i>/</i> COMPOSER</a><span className="aw-fixture">INTERACTIVE PREVIEW · SYNTHETIC DATA</span></header>
    <div className="aw-title"><div><span className="aw-kicker">THE AGENTS WORKING POP-UP</span><h1>Your crew. One glance.</h1></div><p>The faces you know.<br/>A clearer picture of the work.</p></div>
    <nav className="aw-scenes" aria-label="Preview states">{(['working','finished','blocked','unknown','partial','stale','empty','offline','busy'] as Scene[]).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => change(value)}>{({ unknown: 'No measurement', partial: 'Partial rate', stale: 'Stale rate', offline: 'Disconnected', busy: '16 agents', blocked: 'Needs you', working: 'Working', finished: 'Finished', empty: 'Empty' })[value]}</button>)}</nav>
    <section className="aw-stage" aria-label="Composer with real agent activity component">
      <div className="aw-chat"><div className="aw-chat-owner"><AgentFace name="Agent Zero" project="Agent Base" status="waiting" size={32}/><strong>Agent Zero</strong><small>just now</small></div><p>Three focused tasks, one connected crew.</p><div className="aw-launch-note"><span aria-hidden>↳</span><span>Interface · Verification · Components</span><button type="button" onClick={reveal}>View agents <span aria-hidden>↗</span></button></div></div>
      {opened && <div className="aw-opened" role="status"><span className="aw-kicker">CONVERSATION CALLBACK</span><strong>{opened}</strong><p>The real open-chat action reached this preview. No live agent was contacted.</p><button type="button" onClick={() => { setOpened(''); setRevision(value => value + 1); }}>Back to crew</button></div>}
      <div className="aw-compose siso-chat__composer"><div className="aw-draft"><span aria-hidden>＋</span><span>Give the crew a direction…</span><button type="button" aria-label="Preview send control" disabled>↑</button></div><div className="aw-rim"><div className="aw-model"><span aria-hidden>✳</span> Astra 6 <span>·</span> high <small>42% context</small></div><SubagentsPopover key={`${mode}-${revision}`} agent={fixtureAgent} total={rows.length} running={rows.filter(row => row.running).length} crew={crew} onOpenCrew={agent => setOpened(agent.name)}/></div></div>
    </section>
    <footer className="aw-footer"><span>Hover the face stack · expand a row · open its conversation</span><span>Output speed excludes input and cache tokens. “~” is estimated; “+” means partial coverage.</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
