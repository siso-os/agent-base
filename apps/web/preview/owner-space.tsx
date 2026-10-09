import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OwnerSpaceWork } from '../src/components/OwnerSpaceWork';
import type { OwnerQuestionConnection } from '../src/components/OwnerSpaceModel';
import '../../../packages/siso-tokens/siso.css';
Object.defineProperty(window,'EventSource',{value:undefined});
const task={id:'t-fixture',title:'Finish the owner workspace',project:'Example',owner:'OWNER',agent:'WORKER',stage:'building',priority:'P2',updated:'2026-10-06T00:00:00Z',needs:true,next:'Choose compact or roomy layout'};
window.fetch=(async input=>{
 const url=String(input);
 if(url==='/api/a0/tasks')return new Response(JSON.stringify({updated:task.updated,counts:{},tasks:[task]}));
 if(url==='/api/a0/tasks/t-fixture')return new Response(JSON.stringify({...task,links:{surface:'side-nav',spec:'ui-hub/side-nav/README.md'},evidence:['fixture-check.json'],history:[{at:task.updated,stage:'building',note:'Question recorded'}]}));
 throw Error('Fixture blocks unknown request');
}) as typeof fetch;
const request={id:'q:fixture',hostInstance:'fixture-host-'+new URLSearchParams(location.search).get('run'),session:'fixture-session',toolId:'question-tool',provider:'codex' as const,mode:'live' as const,createdAt:1,expiresAt:4102444800000,questions:[{id:'layout',header:'Layout',question:'Which layout should the crew use?',options:[{value:'compact',label:'Compact',description:'Keep room for the chat'}],multiple:false,allowCustom:true,required:true}]};
function Preview(){const [mounted,setMounted]=useState(0),[calls,setCalls]=useState(0),[snapshot,setSnapshot]=useState(1),[failed,setFailed]=useState(false),[connected,setConnected]=useState(true),[opened,setOpened]=useState(false);
const connection:OwnerQuestionConnection={connected,hostInstance:request.hostInstance,session:'fixture-session',snapshotVersion:String(snapshot),requests:[request],answer:async m=>{setCalls(c=>c+1);await new Promise(r=>setTimeout(r,200));if(failed)throw Error('Fixture transport unavailable');return {t:'question_done',id:m.id,hostInstance:m.hostInstance,outcome:m.action==='answer'?'answered':'dismissed',at:Date.now()};}};
return <main style={{maxWidth:880,margin:'24px auto',padding:12,color:'#eee',background:'#181818',fontFamily:'system-ui'}}><h1>Owner work · synthetic review</h1><nav style={{display:'flex',gap:8,flexWrap:'wrap'}}><button id="remount" onClick={()=>setMounted(c=>c+1)}>Reload component</button><button id="disconnect" onClick={()=>setConnected(c=>!c)}>Connection</button><button id="fail" onClick={()=>setFailed(c=>!c)}>Failure</button><button id="refresh" onClick={()=>setSnapshot(c=>c+1)}>Refresh native snapshot</button></nav><p id="calls">{calls} sends</p><p id="opened">{opened?'Chat opened':'Chat closed'}</p><OwnerSpaceWork key={mounted} name="OWNER" questions={connection} chatAvailable onChat={()=>setOpened(true)} /></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
