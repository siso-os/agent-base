import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AgentWidgets} from '../src/components/widgets/AgentWidgets';
import '../src/index.css';
function Fixture(){const [selected,onSelect]=useState<string|null>(new URLSearchParams(location.search).get('widget'));return <main style={{height:'100dvh',maxWidth:460,margin:'0 auto',background:'var(--crm-color-canvas)'}}><AgentWidgets agent="A0" selectedId={selected} onSelect={onSelect} onVoice={async()=> 'Synthetic voice transcript'}/></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
