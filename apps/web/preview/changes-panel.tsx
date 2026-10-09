import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ChangesPanel } from '../src/components/ChangesPanel';
import '../src/index.css';
function Fixture() {
  const [session, setSession] = useState('fixture-session');
  return <main style={{ background: '#15161b', color: '#e8e8ed', minHeight: '100dvh', padding: 18, fontFamily: 'system-ui' }}><div style={{ maxWidth: 460, margin: '0 auto' }}><header style={{ marginBottom: 18 }}><h1 style={{ fontSize: 16 }}>Changes · synthetic review</h1><button onClick={() => setSession(session === 'fixture-session' ? 'successor-session' : 'fixture-session')}>Switch fixture session</button></header><ChangesPanel agentId="fixture-agent" sessionId={session} turns={new URLSearchParams(location.search).has('turnApi') ? undefined : [{ id: 'turn-1', label: 'Turn 1 · captured edits' }, { id: 'missing-turn', label: 'Turn 2 · unavailable capture' }]} /></div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
