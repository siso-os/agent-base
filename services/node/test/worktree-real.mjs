/** Opt-in attended scratch-only proof. No launchd/herdr mutation and no real project checkout. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { webkit, suitePort } from './suite-runtime.mjs';
if(process.env.AB_REAL_WORKTREE!=='1')throw Error('Set AB_REAL_WORKTREE=1 for real gpt-6.1-sol scratch proof');
const root=path.resolve(import.meta.dirname,'../../..');
const scratch=realpathSync(mkdtempSync('/tmp/ab-worktree-real-'));
const out=process.argv[2];if(!out)throw Error('Explicit evidence directory required');mkdirSync(out,{recursive:true});
const repo=path.join(scratch,'scratch-repo'),remote=path.join(scratch,'remote.git'),hosts=path.join(scratch,'hosts'),receipts=path.join(scratch,'receipts');mkdirSync(repo);mkdirSync(hosts);
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git(scratch,['init','--bare',remote]);git(repo,['init','-b','dev']);git(repo,['config','user.name','Scratch fixture']);git(repo,['config','user.email','fixture@example.invalid']);
mkdirSync(path.join(repo,'.agents'));
writeFileSync(path.join(repo,'same.txt'),'base\n');writeFileSync(path.join(repo,'.gitignore'),'prepared.txt\n');
writeFileSync(path.join(repo,'.agents/workspace.json'),JSON.stringify({version:1,fetch:true,setup:[{id:'fixture',label:'Prepare fixture',argv:[process.execPath,'-e',"setTimeout(()=>require('fs').writeFileSync('prepared.txt','ready'),3000)"],timeoutMs:10000,required:true}]}));
git(repo,['add','.']);git(repo,['commit','-m','scratch base']);git(repo,['remote','add','origin',remote]);git(repo,['push','-u','origin','dev']);
const port=await suitePort(),webPort=await suitePort(),url=`http://127.0.0.1:${port}`,webUrl=`http://127.0.0.1:${webPort}`;
const fakeRow={agent:'claude',agent_status:'idle',cwd:repo,pane_id:'w1:p1',terminal_id:'term_fixturezero',terminal_title_stripped:'Agent Zero',agent_session:{value:'fixture-zero'}};
const seat=path.join(scratch,'seat.json');writeFileSync(seat,JSON.stringify({session:'fixture-zero',pane:'w1:p1'}));
const env={...process.env,AB_PORT:String(port),AB_WEB_PORT:String(webPort),AB_NODE:String(port),AB_WORKTREE_FIXTURE:'1',AB_FIXTURE_REPO:repo,AB_HOSTS_DIR:hosts,AB_WORKSPACES_DIR:receipts,AB_HERDR:`${process.execPath} ${path.join(root,'services/node/test/fake-herdr.mjs')}`,FAKE_HERDR_AGENTS:JSON.stringify([fakeRow]),AB_STATE:path.join(scratch,'rows.json'),AB_REGISTRY:path.join(scratch,'registry.json'),AB_A0_SEAT:seat,AB_RESURRECT_DIR:path.join(scratch,'none'),AB_CONSOLE_EVENTS:path.join(scratch,'none.jsonl'),AB_CTX_DIR:path.join(scratch,'ctx'),AB_PROMPT_QUEUE_DIR:path.join(scratch,'queues'),AB_CODEX_RUNS:path.join(scratch,'runs'),AB_ATTENTION_DIR:path.join(scratch,'attention'),AB_BROWSER_STATE:path.join(scratch,'browser.json'),AB_BROWSER_HISTORY:path.join(scratch,'history.json')};
const children=[],sockets=[];let browser;const lines=[];
const record=s=>{lines.push(s);console.log(s);};
const until=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('Scratch proof timed out');};
const api=async(route,body)=>{const response=await fetch(url+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {code:response.status,data:await response.json()};};
const status=async id=>(await api(`/api/workspaces/${id}`)).data;
const host=name=>JSON.parse(readFileSync(path.join(hosts,`name-${name}.json`),'utf8'));
const spawnNode=()=>{const child=spawn(process.execPath,['--experimental-strip-types','--no-warnings','src/server.ts'],{cwd:path.join(root,'services/node'),env,stdio:['ignore','ignore','pipe']});children.push(child);let stderr='';child.stderr.on('data',d=>stderr=(stderr+String(d)).slice(-3000));child.on('exit',code=>{if(code)console.error(`fixture node exit ${code}: ${stderr}`);});return child;};
const stop=async child=>{if(child.exitCode!==null)return;if(child===children[1]){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}else child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);};
try {
  const node=spawnNode();await until(()=>fetch(url+'/api/health').then(r=>r.ok,()=>false));
  const vite=spawn('pnpm',['--filter','@agent-base/web','dev','--host','127.0.0.1'],{cwd:root,env,stdio:'ignore',detached:true});children.push(vite);await until(()=>fetch(webUrl).then(r=>r.ok,()=>false));
  record(`DEV ${url}; UI ${webUrl}; scratch ${scratch}`);
  browser=await webkit.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(webUrl);await page.waitForSelector('[data-testid="zero-switch"]');await page.getByTestId('zero-switch').click();await page.getByTestId('new-codex-chat').click();
  await page.getByLabel('Codex chat name').fill('ProofAlpha');await page.getByLabel('Repository',{exact:true}).selectOption(repo);
  assert.equal(await page.getByLabel('Checkout mode').inputValue(),'isolated');
  await page.screenshot({path:path.join(out,'launch-1440x900.png')});
  await page.setViewportSize({width:390,height:844});
  await page.getByTestId('zero-switch').click();await page.getByTestId('new-codex-chat').click();
  await page.getByLabel('Codex chat name').fill('ProofAlpha');await page.getByLabel('Repository',{exact:true}).selectOption(repo);
  await page.screenshot({path:path.join(out,'launch-390x844.png')});await page.setViewportSize({width:1440,height:900});
  await page.getByTestId('zero-switch').click();await page.getByTestId('new-codex-chat').click();
  await page.getByLabel('Codex chat name').fill('ProofAlpha');await page.getByLabel('Repository',{exact:true}).selectOption(repo);
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/agents/start-codex') && r.request().method()==='POST'),page.getByRole('button',{name:'Start Codex chat',exact:true}).click()]);assert.equal(response.status(),202);const alpha=await response.json();
  await page.waitForSelector('[data-testid="worktree-setup"]');await page.screenshot({path:path.join(out,'preparing-1440x900.png')});
  await until(async()=> (await status(alpha.workspaceId)).phase==='active',60000);
  const a=JSON.parse(readFileSync(path.join(receipts,`${alpha.workspaceId}.json`),'utf8'));assert.equal(readFileSync(path.join(a.worktreePath,'prepared.txt'),'utf8'),'ready');assert.ok(a.stages.find(s=>s.id==='setup').endedAt<=host('ProofAlpha').startedAt);assert.equal(host('ProofAlpha').model,'gpt-6.1-sol');
  record(`PASS UI launch HTTP 202 -> active; setup finished before host; ${a.branch}`);
  // The exact same request twice must preserve workspace, host PID and session.
  const launchBody=JSON.parse(response.request().postData());const before=host('ProofAlpha');
  const repeat=await api('/api/agents/start-codex',launchBody);assert.equal(repeat.code,202);assert.equal(repeat.data.workspaceId,alpha.workspaceId);await new Promise(r=>setTimeout(r,500));assert.equal(host('ProofAlpha').pid,before.pid);assert.equal(host('ProofAlpha').session,before.session);
  const changed=await api('/api/agents/start-codex',{...launchBody,model:'different-model'});assert.equal(changed.code,409);record('PASS repeated launch: same workspace, PID and thread; changed model HTTP 409');
  const bravoBody={launchId:'proof-bravo-'+Date.now(),name:'ProofBravo',repo,model:'gpt-6.1-sol',workspace:{type:'isolated'}};
  const bravo=await api('/api/agents/start-codex',bravoBody);assert.equal(bravo.code,202);await until(async()=> (await status(bravo.data.workspaceId)).phase==='active',60000);
  const b=JSON.parse(readFileSync(path.join(receipts,`${bravo.data.workspaceId}.json`),'utf8'));assert.notEqual(a.worktreePath,b.worktreePath);assert.notEqual(a.branch,b.branch);assert.match(a.worktreePath,/SISO_Workspace\/_data\/worktrees\/scratch-repo\//);assert.equal(a.baseRef,'origin/dev');
  const turns=async(name,value)=> {
    const frames=[];const ws=new WebSocket(`${url.replace('http','ws')}/chat/service-${name}/ws`,{headers:{origin:url}});sockets.push(ws);ws.on('message',raw=>{frames.push(JSON.parse(String(raw)));});
    await until(()=>frames.some(f=>f.t==='hello'));ws.send(JSON.stringify({t:'prompt',text:`In this scratch repository only, write same.txt to contain exactly ${value} followed by a newline. Use a file editing tool. Do not modify any other file. Then reply DONE.`}));
    await until(()=>frames.some(f=>f.t==='result'),180000);
    const receipt=name==='ProofAlpha'?a:b;assert.equal(readFileSync(path.join(receipt.worktreePath,'same.txt'),'utf8'),value+'\n');ws.close();
  };
  await Promise.all([turns('ProofAlpha','alpha'),turns('ProofBravo','bravo')]);assert.equal(readFileSync(path.join(repo,'same.txt'),'utf8'),'base\n');
  record('PASS real gpt-6.1-sol chats concurrently edited same.txt: alpha / bravo; source remains base');
  const rows=(await api('/api/agents')).data.agents;assert.equal(rows.find(r=>r.name==='ProofAlpha').branch,a.branch);assert.equal(rows.find(r=>r.name==='ProofBravo').branch,b.branch);
  await page.getByTestId('worktree-setup').getByRole('button',{name:'Close'}).click();
  await page.locator('[data-testid="rail-row"]').filter({hasText:'ProofAlpha'}).first().click();await page.locator('.ab-cap').click({button:'right',position:{x:200,y:20}});await page.waitForSelector('[data-testid="chat-head-branch"]');assert.equal((await page.getByTestId('chat-head-branch').textContent()).replace(/^ · /,''),a.branch);
  await page.screenshot({path:path.join(out,'active-1440x900.png')});await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'active-390x844.png')});
  assert.deepEqual(errors,[]);record('PASS branch in API row and rendered chat head; screenshots 1440x900 + 390x844; zero page errors');
  // Stop fixture hosts so dirty refusal is evaluated, then observe the actual archive response.
  for(const name of ['ProofAlpha','ProofBravo']) {process.kill(host(name).pid,'SIGTERM');}
  await until(()=>['ProofAlpha','ProofBravo'].every(name=>{try{process.kill(host(name).pid,0);return false;}catch{return true;}}));
  // Recent-down classification conservatively refuses archive; wait until it reports actual down.
  await new Promise(r=>setTimeout(r,31000));
  const archived=await api(`/api/workspaces/${a.workspaceId}/archive`,{});assert.equal(archived.code,409);assert.match(archived.data.error,/dirty/);assert.ok(existsSync(a.worktreePath));record(`PASS archive HTTP 409: ${archived.data.error}`);
  const rereg=git(repo,['worktree','list','--porcelain']);assert.ok(rereg.includes(a.worktreePath));assert.ok(rereg.includes(b.worktreePath));
  record(`WORKTREE A ${a.worktreePath}\nWORKTREE B ${b.worktreePath}`);
  record('LIMIT: no merge, queue, deployment, launchd mutation or trusted_hash changes; dirty scratch worktrees retained.');
} finally {
  for(const ws of sockets)ws.close();if(browser)await browser.close();
  for(const child of [...children].reverse())await stop(child);
  // Stop only host PIDs evidenced in this fixture directory, even if proof throws.
  for(const name of ['ProofAlpha','ProofBravo']) {try {const h=host(name);if(h.cwd?.startsWith(path.join(process.env.HOME,'SISO_Workspace/_data/worktrees/scratch-repo/')))process.kill(h.pid,'SIGTERM');}catch{}}
  lines.push('CLEANUP: fixture browser and started node/Vite/hosts stopped.');writeFileSync(path.join(out,'VERIFY.txt'),lines.join('\n')+'\n');
}
