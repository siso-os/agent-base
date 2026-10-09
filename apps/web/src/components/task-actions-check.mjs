import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();const {webkit}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const browser=await webkit.launch({headless:true});
const result={at:new Date().toISOString(),checks:[],errors:[],scope:'Synthetic task store and mocked allocation only; no real tasks/agents/hosts mutated'};
const common={project:'Agent Base',owner:'AGENT-BASE',agent:null,priority:'P1',updated:new Date().toISOString(),source:'available',model:null,his:'Review the task cards',next:'Check the title and spacing'};
const shot='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="580"><rect width="960" height="580" fill="#202420"/><text x="70" y="110" font-size="40" font-family="sans-serif" fill="#d6e0d6">Synthetic task evidence</text><rect x="70" y="170" width="810" height="270" rx="24" fill="#303830"/></svg>');
const initial=[{...common,id:'t-9901',shots:{before:shot,after:shot},title:'Review the complete task card with its full readable title',stage:'preview'}, {...common,id:'t-9902',title:'Check the mobile spacing',stage:'preview'},{...common,id:'t-9903',title:'Start the fully specified task',stage:'specced'},{...common,id:'t-9904',priority:'P2',title:'Prepare the incomplete specification',stage:'thought'}];
try {
 const page=await browser.newPage({viewport:{width:1024,height:900},reducedMotion:'reduce'});
 page.on('pageerror',e=>result.errors.push(e.message));
 await page.routeWebSocket('**/*',s=>s.close());
 await page.addInitScript(()=>{window.EventSource=undefined;window.__TASK_CARDS_TEST__=true;});
 let tasks=structuredClone(initial),fail=false,hold=null,writes=[],allocationPhase=null;
 await page.route('**/api/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname,id=p.split('/')[4],task=tasks.find(t=>t.id===id);
  if(request.method()==='POST'){
   writes.push({path:p,body:request.postDataJSON()});
   if(fail)return route.fulfill({status:422,json:{ok:false,error:'Synthetic save refused'}});
   if(hold)await hold;
   if(p.endsWith('/allocate')){allocationPhase='preparing';return route.fulfill({json:{ok:true,accepted:true,name:'FIXTURE-BUILDER',workspace:{phase:'preparing'}}});}
   Object.assign(task,request.postDataJSON(),{updated:new Date().toISOString()});return route.fulfill({json:{ok:true,task}});
  }
  if(p==='/api/a0/tasks')return route.fulfill({json:{updated:new Date().toISOString(),tasks,counts:{}}});
  if(p==='/api/task-workspaces')return route.fulfill({json:{workspaces:[]}});
  if(p.endsWith('/actions'))return route.fulfill({json:{specReady:id==='t-9903',canStart:id==='t-9903',reason:id==='t-9904'?'A complete spec is needed':'',expectedRevision:'a'.repeat(64),idempotencyKey:'task-'+'b'.repeat(40),...(id==='t-9903'&&allocationPhase?{action:'retry',workspace:{name:'FIXTURE-BUILDER',phase:allocationPhase,error:allocationPhase==='failed'?'Synthetic delayed start failed':null}}:{})}});
  if(task)return route.fulfill({json:{...task,history:[],links:{}}});
  return route.fulfill({status:404,json:{}});
 });
 await page.goto('http://127.0.0.1:54531/preview/task-cards.html');
 const task=id=>page.locator(`[data-testid=plan-step][data-id=${id}]`);
 await task('t-9901').waitFor();
 let release;hold=new Promise(r=>release=r);
 await task('t-9901').getByRole('button',{name:'Good',exact:true}).click();
 assert.equal(await page.getByTestId('task-verdict-receipt').count(),0);
 assert.equal(await task('t-9901').locator('[data-state=saved]').count(),0);
 result.checks.push('No success check or receipt before accepted response');
 release();hold=null;
 await page.getByTestId('task-verdict-receipt').getByText('Rated Good · saved').waitFor();
 assert.equal(tasks[0].stage,'happy');assert.equal(writes[0].body.reason,'Good');
 await page.getByTestId('task-verdict-receipt').getByRole('button',{name:'Undo'}).click();
 await page.getByText('Restored to preview').waitFor();assert.equal(tasks[0].stage,'preview');await task('t-9901').getByRole('button',{name:'Good',exact:true}).waitFor();result.checks.push('Good saves happy with his Good and Undo restores preview with actions available again');
 await task('t-9902').getByRole('button',{name:'Redo',exact:true}).click();
 assert.equal(await task('t-9902').getByRole('button',{name:'Save Redo'}).isDisabled(),true);
 await task('t-9902').getByPlaceholder("What's off?").fill('spacing is off');fail=true;
 await task('t-9902').getByRole('button',{name:'Save Redo'}).click();
 await task('t-9902').getByRole('alert').waitFor();assert.equal(tasks[1].stage,'preview');assert.equal(await task('t-9902').getByPlaceholder("What's off?").inputValue(),'spacing is off');
 result.checks.push('Empty Redo refused; failed save preserves draft and preview state');fail=false;
 await task('t-9902').getByRole('button',{name:'Save Redo'}).click();await page.getByTestId('task-verdict-receipt').getByText('Redo saved · spacing is off',{exact:true}).waitFor();assert.equal(tasks[1].stage,'rework');assert.equal(writes.at(-1).body.reason,'spacing is off');result.checks.push('Redo saves actual words through task edit route');
 await task('t-9903').locator('.ab-plan__line').click();
 await task('t-9903').getByRole('button',{name:'Start',exact:true}).click();
 await task('t-9903').getByText('Workspace preparing · FIXTURE-BUILDER').waitFor();assert.equal(writes.at(-1).path,'/api/a0/tasks/t-9903/allocate');assert.deepEqual(writes.at(-1).body,{expectedRevision:'a'.repeat(64),idempotencyKey:'task-'+'b'.repeat(40)});result.checks.push('Start sends revision and idempotency tokens; preparing receipt never claims connected');
 allocationPhase='failed';await task('t-9903').getByRole('alert').filter({hasText:'Synthetic delayed start failed'}).waitFor();await task('t-9903').getByRole('button',{name:'Retry Start',exact:true}).click();await task('t-9903').getByText('Workspace preparing · FIXTURE-BUILDER').waitFor();allocationPhase='active';await task('t-9903').getByText('Workspace connected · FIXTURE-BUILDER').waitFor();result.checks.push('Delayed workspace failure reveals Retry Start and a later verified active receipt shows connected');
 await page.locator('[data-phase=ideas] .ab-plan__head').click();
 await task('t-9904').locator('.ab-plan__line').click();
 await task('t-9904').getByRole('button',{name:'Spec it',exact:true}).click();await task('t-9904').getByText(/spec it \(Shaan asked/).waitFor();assert.match(tasks[3].next,/^NOW: spec it/);result.checks.push('Incomplete spec requests NOW through existing edit route');
 await page.screenshot({path:path.join(root,'ui-hub/right-panel/rounds/verbs/task-actions-synthetic-1024.png'),fullPage:true});
 const building=page.locator('[data-phase=building] .ab-plan__head');
 await building.focus();await page.keyboard.press('Space');assert.equal(await building.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('[data-phase=building] .ab-task-fold').getAttribute('inert'),'');
 await page.reload();await building.waitFor();assert.equal(await building.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('.ab-task-fold').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 result.checks.push('Keyboard folds persist across reload; collapsed content is inert and reduced motion disables transitions');
 await page.setViewportSize({width:390,height:844});
 await task('t-9901').getByRole('button',{name:'Redo',exact:true}).click();
 await task('t-9901').getByPlaceholder("What's off?").fill('The next action needs more space');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(root,'ui-hub/right-panel/rounds/verbs/task-actions-redo-390.png'),fullPage:false});
 result.checks.push('390px Redo field and existing mic fit without horizontal overflow');
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:54531/preview/task-cards.html?overview');
 await page.locator('[data-task-card=t-9901]').waitFor();
 await page.screenshot({path:path.join(root,'ui-hub/right-panel/rounds/verbs/task-overview-1440.png'),fullPage:false});
 await page.locator('[data-task-card=t-9901]').getByRole('button',{name:/^After:/}).click();
 const modal=page.getByRole('dialog',{name:'Task evidence'});await modal.waitFor();
 await modal.getByRole('button',{name:'Redo',exact:true}).click();
 await modal.getByPlaceholder("What's off?").fill('The evidence needs a clearer caption');
 await page.screenshot({path:path.join(root,'ui-hub/right-panel/rounds/verbs/task-lightbox-verdict-1440.png'),fullPage:false});
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
 result.checks.push('Dashboard 360px task card and real evidence modal expose Good/Redo with optional existing mic; Escape closes');


 await page.close();
} catch(e){result.error=e.message;process.exitCode=1;}
finally{await browser.close();writeFileSync(path.join(root,'ui-hub/right-panel/rounds/verbs/task-actions-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
