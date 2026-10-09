/** Full retained local bundle -> initial controller selection -> native spawn -> fresh management HTTP proof. Synthetic only. */
import assert from 'node:assert/strict';
import { installPlutilFixtureAdapter } from './helpers/plutil-fixture.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { provisionLocalCodex, readBackendCatalog, verifyBackendBundle, nativeBackendTarget } from '../src/backend-artifacts.ts';
import { readBackendSelection, backendChildEnvironment } from '../src/backend-version.ts';
import { createBackendRuntime, backendRuntimeIdentity } from '../src/backend-runtime.ts';
import { prepareInitialBackend } from '../src/backend-service.ts';
import { dispatchRoute } from '../../node/src/routes/registry.ts';

const root = realpathSync(mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-backend-producer.'))), repo = path.join(root,'repo');
const dirs = Object.fromEntries(['artifacts','workspaces','hosts','plists','activity','queues','questions'].map(key=>[key,path.join(root,key)]));
for (const dir of [repo,...Object.values(dirs)]) mkdirSync(dir,{mode:0o700});
const plistAdapter = installPlutilFixtureAdapter(dirs.plists);
const catalogFile=path.join(root,'catalog.json'), id='ws-backend-producer', receiptFile=path.join(dirs.workspaces,id+'.json'), selection=receiptFile+'.backend-selection';
const owner={name:'BACKEND-PRODUCER',label:'com.siso.host-BACKEND-PRODUCER',cwd:repo}, target=nativeBackendTarget();
const platformName=`@openai/codex-${process.platform}-${process.arch}`, sourcePackage=path.join(root,'package'), vendor=path.join(sourcePackage,'node_modules',platformName,'vendor',target);
const native=path.join(vendor,'bin','codex'), resource=path.join(vendor,'codex-resources','fixture.txt');
for(const dir of ['bin','codex-resources','codex-path'])mkdirSync(path.join(vendor,dir),{recursive:true,mode:0o700});
const options={sourcePackage,artifactsDir:dirs.artifacts,catalogFile,expectedCatalogRevision:0};
const checked=[],check=(name,fn)=>{fn();checked.push(name);};
const vars={AB_WORKSPACES_DIR:dirs.workspaces,AB_BACKEND_CATALOG:catalogFile,AB_HOSTS_DIR:dirs.hosts,AB_LAUNCH_AGENTS_DIR:dirs.plists,AB_LAUNCHCTL:path.join(root,'launchctl')};
const saved=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
let runner,server,proxy;let runnerError='';
const wait=async f=>{for(let i=0;i<160;i++){if(await f())return;await new Promise(r=>setTimeout(r,50));}throw Error('Fixture timeout: '+runnerError.slice(-1200));};
const writeJSON=(file,value)=>writeFileSync(file,JSON.stringify(value),{mode:0o600});
const hostFile=path.join(dirs.hosts,'name-'+owner.name+'.json'),readHost=()=>JSON.parse(readFileSync(hostFile,'utf8'));
try {
  const metadata=version=>{
    writeJSON(path.join(sourcePackage,'package.json'),{name:'@openai/codex',version,optionalDependencies:{[platformName]:`npm:@openai/codex@${version}-${process.platform}-${process.arch}`}});
    writeJSON(path.join(vendor,'../../package.json'),{name:'@openai/codex',version:`${version}-${process.platform}-${process.arch}`,os:[process.platform],cpu:[process.arch]});
    writeJSON(path.join(vendor,'codex-package.json'),{layoutVersion:1,version,target,variant:'codex',entrypoint:'bin/codex',resourcesDir:'codex-resources',pathDir:'codex-path'});
  };
  metadata('1.2.3');
  const source=`#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\nint main(int n,char **a){if(getenv("CODEX_MANAGED_PACKAGE_ROOT")||getenv("CODEX_MANAGED_BY_NPM"))return 43;if(n==4 && !strcmp(a[3],"--version")){if(getenv("OPENAI_API_KEY")||getenv("HOME"))return 44;puts("codex-cli 1.2.3");return 0;}char line[65536];while(fgets(line,sizeof(line),stdin)){char *id=strstr(line,"\\\"id\\\":");if(!id)continue;int seq=atoi(id+5);const char *r="{}";if(strstr(line,"thread/start")||strstr(line,"thread/resume"))r="{\\\"thread\\\":{\\\"id\\\":\\\"fixture-thread\\\",\\\"turns\\\":[],\\\"createdAt\\\":1}}";else if(strstr(line,"model/list"))r="{\\\"data\\\":[]}";printf("{\\\"id\\\":%d,\\\"result\\\":%s}\\n",seq,r);fflush(stdout);}return 0;}\n`;
  execFileSync('/usr/bin/cc',['-x','c','-o',native,'-'],{input:source,stdio:['pipe','pipe','pipe']});chmodSync(native,0o700);
  copyFileSync(native,path.join(vendor,'bin','codex-code-mode-host'));chmodSync(path.join(vendor,'bin','codex-code-mode-host'),0o700);
  writeFileSync(resource,'synthetic resource A',{mode:0o600});writeFileSync(path.join(vendor,'codex-path','helper'),'synthetic helper',{mode:0o600});
  const first=provisionLocalCodex(options),a1=first.artifact;
  check('producer snapshots complete platform layout with private provenance and no downloaded claim',()=>{
    assert.equal(first.catalogRevision,1);assert.equal(first.downloaded,false);assert.equal(verifyBackendBundle(a1).files,5);
    const m=JSON.parse(readFileSync(a1.bundle.manifest));assert.equal(m.provenance.origin,'existing-local-installed-package');assert.equal(m.provenance.upstreamVerified,false);assert.equal(m.provenance.downloadedAt,null);assert.equal(statSync(a1.bundle.manifest).mode&0o777,0o600);assert.ok(existsSync(path.join(path.dirname(a1.bundle.manifest),'bin','codex-code-mode-host')));
  });
  check('same full snapshot is idempotent and wrong catalog revision fails',()=>{assert.equal(provisionLocalCodex({...options,expectedCatalogRevision:1}).changed,false);assert.throws(()=>provisionLocalCodex(options),/revision changed/);});
  writeFileSync(resource,'synthetic resource B');
  const second=provisionLocalCodex({...options,expectedCatalogRevision:1}),a2=second.artifact;
  check('resource-only update retains both immutable bundles and previous catalog',()=>{assert.notEqual(a1.id,a2.id);assert.equal(readBackendCatalog(catalogFile).value.artifacts.length,2);assert.equal(readBackendCatalog(catalogFile+'.revision-1.json').value.artifacts.length,1);assert.equal(verifyBackendBundle(a1).files,5);assert.equal(verifyBackendBundle(a2).files,5);});
  check('administrator CLI stages only the requested installed package and emits honest status',()=>{const result=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--no-warnings',path.resolve(import.meta.dirname,'../bin/backend-catalog.mjs'),'--source-package',sourcePackage,'--artifacts-dir',dirs.artifacts,'--catalog',catalogFile,'--expected-catalog-revision','2'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'}));assert.equal(result.artifactId,a2.id);assert.equal(result.changed,false);assert.equal(result.downloaded,false);assert.equal(result.validated,false);assert.equal(result.running,false);assert.equal(result.selected,false);});
  const retainedResource=path.join(path.dirname(a2.bundle.manifest),'codex-resources','fixture.txt');chmodSync(retainedResource,0o600);writeFileSync(retainedResource,'changed');chmodSync(retainedResource,0o444);
  check('non-entrypoint resource tampering fails full bundle validation',()=>assert.throws(()=>verifyBackendBundle(a2),/contents changed/));
  chmodSync(retainedResource,0o600);writeFileSync(retainedResource,'synthetic resource B');chmodSync(retainedResource,0o444);
  check('source scripts and non-executable native entrypoints are rejected',()=>{
    const bytes=readFileSync(native);writeFileSync(native,'#!/bin/sh\nexit 0\n');assert.throws(()=>provisionLocalCodex({...options,expectedCatalogRevision:2}),/architecture/);writeFileSync(native,bytes);chmodSync(native,0o600);assert.throws(()=>provisionLocalCodex({...options,expectedCatalogRevision:2}),/not executable/);chmodSync(native,0o700);
  });
  execFileSync('git',['init','-q','-b','fixture',repo]);
  const receipt={version:1,workspaceId:id,launchId:'backend-launch',name:owner.name,machine:hostname(),worktreePath:repo,commonGitDir:path.join(repo,'.git'),branch:'fixture',inputFingerprint:'fixture',phase:'starting',sequence:1,config:{version:1},handoffAttempted:true,agent:{name:owner.name,label:owner.label},input:{launchId:'backend-launch',name:owner.name,harness:'codex',model:'fixture-model',backendCatalogId:a1.id,workspace:{type:'shared',reason:'synthetic fixture'}},stages:['validate','fetch','checkout','submodules','copy-files','setup','agent'].map(id=>({id,status:'done'}))};
  writeJSON(receiptFile,receipt);
  const lockFile=path.join(dirs.workspaces,'launch-'+id+'.lock'),mode=path.join(root,'launchctl-mode'),calls=path.join(root,'launchctl-calls');writeFileSync(mode,'missing');
  writeFileSync(vars.AB_LAUNCHCTL,`#!${process.execPath}\nimport fs from 'node:fs';const a=process.argv.slice(2);if(a[0]==='print'){if(fs.readFileSync(${JSON.stringify(mode)},'utf8')==='loaded')process.exit(0);console.error('Bad request.\\nCould not find service "'+a[1].split('/').at(-1)+'" in domain for user gui: '+process.getuid());process.exit(113);}if(a[0]!=='bootstrap')process.exit(42);fs.appendFileSync(${JSON.stringify(calls)},a[0]+'\\n');`,{mode:0o700});
  check('fresh selection requires held launch lock and matching catalog ID',()=>{assert.throws(()=>prepareInitialBackend(receiptFile,owner,'fixture-model',dirs.hosts));writeJSON(lockFile,{machine:hostname(),pid:process.pid,nonce:'fixture'});writeJSON(receiptFile,{...receipt,input:{...receipt.input,backendCatalogId:'missing'}});assert.throws(()=>prepareInitialBackend(receiptFile,owner,'fixture-model',dirs.hosts),/retained local bundle/);writeJSON(receiptFile,receipt);assert.equal(existsSync(selection),false);});
  const env={PATH:'/usr/bin:/bin',...vars,AB_WORKSPACE_RECEIPT:receiptFile,AB_SEAT_FILE:path.join(root,'seat'),AB_SERVICE_LABEL:owner.label,AB_ACTIVITY_DIR:dirs.activity,AB_PROMPT_QUEUE_DIR:dirs.queues,AB_QUESTION_JOURNAL_DIR:dirs.questions,HERDR_ENV:'0'};
  const controller=path.resolve(import.meta.dirname,'../src/service-control.ts'),args=['--experimental-strip-types','--no-warnings',controller,'install','--harness','codex','--name',owner.name,'--label',owner.label,'--model','fixture-model','--cwd',repo];
  writeFileSync(mode,'loaded');
  check('loaded job prevents first selection and service-definition creation',()=>{assert.throws(()=>execFileSync(process.execPath,args,{env,stdio:'pipe'}));assert.equal(existsSync(selection),false);assert.equal(existsSync(path.join(dirs.plists,owner.label+'.plist')),false);});
  writeFileSync(mode,'missing');
  execFileSync(process.execPath,args,{env,stdio:'pipe'});
  check('actual install controller stages catalog ID under launch lock before synthetic bootstrap',()=>{const s=readBackendSelection(selection,owner);assert.equal(s.history[0].artifact.bundle.sha256,a1.bundle.sha256);assert.equal(readFileSync(calls,'utf8'),'bootstrap\n');const plist=readFileSync(path.join(dirs.plists,owner.label+'.plist'),'utf8');assert.ok(plist.includes(selection));assert.ok(!plist.includes('AB_CODEX_BIN'));assert.throws(()=>prepareInitialBackend(receiptFile,owner,'fixture-model',dirs.hosts),/already exists/);});
  check('retained service clears global package ownership flags without copying the caller environment',()=>{const base={SAFE:'keep',CODEX_MANAGED_PACKAGE_ROOT:'/global',CODEX_MANAGED_BY_FUTURE:'1'};const child=backendChildEnvironment(base,selection,owner);assert.equal(child.SAFE,'keep');assert.equal(child.CODEX_MANAGED_PACKAGE_ROOT,undefined);assert.equal(child.CODEX_MANAGED_BY_FUTURE,undefined);assert.equal(base.CODEX_MANAGED_BY_FUTURE,'1');});
  const runtime=createBackendRuntime(selection,owner,id,a1.executable);runtime.spawned(process.pid);runtime.stopped(true);runtime.stopped();check('failed runtime evidence remains failed through shutdown',()=>{assert.equal(runtime.snapshot('fixture-thread').status,'failed');assert.equal(backendRuntimeIdentity(runtime.snapshot('fixture-thread')),null);});
  runner=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.resolve(import.meta.dirname,'../src/service-runner.ts'),'--harness','codex','--name',owner.name,'--model','fixture-model'],{cwd:repo,env:{...env,AB_BACKEND_SELECTION:selection,CODEX_MANAGED_PACKAGE_ROOT:'/synthetic/global',CODEX_MANAGED_BY_NPM:'1'},stdio:['ignore','pipe','pipe']});runner.stderr.on('data',b=>runnerError+=b);
  await wait(()=>{try{return readHost().session==='fixture-thread'&&readHost().backend?.status==='initialized';}catch{return false;}});
  const liveHost=readHost();
  check('actual runner and host attest the initialized native child, workspace, selection and full bundle',()=>{assert.equal(liveHost.backend.version,'1.2.3');assert.equal(liveHost.backend.bundleSha256,a1.bundle.sha256);assert.equal(liveHost.backend.hostPid,liveHost.pid);assert.notEqual(liveHost.backend.backendPid,liveHost.pid);assert.equal(liveHost.workspaceId,id);assert.equal(liveHost.backend.providerReportedVersion,null);assert.ok(existsSync(selection+'.lock'));});
  const { serviceLeavesRoutes }=await import('../../node/src/routes/services.area.ts');const routes=[serviceLeavesRoutes({ALLOWED_ORIGINS:new Set(['http://fixture'])})];
  server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');try{if(!await dispatchRoute(routes,req,res,url.pathname,url)){res.writeHead(404);res.end('{}');}}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const get=()=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:'/api/backends/'+id},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>resolve({status:r.statusCode,text,body:JSON.parse(text)}));}).on('error',reject);});
  let response=await get();
  check('real registry HTTP reports running version only after fresh matching loopback health',()=>{assert.equal(response.status,200);assert.equal(response.body.service.running.version,'1.2.3');assert.equal(response.body.service.running.evidence,'spawned-validated-local-bundle');assert.equal(response.body.service.writable,false);assert.equal(response.body.service.downloaded,null);assert.equal(response.text.includes(root),false);assert.equal(response.text.includes(liveHost.token),false);});
  // Alter only synthetic saved proof; live host remains different and management must fail closed.
  writeJSON(hostFile,{...liveHost,backend:{...liveHost.backend,runId:'00000000-0000-0000-0000-000000000000'}});response=await get();check('mismatched saved run identity cannot borrow a healthy native process',()=>assert.equal(response.body.service.running.version,null));writeJSON(hostFile,liveHost);
  proxy=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({pid:liveHost.pid,name:owner.name,session:liveHost.session,child:'running',backend:{...liveHost.backend,status:'stopped'}}));});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  writeJSON(hostFile,{...liveHost,port:proxy.address().port});response=await get();check('stopped health proof is rejected even while PIDs remain alive',()=>assert.equal(response.body.service.running.version,null));
  await new Promise(r=>proxy.close(r));proxy=null;
  proxy=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));writeJSON(hostFile,{...liveHost,port:proxy.address().port});const began=Date.now();response=await get();check('partial health response has a bounded absolute deadline',()=>{assert.equal(response.body.service.running.version,null);assert.ok(Date.now()-began<3000);});proxy.closeAllConnections();await new Promise(r=>proxy.close(r));proxy=null;writeJSON(hostFile,liveHost);
  const done=once(runner,'exit');runner.kill('SIGTERM');await done;runner=null;
  response=await get();check('stopped host returns no running version and releases selection lease',()=>{assert.equal(response.body.service.running.version,null);assert.equal(existsSync(selection+'.lock'),false);});
  runner=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.resolve(import.meta.dirname,'../src/service-runner.ts'),'--harness','codex','--name','BACKEND-CHILD','--model','fixture-model'],{cwd:repo,env:{...env,AB_WORKSPACE_RECEIPT:'',AB_SERVICE_LABEL:'',AB_CHILD_ID:'fixture-child',AB_BACKEND_SELECTION:selection,AB_CODEX_BIN:a1.executable},stdio:['ignore','pipe','pipe']});runner.stderr.on('data',b=>runnerError+=b);
  const childFile=path.join(dirs.hosts,'name-BACKEND-CHILD.json');await wait(()=>{try{return JSON.parse(readFileSync(childFile)).session==='fixture-thread';}catch{return false;}});
  check('hosted child retains inherited binary without claiming or locking parent service selection',()=>{assert.equal(JSON.parse(readFileSync(childFile)).backend,null);assert.equal(existsSync(selection+'.lock'),false);});
  const childDone=once(runner,'exit');runner.kill('SIGTERM');await childDone;runner=null;
  console.log(JSON.stringify({checks:checked.length,passed:checked,realProviderCalls:0,realServiceMutations:0,realCatalogMutations:0,downloads:0,plistConversion:plistAdapter.mode}));
} finally {
  plistAdapter.restore();
  if(runner&&runner.exitCode===null){const done=once(runner,'exit');runner.kill('SIGTERM');await done;}
  if(server)await new Promise(r=>server.close(r));if(proxy)await new Promise(r=>proxy.close(r));
  for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  rmSync(root,{recursive:true,force:true});
}
