import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MicButton } from '../src/components/MicButton';
import { TalkOrb } from '../src/components/TalkOrb';
import { closeMic } from '../src/lib/voice';
const records: unknown[] = [];
function Fixture() {
 const [active, setActive] = useState(true), [mounted, setMounted] = useState(true), [disabled, setDisabled] = useState(false);
 Object.assign(window, { __fixture: { records, setActive, setMounted, setDisabled, closeMic } });
 return <main style={{padding:30,background:'#17131e',color:'#eee',display:'grid',gap:36}}>
 <h1>Synthetic microphone controller check</h1>
 <section id="alpha">{mounted && <MicButton to="fixture-alpha" toName="Fixture Alpha" active={active} disabled={disabled} onText={(text,how)=>records.push({to:'fixture-alpha',text,how})}/>}</section>
 <section id="beta"><MicButton to="fixture-beta" toName="Fixture Beta" variant="face" readAloudMenu onText={(text,how)=>records.push({to:'fixture-beta',text,how})}/></section>
 <section id="accept"><TalkOrb phase="ready" transcript="Synthetic accepted text" onAccept={text=>records.push({accepted:text})} onCancel={()=>records.push({cancelled:true})}/></section>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
