import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { suitePort } from '../../services/node/test/suite-runtime.mjs';
const dir=import.meta.dirname, root=path.resolve(dir,'../..');
const herdr=execFileSync('which',['herdr'],{encoding:'utf8'}).trim();
const run=(...args)=>JSON.parse(execFileSync(herdr,args,{encoding:'utf8'}));
const scratch=path.join(dir,'scratch');mkdirSync(scratch,{recursive:true});mkdirSync(path.join(dir,'hosts'),{recursive:true});
const created=run('workspace','create','--cwd',scratch,'--label','ab-zero-move CODEX TEST ONLY','--no-focus');
writeFileSync(path.join(dir,'created.json'),JSON.stringify(created,null,2));
const r=created.result, workspace=r.workspace.workspace_id, pane=r.root_pane.pane_id, tab=r.tab.tab_id;
assert.ok(pane&&workspace&&tab);assert.ok(!['w7:p37','w7:p3Z'].includes(pane));
writeFileSync(path.join(dir,'guard.json'),JSON.stringify({herdr,workspace,panes:[pane],tabs:[tab]}));
const guard=path.join(dir,'guard-herdr.mjs');
const owned=(...args)=>JSON.parse(execFileSync(guard,args,{encoding:'utf8'}));
const prompt='You are a disposable migration test, never the real Agent Zero. Do no project work and do not launch workers or type into other panes. Reply READY in one line and then stop. After agent-move, read the passport and referenced boot files, reply in one line moved: disposable test ready, then stop and await input. Never operate on the real Agent Zero or Agent Base.';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
if(!owned('agent','list').result.agents.some(a=>a.pane_id===pane)) owned('pane','run',pane,`env SISO_A0=1 codex -m gpt-6-luna -c model_reasoning_effort=high ${quote(prompt)}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=240000)=>{const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await sleep(1500);}throw Error('test wait timed out');};
const old=await until(()=>owned('agent','list').result.agents.find(a=>a.pane_id===pane&&a.agent_session?.value&&['idle','done'].includes(a.agent_status)));
writeFileSync(path.join(dir,'seat.json'),JSON.stringify({pane,session:old.agent_session.value,login_launcher:'codex',claude_login_launcher:'claude',name:'A0 test'}));
writeFileSync(path.join(dir,'seat-before.json'),readFileSync(path.join(dir,'seat.json')));
const port=await suitePort(),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['--experimental-strip-types','--no-warnings','src/server.ts'],{cwd:path.join(root,'services/node'),stdio:'ignore',env:{...process.env,AB_PORT:String(port),AB_HERDR:guard,HERDR_BIN:guard,AB_A0_SEAT:path.join(dir,'seat.json'),AGENT_MOVE_STATE:path.join(dir,'passports'),AB_HOSTS_DIR:path.join(dir,'hosts'),AB_STATE:path.join(dir,'rows.json'),AB_REGISTRY:path.join(dir,'registry.json'),AB_HUB_HOME:scratch,AB_RESURRECT_DIR:path.join(dir,'none'),AB_CONSOLE_EVENTS:path.join(dir,'none.jsonl'),AB_AGENTS_MS:'500',AGENT_MOVE_POLL:'1',AGENT_MOVE_TIMEOUT:'240'}});
try{
  await until(()=>fetch(url+'/api/health').then(r=>r.ok,()=>false),30000);
  for(const to of ['sol','luna']){
    const response=await fetch(url+'/api/agents/Agent%20Zero/move',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to,effort:'high'})});
    const result=await response.json();writeFileSync(path.join(dir,`move-${to}.json`),JSON.stringify({http:response.status,...result},null,2));
    assert.equal(response.status,200);assert.equal(result.state,'done',JSON.stringify(result));
    assert.equal(result.result.kind,'passport');assert.equal(result.result.fallback,'resume-locked');assert.notEqual(result.result.to.session,old.agent_session.value);
    assert.ok(result.stages.includes('Resume locked; starting a fresh agent with its passport'));
    assert.match(readFileSync(result.result.passport,'utf8'),/Boot first/);
    assert.ok(result.stages.includes('Old tab closed'));
    assert.ok(owned('agent','list').result.agents.some(a=>a.pane_id===result.result.to.pane&&a.name==='agent-zero')); 
    writeFileSync(path.join(dir,`seat-${to}.json`),readFileSync(path.join(dir,'seat.json')));
    const row=await until(async()=>{const rows=(await(await fetch(url+'/api/agents')).json()).agents;return rows.find(a=>a.zero&&a.session===result.result.to.session);},15000);
    assert.equal(row.name,'Agent Zero');writeFileSync(path.join(dir,`row-${to}.json`),JSON.stringify({id:row.id,name:row.name,zero:row.zero,tool:row.tool,session:row.session,pane:result.result.to.pane},null,2));
    console.log(`PASS HTTP ${response.status}: ${to}, row=${row.name}, seat=${result.result.to.pane}, passport=${result.result.passport}`);
  }
  console.log('PASS guarded Luna -> Sol -> Luna passport fallback after resume lock, real endpoint; no protected panes addressed');
}finally{server.kill('SIGTERM');}
