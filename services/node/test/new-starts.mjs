// Actual launch routes, durable scratch workspace lifecycle and real Sidebar/App callbacks.
// The service executor only publishes synthetic identities; no agent, provider or launchd is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { chromium } from 'playwright';
import ts from '../../../apps/web/node_modules/typescript/lib/typescript.js';
import { agentLaunchRoutes } from '../src/routes/agent-launch.area.ts';
import { getWorkspace, receiptFile, WorkspaceError } from '../src/worktrees.ts';
import { configuredClaudeProfile, receiptClaudeProfile, startSupervisedClaude } from '../src/claude-service-lifecycle.ts';
import { configDir } from '../../host/src/service.ts';

const root=path.resolve(import.meta.dirname,'../../..'),scratch=realpathSync(mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-new-starts.')));
const repo=path.join(scratch,'repo'),hosts=path.join(scratch,'hosts');mkdirSync(repo);mkdirSync(hosts);
process.env.AB_WORKSPACES_DIR=path.join(scratch,'receipts');process.env.AB_WORKTREE_ROOT=path.join(scratch,'worktrees');
const catalogFile=path.join(scratch,'backend-catalog.json');process.env.AB_BACKEND_CATALOG=catalogFile;
const catalog={schema:1,revision:1,artifacts:['fixture-one','fixture-two'].map((id,i)=>({id,provider:'codex',version:`1.2.${i+3}`,executable:path.join(scratch,'synthetic-never-executed'),sha256:'a'.repeat(64)}))};
writeFileSync(catalogFile,JSON.stringify(catalog),{mode:0o600});
let catalogAvailability='available';
const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);mkdirSync(path.join(repo,'.agents'));
writeFileSync(path.join(repo,'.agents/workspace.json'),JSON.stringify({version:1,fetch:false,submodules:'none',copyFiles:[],setup:[]}));writeFileSync(path.join(repo,'fixture.txt'),'synthetic repo\n');git(['add','.']);git(['commit','-qm','fixture']);
const standing=path.join(scratch,'standing-seat.json'),standingBody=JSON.stringify({name:'A0',session:'standing-original',login_launcher:'standing-launcher',pane:'protected-pane'});writeFileSync(standing,standingBody);
const source=readFileSync(path.join(root,'services/node/src/server.ts'),'utf8'),ast=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true);
const guards=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['startAgent','startZero'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
assert.ok(!/herdr\(|keeper|a0-sdk|writeFileSync/.test(guards));
const context=vm.createContext({WorkspaceError});new vm.Script(ts.transpileModule(guards,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText).runInContext(context);
let profile=configuredClaudeProfile(configDir('claude-siso-3')),rejectOnce=false;
const acceptedHosts=new Map(),commands=[],posts=[],checks=[];
const adapters={find:async r=>{const h=acceptedHosts.get(r.name);if(!h)return null;if(h.workspaceId!==r.workspaceId)throw new WorkspaceError('Existing host ownership preserved');return {id:`service-${r.name}`,session:h.session};},start:async(r,file)=>{
  if(r.input.harness==='codex'){commands.push({name:r.name,workspaceId:r.workspaceId,backendCatalogId:r.input.backendCatalogId});acceptedHosts.set(r.name,{name:r.name,workspaceId:r.workspaceId,session:`native-${r.workspaceId}`});return {label:`fixture.${r.name}`};}
  const saved=receiptClaudeProfile(r);assert.ok(saved);const liveProfile={...saved};
  return startSupervisedClaude(r,file,{...liveProfile,hostsDir:hosts},async command=>{
    commands.push({name:r.name,workspaceId:r.workspaceId,...command});
    assert.equal(command.env.AB_WORKSPACE_RECEIPT,file);assert.equal(JSON.parse(readFileSync(command.env.AB_SEAT_FILE)).login_launcher,saved.loginLauncher);
    const h={name:r.name,workspaceId:r.workspaceId,session:`native-${r.workspaceId}`,cwd:r.worktreePath,harness:'claude'};acceptedHosts.set(r.name,h);writeFileSync(path.join(hosts,`name-${r.name}.json`),JSON.stringify(h));
  });
}};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const runtime={ALLOWED_ORIGINS:new Set(),json,launchRepo:b=>b.repo,moveToHost:async()=>{throw Error('migration forbidden');},readBody:async req=>{let b='';for await(const c of req)b+=c;return b;},registry:{projects:[{id:'fixture',name:'Fixture repository',path:repo}],agents:{}},startAgent:context.startAgent,startZero:context.startZero,workspaceAdapters:adapters,zeroStarting:false,claudeLaunchProfile:()=>({...profile})};
const route=agentLaunchRoutes(runtime);
const api=http.createServer(async(req,res)=>{try{
  if(req.url==='/api/backends')return catalogAvailability==='error'?json(res,503,{error:'fixture catalog unavailable'}):json(res,200,{catalog:{availability:catalogAvailability,reason:catalogAvailability==='available'?null:'catalog-not-staged',artifacts:catalogAvailability==='available'?catalog.artifacts.map(({id,provider,version})=>({id,provider,version})):[]}});
  if(req.url==='/api/workspaces/repos')return json(res,200,{repos:[{id:'fixture',name:'Fixture repository',path:repo}]});
  if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();posts.push({url:req.url,body:body?JSON.parse(body):{}});req[Symbol.asyncIterator]=async function*(){yield body;};if(rejectOnce&&req.url==='/api/agents/start'){rejectOnce=false;return json(res,503,{error:'Synthetic retry: request retained'});}}
  const result=await route.handle(req,res,[],new URL(req.url,'http://fixture'));if(result===false)json(res,200,{agents:[],rows:[],running:0,tokens:0});
}catch(e){json(res,500,{error:e.message});}});
const until=async fn=>{for(let i=0;i<160;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Fixture timeout');};
let vite,browser;
try{
  await new Promise(r=>api.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${api.address().port}`;
  const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {code:r.status,body:await r.json()};};
  for(const body of [{},{name:'LEGACY',cwd:repo},{name:'LEGACY',repo,workspace:'A0'}])assert.equal((await post('/api/agents/start',body)).code,409);
  assert.equal((await post('/api/agents/start-zero',{})).code,409);assert.equal(commands.length,0);assert.equal(readFileSync(standing,'utf8'),standingBody);
  checks.push('actual legacy start and start-zero routes return 409 without agent execution or standing-seat changes');
  const input={launchId:'profile-launch',name:'PROFILE',repo,model:'fixture-model',prompt:'initial fixture prompt',workspace:{type:'isolated'},claudeProfile:{version:1,loginLauncher:'claude',permissionMode:'plan'}};
  const first=await post('/api/agents/start',input);assert.equal(first.code,202,JSON.stringify(first.body));await until(()=>getWorkspace(first.body.workspaceId).phase==='active');
  const r=getWorkspace(first.body.workspaceId);assert.equal(r.input.claudeProfile.loginLauncher,'claude-siso-3');assert.equal(r.input.claudeProfile.permissionMode,'bypassPermissions');assert.equal(r.agent.session,`native-${r.workspaceId}`);assert.equal(r.input.prompt,input.prompt);
  assert.equal((await post('/api/agents/start',input)).body.workspaceId,r.workspaceId);assert.equal(commands.length,1);
  profile=configuredClaudeProfile(configDir('claude'));assert.equal((await post('/api/agents/start',input)).code,409);profile=configuredClaudeProfile(configDir('claude-siso-3'));assert.equal(receiptClaudeProfile(getWorkspace(r.workspaceId)).loginLauncher,'claude-siso-3');
  checks.push('receipt snapshots server-owned configured login; forged client profile is ignored; replay is one handoff and changed configuration fails closed');
  assert.equal((await post('/api/agents/start',{...input,launchId:'reserved',name:'A0'})).code,400);assert.equal((await post('/api/agents/start',{...input,launchId:'dot-name',name:'BAD.NAME'})).code,400);
  const collision=await post('/api/agents/start',{...input,launchId:'different-owner'});assert.equal(collision.code,202);await until(()=>getWorkspace(collision.body.workspaceId).phase==='failed');assert.equal(commands.length,1);assert.equal(acceptedHosts.get('PROFILE').workspaceId,r.workspaceId);
  checks.push('reserved A0, unsafe service name and different launch claiming an existing name cannot replace ownership');

  const app=readFileSync(path.join(root,'apps/web/src/App.tsx'),'utf8'),appAst=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),callbacks={};
  const visit=n=>{if(ts.isJsxAttribute(n)&&['onNewClaude','onNewCodex'].includes(n.name.getText(appAst)))callbacks[n.name.getText(appAst)]=n.initializer.expression.getText(appAst);ts.forEachChild(n,visit);};visit(appAst);assert.ok(callbacks.onNewClaude&&callbacks.onNewCodex);
  const callbackCode=ts.transpileModule(`const onNewClaude=${callbacks.onNewClaude};const onNewCodex=${callbacks.onNewCodex};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const fixtureCode=`import React from 'react';import {createRoot} from 'react-dom/client';import {Sidebar} from '/src/components/Sidebar.tsx';import {requestWorkspace,draftLaunchId,completeLaunchDraft} from '/src/lib/agents.ts';import '/src/index.css';
  window.__newStarts={accepted:[]};const acceptWorkspace=r=>window.__newStarts.accepted.push(r);${callbackCode}
  const noop=()=>{};const zero={id:'standing',key:'fixture/A0',name:'Agent Zero',zero:true,a0:true,main:true,row:'live',status:'idle',tool:'claude',host:true,chat:true,session:'standing-original',cwd:'/fixture',pane:'',machine:'Fixture',machineKey:'fixture',hud:{model:'fixture-model'},project:'Fixture',owner:null,lead:null};
  createRoot(document.getElementById('root')).render(<div style={{width:320,minHeight:'100vh'}}><Sidebar agents={[zero]} domains={[]} activeId="standing" error={null} onOpen={noop} onAct={noop} onEdit={noop} onReorder={noop} onReorderProjects={noop} onWorkers={noop} onRename={noop} org={null} onOrg={noop} onPage={noop} onProjectDashboard={noop} onEndedPage={noop} onNewClaude={onNewClaude} onNewCodex={onNewCodex}/></div>);`;
  const {createServer}=await import(path.join(root,'apps/web/node_modules/vite/dist/node/index.js'));runtime.ALLOWED_ORIGINS.add(base);
  vite=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),cacheDir:path.join(scratch,'node_modules/.vite'),optimizeDeps:{entries:['src/components/Sidebar.tsx'],include:['react-dom/client']},plugins:[{name:'new-starts-fixture',resolveId:id=>id==='/new-starts-fixture.tsx'?'\0new-starts-fixture.tsx':null,load:id=>id==='\0new-starts-fixture.tsx'?ts.transpileModule(fixtureCode,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText:null,configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/new-starts-fixture')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/new-starts-fixture.tsx"></script></body></html>'));});}}],server:{port:0,strictPort:false,host:'127.0.0.1',proxy:{'/api':{target:base,headers:{origin:base}},'/chat':{target:base},'/term':{target:base}}}});await vite.listen();
  browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error('Fixture UI error: '+e.message);});
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/new-starts-fixture`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByTestId('zero-switch').click();await page.getByRole('button',{name:'Claude chat',exact:true}).click();
  const submit=page.getByRole('button',{name:'Start Claude chat',exact:true});assert.equal(await submit.isDisabled(),true);await page.getByLabel('Claude chat name').fill('CLAUDE-ONE');
  await page.getByRole('button',{name:/Repository/}).click();await page.getByRole('menuitem').filter({hasText:'Fixture repository'}).click();
  assert.equal(await submit.isEnabled(),true);await page.screenshot({path:path.join(scratch,'claude-launch-1440.png')});
  rejectOnce=true;await submit.click();await page.getByRole('alert').filter({hasText:'Synthetic retry'}).waitFor();assert.equal(await page.getByLabel('Claude chat name').inputValue(),'CLAUDE-ONE');
  const failed=posts.at(-1);await submit.click();await until(()=>acceptedHosts.has('CLAUDE-ONE'));
  const retried=posts.at(-1);assert.equal(failed.body.launchId,retried.body.launchId);assert.equal(retried.body.workspace.type,'isolated');assert.equal(retried.body.repo,repo);assert.equal(await page.evaluate(()=>window.__newStarts.accepted.length),1);
  assert.equal(posts.some(p=>p.url==='/api/agents/start-zero'&&p.body.name==='CLAUDE-ONE'),false);
  checks.push('rendered real Sidebar + App Claude callback requires name/workspace, retains failed draft identity, retries one receipt and accepts native service workspace');
  await page.setViewportSize({width:390,height:844});await page.getByTestId('zero-switch').click();await page.getByRole('button',{name:'Claude chat',exact:true}).click();await page.getByLabel('Claude chat name').fill('CLAUDE-TWO');
  await page.screenshot({path:path.join(scratch,'claude-launch-390.png')});const dialog=page.getByRole('dialog',{name:'New chat'}),box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);await page.getByRole('button',{name:'Start Claude chat',exact:true}).click();await until(()=>acceptedHosts.has('CLAUDE-TWO'));
  assert.notEqual(acceptedHosts.get('CLAUDE-ONE').session,acceptedHosts.get('CLAUDE-TWO').session);assert.equal(readFileSync(standing,'utf8'),standingBody);
  checks.push('390px launch form remains within viewport; second distinct Claude chat gets its own identity while standing seat bytes remain unchanged');
  await page.keyboard.press('Escape');await page.getByTestId('zero-switch').press('Enter');await page.getByRole('button',{name:'Codex chat',exact:true}).click();assert.equal(await page.getByLabel('Codex chat name').isVisible(),true);assert.equal(await page.getByRole('button',{name:'Start Codex chat',exact:true}).isVisible(),true);
  checks.push('existing Codex name/workspace form remains available');
  await page.getByLabel('Codex chat name').fill('CODEX-ONE');await page.getByLabel('Codex version (optional)').selectOption('fixture-one');
  await page.screenshot({path:path.join(scratch,'codex-version-390.png')});await page.getByRole('button',{name:'Start Codex chat',exact:true}).click();await until(()=>acceptedHosts.has('CODEX-ONE'));
  const boundPost=posts.at(-1).body,bound=getWorkspace(acceptedHosts.get('CODEX-ONE').workspaceId);assert.equal(boundPost.backendCatalogId,'fixture-one');assert.equal(bound.input.backendCatalogId,'fixture-one');assert.ok(!('executable' in boundPost)&&!('sha256' in boundPost));
  assert.equal((await post('/api/agents/start-codex',boundPost)).body.workspaceId,bound.workspaceId);assert.equal(commands.filter(c=>c.name==='CODEX-ONE').length,1);
  const resume={...boundPost,workspace:{type:'existing',workspaceId:bound.workspaceId}};assert.equal((await post('/api/agents/start-codex',resume)).code,202);
  const {backendCatalogId:ignored,...implicit}=resume;assert.equal((await post('/api/agents/start-codex',implicit)).code,202);assert.equal(getWorkspace(bound.workspaceId).input.backendCatalogId,'fixture-one');
  assert.equal((await post('/api/agents/start-codex',{...resume,backendCatalogId:'fixture-two'})).code,409);
  checks.push('real Sidebar and App callback send catalog ID only; real route persists it and replay starts once; existing resume preserves binding and rejects explicit version changes');
  const count=commands.length;for(const id of ['',null,42,{},'../fixture-one','x'.repeat(129),'unknown'])assert.equal((await post('/api/agents/start-codex',{...boundPost,backendCatalogId:id,launchId:'invalid-version-'+String(id),name:'INVALID'})).code,400);assert.equal(commands.length,count);
  const unbound={...boundPost,name:'CODEX-DEFAULT',launchId:'codex-default'};delete unbound.backendCatalogId;process.env.AB_BACKEND_CATALOG=path.join(scratch,'missing-catalog');
  assert.equal((await post('/api/agents/start-codex',{...boundPost,name:'UNAVAILABLE',launchId:'catalog-unavailable'})).code,503);
  const plain=await post('/api/agents/start-codex',unbound);assert.equal(plain.code,202);await until(()=>acceptedHosts.has('CODEX-DEFAULT'));assert.ok(!('backendCatalogId' in getWorkspace(plain.body.workspaceId).input));process.env.AB_BACKEND_CATALOG=catalogFile;
  assert.equal((await post('/api/agents/start-codex',{...unbound,workspace:{type:'existing',workspaceId:plain.body.workspaceId},backendCatalogId:'fixture-one'})).code,409);
  checks.push('malformed/unknown IDs rejected before handoff; unavailable catalog rejects explicit selection while absent binding preserves normal launch; existing unbound resume cannot acquire a different binding');
  await page.setViewportSize({width:1440,height:900});await page.getByTestId('zero-switch').click();await page.getByRole('button',{name:'Codex chat',exact:true}).click();await page.getByLabel('Codex chat name').fill('CODEX-DESKTOP');await page.screenshot({path:path.join(scratch,'codex-version-1440.png')});
  catalogAvailability='unavailable';await page.evaluate(async()=>{const {refresh}=await import('/src/lib/poll.ts');await refresh('/api/backends');});await page.getByText('Choose the default or an available version to continue.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start Codex chat',exact:true}).isDisabled(),true);await page.getByLabel('Codex version (optional)').selectOption('');await page.getByText('No staged Codex versions. Uses the configured default.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start Codex chat',exact:true}).isEnabled(),true);
  catalogAvailability='error';await page.evaluate(async()=>{const {refresh}=await import('/src/lib/poll.ts');await refresh('/api/backends');});await page.getByText('Versions could not be refreshed. The configured default is available.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start Codex chat',exact:true}).isEnabled(),true);
  await page.evaluate(({repo})=>sessionStorage.setItem(`ab-launch:codex:CODEX-DESKTOP:${JSON.stringify({repo,workspace:{type:'isolated'}})}`,'preserved-default-draft'),{repo});await page.getByRole('button',{name:'Start Codex chat',exact:true}).click();await until(()=>acceptedHosts.has('CODEX-DESKTOP'));assert.equal(posts.at(-1).body.launchId,'preserved-default-draft');assert.ok(!('backendCatalogId' in posts.at(-1).body));
  checks.push('Codex version form fits390/1440; unavailable selected version blocks submission; missing/error state permits configured default and preserves its existing retry key');assert.deepEqual(errors,[]);
  writeFileSync(path.join(scratch,'checks.json'),JSON.stringify({ok:true,count:checks.length,checks,evidence:scratch,commands:commands.map(c=>({name:c.name,workspaceId:c.workspaceId}))},null,2));
  console.log(JSON.stringify({ok:true,count:checks.length,checks,evidence:scratch}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();if(vite){vite.httpServer?.closeAllConnections();await Promise.race([vite.close(),new Promise(r=>setTimeout(r,3000))]);}api.closeAllConnections();await new Promise(r=>api.close(r));}
// A Vite optimizer may retain an internal handle after all owned servers and browser contexts close.
process.exit(process.exitCode ?? 0);
