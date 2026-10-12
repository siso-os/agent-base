// Synthetic full-app regression; run with heavy. No live API/socket is reachable.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const {createServer}=createRequire(path.join(root,'apps/web/package.json'))('vite');
const before=process.argv.includes('--before');
const baseline='db2250ad02c57ebb27e0d9bb6d9f6f3899d66884';
const area=process.argv.find(x=>x.startsWith('--area='))?.split('=')[1] ?? 'bell';
const directory={bell:'bell',version:'tokens',infra:'side-nav'}[area];
const source={name:'papercut-baseline',enforce:'pre',load(id){
 if(!before)return;
 const rel=path.relative(root,id.split('?')[0]);
 if(!/^(apps\/web\/src|packages)\//.test(rel)||rel.includes('node_modules')||!/\.(tsx?|css)$/.test(rel))return;
 return execFileSync('git',['show',`${baseline}:${rel}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
}};
let server,browser;
const results=[];
try {
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),logLevel:'error',plugins:[source,{name:'sealed-api',configureServer(v){v.middlewares.use((req,res,next)=>{if(/^\/(api|chat|term)\b/.test(req.url??'')){res.statusCode=410;res.end('Fixture only');return;}next();});}}],server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:{ignored:['**/*']}}});
 await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await webkit.launch({headless:true});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',socket=>socket.close());
  const now=Date.now();let extra=false;
  const items=()=>Array.from({length:508+(extra?1:0)},(_,i)=>({id:`fixture-${i}`,ref:{hostInstanceId:'fixture',sessionId:'fixture',runId:'fixture'},phase:'completed',revision:1,at:new Date(i===508?Date.now():now-(i<500?48*3600_000:60_000)).toISOString(),agentId:'fixture-zero',agentName:'Fixture builder',headline:'Synthetic completed work',read:false,buzz:false,delivery:'off'}));
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.fallback():route.abort());
  await page.route(`${base}/api/**`,route=>{
   const p=new URL(route.request().url()).pathname;
   let body=fixtureResponse(p,'fixture');
   if(p==='/api/attention')body={...body,items:items()};
   if(p==='/api/org'&&area==='infra')body={...body,bottom:['HEALTH','EFFICIENCY','ESTATE'].map(name=>({name,domain:'Agent Infrastructure',icon:'bot',state:'live',working:0,plan:{checked:0,total:0,asked:0},status:'idle',ledger:null}))};
   if(p==='/api/version')body={web:'0.8.5',node:'0.8.2',desktop:'0.6.1',sha:'fixture-new',assets:['/fixture-new.js']};
   if(p==='/api/version/changes')body={subjects:['Synthetic release'],changes:[],sha:'fixture-new'};
   return route.fulfill({status:body?200:404,json:body??{}});
  });
  await page.goto(base);
  if(area==='bell'){
   // SISO OS §6 (t-0599): the bell is gone; ⌥⌘A opens the needs list (AttentionPanel), Esc closes it.
   await page.getByTestId('nav-rows').waitFor({state:'attached'});
   assert.equal(await page.getByTestId('notifications-bell').count(),0,'no bell in the top bar');
   await page.keyboard.press('Alt+Meta+KeyA');
   await page.getByRole('button',{name:'Close notifications'}).waitFor();
   await page.screenshot({path:path.join(root,`ui-hub/${directory}/papercut-${before?'before':'after'}-${width}.png`)});
   await page.getByRole('button',{name:'Close notifications'}).click();
   results.push({width,label:'no bell; ⌥⌘A opens the list'});
  }
  if(area==='version'){
   if(before){
    const trigger=page.getByRole('button',{name:'Versions: Update available'});await trigger.waitFor();
    await trigger.hover();await page.waitForTimeout(300);
    await page.getByRole('dialog',{name:'Version details',exact:true}).waitFor();
    await page.screenshot({path:path.join(root,`ui-hub/${directory}/papercut-before-${width}.png`)});
    results.push({width,hover:'opens',click:'baseline'});
   }else{
    // t-0570 (Shaan, 9 Oct: "there's this pinned versions thing hanging around I hate"): the floating Versions notice is gone;
    // the new build is offered from the top bar's Recorded pill, which opens on click (not hover) as a pop-up, not a page.
    const pill=page.getByTestId('version-pill');await pill.waitFor();
    assert.equal(await page.getByRole('button',{name:/^Versions:/}).count(),0,'no floating version notice');
    assert.equal(await pill.getAttribute('data-ready'),'true','the pill marks the waiting build');
    const peek=page.getByTestId('version-peek');
    await pill.hover();await page.waitForTimeout(300);assert.equal(await peek.count(),0,'hover does not open it');
    await page.screenshot({path:path.join(root,`ui-hub/${directory}/papercut-after-${width}.png`)});
    await pill.click();await peek.waitFor();
    assert.ok((await peek.innerText()).includes('New build ready'),'the pop-up offers the build');
    assert.equal(await page.getByTestId('whats-new').count(),0,'no page opened');
    await page.keyboard.press('Escape');await peek.waitFor({state:'detached'});
    results.push({width,hover:'closed',click:'Recorded pill opens the pop-up with the new build; Escape dismisses'});
   }
  }
  if(area==='infra'){
   // The infrastructure folder in the side nav. t-0557 removed it (8 Oct); t-0570 brought it back on Shaan's word (9 Oct: "we got
   // rid of the agent infrastructure and the side now I don't know why we did that"); since 12 Oct it is a folder, not the footer.
   await page.getByTestId('nav-infra').waitFor();
   await page.screenshot({path:path.join(root,`ui-hub/${directory}/papercut-${before?'before':'after'}-${width}.png`)});
   if(!before){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ab:open-servers')));}
   results.push({width,footer:'present'});
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 writeFileSync(path.join(root,`ui-hub/${directory}/papercut-${before?'before':'after'}-checks.json`),JSON.stringify({baseline,area,results},null,2)+'\n');
 console.log(JSON.stringify({area,before,results}));
}finally{await browser?.close();await server?.close();}
