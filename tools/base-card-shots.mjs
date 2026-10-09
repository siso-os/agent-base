// Headless WebKit only. Requires the isolated composer fixture on 5472.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {baseCardFixture} from './base-card-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'services/node/package.json'));
const {webkit}=require('playwright'),phase=process.argv[2]||'before';
const out=path.join(root,'ui-hub/side-nav/rounds/base-card'),url='http://127.0.0.1:5472';
const live=await fetch(url+'/api/agents').then(r=>r.json());
const zero=(live.agents??live).find(a=>a.zero)??(live.agents??live)[0];
const data=baseCardFixture(zero),browser=await webkit.launch({headless:true}),errors=[],captures=[],checks=[],failures=[];
const after=phase!=='before';
try {
 const context=await browser.newContext({deviceScaleFactor:2});
 await context.addInitScript(()=>{localStorage.setItem('agent-base:sidebar-open','true');localStorage.setItem('agent-base:panel.open.zero','false');});
 await context.route('**/api/agents',r=>r.fulfill({json:{...(!Array.isArray(live)?live:{}),agents:data.agents}}));
 await context.route('**/api/org',r=>r.fulfill({json:data.org}));
 await context.route('**/api/spaces/*',r=>r.fulfill({json:{project:r.request().url().split('/').at(-1),agents:data.agents.filter(a=>a.project===(r.request().url().endsWith('halo')?'HALO':'Agent Base')),layout:{positions:{},collapsed:{}},pins:[]}}));
 await context.route('**/api/a0/tasks',r=>r.fulfill({json:{updated:new Date().toISOString(),counts:{},tasks:data.tasks}}));
 await context.route('**/api/a0/tasks/events',r=>r.fulfill({contentType:'text/event-stream',body:''}));
 await context.route('**/api/hub/project/*',r=>r.fulfill({status:404,json:{error:'No fixture hub project'}}));
 await context.route('**/api/org/project/*',r=>r.fulfill({json:data.projects.find(p=>r.request().url().endsWith(p.id))??{}}));
 await context.route('**/api/codex-workers/**',r=>r.fulfill({json:{id:r.request().url().split('/').at(-1),name:'BASECARD',runs:[{id:'fixture',name:'BASECARD',alive:true,model:'gpt-6.1-sol',started:Date.now()-720000,step:'Reusing the pinned owner rim',tickets:['t-card: Build the Agent Base card'],items:[],result:'',tokensPerSecond:0}]}}));
 await context.route('**/api/tasks?*',r=>r.fulfill({json:{tasks:[]}}));
 await context.route('**/__basecard-*.png',r=>r.fulfill({contentType:'image/png',body:readFileSync(path.join(root,'ui-hub/side-nav/rounds/v2',r.request().url().includes('before')?'01-before-nav-1440.png':'01-after-nav-1440.png'))}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 for(const [w,h] of [[1440,900],[1024,768]]) {
  await page.setViewportSize({width:w,height:h});await page.goto(url);await page.locator('[data-testid=zero-name]').waitFor();
  const nav=page.getByRole('button',{name:'Show or hide the side nav',exact:true});if(await nav.getAttribute('aria-pressed')!=='true')await nav.click();
  await page.locator('[data-testid=zero-name]').click();await page.locator('.ab-cap').waitFor();assert.equal(await page.locator('.ab-cap').count(),1);checks.push(`${w}: one main chat header`);
  const shot=async(n,label)=>{const name=`${n}-${phase}-${label}-${w}.png`;try{await page.screenshot({path:path.join(out,name)});}catch{try{await page.screenshot({path:path.join(out,name)});}catch(e){failures.push(`${name}: ${e.message}`);return;}}captures.push(name);};
  if(after){await page.locator('[data-testid=pinned-project-card]').first().waitFor();assert.equal(await page.locator('[data-testid=pinned-project-card]').count(),2);assert.equal(await page.locator('[data-project-card=agent-base] [data-testid=project-to-rate]').innerText(),'1 to rate');assert.equal(await page.locator('[data-project-card=agent-base] [data-testid=project-crew-face]').count(),3);assert.equal(await page.locator('[data-project-card=agent-base] [data-testid=project-crew-more]').innerText(),'+12');assert.equal(await page.locator('[data-project-card=agent-base] .ab-project-card__line').evaluate(el=>el.scrollWidth<=el.clientWidth),true);checks.push(`${w}: two cards, three crew, +12 earlier, one project preview; full activity line fits`);}
  await shot('01','nav');
  const panel=page.locator('[data-testid=chat-panel-toggle]');if(await panel.getAttribute('aria-pressed')==='true')await panel.click();
  await panel.click();await page.waitForTimeout(250);await shot('02','nav-panel');await nav.click();await shot('03','closed-nav-panel');await panel.click();await shot('04','closed-nav');await nav.click();
  if(after){await page.locator('[data-project-card=agent-base] [data-testid=project-crew-face]').first().hover();await page.locator('.ab-hover-card').waitFor().catch(()=>{});await page.waitForTimeout(650);await shot('05','crew-hover');await page.mouse.move(w-30,30);await page.locator('[data-project-card=agent-base] [data-testid=project-crew-face]').first().click();await page.locator('[data-testid=codex-worker-page]').waitFor();checks.push(`${w}: crew click opens Codex worker page`);await page.locator('[data-testid=zero-name]').click();await page.getByRole('button',{name:'More for Agent Base',exact:true}).click();await page.getByRole('menuitem',{name:'New agent here',exact:true}).click();await page.getByRole('textbox',{name:'New owner in Agent Base',exact:true}).waitFor();await page.getByRole('textbox',{name:'New owner in Agent Base',exact:true}).press('Escape');checks.push(`${w}: existing New owner menu/form preserved`);await page.locator('[data-project-card=agent-base] [role=button]').click();await page.locator('.ab-cap').waitFor();assert.equal(await page.locator('.ab-cap').count(),1);assert.match(await page.locator('.ab-cap').innerText(),/AGENT BASE/);checks.push(`${w}: card opens normalized owner with one header`);await page.getByRole('button',{name:'Agent Base dashboard',exact:true}).click();}
  else {await page.evaluate(()=>{location.hash='project/agent-base';});}
  await page.locator('[data-testid=org-page]').waitFor();
  if(after){await page.locator('[data-testid=project-dashboard-crew]').waitFor();assert.equal(await page.locator('[data-testid=project-dashboard-crew] [data-testid=project-crew-card]').count(),3);assert.equal(await page.locator('[data-testid=project-landed] [data-task-card]').count(),1);await page.getByRole('button',{name:'Show 12 earlier',exact:true}).click();assert.equal(await page.locator('[data-testid=project-dashboard-crew] [data-testid=project-crew-card]').count(),15);await page.getByRole('button',{name:'Hide earlier',exact:true}).click();checks.push(`${w}: dashboard crew and project-only landed; earlier expands to 15`);}
  await page.getByRole('region',{name:'Dashboard',exact:true}).evaluate(el=>el.scrollTop=0);await page.waitForTimeout(150);await shot('06','dashboard');
  if(after){await page.getByRole('button',{name:/^Before: Side nav/}).click();await page.getByRole('dialog',{name:'Task evidence'}).waitFor();await page.keyboard.press('ArrowRight');assert.match(await page.getByRole('dialog',{name:'Task evidence'}).innerText(),/After/);await shot('07','evidence');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Task evidence'}).count(),0);checks.push(`${w}: lightbox arrow and Escape`);}
 }
 assert.deepEqual(errors,[]);checks.push('No browser page errors');
} finally {await browser.close();writeFileSync(path.join(out,`receipt-${phase}.json`),JSON.stringify({phase,captures,checks,errors,failures,fixture:'base-card-fixture.mjs; illustrative preview images from v2',deviceScaleFactor:2},null,2));}
console.log(JSON.stringify({phase,captures:captures.length,checks,errors,failures}));
