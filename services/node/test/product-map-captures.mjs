// HTTP-served actual components with sealed synthetic APIs; no installed-state claim.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixtureResponse,fixtureEvent} from '../../../tools/ab-qa-fixtures.mjs';
import {readProductMap,productMapPath} from '../src/product-map.ts';
const root=process.cwd(),hub=path.join(root,'ui-hub'),out=path.join(root,'.agents/scratchpads/landing-20261006');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hash=p=>createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex');
const {chromium}=createRequire(path.join(root,'services/node/package.json'))('playwright'),{createServer}=await import(path.join(root,'apps/web/node_modules/vite/dist/node/index.js'));
const primary={'chat-header':'ChatHeader','agent-zero-board':'panel/A0Board','servers':'ServersSpace','tokens':'TokensSpace','stats':'StatsPage','ended':'EndedPage','starred':'StarredPage','research':'ResearchPage','codex-work':'CodexWorkPage','life':'LifeSpace','voice':'VoiceSpace','rolodex':'RolodexSpace','entity':'EntityPage','product-map':'ProductMap','org-chart':'OrgChart','whatsnew':'WhatsNew','laptop-jobs':'LaptopJobsPage','dictation':'DictationSpace','mini-lanes':'MiniLanes','codex-worker':'CodexWorkerPage','agent-zero-page':'AgentZeroPage','terminal':null};
const expected={'chat-header':'Fixture Zero','agent-zero-board':'No dispatched runs','servers':'Fixture machine','tokens':'Synthetic Codex','stats':'Tokens','ended':'Finished fixture','starred':'Fixture Zero','research':'Synthetic findings','codex-work':'Synthetic finished job','life':'Water','voice':'A synthetic dictation','rolodex':'Avery Fixture','entity':'Fixture Studio','product-map':'What needs your eye','org-chart':'AGENT BASE','whatsnew':'Synthetic checked release','laptop-jobs':'com.fixture.review','dictation':'Synthetic captured dictation','mini-lanes':'Synthetic component review','codex-worker':'Synthetic worker output','agent-zero-page':'Review the synthetic page','terminal':''};
const targets=process.env.CAPTURE_SURFACES?.split(',')??Object.keys(primary),receipt={schema:1,sourceRevision:sha,scope:'Synthetic actual components; installed acceptance and human ratings unverified',startedAt:new Date().toISOString(),surfaces:[],faces:[],errors:[]};
const shared=['apps/web/preview/product-map-captures.tsx','apps/web/preview/product-map-captures.html','tools/ab-qa-fixtures.mjs','apps/web/src/index.css','apps/web/src/components/Phone.css','services/node/test/product-map-captures.mjs'];
let server,browser;
const now=Date.now(),iso=new Date(now).toISOString();
function response(p){
 if(p==='/api/product-map')return readProductMap({tasks:[]});
 if(p==='/api/launchd')return {machine:'Synthetic laptop',at:now/1000,jobs:[{label:'com.fixture.review',health:'ok',schedule:'Manual synthetic run',runs_per_day:1,loaded:true,last_exit:0,owner:'Fixture'}]};
 if(p==='/api/dictation/status')return {owner:'agent-base',switching:false,phase:'idle',error:'',hotkey:'Control + Space · fixture',native:{registered:true,permission:true,updatedAt:now,error:''}};
 if(p==='/api/dictation/history')return {entries:[{id:'fixture',timestamp:iso,app:'Synthetic app',bundleId:'invalid.fixture',text:'Synthetic captured dictation. No real audio or transcript.',cleanup:''}],total:1};
 if(p==='/api/mini/lanes/fixture')return {enabled:true,reachable:true,note:'Synthetic fixture; no Mini connection',at:now,lane:{name:'fixture',model:'Fixture model',goal:'Synthetic component review',lastCommitAt:now,running:false,session:'synthetic',source:'lanes'},commits:[{sha:'a'.repeat(40),subject:'Synthetic fixture change',at:now}],pane:'Synthetic terminal record. No remote process attached.'};
 if(p==='/api/codex-workers/fixture-zero')return {id:'fixture-zero',name:'Fixture Zero',runs:[{id:'fixture-run',name:'Synthetic run',model:'Synthetic model',started:now-60000,alive:false,tickets:['Fixture task'],step:'Done',items:[{id:'message',kind:'agent_message',text:'Synthetic worker output for component review.'}],returned:'done',result:'Synthetic result',tokensPerSecond:0,rateEstimated:false,ended:now,returnStatus:'done'}]};
 if(p.startsWith('/api/hub/agent/'))return {name:'Fixture Zero',kind:'owner',project:'Synthetic',state:'idle',spunUp:true,workers:{total:0,working:0}};
 return fixtureResponse(p,sha);
}
try{
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),cacheDir:path.join(root,'apps/web/node_modules/.vite-product-captures'),optimizeDeps:{entries:['preview/product-map-captures.html','preview/original-faces-review.html']},server:{port:0,host:'127.0.0.1',proxy:{}}});await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({headless:true,channel:'chrome'});
 async function pageFor(width,reducedMotion='reduce'){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion,serviceWorkers:'block'});
  const missing=[],errors=[];
  await context.routeWebSocket('**/*',socket=>{if(new URL(socket.url()).pathname==='/term/synthetic-capture/ws'){socket.onMessage(()=>{});setTimeout(()=>socket.send(Buffer.from('0\r\nSynthetic terminal session\r\nNo shell, agent, or remote process is connected.\r\n\r\n$ fixture-review\r\n21 component states rendered\r\n$ ')),150);}else socket.close();});
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
   if(u.origin!==origin||!['GET','HEAD'].includes(req.method())){await route.abort();return;}
   if(u.pathname.startsWith('/api/product-map/files/')){try{const file=productMapPath(hub,decodeURIComponent(u.pathname.slice(23)));await route.fulfill({path:file});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}return;}
   if(u.pathname.startsWith('/api/')){const event=fixtureEvent(u.pathname);if(event!==null){await route.fulfill({status:200,contentType:'text/event-stream',body:event});return;}const data=response(u.pathname);if(data===undefined)missing.push(u.pathname);await route.fulfill({status:data===undefined?503:200,contentType:'application/json',body:JSON.stringify(data??{error:'Synthetic fixture unavailable'})});return;}
   await route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));return {context,page,missing,errors};
 }
 for(const id of targets){const source=primary[id]?`apps/web/src/components/${primary[id]}.tsx`:'packages/siso-terminal/src/TerminalView.tsx',sources=[...shared,source].map(file=>({file,sha256:hash(file)})),assets=[];let failed=false;
  for(const width of [1440,390]){const {context,page,missing,errors}=await pageFor(width);try{
   await page.goto(origin+'/preview/product-map-captures.html?surface='+id,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('[data-capture-component]').waitFor();
   if(expected[id])await page.waitForFunction(({id,text})=>document.querySelector(`[data-capture-component="${id}"]`)?.textContent.includes(text),{id,text:expected[id]});
   else await page.locator('.xterm-screen').waitFor();
   await page.waitForTimeout(350);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
   const file=`${id}/capture-20261006-${width}.png`;mkdirSync(path.join(hub,id),{recursive:true});await page.screenshot({path:path.join(hub,file),fullPage:false});
   assets.push({layout:await page.evaluate(()=>({viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,scrollX})),file,sha256:hash('ui-hub/'+file),capturedAt:new Date().toISOString(),viewport:{width,height:1000},url:'/preview/product-map-captures.html?surface='+id});
   console.log('CAPTURE '+id+' '+width);
  }catch(e){failed=true;receipt.errors.push({id,width,error:String(e),missing,errors});console.log('BLOCKED '+id+' '+width+' '+String(e).slice(0,160));}finally{await context.close();}}
  const changed=sources.filter(s=>hash(s.file)!==s.sha256).map(s=>s.file);
  if(changed.length){failed=true;receipt.errors.push({id,error:'Source changed during capture',changed});}
  receipt.surfaces.push({id,state:failed?'blocked':'captured',sources,assets});
  if(!failed){const chosen=assets[0];writeFileSync(path.join(hub,id,'capture.json'),JSON.stringify({schema:1,...chosen,mode:'synthetic',sourceRevision:sha,sources,dirtyWorktree:true,state:'Synthetic populated or explicit empty state',gallery:`${id}/capture-gallery.html`,assets},null,2)+'\n');writeFileSync(path.join(hub,id,'capture-gallery.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${id} capture</title><style>body{background:#181a16;color:#eee;font:16px system-ui;max-width:1440px;margin:auto;padding:24px}img{max-width:100%;height:auto}a{color:#bdd9ad}</style><h1>${id} · synthetic component capture</h1><p>Actual component, synthetic records. Captured ${chosen.capturedAt}. Installed behavior and human review unverified.</p><p><a href="capture.json">Image and source hashes</a></p>${assets.map(a=>`<figure><figcaption>${a.viewport.width}px</figcaption><img src="${path.basename(a.file)}" alt="${id} synthetic component at ${a.viewport.width}px"></figure>`).join('')}</html>`);}
  writeFileSync(path.join(out,'product-map-capture-progress.json'),JSON.stringify(receipt,null,2));
 }
 if(!process.env.CAPTURE_SURFACES){
  const faceDir=path.join(hub,'animations/original-faces-20261006');mkdirSync(faceDir,{recursive:true});
  for(const reduced of ['no-preference','reduce'])for(const width of [1440,390]){const {context,page,errors}=await pageFor(width,reduced);try{
   await page.goto(origin+'/preview/original-faces-review.html',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('.pf svg').first().waitFor();assert.equal(await page.locator('.pf').count(),18);assert.equal(await page.locator('figure figcaption').count(),18);await page.waitForTimeout(400);
   const face=page.locator('[data-face-state="working"]').first();const before=await face.screenshot();await page.waitForTimeout(600);const after=await face.screenshot();const changed=!before.equals(after);
   assert.equal(changed,reduced==='no-preference','motion follows preference');assert.deepEqual(errors,[]);
   const file=`animations/original-faces-20261006/${reduced}-${width}.png`;await page.screenshot({path:path.join(hub,file),fullPage:true});receipt.faces.push({file,sha256:hash('ui-hub/'+file),capturedAt:new Date().toISOString(),width,motion:reduced,temporalPixelsChanged:changed,count:18});console.log('FACES '+reduced+' '+width);
  }catch(e){receipt.errors.push({faces:reduced,width,error:String(e)});console.log('BLOCKED FACES '+String(e));}finally{await context.close();}}
  const faceSources=['packages/halo-face/AgentFace.tsx','packages/halo-face/prism-engine.ts','packages/halo-face/prism-face.css','packages/halo-face/identity.ts','apps/web/preview/original-faces-review.tsx','apps/web/preview/original-faces-review.css'].map(file=>({file,sha256:hash(file)}));
  writeFileSync(path.join(faceDir,'provenance.json'),JSON.stringify({sourceRevision:sha,sources:faceSources,mode:'synthetic',humanRatings:0,assets:receipt.faces},null,2));
  writeFileSync(path.join(faceDir,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Original AgentFace owner review</title><style>body{background:#171914;color:#efefe8;font:16px system-ui;max-width:1440px;margin:auto;padding:24px}a{color:#c1d9ae}img{max-width:100%;height:auto}nav{display:flex;gap:20px;flex-wrap:wrap}</style><h1>Original AgentFace · six combinations</h1><p>Real approved component: existing hats, six eye styles, six palettes, Claude and Codex geometry. Every combination appears idle, working, and needing you. Synthetic identities. Owner review pending; zero human ratings supplied.</p><p>Normal motion changed pixels over 600 ms; reduced motion stayed stable where checks passed. Static captures below show appearance; see provenance for each result.</p><p><a href="provenance.json">Source and image hashes</a></p><nav>${receipt.faces.map(f=>`<a href="#${f.motion}-${f.width}">${f.motion} · ${f.width}px</a>`).join('')}</nav>${receipt.faces.map(f=>`<section id="${f.motion}-${f.width}"><h2>${f.motion} · ${f.width}px</h2><p>18 faces · captured ${f.capturedAt}</p><img src="${path.basename(f.file)}" alt="Six original AgentFace combinations with labelled idle, working and needs-you states in ${f.motion} mode"></section>`).join('')}</html>`);
 }
 const catalog=readProductMap();receipt.coverage={total:catalog.rows.length,withImage:catalog.rows.filter(r=>r.screenshot).length,missing:catalog.rows.filter(r=>!r.screenshot).map(r=>r.id),humanRatings:catalog.rows.filter(r=>r.rating).length,explicit:catalog.rows.filter(r=>r.screenshot?.mode).length};receipt.finishedAt=new Date().toISOString();writeFileSync(path.join(out,process.env.CAPTURE_SURFACES?'product-map-capture-retry.json':'product-map-faces-return.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({coverage:receipt.coverage,errors:receipt.errors}));
}finally{await browser?.close();await server?.close();}
