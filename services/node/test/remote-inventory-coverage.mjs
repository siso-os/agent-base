import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRemoteInventory, remoteCoverageTargets, remoteCoverageScript, parseRemoteCoverage, reconcileRemoteSources, readRemoteInventorySource } from '../src/remote-inventory.ts';
import { parseRemoteInventory, projectRemoteInventory } from '../../../apps/web/src/lib/remote-inventory.ts';
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
const base={machineKey:'mini',alias:'mac-mini-herdr',session:'jarvis'};
const host={...base,session:'ab-managed-hosts',source:'managed-hosts'},proc={...base,session:'codex-processes',source:'codex-processes'};
const pid='123:1791248400000',pid2='124:1791248401000';
const receipt=(extra={})=>({session:'session-a',parentSession:null,harness:'codex',reportedState:'working',fresh:true,processState:'observed',runtimeId:'100:1791248300000',reconciles:[pid],...extra});
const raw=(t,rows)=>({schema:1,source:t.source,rows,diagnostics:{eligibleProcesses:2}});
const parse=(t,rows)=>parseRemoteCoverage(raw(t,rows),t,10000);
const source=(t,rows,state='fresh')=>({machineKey:t.machineKey,machineUser:t.user,session:t.session,source:t.source,state,observedAt:10000,attemptedAt:10000,error:null,agents:parse(t,rows)});
check('fixed eligible scopes expand once per account',()=>{const vps={machineKey:'vps-siso',alias:'siso-vps',user:'siso',session:'halo'};assert.equal(remoteCoverageTargets([base,vps,{...vps,session:'agent-home'}]).length,7);assert.deepEqual(remoteCoverageTargets([{...base,machineKey:'other'},{...base,alias:'other'}]),[{...base,machineKey:'other'},{...base,alias:'other'}]);});
check('process identities remain unknown tasks and models never surface',()=>{const [a]=parse(proc,[{runtimeId:pid,parentRuntimeId:null,model:'private',prompt:'secret'}]);assert.equal(a.state,'unknown');assert.equal(a.taskSession,null);assert.equal(a.identity,'process-only');assert.equal(a.processState,'observed');assert.ok(!JSON.stringify(a).includes('secret'));assert.ok(!('model'in a));});
check('PID reuse creates distinct identities',()=>assert.notEqual(parse(proc,[{runtimeId:pid,parentRuntimeId:null}])[0].id,parse(proc,[{runtimeId:'123:1791248499999',parentRuntimeId:null}])[0].id));
check('exact observed process parent relation nests without names',()=>{const a=parse(proc,[{runtimeId:pid,parentRuntimeId:null},{runtimeId:pid2,parentRuntimeId:pid}]);assert.equal(a[1].parentId,a[0].id);});
check('missing or cyclic parents cannot create a hidden group',()=>{assert.equal(parse(proc,[{runtimeId:pid,parentRuntimeId:pid2}])[0].parentId,null);const rows=parse(proc,[{runtimeId:pid,parentRuntimeId:pid2},{runtimeId:pid2,parentRuntimeId:pid}]);assert.ok(rows.some(a=>a.parentId===null));});
check('managed child uses verified session relation',()=>{const a=parse(host,[receipt(),receipt({session:'child',parentSession:'session-a',runtimeId:'101:1791248300000',reconciles:[]})]);assert.equal(a[1].parentId,a[0].id);});
check('stale receipt cannot assert task liveness',()=>{const [a]=parse(host,[receipt({fresh:false})]);assert.equal(a.state,'unknown');assert.equal(a.stale,true);assert.equal(a.reportedState,'working');});
check('identical duplicates collapse and conflicting receipt identities lose state',()=>{assert.equal(parse(host,[receipt(),receipt()]).length,1);const [a]=parse(host,[receipt(),receipt({reportedState:'idle'})]);assert.equal(a.identity,'conflict');assert.equal(a.state,'unknown');assert.deepEqual(a.reconciles,[]);});
check('private receipt fields never leave projection',()=>{const [a]=parse(host,[receipt({name:'secret name',token:'secret',cwd:'/private',activityJournal:'private',model:'private',prompt:'secret'})]);assert.ok(!JSON.stringify(a).includes('secret'));assert.ok(!JSON.stringify(a).includes('private'));});
check('malformed and unsafe source identities reject',()=>{for(const r of [receipt({session:'../private'}),receipt({runtimeId:'bad'}),receipt({reconciles:['bad']})])assert.throws(()=>parse(host,[r]));assert.throws(()=>parseRemoteCoverage(raw(host,[]),{...host,alias:'unknown'},10));assert.throws(()=>remoteCoverageScript({...host,user:'root'}));});
check('same-process host claims are conflicts and do not swallow unmatched processes',()=>{const s=reconcileRemoteSources([source(host,[receipt(),receipt({session:'other'})]),source(proc,[{runtimeId:pid,parentRuntimeId:null}])]);assert.ok(s[0].agents.every(a=>a.identity==='conflict'));assert.equal(s[1].agents.length,1);});
check('only exact unique hosted process evidence reconciles',()=>{const s=reconcileRemoteSources([source(host,[receipt()]),source(proc,[{runtimeId:pid,parentRuntimeId:null},{runtimeId:pid2,parentRuntimeId:pid}])]);assert.equal(s[1].agents.length,1);assert.equal(s[1].agents[0].runtimeId,pid2);assert.equal(s[1].agents[0].parentId,null);assert.equal(s[1].diagnostics.reconciledProcesses,1);});
check('offline host evidence cannot hide a current process',()=>{assert.equal(reconcileRemoteSources([source(host,[receipt()],'stale'),source(proc,[{runtimeId:pid,parentRuntimeId:null}])])[1].agents.length,1);});
check('accounts and machines never reconcile across boundaries',()=>{const s=source(host,[receipt()]);s.machineUser='other';assert.equal(reconcileRemoteSources([s,source(proc,[{runtimeId:pid,parentRuntimeId:null}])])[1].agents.length,1);s.machineUser=undefined;s.machineKey='other';assert.equal(reconcileRemoteSources([s,source(proc,[{runtimeId:pid,parentRuntimeId:null}])])[1].agents.length,1);});
let targets=[base],calls=0,enabled=true,now=10000,fail=false;
const inv=createRemoteInventory({enabled:()=>enabled,targets:()=>targets,expandCoverage:true,now:()=>now,ttlMs:1000,read:async t=>{calls++;if(fail&&t.source==='codex-processes')throw Error('private');return t.source?raw(t,t.source==='managed-hosts'?[receipt()]:[{runtimeId:pid,parentRuntimeId:null},{runtimeId:pid2,parentRuntimeId:null}]):{agents:[]};}});
let snapshot=await inv.read();
check('production-shaped snapshot carries three sources and parses in current UI',()=>{assert.equal(snapshot.sources.length,3);assert.equal(snapshot.agents.length,2);assert.equal(snapshot.coverageComplete,false);assert.equal(projectRemoteInventory(parseRemoteInventory(snapshot),now).count,2);});
await inv.read();check('expanded collector TTL prevents repeated reads',()=>assert.equal(calls,3));
now+=1001;fail=true;snapshot=await inv.read();check('source outage preserves only marked unknown last-good rows',()=>{const s=snapshot.sources.find(s=>s.source==='codex-processes');assert.equal(s.state,'stale');assert.ok(s.agents.every(a=>a.stale&&a.state==='unknown'));assert.ok(!JSON.stringify(s).includes('private'));});
targets=[];snapshot=await inv.read();check('revocation removes every derived source',()=>assert.equal(snapshot.sources.length,0));
let script,args;await readRemoteInventorySource(host,async(...v)=>{args=v;script=v[1];return JSON.stringify(raw(host,[]));});
check('fixed transport is bounded and cannot request private paths or command arguments',()=>{assert.equal(args[0],'mac-mini-herdr');assert.equal(args[2],15000);assert.equal(args[3],1<<20);assert.match(script,/signal.alarm\(12\)/);assert.match(script,/pid=,ppid=,lstart=,comm=/);assert.doesNotMatch(script,/cmdline|args=|\.codex|rollouts|config.toml|kill\(-/);assert.match(script,/os.O_NOFOLLOW/);assert.match(script,/os.setuid/);});
execFileSync('sh',['-n'],{input:script});execFileSync('python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:script.split("<<'AB_COVERAGE_READ'\n")[1].split('\nAB_COVERAGE_READ')[0]});
check('remote shell and Python parse without executing',()=>{});
console.log(`${n}/${n} coverage contracts passed; synthetic only; no SSH`);
// Exercise the actual embedded remote collector with in-memory OS/receipt fakes. No remote read or private file.
const python=script.split("<<'AB_COVERAGE_READ'\n")[1].split('\nAB_COVERAGE_READ')[0];
const harness=String.raw`
import sys,json,types,unittest.mock as m,datetime,stat
script=sys.stdin.read()
uid=1234
start=1791248400000
stamp=datetime.datetime.fromtimestamp(start/1000,datetime.timezone.utc).strftime('%a %b %d %H:%M:%S %Y')
ps=('100 1 '+stamp+' /usr/bin/node\n123 100 '+stamp+' /opt/bin/codex\n124 123 '+stamp+' /opt/bin/codex\n200 1 '+stamp+' /bin/sh\n').encode()
class Pipe:
 def __init__(self): self.stdout=__import__('io').BytesIO(ps)
 def poll(self): return 0
 def wait(self,timeout=None): return 0
class Scan:
 def __enter__(self): return iter([types.SimpleNamespace(name='host.json')])
 def __exit__(self,*a): pass
receipt=dict(session='session-a',parentSession=None,harness='codex',pid=100,startedAt=start+1000,updatedAt=start+1000,state='working',token='SECRET',cwd='/PRIVATE',name='PRIVATE',model='SECRET')
account=types.SimpleNamespace(pw_name='fixture',pw_uid=uid,pw_gid=uid,pw_dir='/synthetic')
info=types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=uid)
file=types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=uid,st_size=1000)
with m.patch('sys.argv',['read','-','managed-hosts']),m.patch('pwd.getpwuid',return_value=account),m.patch('os.getuid',return_value=uid),m.patch('os.geteuid',return_value=uid),m.patch('os.chdir'),m.patch('signal.alarm'),m.patch('time.time',return_value=start/1000+2),m.patch('os.lstat',return_value=info),m.patch('os.scandir',return_value=Scan()),m.patch('os.open',return_value=999),m.patch('os.fstat',return_value=file),m.patch('os.read',return_value=json.dumps(receipt).encode()),m.patch('os.close'),m.patch('subprocess.Popen',return_value=Pipe()):
 exec(compile(script,'collector','exec'),{})
`;
const fixture=JSON.parse(execFileSync('python3',['-c',harness],{input:python,encoding:'utf8'}));
check('actual collector verifies host PID/start and direct Codex child from receipt',()=>{assert.equal(fixture.rows.length,1);assert.equal(fixture.rows[0].processState,'observed');assert.equal(fixture.rows[0].fresh,true);assert.deepEqual(fixture.rows[0].reconciles,[pid]);assert.ok(!JSON.stringify(fixture).includes('SECRET'));assert.ok(!JSON.stringify(fixture).includes('PRIVATE'));});
const reused=JSON.parse(execFileSync('python3',['-c',harness.replace('startedAt=start+1000','startedAt=start+90000')],{input:python,encoding:'utf8'}));
check('actual collector rejects stale receipt PID reuse as runtime evidence',()=>{assert.equal(reused.rows[0].processState,'not-observed');assert.equal(reused.rows[0].fresh,false);assert.deepEqual(reused.rows[0].reconciles,[]);});
const badFile=JSON.parse(execFileSync('python3',['-c',harness.replace('stat.S_IFREG|0o600','stat.S_IFREG|0o666')],{input:python,encoding:'utf8'}));
check('actual collector rejects mutable untrusted receipts and reports count',()=>{assert.equal(badFile.rows.length,0);assert.equal(badFile.diagnostics.rejectedReceipts,1);});
check('inconsistent receipt liveness claims fail closed',()=>{const [a]=parse(host,[receipt({processState:'not-observed',runtimeId:null})]);assert.equal(a.state,'unknown');assert.equal(a.stale,true);});
console.log(`${n}/${n} total coverage contracts passed; collector fixture included; no SSH`);
const processFixture=JSON.parse(execFileSync('python3',['-c',harness.replace("['read','-','managed-hosts']","['read','-','codex-processes']")],{input:python,encoding:'utf8'}));
check('actual collector excludes generic node and shell processes from Codex records',()=>{assert.equal(processFixture.rows.length,2);assert.equal(processFixture.rows[1].parentRuntimeId,pid);assert.ok(processFixture.rows.every(r=>!('session'in r)&&!('model'in r)));});
check('runtime conflict count is accurate and child cannot nest under an ambiguous parent',()=>{const [s]=reconcileRemoteSources([source(host,[receipt(),receipt({session:'other'}),receipt({session:'child',parentSession:'session-a',runtimeId:'101:1791248300000',reconciles:[]})])]);assert.equal(s.diagnostics.conflictingIdentities,2);assert.equal(s.agents[2].parentId,null);});
console.log(`${n}/${n} final coverage contracts passed; no SSH`);
