// Real service controller, runner and Codex host; fake launchctl/provider only. No account/model calls.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { supervisedResumeCommand, resumeSupervisedSession } from '../../node/src/claude-service-lifecycle.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const root = realpathSync(mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-resume.')));
const hosts = path.join(root, 'hosts'), plists = path.join(root, 'plists');
mkdirSync(hosts); mkdirSync(plists);
const base = { name: 'RESUME', harness: 'codex', session: 'original-thread', cwd: root, model: 'fixture-model', hostsDir: hosts };
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const until = async fn => { for (let i = 0; i < 160; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('Fixture timeout'); };
let runner, ws;
try {
  check('resume command fixes original session, CWD, model, label and strict identity', () => {
    const c = supervisedResumeCommand(base);
    for (const [flag, value] of [['--resume',base.session],['--cwd',root],['--model',base.model],['--harness','codex'],['--label','com.siso.host-RESUME']]) assert.equal(c.args[c.args.indexOf(flag)+1], value);
    assert.equal(c.env.AB_EXACT_RESUME,base.session); assert.equal(c.env.AB_WORKSPACE_RECEIPT,'');
    assert.ok(!c.args.includes('--prompt'));
  });
  for (const [label, changes] of [['owner',{name:'A0'}],['path traversal',{name:'../bad'}],['harness',{harness:'other'}],['missing session',{session:''}],['missing model',{model:''}],['relative cwd',{cwd:'.'}],['missing cwd',{cwd:path.join(root,'missing')}],['cross-provider login',{loginLauncher:'claude'}]]) check(`invalid ${label} fails before launch`, () => assert.throws(() => supervisedResumeCommand({...base,...changes})));
  check('Claude command requires explicit supported login, transcript and permission', () => {
    const o = {...base,harness:'claude',loginLauncher:'claude-siso',transcriptFile:path.join(root,'original-thread.jsonl'),permissionMode:'default'};
    assert.equal(supervisedResumeCommand(o).args.at(-1),'default');
    assert.throws(()=>supervisedResumeCommand({...o,loginLauncher:'unknown'}));
    assert.throws(()=>supervisedResumeCommand({...o,transcriptFile:undefined}));
  });
  let calls = 0;
  writeFileSync(path.join(hosts,'name-TAKEN.json'),JSON.stringify({name:'TAKEN',harness:'codex',session:'occupied'}));
  await assert.rejects(resumeSupervisedSession({...base,name:'TAKEN'},async()=>calls++),/Existing host name/);
  await assert.rejects(resumeSupervisedSession({...base,session:'occupied'},async()=>calls++),/host owner/);
  assert.equal(calls,0); checks.push('existing name or session owner cannot be replaced');
  await assert.rejects(resumeSupervisedSession({...base,name:'UNCERTAIN',session:'uncertain-thread'},async()=>{calls++;throw Error('unknown outcome');}),/unknown outcome/);
  await assert.rejects(resumeSupervisedSession({...base,name:'RETRY',session:'uncertain-thread'},async()=>calls++),/EEXIST/);
  assert.equal(calls,1); checks.push('uncertain install retains exclusive session claim across renamed retry');

  const fake = path.join(root,'launchctl');
  writeFileSync(fake,'#!/bin/sh\nif [ "$1" = print ]; then exit 1; fi\nexit 0\n',{mode:0o700});
  const command = supervisedResumeCommand(base);
  const env = {...process.env,...command.env,AB_BACKEND_SELECTION:'',AB_LAUNCHCTL:fake,AB_LAUNCH_AGENTS_DIR:plists,AB_CODEX_BIN:path.join(repo,'services/host/test/fake-codex.mjs'),AB_PROMPT_QUEUE_DIR:path.join(root,'queue'),HERDR_ENV:'0'};
  const result = await resumeSupervisedSession(base,async c=>execFileSync(c.command,c.args,{env:{...env,...c.env},stdio:'pipe'}));
  assert.equal(result.installed,true); assert.equal(result.ready,false);
  const plist = readFileSync(path.join(plists,'com.siso.host-RESUME.plist'),'utf8');
  assert.ok(plist.includes('<string>original-thread</string>')); assert.ok(plist.includes('<key>WorkingDirectory</key><string>'+root+'</string>'));
  assert.ok(plist.includes('<key>AB_EXACT_RESUME</key><string>original-thread</string>'));
  checks.push('real controller accepts strict command and writes exact resume/CWD definition with fake launchctl');
  await assert.rejects(resumeSupervisedSession(base,async()=>calls++),/EEXIST/);
  checks.push('same-name repeated handoff cannot install twice');
  const file = path.join(hosts,'name-RESUME.json');
  const read = ()=>JSON.parse(readFileSync(file,'utf8'));
  let errors='';
  runner = spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(repo,'services/host/src/service-runner.ts'),'--harness','codex','--name',base.name,'--model',base.model,'--resume',base.session],{cwd:root,env:{...env,AB_SERVICE_LABEL:'com.siso.host-RESUME'},stdio:['ignore','ignore','pipe']});
  runner.stderr.on('data',d=>errors+=d);
  await until(()=>{if(runner.exitCode!==null)throw Error(errors);return existsSync(file)&&read().session===base.session;});
  assert.equal(read().cwd,root); assert.equal(read().state,'idle'); assert.equal(read().model,base.model);
  checks.push('real runner and host resume original thread with exact CWD/model and idle state');
  const host=read(), frames=[];
  ws=new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`);
  ws.on('message',raw=>{const frame=JSON.parse(raw);frames.push(frame);if(frame.t==='approval')ws.send(JSON.stringify({t:'approve',id:frame.id,allow:true}));});
  await until(()=>frames.some(f=>f.t==='hello'));
  ws.send(JSON.stringify({t:'prompt',text:'synthetic follow-up'}));
  await until(()=>frames.some(f=>f.t==='result'));
  assert.equal(read().session,base.session); assert.equal(read().state,'idle'); assert.equal(frames.filter(f=>f.t==='result').length,1);
  assert.ok(frames.some(f=>f.t==='text'&&f.text==='Approved reply'));
  checks.push('one follow-up completes once on the same resumed synthetic thread');
  console.log(JSON.stringify({ok:true,count:checks.length,checks,evidence:root,unverified:['Claude login-backed runner and real provider/launchd remain runtime gates']}));
} finally {
  ws?.close();
  if(runner&&runner.exitCode===null){runner.kill('SIGTERM');await new Promise(r=>runner.once('exit',r));}
}
