// Real app + isolated node/SDK fixture. Never connects to a live pane.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,utimesSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {seedSpace} from './space-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'services/node/package.json'));
const {webkit}=require('playwright'), {WebSocketServer}=require('ws');
const phase=process.argv[2]??'after';
const out=process.env.COMPOSER_SHOTS??path.join(process.env.HOME,'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/jobs/ab-composer-mock');
mkdirSync(out,{recursive:true});
const scratch=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-composer.'));
const session='00000000-0000-4000-8000-0000000000a0';
for(const d of ['claude/projects/fixture','hosts','runs','ctx']) mkdirSync(path.join(scratch,d),{recursive:true});
const subdir=path.join(scratch,'claude/projects/fixture',session,'subagents'); mkdirSync(subdir,{recursive:true});
const stamp=new Date().toISOString();
writeFileSync(path.join(scratch,'claude/projects/fixture',session+'.jsonl'),JSON.stringify({type:'user',uuid:'fixture',timestamp:stamp,message:{role:'user',content:'Review the composer'}})+'\n'+JSON.stringify({type:'assistant',timestamp:stamp,message:{id:'fixture-call',role:'assistant',model:'claude-opus-5-5[1m]',usage:{input_tokens:24000,output_tokens:3200},content:[{type:'tool_use',id:'claude-worker',name:'Agent',input:{description:'Review composer',prompt:'Check the composer',subagent_type:'reviewer'}}]}})+'\n');
writeFileSync(path.join(subdir,'agent-fixture.meta.json'),JSON.stringify({name:'CLAUDE-REVIEW',model:'Sonnet 5.5',toolUseId:'claude-worker',agentType:'reviewer',description:'Checking the composer'}));
writeFileSync(path.join(scratch,'seat.json'),JSON.stringify({name:'A0',pane:'w1:p1',session}));
writeFileSync(path.join(scratch,'ctx',session+'.json'),JSON.stringify({profile:path.join(scratch,'claude'),used_percentage:28,model:{display_name:'Opus 5.5 1M'},total_input_tokens:24000,total_output_tokens:3200,current_usage:{input_tokens:2000,cache_read_input_tokens:22000},cost:{total_cost_usd:1.84},rate_limits:{five_hour:{used_percentage:0,resets_at:Math.round(Date.now()/1000)+4*3600+41*60},seven_day:{used_percentage:87,resets_at:Math.round(Date.now()/1000)+49*3600}},at:Date.now()-2*60000}));
const host=http.createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({pid:process.pid,name:"A0",session}));});await new Promise(r=>host.listen(0,'127.0.0.1',r));
const wss=new WebSocketServer({server:host});let working=false;
let spaceFixture=null;
const hello=()=>({t:'hello',session,name:'Agent Zero',state:working?'working':'idle',log:[{t:'init',session,model:'claude-opus-5-5[1m]',name:'Agent Zero',cwd:scratch},...(spaceFixture?.steps??[])],partial:{},tasks:[],bg:working?[{id:'shell-1',kind:'shell',description:'Checking build output'}]:[]});
let pickedModel='claude-opus-5-5[1m]',hostCtx=null;
const writeHost=()=>writeFileSync(path.join(scratch,'hosts/fixture.json'),JSON.stringify({pid:process.pid,port:host.address().port,token:'fixture',session,pane:'w1:p1',name:'A0',cwd:scratch,model:pickedModel,state:working?'working':'idle',child:'running',...(hostCtx?{ctx:{pct:hostCtx,at:Date.now()}}:{})}));
wss.on('connection',ws=>{ws.send(JSON.stringify(hello()));ws.on('message',raw=>{const msg=JSON.parse(String(raw));if(msg.t==='set_model'){pickedModel=msg.model;writeHost();for(const client of wss.clients)client.send(JSON.stringify({t:'init',session,model:pickedModel,name:'Agent Zero',cwd:scratch}));}});});writeHost();
if(process.env.COMPOSER_SPACE)spaceFixture=seedSpace({scratch,root,session,hostPort:host.address().port,pid:process.pid});
const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=process.env.COMPOSER_PORT?Number(process.env.COMPOSER_PORT):process.env.COMPOSER_SERVE?5499:reserve.address().port;await new Promise(r=>reserve.close(r));
// Before renders dev's built app and dev's node readers, even while mock sources are edited.
let serverSource = path.join(root,'services/node/src/server.ts');
if(phase==='before'){
 const nodeRequire=createRequire(path.join(root,'services/node/package.json'));
 const snapshot=(name)=>{
  let src=execFileSync('git',['show',`origin/dev:services/node/src/${name}.ts`],{cwd:root,encoding:'utf8'});
  src=src.replace(/from (["'])([^"']+)\1/g,(all,q,id)=>{
   if(id.startsWith('node:'))return all;
   const target=id==='./subagents.ts'?path.join(scratch,'subagents.ts'):id.startsWith('.')?path.resolve(root,'services/node/src',id):id==='ws'?path.join(path.dirname(nodeRequire.resolve(id)),'wrapper.mjs'):nodeRequire.resolve(id);
   return `from ${q}${target}${q}`;
  }).replaceAll('import.meta.dirname',JSON.stringify(path.join(root,'services/node/src')));
  const dest=path.join(scratch,`${name}.ts`);writeFileSync(dest,src);return dest;
 };
 snapshot('subagents');serverSource=snapshot('server');
}
const child=spawn(process.execPath,['--experimental-strip-types','--no-warnings',serverSource],{cwd:path.join(root,'services/node'),stdio:['ignore','ignore','pipe'],env:{...process.env,...(spaceFixture?.env??{}),HOME:scratch,AB_HUB_HOME:scratch,AB_PORT:String(port),AB_HERDR:`${process.execPath} ${root}/services/node/test/fake-herdr.mjs`,FAKE_HERDR_AGENTS:JSON.stringify(spaceFixture?.agents??[{agent:'siso',agent_status:'idle',cwd:scratch,pane_id:'w1:p1',terminal_id:'fixture',terminal_title_stripped:'A0',agent_session:{value:session}}]),AB_CLAUDE_DIRS:path.join(scratch,'claude'),AB_CTX_DIR:path.join(scratch,'ctx'),AB_A0_SEAT:path.join(scratch,'seat.json'),AB_HOSTS_DIR:path.join(scratch,'hosts'),AB_CODEX_RUNS:path.join(scratch,'runs'),AB_STATE:path.join(scratch,'rows.json'),AB_REGISTRY:path.join(scratch,'registry.json'),AB_RESURRECT_DIR:path.join(scratch,'none'),AB_CONSOLE_EVENTS:path.join(scratch,'none.jsonl')}});
let serverError="";child.stderr.on("data",b=>serverError+=String(b));
let streamed=0,finished2=false;
const liveStream=setInterval(()=>{if(!working)return;streamed+=40;for(let i=1;i<=3;i++)if(!(finished2&&i===2))writeFileSync(path.join(scratch,`runs/worker-${i}.jsonl`),JSON.stringify({type:'item.updated',item:{id:'live',type:'agent_message',text:'Reading composer source. '+'.'.repeat(streamed)}})+'\n');},500);
let browser;const failures=[],captures=[];
try{
 let ready=false;for(let i=0;i<150;i++){if(await fetch(`http://127.0.0.1:${port}/api/health`).then(r=>r.ok,()=>false)){ready=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,`fixture boot: ${serverError.slice(-1400)}`);
 await fetch(`http://127.0.0.1:${port}/api/agents`);
 // COMPOSER_SERVE=working|idle: keep the fixture app up for Shaan to look at (http://127.0.0.1:5499), no browser, until stopped.
 if(process.env.COMPOSER_SERVE){child.on('exit',code=>{console.log('fixture node exited',code,serverError.slice(-1500));process.exit(1);});working=process.env.COMPOSER_SERVE==='working';writeHost();console.log(`fixture app: http://127.0.0.1:${port}  (${process.env.COMPOSER_SERVE})`);await new Promise(()=>{});}
 browser=await webkit.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(25000);
 const navButton=page.getByRole('button',{name:'Show or hide the side nav',exact:true});
 const ensureNav=async nav=>{const wanted=nav==='open';if((await navButton.getAttribute('aria-pressed')==='true')!==wanted)await navButton.click();};
 const errors=globalThis.__errs=[];page.on('pageerror',e=>errors.push(e.message+' @ '+(e.stack||'').split('\n').slice(0,3).join(' | ')));
 for(const [width,height] of phase==='taste'?[[1440,900]]:[[1440,900],[1024,768],[390,844]])for(const nav of phase==='taste'||width===390?['closed']:['open','closed']){
  if(phase==='after-r4'&&(width===390||(width===1024&&nav==='closed')))continue;
  for(let i=1;i<=3;i++)writeFileSync(path.join(scratch,`runs/worker-${i}.meta.json`),JSON.stringify({pid:2147483647,name:`CODEX-${i}`,model:'gpt-6.1-sol',parent_session:session,batch:'Composer research',started:Date.now()-120000}));
  writeFileSync(path.join(subdir,'agent-fixture.jsonl'),JSON.stringify({type:'assistant',timestamp:stamp,message:{content:[{type:'text',text:'Done'}]}})+'\n');utimesSync(path.join(subdir,'agent-fixture.jsonl'),new Date(Date.now()-120000),new Date(Date.now()-120000));
  working=false;writeHost();for(const ws of wss.clients)ws.send(JSON.stringify(hello()));
  await page.setViewportSize({width,height});
  await page.addInitScript(open=>{localStorage.setItem('agent-base:sidebar-open',String(open));localStorage.setItem('agent-base:panel.open.zero','false');},true);
  await page.goto(`http://127.0.0.1:${port}`);await page.waitForFunction(() => document.querySelector('[data-testid=rail-row][aria-label^="Agent Zero"]') || document.querySelector('textarea[aria-label="Message"]'),null,{timeout:60000}) /* the node's cold /api/usage scan holds its first answers ~12 s; under load longer */.catch(async e=>{console.log({width,nav,api:await fetch(`http://127.0.0.1:${port}/api/agents`).then(r=>r.text()),body:(await page.locator('body').innerText()).slice(-1800),errors});throw e;});
  if(await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().isVisible())await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  await ensureNav(nav);
  if(phase==='after-ui' && width===1440 && nav==='open'){
   // Regression: standing workers belong to the scrolling middle, never the fixed header.
   for(let i=1;i<=30;i++)writeFileSync(path.join(scratch,`runs/nav-${i}.meta.json`),JSON.stringify({worker:`NAV-${i}`,name:`NAV-${i}`,pid:2147483647,started:Date.now()}));
   // Dev's nav (7360e03) folds souls into Agent Zero's fold, so they may not add rows; give them a moment, then check the scroll contract.
   await page.waitForTimeout(6000);
   const navGeometry=await page.evaluate(()=>{
    const body=document.querySelector('.siso-sidenav__body'),header=document.querySelector('.siso-sidenav__header'),footer=document.querySelector('.siso-health');
    const top=header.getBoundingClientRect().top,bottom=footer?.getBoundingClientRect().bottom;
    const chain=[];for(let el=body;el && !el.classList.contains('siso-app');el=el.parentElement)chain.push({name:el.className,minHeight:getComputedStyle(el).minHeight});
    body.scrollTop=300;
    return {overflow:getComputedStyle(body).overflowY,client:body.clientHeight,height:body.scrollHeight,scrollTop:body.scrollTop,chain,headerFixed:header.getBoundingClientRect().top===top,footerFixed:footer?.getBoundingClientRect().bottom===bottom};
   });
   assert.equal(navGeometry.overflow,'auto');if(navGeometry.height>navGeometry.client)assert.ok(navGeometry.scrollTop>0,'the nav middle scrolls');
   assert.ok(navGeometry.chain.every(el=>el.minHeight==='0px'));assert.ok(navGeometry.headerFixed && navGeometry.footerFixed);
   for(let i=1;i<=30;i++)writeFileSync(path.join(scratch,`runs/nav-${i}.meta.json`),'{}');
   await page.waitForFunction(()=>document.querySelectorAll('.siso-sidenav__body [data-testid=codex-worker-row]').length<30);
   const geometry=()=>page.evaluate(()=>{const rim=document.querySelector('[data-testid=halo-rim]'),ancestors=[];for(let el=rim.parentElement;el;el=el.parentElement)ancestors.push({name:el.className||el.tagName,scrollTop:el.scrollTop});return {document:document.scrollingElement.scrollTop,bottom:rim.getBoundingClientRect().bottom,ancestors};});
   const before=await geometry();
   const buffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=','base64');
   await page.locator('input[type=file]').setInputFiles([{name:'one.png',mimeType:'image/png',buffer},{name:'two.png',mimeType:'image/png',buffer}]);
   await page.waitForFunction(()=>document.querySelectorAll('button[aria-label="Remove image"]').length===2);
   const after=await geometry();
   assert.equal(after.document,0);assert.ok(after.ancestors.every(el=>el.scrollTop===0));assert.ok(Math.abs(after.bottom-before.bottom)<=20);
   // An overflowing descendant must not let focus/scrollIntoView scroll the frame.
   const forced=await page.evaluate(()=>{const frame=document.querySelector('.siso-app__frame'),header=document.querySelector('.siso-headstack'),extra=document.createElement('div');extra.style.height='1200px';header.append(extra);frame.scrollTop=290;const top=frame.scrollTop;extra.remove();return top;});
   assert.equal(forced,0);
   while(await page.getByRole('button',{name:'Remove image',exact:true}).count())await page.getByRole('button',{name:'Remove image',exact:true}).first().click();
   console.log('LAYOUT',JSON.stringify({nav:navGeometry,images:{before:before.bottom,after:after.bottom,document:after.document,ancestorScrollTops:after.ancestors.map(el=>el.scrollTop)},forcedFrameScrollTop:forced}));
  }
  const shot=async state=>{if(phase==='after-r4'&&state!=='working')return;await page.mouse.move(width-5,height/2);await page.waitForTimeout(150);const f=`${width}x${height}-${nav}-${state}-${phase}.png`;try{await page.screenshot({path:path.join(out,f),animations:'disabled'});captures.push(f);}catch(e){failures.push(`${f}: ${e.message}`);}};
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('');await page.getByRole('textbox',{name:'Message',exact:true}).blur();await page.mouse.move(width-5,height/2);await page.waitForTimeout(300);if(phase!=='before')assert.equal(await page.locator('[data-testid=faces-pill]').getAttribute('data-running'),'0');await shot('idle');
  if(phase==='after-r3'||phase==='after-r4'||phase==='after-ui'){
   const composerWidth=await page.locator('[data-testid=halo-rim]').evaluate(el=>el.getBoundingClientRect().width);
   if(phase==='after-ui'){// Reading width (4 Oct, "it's too wide"): bar and messages share 940 px, and the bar ends left of Agent Zero's face.
    const g=await page.evaluate(()=>{const r=document.querySelector('[data-testid=halo-rim]').getBoundingClientRect(),c=document.querySelector('.siso-chat__col').getBoundingClientRect(),f=document.querySelector('.siso-zero-face')?.getBoundingClientRect();return{rw:r.width,rl:r.left,rr:r.right,cw:c.width,cl:c.left,fl:f&&f.width?f.left:null,fr:f?f.right:null,ft:f?f.top:null,rb:r.bottom};});
    console.log('WIDTH',width,nav,JSON.stringify(g));
    assert.ok(g.rw<=893,`bar at most 892 px wide (${g.rw})`);assert.ok(g.cw<=941,`messages at most 940 px (${g.cw})`);
    if(g.rw>=883)assert.ok(await page.locator('.ab-hud.is-rim .ab-hud__inline').isVisible(),'tokens and cost stay inline at full reading width');
    if(g.fl!==null&&g.ft<g.rb)assert.ok(g.rr<=g.fl||g.rl>=g.fr,`bar clear of Agent Zero's face (${g.rl}-${g.rr} vs ${g.fl}-${g.fr})`);}
   assert.ok(await page.locator('.ab-hud.is-rim .ab-hud__ctx b').isVisible(),'context percentage stays visible');
   assert.equal(await page.locator('.ab-hud.is-rim .ab-hud__usage').isVisible(),composerWidth-23>=520,'usage follows composer width (kept down to 520 px inside, 4 Oct)');
   assert.equal(await page.locator('.ab-model__full').isVisible(),composerWidth>=640,'full model name at medium and wide widths');
   assert.match(await page.locator('.ab-hud__usage summary').innerText(),phase!=='after-r3'?/5h 0%\s*·\s*wk 87%/:/wk 87%/);
   if(phase!=='after-r3'){
    assert.equal(await page.locator('.ab-hud__usage summary .text-done').innerText(),'5h 0%');
    assert.equal(await page.locator('.ab-hud__usage summary .text-failed').innerText(),'wk 87%');
   }
   const detail=page.locator(composerWidth-23>=520?'.ab-hud__usage':'.ab-hud__context');
   await detail.locator('summary').focus();await page.keyboard.press('Enter');
   const card=detail.locator('.ab-hud__card');assert.ok(await card.isVisible(),'usage card opens on tap');
   for(const text of phase==='after-ui'?['5 hours','Week','resets','cache','Today','full ~']:['5h 0%','wk 87%','resets in','cache','Today'])assert.ok((await card.innerText()).includes(text),`usage card contains ${text}`);
   if(phase==='after-ui'){await page.evaluate(()=>document.activeElement?.blur());await shot('card');}
   await detail.evaluate(el=>el.open=false);await page.mouse.move(width-5,height/2);
  }

  if(phase.startsWith('after')&&width===1440&&nav==='closed'){
   await page.locator('.ab-hud__context summary').hover();assert.ok(await page.locator('.ab-hud__context .ab-hud__card').isVisible(),'context hover card');await page.getByRole('textbox',{name:'Message',exact:true}).blur();await page.mouse.move(width-5,height/2);
   const orb=page.getByRole('button',{name:'Talk',exact:true});await orb.dispatchEvent('contextmenu');
   const menu=page.getByRole('menu',{name:'Voice options'});await menu.waitFor();await menu.getByRole('button',{name:'Read replies aloud',exact:true}).click();assert.equal(await page.locator('.siso-orb__speak-dot').count(),1);
   await menu.getByRole('button',{name:'Stop reading replies aloud',exact:true}).click();await page.keyboard.press('Escape');
   await orb.dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',button:0});await page.waitForTimeout(550);await orb.dispatchEvent('pointerup',{pointerId:7,pointerType:'touch',button:0});await menu.waitFor();assert.equal(await page.locator('.siso-mic.is-chat').getAttribute('data-phase'),'idle');await page.keyboard.press('Escape');
  }
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep the rim. Make room for the work.');await page.waitForTimeout(300);await shot('typing');
  if(phase!=='before'){
   const box=page.getByRole('textbox',{name:'Message',exact:true});await box.fill('A long draft\n'.repeat(10));if(phase==='after-ui')await shot('long');
   assert.ok(await box.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=52),'two-line input scrolls');await box.fill('');
   assert.equal(await page.getByRole('button',{name:'Send',exact:true}).count(),0);
  }
  // Screenshot taste lock: the real rendered ring and glow, at a fixed size and animation time.
  if(width===1440&&nav==='closed')for(const state of ['idle','typing']){
   const box=page.getByRole('textbox',{name:'Message',exact:true});await box.fill(state==='typing'?'Typing':'');if(state==='idle')await box.blur();else await box.focus();
   const rim=page.locator('[data-testid=halo-rim]');
   await rim.evaluate(el=>{el.style.width='800px';el.style.height='110px';el.style.boxSizing='border-box';for(const c of el.children)c.style.visibility='hidden';for(const a of el.getAnimations({subtree:true})){a.pause();a.currentTime=0;}});
   const pixels=await rim.screenshot({animations:'allow'});const baseline=path.join(root,'tools/test',`composer-rim-${state}.png`);
   if(phase==='before')writeFileSync(baseline,pixels);else assert.deepEqual(pixels,readFileSync(baseline),`taste lock ${state}`);
   await page.reload();await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();await ensureNav(nav);
  }
  if(phase==='taste')continue;
  for(let i=1;i<=3;i++){writeFileSync(path.join(scratch,`runs/worker-${i}.meta.json`),JSON.stringify({pid:process.pid,name:`CODEX-${i}`,worker:`CODEX-${i}`,model:'gpt-6.1-sol',parent_session:session,batch:'Composer research',started:Date.now()-120000}));writeFileSync(path.join(scratch,`runs/worker-${i}.jsonl`),JSON.stringify({type:'item.started',item:{id:'step',type:'command_execution',command:'Reading composer source'}})+'\n');}
  writeFileSync(path.join(subdir,'agent-fixture.jsonl'),JSON.stringify({type:'user',timestamp:stamp,message:{role:'user',content:'Check the composer'}})+'\n');
  working=true;writeHost();for(const ws of wss.clients)ws.send(JSON.stringify(hello()));
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('');await page.reload();await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();await ensureNav(nav);await page.waitForTimeout(phase.startsWith('after')?3500:800);
  if(phase!=='before'){
   await page.waitForFunction(()=>document.querySelector('[data-testid=faces-pill]')?.getAttribute('data-running')==='5').catch(async e=>{console.log('PILL',width,nav,await page.evaluate(()=>{const h=document.querySelectorAll('[data-testid=hud]');return h.length+' huds; '+[...h].map(x=>x.textContent.slice(0,200)).join(' || ')+' ; textarea='+!!document.querySelector('textarea[aria-label=Message]')+' ; body='+document.body.innerText.slice(-300).replace(/\n/g,' / ')}),await page.locator('[data-testid=faces-pill]').evaluate(el=>el.getAttribute('data-running')+' '+el.textContent,null,{timeout:2000}).catch(x=>'none'),JSON.stringify(errors.slice(-3)));throw e;});
   const api=await fetch(`http://127.0.0.1:${port}/api/agents/fixture/subagents`).then(r=>r.json());assert.equal(api.rows.filter(r=>r.batchId).length,3);
   assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1);
   const box=page.getByRole('textbox',{name:'Message',exact:true});await box.fill('Queue this');assert.equal(await page.getByRole('button',{name:'Send',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),0);await box.fill('');
  }
  await shot('working');
  if(phase!=='after-r4'&&((width===1440&&nav==='closed')||width===390)){
   try{await page.locator('[data-testid=faces-pill]').focus();await page.keyboard.press('Enter');await page.locator('[data-testid=subagents-panel]').waitFor();await shot('popup');await page.keyboard.press('Escape');}catch(e){failures.push(`${width}x${height}-${nav}-popup-${phase}: ${e.message}`);}
   try{const chip=page.locator('[data-testid=model-chip]');if(await chip.isDisabled()){failures.push(`${width}x${height}-${nav}-model-picker-${phase}: dev picker is disabled by the seat`);await chip.hover();}else await chip.click();await shot('model-picker');
   if(phase.startsWith('after')&&width===390){await page.getByRole('menuitemradio',{name:'Sonnet 5.5'}).click();await page.waitForFunction(()=>document.querySelector('[data-testid=model-chip]')?.textContent?.includes('Sonnet 5.5'));assert.equal(pickedModel,'claude-sonnet-5-5');}
   await page.keyboard.press('Escape');}catch(e){failures.push(`${width}x${height}-${nav}-model-picker-${phase}: ${e.message}`);}
  }
  if(phase==='after-ui'&&width===1440&&nav==='closed'){
   // v2 routes (4 Oct): context mix, talk to a busy worker, @ an unknown name.
   const post=(u,b)=>fetch(`http://127.0.0.1:${port}${u}`,{method:'POST',headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(async r=>({status:r.status,body:await r.json()}));
   const mixR=await fetch(`http://127.0.0.1:${port}/api/agents/fixture/context`).then(r=>r.json());assert.ok(mixR.kinds&&mixR.kinds.talk>0,'context mix counts the conversation');assert.ok(mixR.turns?.length>=1,'context mix lists his turns for forking');
   const busy=await post('/api/agents/fixture/subagents/run:worker-1/talk');assert.equal(busy.status,409,JSON.stringify(busy));assert.match(busy.body.error,/still working/);
   const nobody=await post('/api/agents/say',{parent:'fixture',name:'NOBODY',text:'hi'});assert.equal(nobody.status,404,JSON.stringify(nobody));
   // Picks 1 and 2 (4 Oct): a worker finishing pops out of the pill; a hot ctx ring offers Compact.
   for(let i=1;i<=3;i++)writeFileSync(path.join(scratch,`runs/worker-${i}.meta.json`),JSON.stringify({pid:i===2?2147483647:process.pid,name:`CODEX-${i}`,worker:`CODEX-${i}`,model:'gpt-6.1-sol',parent_session:session,batch:'Composer research',started:Date.now()-120000}));
   finished2=true;writeFileSync(path.join(scratch,'runs/worker-2.last.md'),'Composer read.\nSTATUS: done\n');writeFileSync(path.join(scratch,'runs/worker-2.jsonl'),JSON.stringify({type:'item.completed',item:{id:'end',type:'agent_message',text:'Composer read.\nSTATUS: done'}})+'\n');
   await page.locator('[data-testid=finish-pop]').waitFor({timeout:40000});await page.waitForTimeout(500);await shot('finish');rmSync(path.join(scratch,'runs/worker-2.last.md'),{force:true});
   finished2=false;hostCtx=84;working=false;writeHost();await page.reload();await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();await ensureNav(nav);
   await page.waitForFunction(()=>document.querySelector('.ab-hud__ctx.is-hot'));await page.waitForTimeout(400);await shot('hot');
   await page.locator('.ab-hud__context summary').focus();await page.keyboard.press('Enter');await page.locator('[data-testid=hud-compact]').waitFor();await page.evaluate(()=>document.activeElement?.blur());await shot('compact');
   await page.locator('.ab-hud__context').evaluate(el=>el.open=false);hostCtx=null;writeHost();
  }
 }
 if(phase==='after-r3'){
  const ctxFile=path.join(scratch,'ctx',session+'.json');const ctx=JSON.parse(readFileSync(ctxFile,'utf8'));
  ctx.rate_limits.five_hour.used_percentage=92;writeFileSync(ctxFile,JSON.stringify(ctx));
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();await ensureNav('closed');
  await page.waitForFunction(()=>document.querySelector('.ab-hud__usage summary')?.textContent?.includes('5h 92%'));
  console.log('Round 3: model/usage/context tiers, hover/tap card and tighter 5h limit passed');
 }
 const warnings=errors.filter(e=>e.includes('ResizeObserver loop'));
 assert.equal(errors.length-warnings.length,0,errors.join('; '));
 writeFileSync(path.join(out,`receipt-${phase}.json`),JSON.stringify({captures,failures,warnings,skipped:['390x844-open: drawer covers composer'],fixture:scratch},null,2));console.log(JSON.stringify({phase,captures:captures.length,failures,fixture:scratch}));
}catch(e){console.log('PAGE ERRORS',JSON.stringify((globalThis.__errs||[]).slice(-4)));throw e;}finally{clearInterval(liveStream);await browser?.close();child.kill('SIGTERM');for(const ws of wss.clients)ws.close();wss.close();host.close();}
