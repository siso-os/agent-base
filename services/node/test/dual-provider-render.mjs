import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),{chromium}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const {createServer}=await import(path.join(root,'apps/web/node_modules/vite/dist/node/index.js'));
const out=path.join(root,'.agents/scratchpads/landing-20261006'),checks=[],errors=[];
let server,browser;
try{
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),cacheDir:path.join(root,'apps/web/node_modules/.vite-dual-provider'),optimizeDeps:{entries:['preview/dual-provider.html']},server:{port:0,host:'127.0.0.1'}});await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const width of [1440,1024,390])for(const variant of ['rim','strip']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/preview/dual-provider.html?variant=${variant}`,{waitUntil:'domcontentloaded',timeout:60000});
  const claude=page.getByTestId('provider-claude'),codex=page.getByTestId('provider-codex'),usage=page.getByTestId('provider-usage');
  await page.waitForFunction(()=>document.querySelector('[data-testid=provider-claude]')?.textContent.includes('75%'));
  for(const meter of [claude,codex]){assert.equal(await meter.isVisible(),true);const box=await meter.boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.y+box.height<=900,'both meters inside viewport');assert.equal(await meter.evaluate(el=>{const r=el.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return p===el||el.contains(p);}),true,'meter not clipped or covered');}
  assert.equal(await claude.getAttribute('data-tone'),'warn');assert.equal(await codex.getAttribute('data-tone'),'bad');assert.equal(await page.getByTestId('provider-usage').count(),1,'one merged usage item');assert.doesNotMatch(await usage.innerText(),/Claude|Codex|stale/,'no provider words in the bar');checks.push(`${width} ${variant}: one merged item, both rings visible and threshold-coloured, no words`);
  await usage.focus();await page.keyboard.press('ArrowDown');let panel=page.getByRole('dialog',{name:'Usage accounts'});await panel.waitFor();assert.match(await panel.innerText(),/Fixture Claude account/);assert.match(await panel.innerText(),/resets in 1h/);assert.match(await panel.innerText(),/5h/);assert.match(await panel.innerText(),/Week/);
  let box=await panel.boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=900,'keyboard card within viewport');
  await page.keyboard.press('Escape');assert.equal(await panel.count(),0);assert.equal(await usage.evaluate(el=>document.activeElement===el),true);checks.push(`${width} ${variant}: keyboard opens account/reset card; Escape restores focus`);
  await codex.hover();panel=page.getByRole('dialog',{name:'Usage accounts'});await panel.waitFor();assert.match(await panel.innerText(),/Codex \(fixture plan\)/);assert.ok((await panel.innerText()).length<700,'card stays short');await panel.getByRole('button',{name:'Close usage'}).click();checks.push(`${width} ${variant}: hover popup preserves unknown account attribution`);
  await page.evaluate(()=>window.__dualProvider.scenario('stale'));await page.waitForFunction(()=>document.querySelector('[data-testid=provider-claude]')?.dataset.state==='stale');assert.equal(await codex.getAttribute('data-state'),'fresh','a passed 5h reset no longer sets the headline');assert.match(await codex.innerText(),/18%/);await usage.focus();await page.keyboard.press('Enter');panel=page.getByRole('dialog',{name:'Usage accounts'});await panel.waitFor();assert.match(await panel.innerText(),/reset passed/);await page.keyboard.press('Escape');
  await page.evaluate(()=>window.__dualProvider.scenario('fresh'));await page.waitForFunction(()=>document.querySelector('[data-testid=provider-claude]')?.dataset.state==='fresh');await page.evaluate(()=>window.__dualProvider.scenario('error'));await page.waitForFunction(()=>document.querySelector('[data-testid=provider-claude]')?.dataset.state==='stale');assert.match(await claude.innerText(),/75%/);checks.push(`${width} ${variant}: stale/reset/failed refresh keep measurements explicit`);
  await page.evaluate(()=>window.__dualProvider.scenario('unknown'));await page.waitForFunction(()=>document.querySelector('[data-testid=provider-claude]')?.dataset.state==='unknown');assert.match(await claude.innerText(),/—/);assert.equal(await codex.isVisible(),true);
  await page.evaluate(()=>window.__dualProvider.scenario('long'));await usage.focus();await page.keyboard.press('Enter');panel=page.getByRole('dialog',{name:'Usage accounts'});await panel.waitFor();assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push(`${width} ${variant}: unknown states and long account labels do not overflow`);
  assert.equal(await page.evaluate(()=>window.__dualProvider.requests.filter(u=>u==='/api/tokens').length>=1),true);
  await page.close();
 }
 const shared=await browser.newPage({viewport:{width:1024,height:900}});shared.on('pageerror',e=>errors.push(e.message));await shared.clock.install();
 await shared.goto(`http://127.0.0.1:${port}/preview/dual-provider.html?copies=2`,{waitUntil:'domcontentloaded',timeout:60000});await shared.waitForFunction(()=>document.querySelector('[data-testid=provider-claude]')?.textContent.includes('75%'));
 assert.equal(await shared.evaluate(()=>window.__dualProvider.requests.filter(u=>u==='/api/tokens').length),1,'two HUDs share one request');
 await shared.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await shared.clock.runFor(61000);assert.equal(await shared.evaluate(()=>window.__dualProvider.requests.filter(u=>u==='/api/tokens').length),1,'hidden document does not poll');
 await shared.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await shared.waitForFunction(()=>window.__dualProvider.requests.filter(u=>u==='/api/tokens').length===2);checks.push('Two mounted HUDs share one cached read; hidden document stops polling and resumes once');await shared.close();
 assert.deepEqual(errors,[]);writeFileSync(path.join(out,'dual-provider-checks.json'),JSON.stringify({status:'pass',scope:'isolated actual Hud components; no live accounts',checks,errors},null,2));console.log(JSON.stringify({status:'pass',checks,errors}));
}finally{await browser?.close();await server?.close();}
