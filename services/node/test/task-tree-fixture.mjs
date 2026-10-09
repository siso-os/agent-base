// Isolated TasksPage/reader check. No app server, proxies, accounts, agents, or CLI writes.
// Run: HEAVY_DIR=<fixture slots> heavy -- node services/node/test/task-tree-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..');
const canonical=process.env.AB_TASK_TREE_DEPS ?? path.join(os.homedir(), 'SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agent-base');
const require=createRequire(canonical+'/apps/web/package.json');
const esbuild=require(canonical+'/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'.siso-ephemeral-ab-task-tree-fixture-'));
const alias={};
for(const d of fs.readdirSync(root+'/packages')) {
 const folder=root+'/packages/'+d;
 if(!fs.existsSync(folder+'/package.json'))continue;
 const p=JSON.parse(fs.readFileSync(folder+'/package.json'));
 for(const [key,value] of Object.entries(p.exports??{}))if(typeof value==='string')alias[p.name+(key==='.'?'':key.slice(1))]=folder+'/'+value;
}
for(const folder of [canonical+'/apps/web',...fs.readdirSync(canonical+'/packages').map(d=>canonical+'/packages/'+d)]){
 if(!fs.existsSync(folder+'/package.json'))continue;
 const p=JSON.parse(fs.readFileSync(folder+'/package.json'));
 for(const name of Object.keys({...p.dependencies,...p.devDependencies,...p.peerDependencies})){
  const loc=folder+'/node_modules/'+name;
  if(name.startsWith('@siso/')||alias[name]||!fs.existsSync(loc))continue;
  alias[name]=fs.realpathSync(loc);
 }
}
alias['modern-screenshot']=path.join(os.homedir(),'SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base/ab-nav-iterate/node_modules/.pnpm/modern-screenshot@4.7.0/node_modules/modern-screenshot');
const build=options=>esbuild.build({bundle:true,jsx:'automatic',alias,logLevel:'warning',...options});
const env={...process.env,AB_TASK_TREE_FIXTURE:scratch,AB_A0_TASKS:scratch+'/tasks',AB_TIMELINE_GALLERIES:scratch+'/galleries',AB_TASK_WORKSPACE_NATIVE_PROBE:'0'};
try {
 if(!process.argv.includes('--skip-unit')) {
 await build({entryPoints:[root+'/apps/web/src/lib/__tests__/task-tree.fixture.ts'],outfile:scratch+'/checks.mjs',platform:'node',format:'esm',loader:{'.css':'empty'},banner:{js:"import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(import.meta.url);"}});
 execFileSync(process.execPath,['--test',scratch+'/checks.mjs'],{env,stdio:'inherit'});
 }
 // Read installed types directly; no dependency installation, copied modules or symlinks.
 const ts=require('typescript');
 const cfg=ts.readConfigFile(root+'/apps/web/tsconfig.json',ts.sys.readFile);
 const parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,root+'/apps/web');
 parsed.options.typeRoots=[canonical+'/apps/web/node_modules/@types'];parsed.options.types=[];
 parsed.fileNames.push(canonical+'/apps/web/node_modules/vite/client.d.ts');
 const host=ts.createCompilerHost(parsed.options);
 host.resolveModuleNames=(names,file)=>names.map(n=>n.startsWith('@siso/') ? ts.resolveModuleName(alias[n]??n,file,parsed.options,host).resolvedModule : ts.resolveModuleName(n,file,parsed.options,host).resolvedModule??ts.resolveModuleName(n,file.replace(root,canonical),parsed.options,host).resolvedModule??ts.resolveModuleName(alias[n]??n,file,parsed.options,host).resolvedModule);
 const ds=ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames,parsed.options,host));
 console.log(ts.formatDiagnosticsWithColorAndContext(ds,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 console.log('WEB_TYPECHECK '+(ds.length?'FAIL':'PASS')+' '+ds.length);
 if(ds.length)process.exitCode=1;
 const nodeOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,allowImportingTsExtensions:true,skipLibCheck:true,noEmit:true,types:['node'],typeRoots:[canonical+'/services/node/node_modules/@types']};
 const nodeDs=ts.getPreEmitDiagnostics(ts.createProgram([root+'/services/node/src/a0-tasks.ts'],nodeOptions));
 console.log(ts.formatDiagnosticsWithColorAndContext(nodeDs,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 console.log('TASK_READER_TYPECHECK '+(nodeDs.length?'FAIL':'PASS')+' '+nodeDs.length);
 if(nodeDs.length)process.exitCode=1;
 if(process.argv.includes('--render'))await render();
}finally{
 if(process.env.AB_TASK_TREE_KEEP_FIXTURE==='1')console.log('Synthetic scratch: '+scratch);
 else fs.rmSync(scratch,{recursive:true}); // Exactly this run's generated synthetic files.
}
async function render(){
 const {webkit}=await import(pathToFileURL(canonical+'/services/node/node_modules/playwright/index.mjs'));
 await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {TasksPage} from '${root}/apps/web/src/components/TasksPage'; import '@siso/tokens/siso.css'; import '@siso/tokens/tokens.css'; createRoot(document.getElementById('root')).render(<TasksPage/>);`,resolveDir:root,loader:'tsx'},outfile:scratch+'/page.js',platform:'browser',format:'esm'});
 const browser=await webkit.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const errors=[];const requests=[];
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const row=(id,extra={})=>({id,title:id,project:'Project',owner:'OWNER',model:null,priority:'P1',stage:'building',updated:'2026-10-06T00:00:00Z',...extra});
  const long='A complete task title that must remain legible across the whole page including the final words: LAST WORDS ARE VISIBLE';
  const rows=[row('parent',{stage:'live',title:'Durable parent project'}),row('child',{parent:'parent',needs:true,title:long,his:'Inspect this synthetic task',short:'A complete task…',next:'NEEDS HIM: choose the fixture result',agent:'WORKER'}),row('missing-next',{needs:true,next:null}),row('unsorted',{project:'Unknown',owner:null,source:'unavailable'})];
  const registry={workspaces:[{id:'project',name:'Project',owner:'OWNER',color:'#6aaeff',order:0,nav:true}]};
  let mode='normal',revision=0;
  await page.addInitScript(()=>{window.EventSource=undefined;});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());requests.push(url.href);
   if(url.origin!=='http://task-tree.fixture')return route.abort();
   const body=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/page.css"><style>body{margin:0;background:#111216;color:#e5e5e8;font-family:system-ui}button,input,select{font:inherit}button{color:inherit;background:none;border:0;cursor:pointer}#root{min-height:100vh}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/page.js"></script></body></html>'});
   if(['/page.js','/page.css'].includes(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(scratch+url.pathname)});
   if(url.pathname==='/api/a0/tasks'){
    if(mode==='loading')return new Promise(resolve=>setTimeout(()=>resolve(body({tasks:rows,counts:{},updated:String(revision)})),1500));
    if(mode==='index-error')return body({error:'fixture outage'},503);
    return body({tasks:mode==='empty'?[]:rows,counts:{},updated:String(revision)});
   }
   if(url.pathname==='/api/workspace-registry')return body(mode==='registry-error'?{invalid:true}:registry);
   if(url.pathname.startsWith('/api/a0/tasks/')){
    if(mode==='detail-error')return body({error:'fixture detail unavailable'},503);
    return body(rows.find(t=>t.id===url.pathname.split('/').pop()));
   }
   return route.abort();
  });
  const assert=(ok,note)=>{if(!ok)throw Error(note);console.log('RENDER_PASS '+note);};
  await page.goto('http://task-tree.fixture');
  const head=page.locator('[data-workspace="project"] > button');if(await head.getAttribute('aria-expanded')==='false')await head.click();
  assert(await page.locator('[data-id="child"]').count()===1,'child reachable beneath closed parent');
  assert(await page.locator('[data-id="child"]').innerText().then(s=>s.includes(long)),'complete title present with original words');
  await page.reload();await page.locator('[data-id="child"]').waitFor();
  assert(await head.getAttribute('aria-expanded')==='true','workspace expansion survives reload');
  await page.getByRole('tab',{name:/Needs you/}).click();
  assert(await page.locator('[data-id="parent"]').count()===1,'Needs you retains parent context');
  assert(await page.getByText(/Next action not recorded/).count()===1,'missing next step has explicit owner action');
  await page.keyboard.press('/');assert(await page.getByRole('searchbox').evaluate(el=>el===document.activeElement),'slash focuses search');
  await page.getByRole('searchbox').fill('LAST WORDS');
  assert(await page.locator('[data-id="child"]').count()===1&&await page.locator('[data-id="parent"]').count()===1,'search retains matching child and parent');
  assert(await page.locator('[data-id="missing-next"]').count()===0,'search excludes sibling');
  const line=page.locator('[data-id="child"] > button');await line.focus();await page.keyboard.press('Enter');await page.getByText('Executor: WORKER',{exact:false}).last().waitFor();
  assert(await page.locator('[data-testid="task-open"]').count()===1,'Enter pins task detail');
  for(const width of [1440,1100]){
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow '+width);
   await page.screenshot({path:scratch+'/tasks-'+width+'.png',fullPage:true});
  }
  await page.keyboard.press('Escape');assert(await page.locator('[data-testid="task-open"]').count()===0,'Escape closes detail');
  mode='detail-error';await line.click();await page.getByRole('alert').waitFor();
  assert(await page.getByRole('button',{name:'Move to…',exact:true}).count()===0,'unavailable detail has no stale mutation controls');
  await page.screenshot({path:scratch+'/detail-error.png',fullPage:true});
  mode='registry-error';await page.reload();await page.getByText(/Workspace registry unavailable/).waitFor();
  assert(await page.locator('[data-id="child"]').count()===1,'failed registry keeps tasks reachable in Unsorted');
  await page.screenshot({path:scratch+'/registry-error.png',fullPage:true});
  mode='empty';await page.reload();if(await head.getAttribute('aria-expanded')==='false')await head.click();await page.getByText('No tasks in this view').first().waitFor();
  await page.screenshot({path:scratch+'/empty.png',fullPage:true});
  mode='index-error';await page.reload();await page.getByText("Agent Zero's task index is unavailable.").first().waitFor();
  await page.screenshot({path:scratch+'/index-error.png',fullPage:true});
  mode='loading';await page.reload();
  assert(await page.getByText("Reading Agent Zero's tasks…").count()>0,'loading distinct from empty/error');
  await page.screenshot({path:scratch+'/loading.png',fullPage:true});
  mode='normal';revision++;await page.reload();if(await head.getAttribute('aria-expanded')==='false')await head.click();await page.locator('[data-id="child"]').waitFor();
  rows[1].next='NEEDS HIM: inspect the CHANGED result';revision++;
  await page.reload();await page.getByText(/CHANGED result/).waitFor();
  await page.screenshot({path:scratch+'/changed.png',fullPage:true});
  assert(errors.length===0,'no browser runtime errors');
  assert(requests.every(u=>u.startsWith('http://task-tree.fixture/')),'all browser requests intercepted synthetic origin');
  fs.writeFileSync(scratch+'/render-receipt.json',JSON.stringify({widths:[1440,1100],errors,requests:requests.length,states:['normal','changed','empty','loading','registry-error','index-error','detail-error'],browser:'headless WebKit',closed:true},null,2));
 }finally{await browser.close();}
}
