import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(), phase=process.argv[2]??'before';
const {webkit}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const real=await(await fetch('http://127.0.0.1:5401/api/a0/tasks')).json();
const registry=await(await fetch('http://127.0.0.1:5401/api/task-workspaces')).json().catch(()=>({workspaces:[]}));
const origin='http://127.0.0.1:54531', out=path.join(root,'ui-hub/right-panel/rounds/verbs');
const {transformWithEsbuild}=await import(createRequire(path.join(root,'apps/web/package.json')).resolve('vite'));
const browser=await webkit.launch({headless:true});
const result={phase,source:phase==='before'?'Task sources reconstructed from 24b88a79; current shared face package; live GET-only task snapshot':'Current task source with live GET-only task snapshot',at:new Date().toISOString(),screenshots:[],checks:[],errors:[]};
try {
 for(const width of [1440,1024,390]) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.routeWebSocket('**/*',s=>s.close());
  await page.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};});
  if(phase==='before') await page.route('**/src/components/**',async route=>{
   const url=new URL(route.request().url()),rel='apps/web'+url.pathname;
   const beforeFiles=['OwnerTasksPanel.tsx','OwnerTasksPanel.css','TasksPage.css','TaskWorkspaceGroups.tsx','TaskWorkspaceGroups.css','panel/TaskTree.tsx','panel/TaskTree.css'];
   if(!beforeFiles.some(f=>url.pathname==='/src/components/'+f))return route.continue();
   const source=execFileSync('git',['show','24b88a79:'+rel],{cwd:root,encoding:'utf8'});
   if(rel.endsWith('.css'))return route.fulfill({contentType:'text/javascript',body:`import {updateStyle} from '/@vite/client';updateStyle(${JSON.stringify(rel)},${JSON.stringify(source)});`});
   const transformed=await transformWithEsbuild(source,rel,{loader:'tsx',jsx:'transform',jsxFactory:'__React.createElement',jsxFragment:'__React.Fragment'});
   const current=await(await fetch(url.href)).text();
   const urls=[...current.matchAll(/from ["']([^"']+)["']/g)].map(m=>m[1]);
   let code=transformed.code.replace(/import \{([^}]+)\} from ["']react["'];?/g,(_m,names)=>`const {${names}}=__React;`).replace(/from ["']([^"']+)["']/g,(m,spec)=>{
    if(spec.startsWith('.'))return m;
    const key=spec.replaceAll('/','_').replaceAll('@','@');
    const found=urls.find(u=>u.includes('/'+key+'.js') || (spec.startsWith('@siso/') && u.includes('/packages/siso-'+spec.slice(6)+'/src/')));
    if(found)return `from ${JSON.stringify(found)}`;
    if(spec==='react/jsx-runtime')return 'from "/node_modules/.vite/deps/react_jsx-runtime.js"';
    throw Error('Unresolved before import '+spec);
   });
   const ownerModule=urls.some(u=>u.includes('/react.js?'))?current:await(await fetch(origin+'/src/components/OwnerTasksPanel.tsx')).text();
   const reactUrl=ownerModule.match(/from ["']([^"']*\/react\.js\?[^"']+)["']/)?.[1];
   return route.fulfill({contentType:'text/javascript',body:`import __React from ${JSON.stringify(reactUrl)};\n`+code});
  });
  await page.route('**/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(route.request().method()!=='GET')throw Error('Mutation forbidden in real capture');
   if(p==='/api/a0/tasks') return route.fulfill({json:real});
   if(p==='/api/task-workspaces')return route.fulfill({json:registry});
   if(p.endsWith('/actions'))return route.fulfill({status:503,json:{error:'Allocation not connected in review'}});
   if(/^\/api\/a0\/tasks\/t-\d+$/.test(p))return route.fulfill({json:real.tasks.find(t=>t.id===p.split('/').pop())??{},status:200});
   return route.fulfill({json:{},status:404});
  });
  await page.goto(origin+'/preview/task-cards.html');
  await page.getByTestId('task-plan').waitFor({timeout:15000}).catch(async e=>{console.log((await page.locator('body').innerText()).slice(0,2000));throw e;});
  await page.screenshot({path:path.join(out,`task-cards-${phase}-${width}.png`),fullPage:false});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)throw Error('Horizontal overflow '+width);
  result.screenshots.push(`ui-hub/right-panel/rounds/verbs/task-cards-${phase}-${width}.png`);
  result.checks.push({width,overflow,rows:await page.getByTestId('plan-step').count()});
  await page.close();
 }
}finally{await browser.close();writeFileSync(path.join(out,`task-cards-${phase}-receipt.json`),JSON.stringify(result,null,2));}
if(result.errors.length)throw Error(result.errors.join('\n'));
console.log(JSON.stringify(result));
