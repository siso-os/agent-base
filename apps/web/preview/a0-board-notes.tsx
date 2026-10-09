import { createRoot } from 'react-dom/client';
import { A0Board } from '../src/components/panel/A0Board';
import type { Agent } from '../src/lib/agents';
import '../src/index.css';
import '../src/components/AgentPanel.css';

// This fixture is served only by the sealed test runner with a temporary synthetic store.
Object.defineProperty(window, 'EventSource', {value:undefined,configurable:true});
const zero = {id:'fixture-zero',name:'Fixture Zero',zero:true,status:'idle',row:'live',machine:'laptop',hud:{}} as Agent;
createRoot(document.getElementById('root')!).render(<main style={{height:'100dvh',display:'flex',justifyContent:'center',background:'var(--crm-color-canvas)',color:'var(--crm-color-text)'}}><div style={{display:'flex',width:'min(100%, 420px)',minWidth:0}}><A0Board a={zero} agents={[zero]}/></div></main>);
