import { createServer } from '../../../apps/web/node_modules/vite/dist/node/index.js';
import react from '../../../apps/web/node_modules/@vitejs/plugin-react/dist/index.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { remoteInventoryFixture } from './remote-inventory-fixture.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),out=path.join(root,'.agents/scratchpads/landing-20261006');
const owner={userId:'remote-inventory-coverage-ui',sessionKey:`synthetic-${Date.now()}`};
let scenario='live-shape',tab=null,requests=0,browserClosed=false,serverClosed=false;
const checks=[],screenshots=[],unexpected=[];
const vite=await createServer({configFile:false,root:path.join(root,'apps/web'),cacheDir:path.join(out,'node_modules/.vite-remote-coverage'),optimizeDeps:{entries:['preview/remote-inventory.html']},plugins:[react(),{name:'remote-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(req.url?.startsWith('/api/')){requests++;if(req.url!=='/api/remote/agents'||req.method!=='GET')unexpected.push(`${req.method} ${req.url}`);assert.equal(req.url,'/api/remote/agents');assert.equal(req.method,'GET');res.writeHead(scenario==='failure'?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(scenario==='failure'?{error:'Synthetic outage'}:remoteInventoryFixture(scenario)));return;}next();
});}}],resolve:{alias:{react:path.join(root,'apps/web/node_modules/react'),'react-dom':path.join(root,'apps/web/node_modules/react-dom'),'lucide-react':path.join(root,'apps/web/node_modules/lucide-react')},dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,fs:{allow:[root]}}});
const api=async(p,method='GET',data)=>{const suffix=method==='GET'||method==='DELETE'?`?${new URLSearchParams(owner)}`:'';const r=await fetch(`http://127.0.0.1:9377${p}${suffix}`,{method,headers:data?{'content-type':'application/json'}:undefined,body:data?JSON.stringify({...owner,...data}):undefined});if(!r.ok)throw Error(`Camofox ${r.status}: ${(await r.text()).slice(0,300)}`);return r.json();};
const evaluate=async(expression)=>{const r=await api(`/tabs/${tab}/evaluate`,'POST',{expression});return r.result??r.value;};
const wait=async(expression)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error(`wait failed: ${expression}`);};
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const refresh=async()=>{await api(`/tabs/${tab}/click`,'POST',{selector:'button[aria-label="Refresh remote inventory"]'});await wait('document.querySelector("[aria-busy]")?.getAttribute("aria-busy")==="false"');};
const shot=async(name)=>{const r=await fetch(`http://127.0.0.1:9377/tabs/${tab}/screenshot?${new URLSearchParams(owner)}`);assert.ok(r.ok);const data=r.headers.get('content-type')?.includes('json')?Buffer.from((await r.json()).screenshot.data,'base64'):Buffer.from(await r.arrayBuffer());assert.equal(data.subarray(1,4).toString(),'PNG');writeFileSync(path.join(out,name),data);screenshots.push(name);};
try {
 await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 for(const mode of ['panel','navigation']) {
  scenario='live-shape';const opened=await api('/tabs','POST',{url:base+'/preview/remote-inventory.html'+(mode==='navigation'?'?navigation':'')});tab=opened.tabId;
  await wait('document.querySelectorAll("[data-source-kind]").length===7');
  const snapshot=await api(`/tabs/${tab}/snapshot`);check(`${mode} accessible snapshot is readable`,typeof snapshot.snapshot==='string'&&snapshot.snapshot.includes('Remote inventory'));
  for(const width of [1440,1024,390]) {
   await api(`/tabs/${tab}/viewport`,'POST',{width,height:1000});
   const state=await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,body:document.body.innerText,kinds:Array.from(document.querySelectorAll("[data-source-kind]")).map(e=>e.dataset.sourceKind),records:document.querySelectorAll("[data-record-kind]").length,processes:document.querySelectorAll("[data-record-kind=process-only]").length,links:document.querySelectorAll("main a").length,buttons:document.querySelectorAll("main button").length})');
   check(`${mode} ${width}px no overflow`,!state.overflow);
   check(`${mode} ${width}px seven sources across three kinds`,state.kinds.length===7&&state.kinds.filter(k=>k==='herdr').length===3&&state.kinds.filter(k=>k==='managed-hosts').length===2&&state.kinds.filter(k=>k==='codex-processes').length===2);
   check(`${mode} ${width}px truthful live-shaped eight-record summary`,state.records===8&&state.processes===1&&state.body.includes('8 records')&&state.body.includes('7 sources')&&state.body.includes('7 herdr records · 1 process observation')&&!/8 agents|7 sessions/.test(state.body));
   check(`${mode} ${width}px unverified process and absent-directory caveats visible`,state.body.includes('Codex process · task/session/model unverified')&&state.body.includes('Default host receipt directory absent. Jobs may use other locations')&&state.body.includes('Records are not an active-job count'));
   check(`${mode} ${width}px no control or local routing`,state.links===0&&state.buttons===1);
   await evaluate('scrollTo(0,0)');await shot(`remote-coverage-${mode}-${width}.png`);
   if(width===390){await evaluate('document.querySelector("[data-record-kind=process-only]").scrollIntoView({block:"center"})');await shot(`remote-coverage-${mode}-mini-390.png`);}
  }
  if(mode==='navigation') {
   await api(`/tabs/${tab}/click`,'POST',{selector:'[data-record-kind="process-only"] > details > summary'});
   const detail=await evaluate('document.querySelector("[data-record-kind=process-only] details[open]")?.innerText');
   check('navigation process metadata stays unverified in place',detail.includes('Task session\nUnverified')&&detail.includes('Task state\nUnknown')&&detail.includes('Model\nUnverified')&&detail.includes('No verified task parent')&&detail.includes('Read-only inventory'));
   await evaluate('document.querySelector("[data-record-kind=process-only] details[open]").scrollIntoView({block:"center"})');
   await shot('remote-coverage-navigation-process-detail-390.png');
  }
  scenario='contracts';await refresh();
  const state=await evaluate('({body:document.body.innerText,child:document.querySelectorAll("[data-child]").length,nested:document.querySelectorAll(".ab-remote-nav__rows .ab-remote-nav__rows").length,processNested:document.querySelectorAll(".ab-remote__children [data-record-kind=process-only],.ab-remote-nav__rows .ab-remote-nav__rows [data-record-kind=process-only]").length,stale:document.querySelectorAll("[data-source-state=stale],[data-state=stale].ab-remote-nav__group").length,unavailable:document.querySelectorAll("[data-source-state=unavailable],[data-state=unavailable].ab-remote-nav__group").length})');
  check(`${mode} managed receipts and herdr children retain verified hierarchy`,(mode==='panel'?state.child:state.nested)===2&&state.processNested===0&&state.body.includes('Identified session · codex'));
  check(`${mode} stale unavailable unknown and rejected receipt states stay explicit`,state.stale===1&&state.unavailable===1&&state.body.includes('Synthetic unresolved parent')&&state.body.includes('receipt(s) could not be verified'));
  await evaluate('scrollTo(0,0)');await shot(`remote-coverage-${mode}-contracts-390.png`);
  scenario='failure';await refresh();
  check(`${mode} failed refresh keeps records without current-state claims`,await evaluate('document.querySelectorAll("[data-record-kind]").length===9&&!!document.querySelector("[role=alert]")&&Array.from(document.querySelectorAll(".ab-remote__agent-state,.ab-remote-nav summary>small")).every(e=>e.textContent==="Unknown")'));
  scenario='malformed';await refresh();check(`${mode} malformed response retains unknown last reading`,await evaluate('document.querySelectorAll("[data-record-kind]").length===9&&!!document.querySelector("[role=alert]")'));
  scenario='empty';await refresh();check(`${mode} empty sources preserve coverage limits`,await evaluate('document.querySelectorAll("[data-record-kind]").length===0&&document.querySelectorAll("[data-source-kind]").length===7&&document.body.innerText.includes("Other jobs are outside this source")&&document.body.innerText.includes("Independent jobs are outside this source")'));
  scenario='disabled';await refresh();check(`${mode} disabled revokes old rows`,await evaluate('document.querySelectorAll("[data-record-kind]").length===0&&document.querySelectorAll("[data-source-kind]").length===0&&/inventory (is )?disabled/.test(document.body.innerText)'));
  scenario='unconfigured';await refresh();check(`${mode} unconfigured differs from empty sources`,await evaluate('document.body.innerText.includes("No remote sources")&&document.querySelectorAll("[data-source-kind]").length===0'));
  scenario='invalid';await refresh();check(`${mode} invalid configuration hides cached rows`,await evaluate('document.body.innerText.includes("configuration")&&document.querySelectorAll("[data-record-kind]").length===0'));
  scenario='cycle';await refresh();check(`${mode} cyclic and unknown owners stay top-level`,await evaluate('document.body.innerText.includes("Cycle A")&&document.body.innerText.includes("Cycle B")&&document.querySelectorAll("[data-child],.ab-remote-nav__rows .ab-remote-nav__rows").length===1'));
  scenario='live-shape';await refresh();check(`${mode} successful reconnect refreshes eight records`,await evaluate('document.querySelectorAll("[data-record-kind]").length===8&&!document.querySelector("[role=alert]")'));
  await api(`/tabs/${tab}`,'DELETE');tab=null;
 }
 check('all fixture API requests are read-only inventory GET',unexpected.length===0&&requests>=20);
 console.log(JSON.stringify({checks:checks.length,requests,screenshots}));
} finally {
 if(tab){await api(`/tabs/${tab}`,'DELETE');tab=null;}browserClosed=true;
 await vite.close();serverClosed=true;
 writeFileSync(path.join(out,'remote-inventory-coverage-ui-results.json'),JSON.stringify({at:new Date().toISOString(),checks,screenshots,requests,unexpected,synthetic:true,liveApiRequests:0,liveIdentitiesRead:false,browserClosed,serverClosed},null,2)+'\n');
}
