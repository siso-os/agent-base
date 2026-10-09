import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),deps=process.env.AB_DEPENDENCY_ROOT??root;
const out=process.env.AB_ACTIVITY_OUTPUT??path.join(root,'.agents/scratchpads/agents-working');
const require=createRequire(path.join(deps,'services/node/package.json'));
const {webkit}=require('playwright');
const url=process.env.AB_ACTIVITY_URL??'http://127.0.0.1:8878/agents-working.html';
const result={checks:[],errors:[],screenshots:[],engine:'WebKit',url};
let browser;
const check=(name,passed)=>{assert.ok(passed,name);result.checks.push(name);};
try{
 browser=await webkit.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-GB',reducedMotion:'reduce'});
 page.on('pageerror',e=>result.errors.push(e.message));
 const opened=async()=>{await page.getByTestId('subagents-panel').waitFor();};
 const shot=async name=>{const file=path.join(out,name+'.png');await page.screenshot({path:file});result.screenshots.push(file);};
 const bounds=async(width)=>{const b=await page.getByTestId('subagents-panel').boundingBox();check(`panel fits ${width}`,b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=await page.evaluate(()=>innerHeight)+1);check(`page fits ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));};
 for(const width of [1440,1100,390]){
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto(url);await opened();await page.getByTestId('pill-rate').getByText('~153.6 tok/s').waitFor();await bounds(width);
  check(`three active rows visible ${width}`,await page.locator('[data-testid=subagent-row]:visible').count()===3);
  check(`finished batch folded ${width}`,await page.getByRole('button',{name:/Workspace handoff 2 of 2 finished/}).getAttribute('aria-expanded')==='false');
  await shot(`working-${width}`);
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(url);await opened();
 await page.getByRole('button',{name:'Details for ASTRA · VERIFICATION',exact:true}).first().click();
 check('detail shows real rate provenance',(await page.locator('.ab-subagents__detail').innerText()).includes('Output-token counters · 30s window'));
 await shot('details-1440');
 await page.getByRole('button',{name:/Workspace handoff 2 of 2 finished/}).click();
 check('completed batch expands',await page.locator('[data-testid=subagent-row]:visible').count()===5);
 await page.keyboard.press('Escape');check('Escape returns focus to trigger',await page.getByTestId('faces-pill').evaluate(el=>el===document.activeElement));
 await page.getByTestId('faces-pill').hover();await opened();
 await page.keyboard.press('ArrowDown');check('keyboard enters popup',await page.getByTestId('subagents-panel').evaluate(el=>el.contains(document.activeElement)));
 await page.getByTestId('subagent-row').first().click();
 check('row invokes its actual open callback',(await page.getByRole('status').innerText()).includes('ASTRA · VERIFICATION'));
 check('open callback closes popup',await page.getByTestId('subagents-panel').count()===0);
 await page.getByRole('button',{name:'Back to crew',exact:true}).click();await opened();
 for(const state of ['No measurement','Partial rate','Stale rate','Needs you','Finished','Empty','Disconnected','16 agents']){
  await page.getByRole('button',{name:state,exact:true}).click();await opened();
  if(['No measurement','Stale rate'].includes(state))check(`${state} is not a fabricated zero`,await page.getByTestId('pill-rate').innerText()==='— tok/s');
  if(state==='Partial rate')check('partial coverage marked',await page.getByTestId('pill-rate').innerText()==='~89.8+ tok/s');
  if(state==='Needs you')check('blocked row remains visible',(await page.locator('.ab-subagents__branch[data-tone=failed] .ab-subagents__node-state').innerText()).includes('Blocked'));
  if(state==='Finished')check('completed rates excluded',(await page.locator('.ab-subagents__metrics').innerText()).includes('Working\n0'));
  if(state==='Empty')check('empty state explicit',await page.getByText('No agents working right now',{exact:true}).isVisible());
  if(state==='Disconnected')check('failure distinct from empty',await page.getByText('Activity unavailable',{exact:true}).isVisible());
  if(state==='16 agents'){
   check('long list scrolls inside popup',await page.locator('.ab-subagents__body').evaluate(el=>el.scrollHeight>el.clientHeight));
   await page.locator('.ab-subagents__body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   check('bottom batch reachable',await page.getByRole('button',{name:/Workspace handoff/}).isVisible());
  }
  await bounds(1440);await shot(`state-${state.toLowerCase().replaceAll(' ','-')}`);
 }
 await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});await page.goto(url);await opened();await page.getByRole('button',{name:'Details for ASTRA · VERIFICATION',exact:true}).first().click();await bounds(390);await shot('details-390');
 await page.evaluate(() => { window.fetch = async () => new Response('{}', { status: 503 }); });
 await page.getByText('Could not refresh agents. Last known activity is shown; rates are unavailable.',{exact:true}).waitFor();
 check('failed refresh preserves known rows',await page.locator('[data-testid=subagent-row]:visible').count()===3);
 check('failed refresh clears the rate',await page.getByTestId('pill-rate').innerText()==='— tok/s');
 check('no browser errors',result.errors.length===0);result.status='passed';
}catch(e){result.status='failed';result.failure=String(e);process.exitCode=1;}
finally{await browser?.close();fs.writeFileSync(path.join(out,'render-checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
