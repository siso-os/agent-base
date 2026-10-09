import { createServer } from '../../../apps/web/node_modules/vite/dist/node/index.js';
import react from '../../../apps/web/node_modules/@vitejs/plugin-react/dist/index.js';
import { chromium } from '../node_modules/playwright/index.mjs';
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer as portProbe } from 'node:net';
import { handleProductMap } from '../src/product-map.ts';
const repo=path.resolve(import.meta.dirname,'../../..'), proof=path.join(repo,'.agents/scratchpads/landing-20261006/product-map-proof');
mkdirSync(proof,{recursive:true});
const fixtureRoot=realpathSync(mkdtempSync(path.join(tmpdir(),'product-map-ui-')));
const catalog=JSON.parse(readFileSync(path.join(repo,'ui-hub/components.json'),'utf8'));
const total=catalog.components.filter(c=>c.kind!=='manual').length;
// Isolated catalog and metadata; never use a production rating store or live API.
writeFileSync(path.join(fixtureRoot,'components.json'),JSON.stringify(catalog));
for(const c of catalog.components)mkdirSync(path.join(fixtureRoot,c.id));
for(const section of ['states','animations','edge-cases']){for(const file of ['index.html','README.md'])copyFileSync(path.join(repo,'ui-hub',section,file),path.join(fixtureRoot,section,file));}for(const file of ['manual.js','manual.css'])copyFileSync(path.join(repo,'ui-hub/states',file),path.join(fixtureRoot,'states',file));
const chat=catalog.components.find(c=>c.id==='chat');chat.pages=[{id:'feedback',title:'Synthetic feedback',file:'FEEDBACK.md'},{id:'round',title:'Synthetic example round',file:'rounds/example/',kind:'gallery'}];
writeFileSync(path.join(fixtureRoot,'components.json'),JSON.stringify(catalog));
mkdirSync(path.join(fixtureRoot,'chat/rounds/example'),{recursive:true});
writeFileSync(path.join(fixtureRoot,'chat/FEEDBACK.md'),'# Synthetic feedback\nThis text is a test fixture, not a human review.');
writeFileSync(path.join(fixtureRoot,'chat/surface.json'),JSON.stringify({lane:'now',openFeedback:1}));
writeFileSync(path.join(fixtureRoot,'library/surface.json'),JSON.stringify({lane:'next',landedAt:new Date().toISOString()}));
const tasks=[{id:'t-9999',title:'Synthetic catalog task',stage:'working',agent:'Fixture builder',links:{surface:'chat'}}];
let failSaves=false, failReads=false, failImages=false;
const probe=portProbe();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const fixturePort=probe.address().port;await new Promise(r=>probe.close(r));
const vite=await createServer({configFile:false,root:repo,plugins:[react(),{name:'product-map-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{
 if(req.url==='/fixture/fail-image'){failImages=true;res.end('ok');return;}
 if(failImages&&req.url?.endsWith('/after.png')){res.writeHead(404);res.end('Synthetic missing image');return;}
 if(req.url==='/fixture/fail-save'){failSaves=true;res.end('ok');return;}
 if(req.url==='/fixture/fail-read'){failReads=true;res.end('ok');return;}
 if(req.url?.startsWith('/api/product-map')&&((failSaves&&req.method==='POST')||(failReads&&req.method==='GET'&&req.url==='/api/product-map'))){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Synthetic unavailable"}');return;}
 if(!await handleProductMap(req,res,{hubRoot:fixtureRoot,tasks}))next();
 });}}],resolve:{alias:{react:path.join(repo,'apps/web/node_modules/react'),'react-dom':path.join(repo,'apps/web/node_modules/react-dom')},dedupe:['react','react-dom']},server:{watch:null,host:'127.0.0.1',port:fixturePort,strictPort:true,fs:{allow:[repo]}}});
let browser;const checks=[],errors=[];
const check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true});console.log('PASS',name);};
try{
 await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/apps/web/preview/product-map.html');await page.getByText(`${total} of ${total} surfaces`,{exact:true}).waitFor();
 check('catalog renders every registered surface',await page.locator('.pm-tile').count()===total);
 await page.getByRole('button',{name:'States',exact:true}).click();await page.getByRole('button',{name:'working',exact:true}).click();
 check('manual working state uses actual HaloRim',await page.locator('.pm-manual .siso-rim').getAttribute('data-state')==='working');
 await page.locator('.pm-manual').screenshot({path:path.join(fixtureRoot,'chat/rounds/example/after.png')});
 await page.getByRole('button',{name:'States',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:false}).click();await page.locator('[data-surface="chat"] img').waitFor();
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(proof,`map-${width}.png`),fullPage:false});
  check(`map no overflow at ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('[data-surface="chat"]').getByRole('button',{name:'View & rate'}).click();
 await page.getByRole('textbox',{name:'Feedback in your words'}).fill('Synthetic user interaction for persistence verification');await page.getByRole('button',{name:'Good',exact:true}).click();await page.getByText('Saved good for Chat.',{exact:true}).waitFor();
 await page.screenshot({path:path.join(proof,'rating-detail-1440.png')});
 await page.getByRole('button',{name:'Close surface review'}).click();await page.reload();await page.locator('[data-surface="chat"] .pm-verdict-good').waitFor();
 check('rating and note survive HTTP reload',JSON.parse(readFileSync(path.join(fixtureRoot,'chat/surface.json'),'utf8')).rating.note==='Synthetic user interaction for persistence verification');
 await page.getByRole('button',{name:'Never reviewed',exact:true}).click();check('unrated lens excludes saved user rating',await page.locator('[data-surface="chat"]').count()===0);
 await page.getByRole('button',{name:'Running now',exact:true}).click();check('running lens matches explicit task links',await page.locator('.pm-tile').count()===1);
 await page.getByRole('button',{name:'Landed this week',exact:true}).click();check('landed lens uses recorded dates only',await page.locator('.pm-tile').count()===1);
 await page.getByRole('button',{name:'All surfaces',exact:true}).click();await page.getByRole('searchbox').fill('no-matching-surface');await page.getByText('No surfaces in this view',{exact:true}).waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 check('clear restores catalog',await page.locator('.pm-tile').count()===total);
 await page.locator('[data-surface="chat"]').getByRole('button',{name:'View & rate'}).click();await page.getByRole('textbox',{name:'Feedback in your words'}).fill('Preserve this failed draft');await page.request.get(base+'/fixture/fail-save');await page.getByRole('button',{name:'Shit',exact:true}).click();await page.getByText('Rating was not saved. Your note is still here.',{exact:true}).waitFor();
 check('failed save retains draft and prior verdict',(await page.getByRole('textbox',{name:'Feedback in your words'}).inputValue())==='Preserve this failed draft'&&JSON.parse(readFileSync(path.join(fixtureRoot,'chat/surface.json'),'utf8')).rating.value==='good');
 await page.keyboard.press('Escape');check('escape closes review',await page.getByRole('dialog').count()===0);
 await page.request.get(base+'/fixture/fail-image');await page.reload();await page.getByText('Stored screenshot unavailable',{exact:true}).waitFor();check('failed screenshot is labelled unavailable',true);
 for(const section of ['States','Animations','Edge cases']){
  await page.getByRole('button',{name:section,exact:true}).click();await page.locator('.pm-manual').scrollIntoViewIfNeeded();
  for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});const manualHeight=await page.locator('.pm-manual').evaluate(e=>e.getBoundingClientRect().height);await page.setViewportSize({width,height:Math.ceil(manualHeight)+500});await page.locator('.pm-manual').screenshot({path:path.join(proof,`${section.toLowerCase().replaceAll(' ','-')}-${width}.png`)});check(`${section} no overflow at ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  if(section==='Animations'){
   await page.evaluate(()=>{window.__receiptSeen=false;const o=new MutationObserver(()=>{if(document.querySelector('.siso-chat__receipt')?.textContent.includes('Received by agent')){window.__receiptSeen=true;o.disconnect();}});o.observe(document.body,{childList:true,subtree:true});});await page.getByRole('button',{name:'Simulate receipt',exact:true}).click();await page.waitForFunction(()=>window.__receiptSeen);check('receipt is explicit local acknowledgement example',true);
   await page.getByRole('button',{name:'Pause living assets',exact:true}).click();check('pause control toggled',await page.getByRole('button',{name:'Resume living assets',exact:true}).getAttribute('aria-pressed')==='true');
   await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Resume living assets',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pm-manual .li,.pm-manual .wm')).every(e=>e.dataset.motion==='off'));check('reduced motion stops unpaused living assets',true);
  }
  await page.getByRole('button',{name:section,exact:true}).click();
 }
 await page.request.get(base+'/fixture/fail-read');await page.getByRole('button',{name:'Refresh',exact:false}).click();await page.getByRole('alert').waitFor();check('read failure retains last catalog',await page.locator('.pm-tile').count()===total);
 for(const section of ['states','animations','edge-cases']){await page.goto(base+'/api/product-map/files/'+section+'/index.html');await page.getByRole('region',{name:'Component manual'}).waitFor();check('standalone '+section+' manual renders through API',await page.locator('.pm-manual h2').count()===1);if(section==='states'){await page.getByRole('button',{name:'working',exact:true}).click();check('reduced motion removes working rim rotation',await page.locator('.siso-rim').evaluate(e=>getComputedStyle(e,'::before').animationName)==='none');}}
 check('no browser runtime errors',errors.length===0);
 writeFileSync(path.join(proof,'receipt.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,synthetic:true,livePost:false,humanRatingGate:'No genuine user ratings collected; all persisted ratings were temporary synthetic test state.'},null,2));
 console.log(`PASS ${checks.length} product-map browser checks; ${proof}`);
}finally{await browser?.close();vite.httpServer?.closeAllConnections();await vite.close();rmSync(fixtureRoot,{recursive:true});}
