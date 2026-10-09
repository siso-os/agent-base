// Cross-repo migration acceptance. Explicit executables; synthetic data and loopback inbox only.
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createWidgetReader} from '../src/widgets.ts';
import {widgetActionsRoute} from '../src/routes/widget-actions.route.ts';
import {dispatchRoute} from '../src/routes/registry.ts';
const cli=process.env.A0_WIDGETS_CLI,fallback=process.env.A0_BOARD_FALLBACK;
assert.ok(cli&&fallback,'Set A0_WIDGETS_CLI and A0_BOARD_FALLBACK explicitly');
const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'widget-migration-')));
let server;const checks=[];const check=(name,test)=>{assert.ok(test,name);checks.push(name);};
try{
 const workspace=path.join(temp,'workspace'),legacy=path.join(temp,'legacy'),root=path.join(temp,'widgets'),inbox=path.join(temp,'inbox.jsonl');
 for(const p of [path.join(legacy,'.agents/a0'),path.join(legacy,'.agents/tasks/task-1'),path.join(workspace,'fixture/.agents/plan'),path.join(workspace,'SISO_Agents/laptop-health/.agents')])await mkdir(p,{recursive:true});
 const announcements=[{id:7,title:'First announcement',body:'Synthetic ready',project:'Fixture',at:'2026-10-06T00:00:00Z',needs:'Review'},{id:8,title:'Second announcement',body:'Synthetic complete',project:'Fixture',at:'2026-10-06T00:01:00Z',needs:'nothing'}];
 const ann=path.join(legacy,'.agents/a0/announcements.jsonl'),plan=path.join(workspace,'fixture/.agents/plan/test.json'),state=path.join(legacy,'.agents/tasks/task-1/STATE.json'),log=path.join(legacy,'.agents/tasks/task-1/LOG.md'),issues=path.join(workspace,'SISO_Agents/laptop-health/.agents/issues.jsonl');
 await writeFile(ann,announcements.map(v=>JSON.stringify(v)+'\n').join(''));await writeFile(inbox,'');await writeFile(issues,JSON.stringify({id:'h1',machine:'fixture',status:'open',cause:'Synthetic issue'})+'\n');
 const rows=[{id:'p1',title:'Synthetic checked task',status:'checked',to:{agent:'tester'},his:'Preserve all fields',evidence:['Synthetic evidence']},{id:'p2',title:'Synthetic open task',status:'building',to:'worker'}];
 await writeFile(plan,JSON.stringify({project:'Fixture',owner:'Tester',domain:'Acceptance',updated:'2026-10-06',items:rows}));await writeFile(state,JSON.stringify({state:'claimed',holder:{model:'fixture'}}));await writeFile(log,'Synthetic last report\n');
 const manifest=path.join(temp,'sources.json');await writeFile(manifest,JSON.stringify({announcements:ann,inbox,plans:[plan],tasks:[{id:'task-1',state,log}],issues}));
 // Run the legacy generator with only its two runtime roots rebound in a disposable copy. Never --post.
 const original=await readFile(fallback,'utf8');const oldScript=original.replace('W = os.path.expanduser("~/SISO_Workspace")',`W = ${JSON.stringify(workspace)}`).replace('HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))',`HERE = ${JSON.stringify(legacy)}`);
 assert.notEqual(oldScript,original);const oldCopy=path.join(temp,'legacy-board.py');await writeFile(oldCopy,oldScript);
 const publish=()=>JSON.parse(execFileSync('python3',[cli,'--manifest',manifest,'--output-root',root,'--publish'],{encoding:'utf8'}));
 const old=async()=>{execFileSync('python3',[oldCopy],{encoding:'utf8',env:{...process.env,A0_BOARD_INBOX:inbox}});return readFile(path.join(legacy,'.agents/a0/pages/board/page.html'),'utf8');};
 publish();const html=await old();const reader=createWidgetReader(root);let index=await reader.index('A0');check('all-producer-files-pass-node-schema',index.excluded===0&&index.widgets.length===7);
 let announcement=await reader.read('A0','announcements'),needs=await reader.read('A0','needs'),progress=await reader.read('A0','plans');
 check('same-announcement-ids-and-fields',announcement.data.items.length===announcements.length&&announcement.data.items.every(item=>html.includes(`data-ann="${item.id}"`)&&html.includes(item.title)&&html.includes(item.body)&&html.includes(item.at)&&html.includes(item.project)));
 check('same-needs-and-plan-counts',needs.data.items.length===1&&needs.data.items[0].id==='7'&&html.includes('1 open of 2 tasks')&&progress.data.total===2&&progress.data.checked===1);
 const detail=await reader.read('A0',index.widgets.find(v=>v.id.startsWith('plan-')).id);check('plan-evidence-and-original-request-retained',detail.data.rows.some(r=>r.quote==='Preserve all fields\nSynthetic evidence')&&html.includes('Preserve all fields')&&html.includes('Synthetic evidence'));
 const team=await reader.read('A0','team');check('historical-task-record-preserved-without-live-claim',team.shape==='list'&&team.data.liveness==='unknown'&&team.data.rows[0].quote==='Synthetic last report'&&html.includes('Synthetic last report'));
 const route=widgetActionsRoute(reader,async delivery=>{assert.equal(delivery.target.kind,'console');await writeFile(inbox,JSON.stringify(delivery.target.body)+'\n',{flag:'a'});});
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');if(!await dispatchRoute([route],req,res,url.pathname,url)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const action=async(kind,itemId,text)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/widgets/A0/announcements/actions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,itemId,text,revision:announcement.revision})});assert.equal(response.status,200);};
 await action('reply','8','Synthetic reply');await action('seen','7');publish();const after=await old();announcement=await reader.read('A0','announcements');needs=await reader.read('A0','needs');
 check('seen-roundtrip-reclassifies-both-views',needs.data.items.length===0&&announcement.data.items.find(v=>v.id==='7').seen&&after.includes('class="announcement seen" data-ann="7"')&&after.includes('1 unseen'));
 check('reply-preserves-item-and-does-not-mark-seen',!announcement.data.items.find(v=>v.id==='8').seen&&(await readFile(inbox,'utf8')).includes('announcement 8: Synthetic reply'));
 check('unchanged-regeneration-preserves-files',publish().changed===0);
 const receipt={at:new Date().toISOString(),passed:checks.length,checks,synthetic:true,legacyBindings:['W','HERE','A0_BOARD_INBOX'],livePublication:false,liveInbox:false,fallbackRetired:false};
 await writeFile(path.resolve(import.meta.dirname,'../../../.agents/scratchpads/landing-20261006/widget-producer-migration.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await new Promise(resolve=>server?server.close(resolve):resolve());await rm(temp,{recursive:true,force:true});}
