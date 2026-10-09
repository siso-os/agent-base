// Sealed scratch git, fake launchctl and recording-only host. No SDK, login, real job or model calls.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { reconcileSeat, readSeat } from '../src/service.ts';
import { renderPlist } from '../src/service-control.ts';
import { startSupervisedClaude, reconcileSupervisedClaude, claudeServiceCommand, backendVersionOwnership } from '../../node/src/claude-service-lifecycle.ts';

const root = realpathSync(mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-lifecycle.')));
const hosts = path.join(root, 'hosts'), plists = path.join(root, 'plists'), file = path.join(root, 'workspace.json');
mkdirSync(hosts); mkdirSync(plists);
const owner = { name: 'LIFECYCLE', workspaceId: 'fixture-workspace', cwd: root, label: 'com.siso.host-LIFECYCLE', model: 'fixture-model' };
const seat = { ...owner, session: null, login_launcher: 'claude', harness: 'claude', startAttempted: false };
const saved = { ...owner, pid: 999999, session: 'fixture-session', configDir: '/unused' };
const r = { version: 1, ...owner, launchId: 'fixture-launch', name: owner.name, machine: hostname(), worktreePath: root, inputFingerprint: 'fixture', config: { version: 1 }, sequence: 1, phase: 'starting', handoffAttempted: true, agent: { name: owner.name }, input: { launchId: 'fixture-launch', name: owner.name, model: owner.model, harness: 'claude', workspace: { type: 'shared', reason: 'isolated test repository' }, prompt: 'fixture bootstrap' }, stages: ['validate','fetch','checkout','submodules','copy-files','setup','agent'].map(id => ({ id, status: id === 'agent' ? 'running' : 'done' })) };
const options = { hostsDir: hosts, loginLauncher: 'claude', permissionMode: 'default' };
const checks = [];
let runner;
const test = (name, fn) => { fn(); checks.push(name); };
const wait = async fn => { for (let n = 0; n < 120; n++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Fixture timeout'); };
try {
  test('fresh seat accepted only with complete ownership', () => assert.deepEqual(reconcileSeat(seat, undefined, owner, () => false), seat));
  test('ambiguous fresh start blocked', () => assert.throws(() => reconcileSeat({ ...seat, startAttempted: true }, undefined, owner, () => false), /ambiguous/));
  test('saved session adopted', () => assert.equal(reconcileSeat(seat, saved, owner, () => false).session, 'fixture-session'));
  test('live host never replaced', () => assert.throws(() => reconcileSeat(seat, saved, owner, () => true), /already alive/));
  test('stopped child requires explicit resume', () => assert.throws(() => reconcileSeat(seat, { ...saved, child: 'stopped' }, owner, () => false), /explicit session resume/));
  for (const [field, value] of [['workspaceId','foreign'],['name','OTHER'],['cwd','/elsewhere'],['label','foreign'],['harness','codex']]) test(`foreign host ${field} blocked`, () => assert.throws(() => reconcileSeat(seat, { ...saved, [field]: value }, owner, () => false), /ownership/));
  test('changed conversation blocked', () => assert.throws(() => reconcileSeat({ ...seat, session: 'another' }, saved, owner, () => false), /session disagrees/));
  test('malformed and missing saved identity blocked', () => { assert.throws(() => reconcileSeat(seat, null, owner, () => false)); assert.throws(() => reconcileSeat(seat, { ...saved, pid: -1 }, owner, () => false)); assert.throws(() => reconcileSeat(seat, { ...saved, session: null }, owner, () => false)); });
  test('explicit model and unique seat in command', () => { const c = claudeServiceCommand(r, file, options); assert.equal(c.env.AB_SEAT_FILE, `${file}.claude-seat`); assert.ok(c.args.includes('fixture-model')); assert.throws(() => claudeServiceCommand({ ...r, input: { ...r.input, model: '' } }, file, options)); });
  test('legacy A0 plist contract retained', () => { const p = renderPlist({ name:'A0', label:'com.siso.a0-host', resume:'legacy-session', cwd:root, seat:file, hosts, node:process.execPath, runner:'runner.ts' }); assert.ok(p.includes('legacy-session')); assert.ok(!p.includes('--harness')); });
  test('Codex model and effort plist contract retained', () => { const p = renderPlist({ name:'CODEX-FIXTURE', label:'com.siso.codex-fixture', resume:'', cwd:root, seat:file, hosts, node:process.execPath, runner:'runner.ts', harness:'codex', model:'fixture-codex', effort:'high' }); assert.ok(p.includes('<string>codex</string><string>--model</string><string>fixture-codex</string><string>--effort</string><string>high</string>')); assert.ok(!p.includes('--resume')); });
  test('version report names source pin without runtime claim', () => { const v = backendVersionOwnership(); assert.equal(v.claude.sdk, JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).dependencies['@anthropic-ai/claude-agent-sdk']); assert.equal(v.claude.installedVersion, null); assert.equal(v.automaticUpdates, false); });

  execFileSync('git', ['init', '-q', '-b', 'fixture'], { cwd:root });
  r.branch = 'fixture'; r.commonGitDir = realpathSync(path.join(root,'.git'));
  writeFileSync(file, JSON.stringify(r));
  let invoked = 0;
  await startSupervisedClaude(r, file, options, async c => { invoked++; assert.equal(c.args[0], 'install'); });
  assert.equal(invoked, 1); assert.equal(readSeat(`${file}.claude-seat`,owner.name).session, null);
  await assert.rejects(startSupervisedClaude(r, file, options, async () => { invoked++; }), /EEXIST/);
  assert.equal(invoked, 1); checks.push('adapter creates one seat and refuses duplicate handoff');

  const fake = path.join(root, 'launchctl'), calls = path.join(root, 'calls');
  writeFileSync(fake, '#!/bin/sh\nif [ "$1" = print ]; then [ -f "$AB_FAKE_LOADED" ]; exit $?; fi\nprintf "%s\\n" "$1" >> "$AB_CALLS"\n', { mode:0o700 });
  const entry = path.join(root, 'recording-host.mjs'), capture = path.join(root, 'capture.jsonl');
  writeFileSync(entry, `import fs from 'node:fs'; const a=process.argv.slice(2); const i=a.indexOf('--resume'); const session=i>=0?a[i+1]:'fixture-session'; fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:a,authPresent:!!process.env.ANTHROPIC_API_KEY})+'\\n'); fs.writeFileSync(${JSON.stringify(path.join(hosts,'name-LIFECYCLE.json'))},JSON.stringify({...${JSON.stringify(owner)},pid:process.pid,session,configDir:process.env.CLAUDE_CONFIG_DIR})); if(i>=0)setInterval(()=>{},1000);`);
  const c = claudeServiceCommand(r,file,options);
  const env = { ...process.env, ...c.env, AB_LAUNCHCTL:fake, AB_LAUNCH_AGENTS_DIR:plists, AB_CALLS:calls, AB_FAKE_LOADED:path.join(root,'loaded'), AB_SERVICE_HOST_ENTRY:entry };
  execFileSync(c.command,c.args,{env,stdio:'pipe'});
  const plist = path.join(plists,`${owner.label}.plist`), original = readFileSync(plist,'utf8');
  assert.ok(original.includes('--harness')); assert.ok(original.includes('claude')); assert.ok(original.includes('--permission-mode')); assert.ok(!original.includes('--resume'));
  assert.throws(() => execFileSync(c.command,c.args,{env,stdio:'pipe'})); assert.equal(readFileSync(plist,'utf8'),original);
  checks.push('fresh fake installation preserves existing definition');

  runner = spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.resolve('services/host/src/service-runner.ts'),'--harness','claude','--name',owner.name,'--model',owner.model],{cwd:root,env:{...env, AB_SERVICE_LABEL:owner.label, ANTHROPIC_API_KEY:'fixture-value'},stdio:['ignore','ignore','pipe']});
  let errors=''; runner.stderr.on('data',d=>errors+=d);
  await wait(() => { if(runner.exitCode!==null)throw new Error(errors); return existsSync(capture) && readFileSync(capture,'utf8').trim().split('\n').length>=2; });
  const launches = readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(launches[0].args.includes('--prompt')); assert.ok(!launches[0].args.includes('--resume'));
  assert.ok(launches[1].args.includes('--resume')); assert.ok(!launches[1].args.includes('--prompt'));
  assert.ok(launches.every(l => !l.authPresent && !l.args.includes('--harness')));
  assert.equal(readSeat(`${file}.claude-seat`,owner.name).session,'fixture-session');
  runner.kill('SIGTERM'); await new Promise(resolve=>runner.once('exit',resolve)); runner=undefined;
  checks.push('recording-only runner starts fresh, recovers same session, does not repeat prompt, strips ambient API key');

  const execute = async command => execFileSync(command.command,command.args,{env:{...env,...command.env},stdio:'pipe'});
  await reconcileSupervisedClaude(r,file,options,execute);
  assert.equal(readFileSync(calls,'utf8'),'bootstrap\nbootstrap\n');
  r.agent.session='fixture-session'; writeFileSync(file,JSON.stringify(r));
  writeFileSync(`${file}.claude-seat`,JSON.stringify({...seat,startAttempted:true}));
  await reconcileSupervisedClaude(r,file,options,execute);
  assert.equal(readFileSync(calls,'utf8'),'bootstrap\nbootstrap\nbootstrap\n');
  checks.push('recovery handles host session published before seat update');
  const hostFile=path.join(hosts,'name-LIFECYCLE.json'), deadHost=readFileSync(hostFile,'utf8');
  writeFileSync(hostFile,JSON.stringify({...JSON.parse(deadHost),pid:process.pid}));
  await assert.rejects(reconcileSupervisedClaude(r,file,options,execute));
  assert.equal(readFileSync(calls,'utf8'),'bootstrap\nbootstrap\nbootstrap\n');
  writeFileSync(hostFile,deadHost);
  checks.push('unloaded job with a live saved PID cannot bootstrap');
  writeFileSync(env.AB_FAKE_LOADED,'loaded');
  await reconcileSupervisedClaude(r,file,options,execute);
  assert.equal(readFileSync(calls,'utf8'),'bootstrap\nbootstrap\nbootstrap\n');
  writeFileSync(plist,original+'foreign');
  await assert.rejects(reconcileSupervisedClaude(r,file,options,execute));
  assert.equal(readFileSync(plist,'utf8'),original+'foreign');
  checks.push('reconciliation bootstraps only saved definition, leaves loaded job and foreign definition untouched');
  console.log(JSON.stringify({ok:true,count:checks.length,checks}));
} finally {
  if(runner) { runner.kill('SIGTERM'); await new Promise(resolve=>runner.once('exit',resolve)); }
  rmSync(root,{recursive:true,force:true});
}
