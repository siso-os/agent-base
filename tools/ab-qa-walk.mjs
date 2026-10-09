#!/usr/bin/env node
// Revision-bound synthetic mirror walk. It never starts the API or connects to live agents.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureResponse, fixtureEvent, fixtureChatHello, fixtureStreams, estateFixture, estateProposedFixture } from './ab-qa-fixtures.mjs';
export { fixtureResponse } from './ab-qa-fixtures.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const estateBlocker = 'companion:estate-world synthetic bundle unavailable';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function loadEstateCompanion(file){
 const manifest=JSON.parse(readFileSync(file,'utf8')),pinsFile=path.join(root,'tools/ab-estate-source.json');
 const pins=JSON.parse(readFileSync(pinsFile,'utf8'));
 const expected={buildings:estateFixture.buildings.length,regions:estateFixture.regions.length,roads:estateFixture.roads.length,buildingIds:estateFixture.buildings.map(b=>b.id),buildingNames:estateFixture.buildings.map(b=>b.name)};
 if(manifest.schema!==1 || manifest.kind!=='estate-synthetic-companion' || manifest.inputMode!=='synthetic-only' || manifest.privateInputsRead!==false)throw new Error('Unapproved Estate companion mode');
 if(manifest.sourceRevision!==pins.revision || JSON.stringify(manifest.sourceFiles)!==JSON.stringify(pins.files) || manifest.pinsSha256!==digest(readFileSync(pinsFile)))throw new Error('Estate source pins mismatch');
 if(manifest.producerSha256!==digest(readFileSync(path.join(root,'tools/ab-build-estate-fixture.mjs'))) || JSON.stringify(manifest.dependencies)!==JSON.stringify(pins.dependencies))throw new Error('Estate producer/dependency mismatch');
 if(manifest.inputHashes?.world!==digest(JSON.stringify(estateFixture)) || manifest.inputHashes?.proposed!==digest(JSON.stringify(estateProposedFixture)) || manifest.substitutions?.world!==1 || manifest.substitutions?.proposed!==1)throw new Error('Estate synthetic inputs mismatch');
 if(JSON.stringify(manifest.expected)!==JSON.stringify(expected) || manifest.query!=='gl=1&q=low&cam=mainland' || manifest.artifact?.file!=='world.html')throw new Error('Estate companion contract mismatch');
 const artifact=path.join(path.dirname(file),'world.html');
 if(lstatSync(file).isSymbolicLink() || lstatSync(artifact).isSymbolicLink())throw new Error('Estate companion symlinks refused');
 const html=readFileSync(artifact);
 if(html.length!==manifest.artifact.bytes || digest(html)!==manifest.artifact.sha256)throw new Error('Estate companion artifact hash mismatch');
 return {html,manifest,manifestSha256:digest(readFileSync(file))};
}
async function inspectEstate(page,companion){
 const holder=page.locator('iframe[title="Estate world"]');
 if(await holder.count()!==1 || !await holder.isVisible())throw new Error('Estate iframe missing or hidden');
 const frame=await (await holder.elementHandle()).contentFrame();
 if(!frame)throw new Error('Estate iframe document unavailable');
 await frame.waitForFunction(()=>window.__world?.ready || window.__world?.error,null,{timeout:90000});
 const state=await frame.evaluate(()=>({ready:window.__world.ready,error:window.__world.error,buildings:window.__world.buildings,regions:window.__world.regions,roads:window.__world.roads,frames:window.__world.frames,backend:window.__world.backend}));
 if(!state.ready || state.error)throw new Error('Estate renderer failed: '+state.error);
 for(const key of ['buildings','regions','roads'])if(state[key]!==companion.manifest.expected[key])throw new Error('Estate rendered count mismatch: '+key);
 if(!state.frames || !await frame.locator('canvas#c').isVisible())throw new Error('Estate canvas did not render');
 await frame.locator('#loader').waitFor({state:'hidden',timeout:10000});
 if(await frame.locator('#dockNow').isVisible())await frame.locator('#dockNow').click();
 await frame.locator('[data-lens="health"]').click();
 if(!await frame.locator('[data-lens="health"].on').count())throw new Error('Estate health lens did not activate');
 const interactionErrors=[],interactionDiagnostics=[];
 try{await frame.locator('#findBtn').click({timeout:2500});}
 catch(error){
  interactionErrors.push(error.message.includes('siso-zero-face')?'Estate Find button is obscured by Agent Base floating agent button':'Estate Find button cannot receive a pointer click');
  interactionDiagnostics.push(error.message.replace(/\u001b\[[0-9;]*m/g,'').slice(0,2200));
  // Exercise the real, existing keyboard path too, while retaining the pointer failure.
  await page.keyboard.press('/');
 }
 await frame.locator('#q').fill(companion.manifest.expected.buildingNames[0]);
 const result=frame.locator('#res [data-i]').first();
 await result.waitFor({state:'visible',timeout:10000});await result.click();
 await frame.locator('#card').waitFor({state:'visible',timeout:10000});
 const card=await frame.locator('#card').innerText();
 if(!card.includes(companion.manifest.expected.buildingNames[0]) || !card.includes(estateFixture.buildings[0].path))throw new Error('Estate Find did not open the synthetic building card');
 const broken=await frame.locator('img').evaluateAll(images=>images.filter(i=>!i.complete||!i.naturalWidth).length);
 if(broken)throw new Error('Estate contains broken images');
 return {...state,manifestSha256:companion.manifestSha256,artifactSha256:companion.manifest.artifact.sha256,interactions:['health lens selected',interactionErrors.length?'Find opened with existing / keyboard shortcut':'Find opened by pointer','Find searched synthetic building','matching building card opened'],interactionErrors,interactionDiagnostics,card};
}
export const routes = [
  ...['agents','pinboard','voice','servers','tokens','rolodex','whatsapp','estate','life','web'].map(space => ({id: space, space})),
  ...['ended-list','dashboard','tasks','orgchart','stats','starred','whatsnew','codex-work','research','canvas','product-map'].map(id => ({id, space:'agents', view:{kind:'tab',id}})),
  ...['docs','works','built','live'].map(tab => ({id:'library-'+tab,space:'library',hash:'#library/'+tab})),
];
export function bugId(route, kind, message) {
  // Same symptom on a later revision updates one bug; revisions retain their own shots.
  return createHash('sha256').update(JSON.stringify([route,kind,message.replace(/127\.0\.0\.1:\d+/g,'fixture')])).digest('hex').slice(0,20);
}
export function allowedRequest(method, url, origin) {
  const u = new URL(url);
  return ['GET','HEAD'].includes(method) && u.origin === origin && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/chat/');
}
async function bounded(promise, label, ms=10000){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]);}
  finally{clearTimeout(timer);}
}
export async function walk({revision,out,browserType,inventory=routes,widths=[1440,390],provenance=null,build=path.join(root,'apps/web/dist'),companionManifest=null}) {
  mkdirSync(out,{recursive:true});
  const receipt={schema:1,revision,mode:'synthetic-readonly-mirror',provenance,state:'blocked',routes:[],bugs:[],startedAt:new Date().toISOString()};
  let browser,server;
  const bugsFile=path.join(out,'..','bugs.json');
  const bugs=existsSync(bugsFile)?JSON.parse(readFileSync(bugsFile,'utf8')):{};
  const addBug=(route,kind,message,shot)=>{
    const id=bugId(route,kind,message);
    bugs[id]={...bugs[id],id,route,kind,message,lastRevision:revision,firstRevision:bugs[id]?.firstRevision??revision,shot,updatedAt:new Date().toISOString()};
    if(!receipt.bugs.includes(id))receipt.bugs.push(id);
  };
  try {
    if(!/^[a-f0-9]{40}$/.test(revision))throw new Error('full source revision required');
    const companion=companionManifest?loadEstateCompanion(companionManifest):null;
    if(companion)receipt.companion={manifestSha256:companion.manifestSha256,...companion.manifest};
    if(readFileSync(path.join(build,'DEPLOYED_SHA'),'utf8').trim()!==revision)throw new Error('build revision mismatch');
    const base=realpathSync(build);
    server=createServer((req,res)=>{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      try {
        const pathname=decodeURIComponent(new URL(req.url,'http://fixture').pathname);
        if(pathname.startsWith('/api/')||pathname.startsWith('/chat/')){res.writeHead(503).end();return;}
        if(companion && /^\/estate-world\/?$/.test(pathname)){
          if(new URL(req.url,'http://fixture').search.slice(1)!==companion.manifest.query){res.writeHead(302,{location:'/estate-world/?'+companion.manifest.query}).end();return;}
          res.writeHead(200,{'content-type':'text/html'}).end(companion.html);return;
        }
        const target=realpathSync(path.join(base,pathname==='/'?'index.html':pathname));
        if(!target.startsWith(base+path.sep)){res.writeHead(403).end();return;}
        const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
        res.writeHead(200,{'content-type':types[path.extname(target)]??'application/octet-stream'}).end(readFileSync(target));
      }catch{res.writeHead(404).end();}
    });
    server.on('upgrade',(_req,socket)=>socket.destroy());
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await browserType.launch({headless:true});
    for(const route of inventory)for(const width of widths){
      const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      const errors=[],errorDetails=[],missing=new Set(),blocked=[],mockedSockets=[];
      let page;
      const shot=path.join(out,`${route.id}-${width}.png`);
      try {
        if(typeof context.routeWebSocket!=='function')throw new Error('Playwright WebSocket isolation unavailable');
        await context.routeWebSocket('**/*',socket=>{
          const u=new URL(socket.url());
          if(u.host===new URL(origin).host&&/^\/chat\/(fixture-zero|base-owner)\/ws$/.test(u.pathname)){mockedSockets.push(socket);socket.send(JSON.stringify(fixtureChatHello));}
          else socket.close();
        });
        await context.route('**/*',async request=>{
          const req=request.request(),url=new URL(req.url());
          if(url.origin===origin && req.method()==='GET' && /^\/estate-world\/?$/.test(url.pathname)){
            if(companion){
              await request.continue();return;
            }
            missing.add(estateBlocker);
            await request.fulfill({status:200,contentType:'text/html',body:'<body style="background:#191916;color:#eee;font:16px system-ui;padding:32px"><h1 data-qa-estate-blocked>Estate coverage blocked</h1><p>The Estate companion HTML is outside the Agent Base build. An approved synthetic companion is required; private estate data is never copied into this fixture.</p></body>'});return;
          }
          if(url.origin===origin && req.method()==='GET' && url.pathname.startsWith('/api/')){
            const event=fixtureEvent(url.pathname);
            if(event!==null){await request.fulfill({status:200,contentType:'text/event-stream',body:event});return;}
            const data=fixtureResponse(url.pathname,revision);
            if(data===undefined){missing.add(url.pathname);await request.fulfill({status:503,contentType:'application/json',body:'{"error":"QA fixture unavailable"}'});}
            else await request.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
          }else if(allowedRequest(req.method(),req.url(),origin))await request.continue();
          else{blocked.push({method:req.method(),path:url.pathname});await request.abort();}
        });
        await context.addInitScript(({route,streams})=>{
          const NativeEventSource=window.EventSource;
          window.EventSource=class extends EventTarget{
            static CONNECTING=0;static OPEN=1;static CLOSED=2;readyState=0;onopen=null;onmessage=null;onerror=null;
            constructor(url,options){
              super();const p=new URL(url,location.origin).pathname;
              if(!(p in streams))return new NativeEventSource(url,options);
              this.url=String(url);this.withCredentials=false;
              this.timer=setTimeout(()=>{this.readyState=1;const opened=new Event('open');this.dispatchEvent(opened);this.onopen?.(opened);const stream=streams[p];if(stream){const event=new MessageEvent(stream.type,{data:JSON.stringify(stream.data)});this.dispatchEvent(event);if(stream.type==='message')this.onmessage?.(event);}},20);
            }
            close(){clearTimeout(this.timer);this.readyState=2;}
          };

          localStorage.clear();
          localStorage.setItem('agent-base:browser-setup',JSON.stringify({step:4,doneAt:1}));
          localStorage.setItem('agent-base:space',JSON.stringify(route.space));
          localStorage.setItem('agent-base:view',JSON.stringify(route.view??{kind:'chat'}));
          localStorage.setItem('agent-base:sidebar-open','false');
          localStorage.setItem('agent-base:pin-project',JSON.stringify('agent-base'));
          localStorage.setItem('agent-base:active',JSON.stringify('fixture-zero'));
          localStorage.setItem('agent-base:open',JSON.stringify(['fixture-zero']));
        },{route,streams:fixtureStreams(revision)});
        page=await context.newPage();
        page.on('pageerror',e=>{errors.push(e.message);errorDetails.push(e.stack);});
        if(route.id==='estate' && companion)page.on('console',m=>{if(m.type()==='error')errors.push('Estate console error: '+m.text());});
        page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))errors.push(`asset HTTP ${r.status()}: ${new URL(r.url()).pathname}`);});
        await page.goto(origin+'/'+(route.hash??''),{waitUntil:'domcontentloaded',timeout:15000});
        await page.locator('#root').waitFor({state:'visible',timeout:20000});
        await page.waitForTimeout(700);
        const estateEvidence=route.id==='estate' && companion?await inspectEstate(page,companion):null;
        if(estateEvidence)errors.push(...estateEvidence.interactionErrors);
        const body=await page.locator('#root').innerText();
        const required={'canvas':'[aria-label="Agent canvas"]','product-map':'.product-map[aria-label="Product map"]'}[route.id];
        if(required && !await page.locator(required).isVisible())errors.push('requested destination not rendered: '+route.id);
        if(route.id.startsWith('library-') && !await page.locator(`[data-testid="library"] [data-tab="${route.id.slice(8)}"][aria-selected="true"]`).isVisible())errors.push('requested Library tab not rendered: '+route.id);
        // An iframe's text is absent from #root.innerText. Only our visibly rendered
        // Estate blocker can explain a short shell; hidden/missing frames still fail.
        let estatePlaceholderVisible=false;
        if(route.id==='estate' && missing.has(estateBlocker)){
          const frame=page.locator('iframe[title="Estate world"]');
          if(await frame.count()===1 && await frame.isVisible()){
            estatePlaceholderVisible=await page.frameLocator('iframe[title="Estate world"]').locator('[data-qa-estate-blocked]').isVisible();
          }
        }
        if(body.trim().length<20 && !estatePlaceholderVisible && !estateEvidence)errors.push('empty rendered application');
        if(/could not be shown|Something went wrong/i.test(body))errors.push('visible application error boundary');
        const broken=await page.locator('img').evaluateAll(images=>images.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')));
        for(const image of broken)errors.push('broken image: '+image);
        await page.screenshot({path:shot,fullPage:true,animations:'disabled',caret:'hide',timeout:15000});
        // Missing fixture contracts cannot establish page health. Report explicit coverage blockers.
        const state=errors.length?'failed':missing.size?'blocked':'passed';
        receipt.routes.push({id:route.id,width,state,url:page.url(),shot,errors,errorDetails,bodyExcerpt:body.slice(0,1500),missingFixtures:[...missing],blockedRequests:blocked,...(route.id==='estate'?{estatePlaceholderVisible,estateEvidence}:{})});
        for(const error of errors)addBug(route.id,'render',error,shot);
      }catch(e){
        if(page)try{await page.screenshot({path:shot,fullPage:true,animations:'disabled',timeout:5000});}catch{}
        receipt.routes.push({id:route.id,width,state:'failed',errors:[...errors,e.message],errorDetails,shot:existsSync(shot)?shot:null});addBug(route.id,'walk',e.message,existsSync(shot)?shot:null);
      }
      finally{
        writeFileSync(path.join(out,'walk.json'),JSON.stringify({...receipt,state:'running'},null,2)+'\n');
        try{for(const socket of mockedSockets)socket.close();await bounded(context.close(),'context cleanup');}catch(e){receipt.routes.at(-1).cleanupError=e.message;receipt.routes.at(-1).state='failed';}
      }
    }
    receipt.state=receipt.routes.some(r=>r.state==='failed')?'failed':receipt.routes.some(r=>r.state==='blocked')?'blocked':receipt.routes.length===inventory.length*widths.length?'passed':'blocked';
  }catch(e){receipt.reason=e.message;}
  finally{
    try{if(browser)await bounded(browser.close(),'browser cleanup');}catch(e){receipt.state='failed';receipt.cleanupError=e.message;}
    if(server){server.closeAllConnections();await bounded(new Promise(r=>server.close(r)),'server cleanup');}
    receipt.finishedAt=new Date().toISOString();
    writeFileSync(path.join(out,'walk.json'),JSON.stringify(receipt,null,2)+'\n');
    writeFileSync(bugsFile,JSON.stringify(bugs,null,2)+'\n');
  }
  return receipt;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
  const revision=arg('--revision'),out=arg('--out');
  if(!args.includes('--revision')||!args.includes('--out'))throw new Error('usage: ab-qa-walk.mjs --revision SHA --out DIR');
  let browserType,dependency;
  try{
    // Reuse the owning checkout's installed Playwright when the exact-revision mirror has no node_modules.
    // This reads dependencies only; fixture/application sources always come from this mirror.
    const common=execFileSync('git',['-C',root,'rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8'}).trim();
    let lastError;
    for(const candidate of [...new Set([root,path.dirname(common)])]){
      try{const require=createRequire(path.join(candidate,'services/node/package.json'));browserType=require('playwright').webkit;dependency={root:candidate,playwright:require('playwright/package.json').version,engine:'webkit'};break;}catch(e){lastError=e;}
    }
    if(!browserType)throw lastError;
  }catch{browserType={launch:async()=>{throw new Error('Playwright WebKit unavailable')}};}
  const result=await walk({revision,out,browserType,provenance:{dependency},companionManifest:args.includes('--companion-manifest')?arg('--companion-manifest'):null});
  console.log(JSON.stringify({state:result.state,revision,routes:result.routes.length,receipt:path.join(out,'walk.json')}));
  process.exitCode=result.state==='passed'?0:1;
}
