// Compiled fake CLIs, fake launchctl and a recording-only child. Never contacts a provider or live service.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertBackendSeatInactive, backendSelectionStatus, readBackendSelection, selectBackendVersion, selectedBackendEnvironment, validateLocalBackend } from '../src/backend-version.ts';

const root = realpathSync(mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-backend-version.')));
const file = path.join(root, 'selection.json'), hosts = path.join(root, 'hosts'), plists = path.join(root, 'plists');
mkdirSync(hosts); mkdirSync(plists);
const owner = { name: 'BACKEND-FIXTURE', label: 'com.siso.backend-fixture', cwd: root };
const checked = [], test = (name, fn) => { fn(); checked.push(name); };
const inactive = () => assertBackendSeatInactive(owner, hosts, false);
const fingerprint = executable => createHash('sha256').update(readFileSync(executable)).digest('hex');
let runner;
const wait = async check => { for (let i=0;i<160;i++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,50)); } throw Error('Synthetic fixture timeout'); };
try {
  const artifacts = ['1.2.3','1.2.4'].map(version => {
    const executable = path.join(root, `codex-${version}`);
    const source = `#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\nint main(int n,char **a) { if(n!=4 || strcmp(a[1],"-m") || strcmp(a[2],"backend-version-probe") || strcmp(a[3],"--version")) return 42; if(getenv("ANTHROPIC_API_KEY") || getenv("OPENAI_API_KEY") || getenv("HOME")) return 43; puts("codex-cli ${version}"); return 0; }\n`;
    execFileSync('/usr/bin/cc', ['-x','c','-o',executable,'-'], { input: source, stdio:['pipe','pipe','pipe'] });
    chmodSync(executable,0o700);
    return { provider:'codex', version, executable, sha256:fingerprint(executable) };
  });
  const [v1,v2] = artifacts;
  test('explicit native artifact version and SHA-256 validated without inherited auth', () => assert.equal(validateLocalBackend(v1).version,v1.version));
  test('wrong version, checksum and unsupported provider rejected', () => {
    assert.throws(()=>validateLocalBackend({...v1,version:'9.9.9'}),/version did not match/);
    assert.throws(()=>validateLocalBackend({...v1,sha256:'0'.repeat(64)}),/checksum/);
    assert.throws(()=>validateLocalBackend({...v1,provider:'claude'}),/Unsupported/);
  });
  test('script wrapper and mutable shared executable rejected', () => {
    const wrapper=path.join(root,'wrapper');writeFileSync(wrapper,'#!/bin/sh\necho codex-cli 1.2.3\n',{mode:0o700});
    assert.throws(()=>validateLocalBackend({...v1,executable:wrapper,sha256:fingerprint(wrapper)}),/Standalone/);
    chmodSync(v2.executable,0o777);assert.throws(()=>validateLocalBackend(v2),/protected/);chmodSync(v2.executable,0o700);
  });
  test('first selection private and never claims downloaded or running',()=>{
    const s=selectBackendVersion(file,owner,{action:'select',expectedRevision:0,artifact:v1},inactive);
    assert.equal(s.history[0].revision,1);assert.equal(statSync(file).mode&0o777,0o600);
    const status=backendSelectionStatus(file,owner);assert.equal(status.runningVersion,null);assert.equal(status.downloadedVersion,null);assert.equal(status.installationSupported,false);
  });
  test('explicit update retains previous artifact and every receipt',()=>{
    const s=selectBackendVersion(file,owner,{action:'select',expectedRevision:1,artifact:v2},inactive);
    assert.equal(s.history.length,2);assert.equal(fingerprint(v1.executable),v1.sha256);assert.equal(selectedBackendEnvironment(file,owner).AB_CODEX_BIN,v2.executable);
  });
  test('explicit rollback revalidates and selects a retained revision',()=>{
    const s=selectBackendVersion(file,owner,{action:'rollback',expectedRevision:2,targetRevision:1},inactive);
    assert.equal(s.history.at(-1).artifact.executable,v1.executable);assert.equal(s.history.length,3);assert.equal(fingerprint(v2.executable),v2.sha256);
  });
  test('stale, missing rollback, installation and foreign ownership requests preserve selection',()=>{
    const before=readFileSync(file,'utf8');
    assert.throws(()=>selectBackendVersion(file,owner,{action:'select',expectedRevision:2,artifact:v2},inactive),/revision/);
    assert.throws(()=>selectBackendVersion(file,owner,{action:'rollback',expectedRevision:3,targetRevision:99},inactive),/rollback revision/);
    assert.throws(()=>selectBackendVersion(file,owner,{action:'install',expectedRevision:3,artifact:v2},inactive),/installation is unsupported/);
    assert.throws(()=>readBackendSelection(file,{...owner,name:'OTHER'}),/ownership/);
    assert.equal(readFileSync(file,'utf8'),before);
  });
  test('loaded, unknown and live-host seats block selection',()=>{
    for(const loaded of [true,null]) assert.throws(()=>selectBackendVersion(file,owner,{action:'select',expectedRevision:3,artifact:v2},()=>assertBackendSeatInactive(owner,hosts,loaded)),/Active or unknown/);
    const host=path.join(hosts,`name-${owner.name}.json`);writeFileSync(host,JSON.stringify({...owner,pid:process.pid}));
    assert.throws(()=>selectBackendVersion(file,owner,{action:'select',expectedRevision:3,artifact:v2},inactive),/Active service host/);
    // Retain the synthetic record away from discovery; never overwrite or remove a real host.
    writeFileSync(host,JSON.stringify({...owner,name:'FOREIGN',pid:process.pid}));
    assert.throws(()=>inactive(),/ambiguous/);rmSync(host);
  });
  test('second inactive check prevents a seat becoming active during validation',()=>{
    let n=0;assert.throws(()=>selectBackendVersion(file,owner,{action:'select',expectedRevision:3,artifact:v2},()=>{if(++n===2)throw Error('became active');}),/became active/);
    assert.equal(readBackendSelection(file,owner).history.length,3);
  });

  const fakeLaunchctl=path.join(root,'launchctl'), calls=path.join(root,'calls');
  writeFileSync(fakeLaunchctl,'#!/bin/sh\nif [ "$1" = print ]; then exit 1; fi\nprintf "%s\\n" "$1" >> "$BACKEND_FIXTURE_CALLS"\n',{mode:0o700});
  const env={ PATH:'/usr/bin:/bin', AB_LAUNCHCTL:fakeLaunchctl, AB_LAUNCH_AGENTS_DIR:plists, AB_HOSTS_DIR:hosts, AB_SEAT_FILE:path.join(root,'seat'), AB_BACKEND_SELECTION:file, BACKEND_FIXTURE_CALLS:calls };
  const controller=path.resolve(import.meta.dirname,'../src/service-control.ts');
  const args=['--experimental-strip-types','--no-warnings',controller,'install','--harness','codex','--name',owner.name,'--label',owner.label,'--cwd',root,'--model','fixture-model'];
  test('existing service controller saves the selection path without embedding a stale binary',()=>{
    execFileSync(process.execPath,args,{env,stdio:'pipe'});
    const plist=readFileSync(path.join(plists,`${owner.label}.plist`),'utf8');assert.ok(plist.includes('AB_BACKEND_SELECTION'));assert.ok(plist.includes(file));assert.ok(!plist.includes('AB_CODEX_BIN'));assert.equal(readFileSync(calls,'utf8'),'bootstrap\n');
    assert.throws(()=>execFileSync(process.execPath,args,{env,stdio:'pipe'}));assert.equal(readFileSync(calls,'utf8'),'bootstrap\n');
  });

  const capture=path.join(root,'runner-capture.json'), child=path.join(root,'recording-child.mjs'), preload=path.join(root,'preload.mjs');
  writeFileSync(child,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(capture)},JSON.stringify({binary:process.env.AB_CODEX_BIN,model:process.argv.slice(2)}));setTimeout(()=>process.exit(0),400);`);
  writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawn;cp.spawn=(bin,args,options)=>{if(bin!==process.execPath||!args[2].endsWith('/codex-host.ts'))throw Error('Unexpected synthetic spawn');return spawn(bin,[${JSON.stringify(child)},...args.slice(3)],options);};syncBuiltinESMExports();`);
  runner=spawn(process.execPath,['--import',preload,'--experimental-strip-types','--no-warnings',path.resolve(import.meta.dirname,'../src/service-runner.ts'),'--harness','codex','--name',owner.name,'--model','fixture-model'],{cwd:root,env:{...env,AB_SERVICE_LABEL:owner.label},stdio:['ignore','pipe','pipe']});
  let error='';runner.stderr.on('data',b=>{error+=b;});
  const exited=once(runner,'exit');
  await wait(()=>existsSync(capture));
  test('real runner passes selected path and holds lease across its service lifetime',()=>{
    assert.equal(JSON.parse(readFileSync(capture,'utf8')).binary,v1.executable);
    assert.throws(()=>selectBackendVersion(file,owner,{action:'select',expectedRevision:3,artifact:v2},inactive),/EEXIST/);
  });
  // Change only this synthetic artifact. The next child start must fail before spawn.
  const bytes=readFileSync(v1.executable);writeFileSync(v1.executable,Buffer.concat([bytes,Buffer.from('changed')]));
  const [code]=await exited;
  test('runner refuses artifact changes on restart and releases its owned lease',()=>{assert.equal(code,1);assert.match(error,/checksum changed/);assert.equal(existsSync(`${file}.lock`),false);});
  test('changed rollback artifact rejected without losing selected history',()=>{
    assert.throws(()=>selectBackendVersion(file,owner,{action:'rollback',expectedRevision:3,targetRevision:1},inactive),/checksum/);
    assert.equal(readBackendSelection(file,owner).history.length,3);
  });
  console.log(JSON.stringify({checks:checked.length,passed:checked,realProviderCalls:0,realServiceMutations:0}));
} finally {
  if(runner&&runner.exitCode===null){runner.kill('SIGTERM');await once(runner,'exit');}
  rmSync(root,{recursive:true,force:true});
}
