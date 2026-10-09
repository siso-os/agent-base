import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),{chromium}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const {createServer}=await import(path.join(root,'apps/web/node_modules/vite/dist/node/index.js'));
const out=path.join(root,'.agents/scratchpads/landing-20261006'),checks=[],errors=[];
let server,browser;
try {
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),cacheDir:path.join(root,'apps/web/node_modules/.vite-delight'),optimizeDeps:{entries:['preview/delight-events.html']},server:{port:0,host:'127.0.0.1'}});await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/releases/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#234"/><text x="20" y="90" fill="white">Synthetic evidence fixture</text></svg>'}));
 await page.goto(`http://127.0.0.1:${port}/preview/delight-events.html`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByTestId('delivery-card').waitFor();assert.equal(await page.evaluate(()=>window.__delight.flightCount),0);checks.push(`${width}: initial history has no flights`);
 assert.match(await page.getByTestId('zero-pipeline').innerText(),/2m median/);
 await page.getByRole('button',{name:'Open running research batch Fixture batch'}).focus();await page.getByRole('button',{name:'Open running research batch Fixture batch'}).click();assert.equal(await page.locator('output').innerText(),'Fixture batch');
 await page.getByRole('button',{name:'Toggle stale research'}).click();assert.equal(await page.getByRole('button',{name:'Research status unavailable'}).count(),1);checks.push(`${width}: fresh research opens; stale research does not claim running`);
 await page.getByRole('button',{name:'After: Synthetic pair'}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');checks.push(`${width}: delivered pair opens existing lightbox`);
 const spawn=async(id)=>page.evaluate(id=>window.__delight.emit({t:'tool',id,name:'Agent',summary:'Managed Codex worker',at:Date.now()}),id);
 const finish=async(id,ok)=>page.evaluate(({id,ok})=>window.__delight.emit({t:'tool_done',id,ok,at:Date.now()}),{id,ok});
 await page.evaluate(()=>window.__delight.emit({t:'task',task:{id:'managed',tool:'managed',kind:'codex',hostName:'FIXTURE',description:'Managed Codex worker',background:true,status:'running',startedAt:Date.now(),endedAt:null,tokens:null,tools:null,last:null,summary:null}}));await spawn('managed');await page.waitForFunction(()=>window.__delight.flightCount===1);await page.waitForTimeout(800);await page.evaluate(()=>window.__delight.emit({t:'task',task:{id:'managed',tool:'managed',kind:'codex',hostName:'FIXTURE',description:'Managed Codex worker',background:true,status:'done',startedAt:Date.now()-1000,endedAt:Date.now(),tokens:1,tools:1,last:null,summary:null}}));await finish('managed',true);await page.waitForFunction(()=>window.__delight.flightCount===2);assert.equal(await page.getByText('Done',{exact:true}).count()>0,true);await page.waitForTimeout(800);
 await finish('managed',true);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.__delight.flightCount),2);checks.push(`${width}: real ChatView socket spawn and done return once`);
 await page.evaluate(()=>window.__delight.hello());await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.__delight.flightCount),2);checks.push(`${width}: hello reconnect does not replay history`);
 await page.emulateMedia({reducedMotion:'reduce'});await spawn('reduced');await page.waitForTimeout(80);await finish('reduced',false);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.__delight.flightCount),2);checks.push(`${width}: reduced motion keeps blocked outcome without flight`);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>document.querySelector('[data-testid=chat-view]').style.visibility='hidden');await spawn('offscreen');await page.waitForTimeout(80);await finish('offscreen',true);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.__delight.flightCount),2);
 await page.evaluate(()=>document.querySelector('[data-testid=chat-view]').style.visibility='visible');await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.__delight.flightCount),2);checks.push(`${width}: hidden recipient does not fly or replay on reveal`);
 await page.evaluate(()=>window.__delight.cli([{id:'run:fixture',kind:'codex',type:'Codex',name:'CLI fixture',what:'Synthetic work',spec:'Fixture',start:new Date().toISOString(),end:null,tokens:0,tools:0,running:true,background:true,status:'working'}]));
 await page.waitForFunction(()=>window.__delight.flightCount===3);await page.waitForTimeout(800);
 // Keep the exact stable start identity from the first response when the run finishes.
 await page.evaluate(async()=>{const source=await fetch('/api/agents/fixture/subagents').then(r=>r.json());await window.__delight.cli(source.rows.map(r=>({...r,running:false,status:'blocked',end:new Date().toISOString()})));});
 await page.waitForFunction(()=>window.__delight.flightCount===4);assert.equal(await page.locator('.ab-flight__outcome').innerText(),'Blocked');await page.waitForTimeout(800);checks.push(`${width}: parent-session CLI polling produces one spawn and blocked return`);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(path.join(out,'delight-events-checks.json'),JSON.stringify({status:'pass',scope:'isolated synthetic real-component fixture',checks,errors},null,2));console.log(JSON.stringify({status:'pass',checks,errors}));
}finally{await browser?.close();await server?.close();}
