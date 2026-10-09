/** Actual service-area registry + HTTP requests; only synthetic catalog, Git receipt, binaries and launchctl. */
import assert from 'node:assert/strict';
import { installPlutilFixtureAdapter } from '../../host/test/helpers/plutil-fixture.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { renderPlist } from '../../host/src/service-control.ts';
import { dispatchRoute } from '../src/routes/registry.ts';
import { lock } from '../src/worktrees.ts';

const root=realpathSync(mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-backend-http.')));
const workspaces=path.join(root,'workspaces'),hosts=path.join(root,'hosts'),plists=path.join(root,'plists'),repo=path.join(root,'repo');
for(const dir of [workspaces,hosts,plists,repo])mkdirSync(dir,{mode:0o700});
const plistAdapter = installPlutilFixtureAdapter(plists);
const id='ws-backend-fixture',file=path.join(workspaces,id+'.json'),selection=file+'.backend-selection';
const catalog=path.join(root,'catalog.json'),mode=path.join(root,'launchctl-mode'),calls=path.join(root,'launchctl-calls');
const owner={name:'BACKEND-HTTP',label:'com.siso.backend-http',cwd:repo};
const envKeys=['AB_WORKSPACES_DIR','AB_HOSTS_DIR','AB_LAUNCH_AGENTS_DIR','AB_BACKEND_CATALOG','AB_LAUNCHCTL'];
const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
Object.assign(process.env,{AB_WORKSPACES_DIR:workspaces,AB_HOSTS_DIR:hosts,AB_LAUNCH_AGENTS_DIR:plists,AB_BACKEND_CATALOG:catalog,AB_LAUNCHCTL:path.join(root,'launchctl')});
const passed=[];let server;
const check=(name,fn)=>{fn();passed.push(name);};
const fingerprint=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
try {
  writeFileSync(mode,'missing');
  writeFileSync(process.env.AB_LAUNCHCTL,`#!${process.execPath}\nimport fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},args[0]+'\\n');const mode=fs.readFileSync(${JSON.stringify(mode)},'utf8');if(args[0]!=='print')process.exit(50);if(mode==='loaded')process.exit(0);const label=args[1].split('/').at(-1);if(mode==='missing'||mode==='wrong-label'){console.error('Bad request.\\nCould not find service "'+(mode==='wrong-label'?'OTHER':label)+'" in domain for user gui: '+process.getuid());process.exit(113);}console.error('private-fixture-diagnostic');process.exit(mode==='generic113'?113:1);`,{mode:0o700});
  execFileSync('git',['init','-q','-b','fixture',repo]);
  const receipt={version:1,workspaceId:id,launchId:'backend-launch',name:owner.name,machine:hostname(),worktreePath:repo,commonGitDir:path.join(repo,'.git'),branch:'fixture',inputFingerprint:'fixture',phase:'active',sequence:1,config:{version:1},agent:{name:owner.name,label:owner.label,session:'fixture-session'},input:{launchId:'backend-launch',name:owner.name,harness:'codex',model:'fixture-model',workspace:{type:'shared',reason:'synthetic fixture'}},stages:['validate','fetch','checkout','submodules','copy-files','setup','agent'].map(id=>({id,status:'done'}))};
  writeFileSync(file,JSON.stringify(receipt),{mode:0o600});
  const definition=path.join(plists,owner.label+'.plist');
  const plist=managed=>renderPlist({...owner,resume:'fixture-session',seat:path.join(root,'seat'),hosts,node:process.execPath,runner:path.resolve(import.meta.dirname,'../../host/src/service-runner.ts'),harness:'codex',model:'fixture-model',env:{AB_WORKSPACE_RECEIPT:file,...(managed?{AB_BACKEND_SELECTION:selection}:{})}});
  writeFileSync(definition,plist(true),{mode:0o600});
  const artifactList=['1.2.3','1.2.4'].map((version,i)=>{
    const executable=path.join(root,`codex-${version}`);
    execFileSync('/usr/bin/cc',['-x','c','-o',executable,'-'],{input:`#include <stdio.h>\n#include <string.h>\nint main(int n,char **a){if(n!=4||strcmp(a[1],"-m")||strcmp(a[3],"--version"))return 42;puts("codex-cli ${version}");return 0;}\n`,stdio:['pipe','pipe','pipe']});
    chmodSync(executable,0o700);return{id:'artifact-'+(i+1),provider:'codex',version,executable,sha256:fingerprint(executable)};
  });
  const writeCatalog=()=>writeFileSync(catalog,JSON.stringify({schema:1,revision:1,artifacts:artifactList}),{mode:0o600});
  const {serviceLeavesRoutes}=await import('../src/routes/services.area.ts');
  const allowed=new Set(['http://backend-fixture']);
  const routes=[serviceLeavesRoutes({ALLOWED_ORIGINS:allowed})];
  server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');try{if(!await dispatchRoute(routes,req,res,url.pathname,url)){res.writeHead(404);res.end('{}');}}catch{res.writeHead(500);res.end('{}');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const request=(route,{method='GET',body,origin='http://backend-fixture',contentType='application/json'}={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{origin,'content-type':contentType}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,body:JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));
  });
  const select=(revision,catalogId='artifact-1',extra={})=>request('/api/backends/select',{method:'POST',body:{serviceId:id,expectedRevision:revision,catalogId,...extra}});
  let result=await request('/api/backends');
  check('missing private catalog is explicit unavailable and read-only',()=>{assert.equal(result.status,200);assert.equal(result.body.catalog.availability,'unavailable');assert.equal(result.body.services[0].writable,false);assert.equal(result.body.services[0].blocker,'catalog-not-staged');});
  result=await select(0);check('missing catalog blocks mutations without creating a selection',()=>{assert.equal(result.status,503);assert.equal(existsSync(selection),false);});
  result=await request('/api/backends/unknown');check('unknown service ID returns 404',()=>assert.equal(result.status,404));
  for(const [route,method,expected]of[['/api/backends','POST',405],['/api/backends/select','GET',405],['/api/backends/rollback','DELETE',405]]){result=await request(route,{method});assert.equal(result.status,expected);}
  passed.push('actual registry preserves route method boundaries');
  result=await request('/api/backends/select',{method:'POST',origin:'https://outside.invalid',body:{serviceId:id,expectedRevision:0,catalogId:'artifact-1'}});check('foreign origin rejected before ownership or writes',()=>assert.equal(result.status,403));
  result=await select(0,'artifact-1',{executable:'/private/do-not-read',sha256:'0'.repeat(64)});check('browser path/hash injection rejected',()=>assert.equal(result.status,400));
  result=await request('/api/backends/select',{method:'POST',body:'{bad'});check('malformed JSON rejected',()=>assert.equal(result.status,400));
  result=await request('/api/backends/select',{method:'POST',body:'x'.repeat(9000)});check('oversized body rejected with an HTTP response',()=>assert.equal(result.status,400));
  result=await request('/api/backends/select',{method:'POST',contentType:'text/plain',body:'{}'});check('non-JSON browser submission rejected',()=>assert.equal(result.status,415));
  writeCatalog();
  result=await request('/api/backends/'+id);
  check('GET separates source, selected, validation, loaded and unattested runtime',()=>{assert.equal(result.status,200);assert.ok(result.body.source.claude.sdkPin);assert.equal(result.body.service.selected,null);assert.equal(result.body.service.validated,null);assert.equal(result.body.service.loaded.loaded,false);assert.equal(result.body.service.running.version,null);assert.equal(result.body.service.writable,true);assert.equal(result.body.installationSupported,false);assert.equal(result.text.includes(root),false);});
  result=await select(0,'unknown');check('unknown catalog item cannot select',()=>assert.equal(result.status,404));
  const originalDefinition=fingerprint(definition);
  result=await select(0);check('HTTP selection validates synthetic local artifact under the shared launch lock',()=>{assert.equal(result.status,200);assert.equal(result.body.service.selected.version,'1.2.3');assert.equal(result.body.service.selected.revision,1);assert.equal(result.body.service.validated.evidence,'recorded-version-and-checksum-probe');assert.equal(fingerprint(definition),originalDefinition);});
  result=await select(1,'artifact-2');check('HTTP update retains selection history',()=>{assert.equal(result.status,200);assert.equal(result.body.service.history.length,2);assert.equal(result.body.service.selected.version,'1.2.4');});
  result=await request('/api/backends/rollback',{method:'POST',body:{serviceId:id,expectedRevision:2,targetRevision:1}});check('HTTP rollback revalidates an explicit retained revision',()=>{assert.equal(result.status,200);assert.equal(result.body.service.selected.version,'1.2.3');assert.equal(result.body.service.selected.revision,3);assert.equal(result.body.service.history.length,3);});
  const stable=fingerprint(selection);
  result=await select(2);check('stale revision is rejected',()=>{assert.equal(result.status,409);assert.equal(result.body.error,'selection-revision-changed');});
  result=await lock('launch-'+id,()=>select(3));check('existing lifecycle launch lock blocks concurrent backend selection',()=>assert.equal(result.status,409));
  writeFileSync(mode,'loaded');result=await select(3);check('loaded launchd seat is never changed',()=>{assert.equal(result.status,409);assert.equal(result.body.error,'service-active-or-host-unknown');});
  for(const fixtureMode of ['permission','generic113','wrong-label']){writeFileSync(mode,fixtureMode);result=await request('/api/backends/'+id);assert.equal(result.body.service.loaded.loaded,null);assert.equal(result.body.service.writable,false);assert.equal(result.text.includes('private-fixture-diagnostic'),false);result=await select(3);assert.equal(result.status,409);assert.equal(result.body.error,'launchctl-state-unknown');}
  passed.push('permission, generic exit 113 and wrong-label failures remain unknown');
  const launchctl=process.env.AB_LAUNCHCTL;process.env.AB_LAUNCHCTL=path.join(root,'missing-launchctl');result=await select(3);check('launchctl transport failure cannot become inactive',()=>{assert.equal(result.status,409);assert.equal(result.body.error,'launchctl-state-unknown');});process.env.AB_LAUNCHCTL=launchctl;
  writeFileSync(mode,'missing');
  const hostFile=path.join(hosts,'name-'+owner.name+'.json');writeFileSync(hostFile,JSON.stringify({...owner,workspaceId:id,pid:process.pid,token:'private-host-token'}),{mode:0o600});
  result=await select(3);check('live saved host blocks an otherwise unloaded job',()=>assert.equal(result.status,409));
  result=await request('/api/backends/'+id);check('host liveness never fabricates running version or reveals token',()=>{assert.equal(result.body.service.running.host,'alive');assert.equal(result.body.service.running.version,null);assert.equal(result.text.includes('private-host-token'),false);});rmSync(hostFile);
  writeFileSync(definition,plist(false));result=await request('/api/backends/'+id);check('unmanaged durable definition is explicitly read-only',()=>{assert.equal(result.body.service.writable,false);assert.equal(result.body.service.blocker,'service-definition-not-selection-managed');});
  const unmanaged=fingerprint(definition);result=await select(3);check('API never rewrites a pre-existing unmanaged service definition',()=>{assert.equal(result.status,409);assert.equal(fingerprint(definition),unmanaged);});writeFileSync(definition,plist(true));
  chmodSync(catalog,0o644);result=await select(3);check('non-private catalog cannot authorize executable selection',()=>assert.equal(result.status,503));chmodSync(catalog,0o600);
  assert.equal(fingerprint(selection),stable);assert.equal(fingerprint(definition),originalDefinition);
  for(const artifact of artifactList)assert.equal(fingerprint(artifact.executable),artifact.sha256);
  check('only catalog-selected receipts changed; service definitions and binaries retained',()=>{assert.ok(readFileSync(calls,'utf8').split('\n').filter(Boolean).every(command=>command==='print'));assert.equal(existsSync(path.join(workspaces,'launch-'+id+'.lock')),false);assert.equal(existsSync(selection+'.lock'),false);});
  console.log(JSON.stringify({checks:passed.length,passed,realProviderCalls:0,serviceMutations:0,plistConversion:plistAdapter.mode,route:'serviceLeavesRoutes -> registry -> actual loopback HTTP'}));
}finally{
  plistAdapter.restore();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  for(const key of envKeys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
  rmSync(root,{recursive:true,force:true});
}
// The service area imports existing background readers. This isolated process has no other owner.
process.exit(0);
