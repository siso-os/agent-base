import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UsagePageView } from '../src/components/UsagePage';
import { VersionsLine } from '../src/components/VersionsLine';
import { ProviderUsageMeters } from '../src/components/ProviderUsageMeters';
import { RecordedSessionReplay } from '../src/components/RecordedSessionReplay';
import { usageFixture } from '../../../services/node/test/usage-versions-fixture.mjs';
import '../src/index.css';
// No API request escapes this synthetic preview, including background polls.
window.fetch = async (input) => new Response(JSON.stringify(usageFixture(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname)), {status:200,headers:{'Content-Type':'application/json'}});
const known={source:{ref:'HEAD',sha:'aaaaaaaa'},preview:{ref:'refs/preview',sha:'bbbbbbbb'},live:{ref:'refs/live',sha:'cccccccc'},layers:{web:'bbbbbbbb',node:'cccccccc'}};
function Preview(){
 const [state,setState]=useState('today known');
 const spend=usageFixture('/api/spend');
 if(state==='attribution stale')spend.attribution.state='stale';
 return <div style={{height:'100dvh',background:'var(--crm-color-canvas)',color:'var(--crm-color-text)'}}>
  <footer aria-label="Synthetic bottom usage" style={{position:'fixed',bottom:0,right:0,zIndex:900,padding:8,background:'var(--crm-color-surface)'}}><ProviderUsageMeters now={Date.now()}/></footer>
  <nav className="usage-fixture-nav" aria-label="Fixture states" style={{position:'relative',zIndex:1000,display:'flex',flexWrap:'wrap',gap:8,padding:12,background:'var(--crm-color-surface)'}}><strong>SYNTHETIC STATES</strong>{['today known','attribution stale','update available','update applying','version unknown','no recording'].map(s=><button key={s} type="button" onClick={()=>setState(s)} aria-pressed={state===s}>{s}</button>)}</nav>
  {state.startsWith('update')||state==='version unknown'?<div style={{padding:20,maxWidth:650,margin:'auto'}}><h1>{state==='update available'?'Update available':state==='update applying'?'Applying supplied update':'Version unknown'}</h1><VersionsLine line={state==='version unknown'?null:known} applying={state==='update applying'}/><p>Synthetic evidence · web updated while node remains on the prior revision</p></div>:state==='no recording'?<div style={{padding:20}}><RecordedSessionReplay sessionId={null} events={[]} owner={{name:'Fixture owner',family:'codex'}}/></div>:<div style={{height:'calc(100% - 95px)'}}><UsagePageView spend={spend}/></div>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
