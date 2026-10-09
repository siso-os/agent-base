// Optional extension of the existing composer fixture, isolated from every live agent.
import {mkdirSync,writeFileSync,copyFileSync,cpSync} from 'node:fs';
import path from 'node:path';
export function seedSpace({scratch,root,session,hostPort,pid}) {
 const spaces=process.env.AB_SPACES_DIR??path.join(scratch,'spaces'),tasks=path.join(scratch,'tasks');
 const repo=path.join(scratch,'repo'),galleries=path.join(scratch,'galleries'),queue=path.join(scratch,'queue');
 for(const dir of [path.join(spaces,'agent-base/pins'),tasks,repo,path.join(galleries,'fixture'),queue])mkdirSync(dir,{recursive:true});
 writeFileSync(path.join(repo,'SPEC.md'),'# Shared direction\n\nOwner at home. Research left. Builder right. Evidence stays above the work.');
 const title=['Build the project space','Keep research children discoverable','Use the existing chat glow'];
 ['note','doc','link'].forEach((kind,i)=>writeFileSync(path.join(spaces,`agent-base/pins/pin-${i}.md`),`---\ntitle: ${title[i]}\nkind: ${kind}\nby: ${i===0?'Shaan':'RESEARCH'}\nat: ${new Date().toISOString()}\n${kind==='doc'?'path: SPEC.md\n':''}---\n${kind==='note'?'The owner is home. I can look sideways without losing the conversation.':kind==='link'?'[The Space spec](https://example.com/space)':''}`));
 // AB_FIXTURE_NAV=1 adds HALO's shape (live 5 Oct): OPERATOR-DESIGN as a main owner with 11 workers.
 const crew=process.env.AB_FIXTURE_NAV?['OPERATOR-DESIGN',...Array.from({length:11},(_,i)=>`OD-WORKER-${i+1}`)]:[];
 const names=['Agent Zero','BUILDER',process.env.AB_FIXTURE_NAV?'AGENT BASE':'RESEARCH','SCOUT-A','SCOUT-B',...crew];
 const agents=names.map((name,i)=>({agent:i===1?'codex':'siso',agent_status:'working',cwd:repo,pane_id:`w1:p${i+1}`,terminal_id:i===0?'fixture':`space-${i}`,terminal_title_stripped:i===0?'A0':name,agent_session:{value:i===0?session:`00000000-0000-4000-8000-0000000000a${i}`}}));
 const who=Object.fromEntries(names.map((name,i)=>[name,crew.includes(name)?{project:'HALO',kind:name==='OPERATOR-DESIGN'?'owner':'worker',owner:name==='OPERATOR-DESIGN'?null:'OPERATOR-DESIGN',role:'Operator design'}:{project:'Agent Base',kind:i===0?'owner':'worker',owner:i===0?null:i>=3?'RESEARCH':'Agent Zero',role:i===1?'Building the canvas and pin polling':i===2?'Research base':i>=3?'Reading the existing app':'Project owner'}]));
 writeFileSync(path.join(scratch,'registry.json'),JSON.stringify({projects:[{id:'agent-base',name:'Agent Base',group:'labs',shown:true,order:0,path:repo},...(crew.length?[{id:'halo',name:'HALO',group:'agency',shown:true,order:1,path:repo,pinned:true,owners:['OPERATOR-DESIGN']}]:[])],agents:who,pinned:['Agent Zero']}));
 agents.slice(1).forEach((a,i)=>writeFileSync(path.join(scratch,`hosts/space-${i+1}.json`),JSON.stringify({pid,port:hostPort,token:'fixture',session:a.agent_session.value,pane:a.pane_id,name:names[i+1],cwd:repo,model:i===0?'gpt-6.1-sol':'claude-opus-5-5[1m]',harness:i===0?'codex':'claude',state:'working',child:'running'})));
 const now=new Date().toISOString();
 const rows=[['t-space','Space pinboard','building',null],['t-space-a','Reuse chat and panel','live','t-space'],['t-space-b','Read agent-authored pins','live','t-space'],['t-space-c','Persist positions','building','t-space'],['t-space-d','Verify overview','allocated','t-space']].map(([id,title,stage,parent])=>({id,title,project:'Agent Base',priority:'P1',stage,parent,agent:'BUILDER',owner:'BUILDER',model:'gpt-6.1-sol',updated:now}));
 // AB_FIXTURE_TASKS_FROM=<a0 task store>: a read-only copy of the real board, so the Tasks card is judged on real data.
 if(process.env.AB_FIXTURE_TASKS_FROM)cpSync(process.env.AB_FIXTURE_TASKS_FROM,tasks,{recursive:true});else{writeFileSync(path.join(tasks,'INDEX.json'),JSON.stringify({updated:now,counts:{},tasks:rows}));rows.forEach(row=>writeFileSync(path.join(tasks,row.id+'.json'),JSON.stringify(row)));}
 const shot=path.join(root,'ui-hub/space/rounds/space/01-before-nav-closed-panel-closed-1440.png');
 copyFileSync(shot,path.join(galleries,'fixture/01-before-space.png'));copyFileSync(shot,path.join(galleries,'fixture/01-after-space.png'));
 writeFileSync(path.join(galleries,'fixture/index.html'),'<h1>Fixture achievement evidence</h1><p>Paired fixture images reuse the baseline capture; they are not a live delivery claim.</p>');
 writeFileSync(path.join(queue,'queue.jsonl'),JSON.stringify({id:'fixture-landed',state:'live',by:'BUILDER',at:now,title:'Chat and panel reuse landed',task:'t-space-a',gallery:'fixture',tests:'Fixture achievement with paired images; no production release.'})+'\n');
 writeFileSync(path.join(spaces,'fixture-agents.json'),JSON.stringify(agents));
 return {agents,env:{FAKE_HERDR_AGENTS_FILE:path.join(spaces,'fixture-agents.json'),AB_SPACES_DIR:spaces,AB_A0_TASKS:tasks,AB_TIMELINE_GALLERIES:galleries,AB_QUEUE_STATE:queue},steps:[{t:'user',id:'space-ask',text:'Build the project space with the existing parts.',at:Date.now()-60000,from:'you'},{t:'text',id:'space-step',text:'Reading the current canvas layout. Chat and panel are reused; next I am checking pin polling and saved placement.',at:Date.now()-30000},{t:'tool',id:'space-read',name:'Read',summary:'Read ProjectSpace and pin reader',input:{path:'ProjectSpace.tsx'},at:Date.now()-1000}]};
}
