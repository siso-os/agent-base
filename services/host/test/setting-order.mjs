// Real host/WebSocket, synthetic HOME/files, injected SDK only. No provider or live agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
const initial = 'claude-opus-5-5[1m]', selected = 'claude-sonnet-5-5';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, why = 'fixture condition', attempts = 300) {
  for (let n = 0; n < attempts; n++) { if (fn()) return; await sleep(10); }
  throw Error(`Timed out: ${why}`);
}
async function fixture({ changesUrl } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-setting-order.'));
  const hosts = path.join(home, 'hosts'), callsFile = path.join(home, 'calls.jsonl'), control = path.join(home, 'control.json');
  mkdirSync(hosts); writeFileSync(control, '{}');
  const sdk = path.join(home, 'sdk.mjs');
  writeFileSync(sdk, `import {appendFileSync,readFileSync} from 'node:fs';
const log=x=>appendFileSync(${JSON.stringify(callsFile)},JSON.stringify(x)+'\\n');
const control=()=>JSON.parse(readFileSync(${JSON.stringify(control)},'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let generation=0;
export const getSessionMessages=async()=>[];
export function query({prompt,options}) {
 const gen=++generation;let model=options.model,effort=options.effort,events=[],wake,ended=false,result=0,compact='';
 const emit=e=>{events.push(e);wake?.();};log({t:'query',gen,model,effort});
 // Like the SDK, input pumping and control acknowledgement are independent of output iteration.
 void(async()=>{log({t:'pump-start',gen});for await(const input of prompt){log({t:'input',gen,model,effort,id:input.uuid,text:input.message.content});emit({type:'command_lifecycle',command_uuid:input.uuid,state:'started'});}})();
 const poll=setInterval(()=>{const c=control();if(c.stop===gen&&!ended){ended=true;emit(null);}if((c.result??0)>result){result=c.result;emit({type:'result',subtype:'success',duration_ms:1});}if(c.compact&&c.compact!==compact){compact=c.compact;const hooks=options.hooks[compact==='start'?'PreCompact':'PostCompact'];void hooks[0].hooks[0]({session_id:'setting-session',trigger:'manual',compact_summary:'synthetic summary'});}},5);
 async function change(kind,value){log({t:kind+'-start',gen,value});await sleep(100);while(control()['hold'+kind]&&!control().release)await sleep(5);if(control()['reject'+kind]){log({t:kind+'-rejected',gen,value});throw Error('synthetic refusal');}if(kind==='model')model=value;else effort=value;log({t:kind+'-done',gen,value});}
 return {close(){clearInterval(poll);ended=true;emit(null);},supportedCommands:async()=>[],getContextUsage:async()=>({}),interrupt:async()=>log({t:'interrupt',gen}),setModel:value=>change('model',value),applyFlagSettings:s=>change('effort',s.effortLevel),async *[Symbol.asyncIterator](){try{yield{type:'system',subtype:'init',session_id:'setting-session',model};for(;;){if(!events.length)await new Promise(r=>wake=r);wake=null;while(events.length){const e=events.shift();if(e===null)return;yield e;}}}finally{clearInterval(poll);}}};
}`);
  let child, ws, stderr = '', events = [];
  // t-0447: an agent's own session sets CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY; the fixture's models must stand.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY')), HOME: home, HERDR_ENV: '0', AB_HOSTS_DIR: hosts, AB_HOST_SDK: sdk,
    AB_PROMPT_QUEUE_DIR: path.join(home, 'queue'), ...(changesUrl ? { AB_CHANGES_URL: changesUrl } : {}) };
  const read = () => JSON.parse(readFileSync(path.join(hosts, `pid-${child.pid}.json`)));
  const calls = () => { try { return readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse); } catch { return []; } };
  async function start() {
    child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.resolve(import.meta.dirname, '../src/host.ts'), '--no-stack', '--name', 'SETTING-QA', '--resume', 'setting-session', '--model', initial, '--effort', 'medium'], { cwd: home, env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', d => { stderr += d; });
    await until(() => { try { return read().child === 'running' && calls().some(c => c.t === 'query'); } catch { return false; } }, `host start: ${stderr}`, 800);
    await connect(); await until(() => events.some(e => e.t === 'hello' && e.session === 'setting-session'));
  }
  async function connect() {
    ws?.close(); const d = read(); const connectionEvents = []; events = connectionEvents;
    // A late frame from the closing socket must never enter the replacement connection's receipt.
    ws = new WebSocket(`ws://127.0.0.1:${d.port}/ws?token=${d.token}`);
    ws.on('message', d => connectionEvents.push(JSON.parse(d)));
    await until(() => events.some(e => e.t === 'hello'), 'hello');
  }
  async function stop() {
    ws?.close(); if (child?.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await ended; }
  }
  const send = m => ws.send(JSON.stringify(m));
  const prompt = (id, extra = {}) => send({ t: 'prompt', key: id, messageId: id, text: `SYNTHETIC ${id}`, delivery: 'next', ...extra });
  const configure = values => { const next = { ...JSON.parse(readFileSync(control)), ...values }; const tmp = `${control}.tmp`; writeFileSync(tmp, JSON.stringify(next)); renameSync(tmp, control); };
  const breakStore = async () => { await until(() => { try { return read().settingsSaved !== null && readFileSync(path.join(hosts, 'settings', 'setting-session.json')); } catch { return false; } }); renameSync(path.join(hosts, 'settings'), path.join(hosts, 'settings-before-failure')); writeFileSync(path.join(hosts, 'settings'), 'not a directory'); };
  try { await start(); } catch (error) { await stop(); throw error; }
  return { read, calls, send, prompt, configure, events: () => events, stop, connect, start, breakStore, hosts,
    repairStore: () => { rmSync(path.join(hosts, 'settings')); renameSync(path.join(hosts, 'settings-before-failure'), path.join(hosts, 'settings')); } };
}
async function use(run, options) { const f = await fixture(options); try { await run(f); } finally { await f.stop(); } }

test('idle prompt waits for serialized model and effort acknowledgements; idle controls need no input', { timeout: 20000 }, () => use(async f => {
  f.send({ t: 'set_model', model: selected }); f.send({ t: 'set_effort', effort: 'max' }); f.prompt('idle');
  await until(() => f.calls().some(c => c.t === 'input'));
  const input = f.calls().find(c => c.t === 'input'); assert.equal(input.model, selected); assert.equal(input.effort, 'max');
  assert.deepEqual(f.calls().filter(c => /-start|-done/.test(c.t) && c.t !== 'pump-start').map(c => c.t), ['model-start', 'model-done', 'effort-start', 'effort-done']);
  assert.equal(f.read().settingsSaved, true);
}));

test('active steer and a queued next turn use acknowledged settings without blocking output', { timeout: 10000 }, () => use(async f => {
  f.prompt('active'); await until(() => f.calls().some(c => c.t === 'input'));
  const turn = f.events().filter(e => e.t === 'queue.snapshot').at(-1).capabilities.activeTurnId;
  f.send({ t: 'set_model', model: selected }); f.send({ t: 'set_effort', effort: 'max' });
  f.prompt('steer', { delivery: 'steer', expectedTurnId: turn }); f.prompt('next');
  await until(() => f.calls().some(c => c.id === 'steer'));
  assert.ok(!f.calls().some(c => c.id === 'next'));
  f.configure({ result: 1 }); await until(() => f.calls().some(c => c.id === 'next'));
  for (const id of ['steer', 'next']) { const c = f.calls().find(c => c.id === id); assert.equal(c.model, selected); assert.equal(c.effort, 'max'); }
}));

test('SDK and validation rejection release later input with last acknowledged values', { timeout: 10000 }, () => use(async f => {
  f.configure({ rejectmodel: true, rejecteffort: true });
  f.send({ t: 'set_model', model: selected }); f.send({ t: 'set_effort', effort: 'max' }); f.send({ t: 'set_model', model: 'unsupported' }); f.prompt('after-rejection');
  await until(() => f.calls().some(c => c.t === 'input'));
  const c = f.calls().find(c => c.t === 'input'); assert.equal(c.model, initial); assert.equal(c.effort, 'medium');
  assert.equal(f.events().filter(e => /unchanged/.test(e.label ?? '')).length, 3);
}));

for (const kind of ['model', 'effort']) test(`${kind} applied but unsaved stays truthful in descriptor, reconnect and input; repair saves it`, { timeout: 10000 }, () => use(async f => {
  await f.breakStore(); const command = kind === 'model' ? { t: 'set_model', model: selected } : { t: 'set_effort', effort: 'max' };
  f.send(command); f.prompt(`unsaved-${kind}`);
  await until(() => f.calls().some(c => c.t === 'input'));
  assert.equal(f.read()[kind], kind === 'model' ? selected : 'max'); assert.equal(f.read().settingsSaved, false);
  await until(() => f.events().some(e => e.label === 'Settings not saved'), 'unsaved-setting socket receipt');
  assert.ok(f.events().some(e => e.label === 'Settings not saved')); assert.ok(!f.events().some(e => /unchanged/.test(e.label ?? '')));
  await f.connect(); const hello = f.events().find(e => e.t === 'hello'); assert.equal(hello[kind], kind === 'model' ? selected : 'max'); assert.equal(hello.settingsSaved, false);
  f.repairStore(); f.send(command); await until(() => f.read().settingsSaved === true);
  await f.stop(); await f.start(); assert.equal(f.read()[kind], kind === 'model' ? selected : 'max');
}));

test('runtime stop releases control wait, rejects old queued controls and ignores late acknowledgement', { timeout: 10000 }, () => use(async f => {
  f.configure({ holdmodel: true }); f.send({ t: 'set_model', model: selected }); f.send({ t: 'set_effort', effort: 'max' }); f.prompt('uncertain');
  await until(() => f.calls().some(c => c.t === 'model-start')); f.configure({ stop: 1 });
  await until(() => f.read().child === 'stopped');
  f.prompt('restart'); await until(() => f.calls().some(c => c.t === 'input' && c.gen === 2));
  const c = f.calls().find(c => c.t === 'input' && c.gen === 2); assert.equal(c.id, 'restart'); assert.equal(c.model, initial); assert.equal(c.effort, 'medium');
  assert.ok(!f.calls().some(c => c.t === 'effort-start')); assert.ok(!f.calls().some(c => c.id === 'uncertain'));
  f.configure({ release: true }); await until(() => f.calls().some(c => c.t === 'model-done')); await sleep(30);
  assert.equal(f.read().model, initial); assert.equal(f.read().effort, 'medium');
  assert.ok(f.events().filter(e => /unchanged/.test(e.label ?? '')).length >= 2);
}));

test('applied unsaved settings survive same-host child restart; init save failure does not kill it', { timeout: 10000 }, () => use(async f => {
  await f.breakStore(); f.send({ t: 'set_model', model: selected }); await until(() => f.read().model === selected);
  f.configure({ stop: 1 }); await until(() => f.read().child === 'stopped');
  f.send({ t: 'set_effort', effort: 'max' }); await until(() => f.events().some(e => e.label === 'Effort unchanged'));
  f.prompt('restart-unsaved'); await until(() => f.calls().some(c => c.t === 'input' && c.gen === 2));
  assert.equal(f.calls().find(c => c.t === 'query' && c.gen === 2).model, selected);
  assert.equal(f.read().child, 'running'); assert.equal(f.read().settingsSaved, false); assert.equal(f.read().effort, 'medium');
}));

test('compaction release waits for outstanding setting acknowledgement', { timeout: 10000 }, () => use(async f => {
  f.prompt('active'); await until(() => f.calls().some(c => c.t === 'input'));
  f.configure({ compact: 'start' }); await until(() => f.read().compacting);
  f.prompt('compacted', { delivery: 'auto' }); f.configure({ holdmodel: true }); f.send({ t: 'set_model', model: selected });
  await until(() => f.calls().some(c => c.t === 'model-start')); f.configure({ compact: 'end' }); await until(() => !f.read().compacting);
  await sleep(30); assert.ok(!f.calls().some(c => c.id === 'compacted'));
  f.configure({ release: true }); await until(() => f.calls().some(c => c.id === 'compacted'));
  assert.equal(f.calls().find(c => c.id === 'compacted').model, selected);
}));

test('checkpoint await rechecks settings barrier and preserves input order', { timeout: 10000 }, async () => {
  const responses = []; const server = http.createServer((req, res) => { responses.push(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await use(async f => {
    f.prompt('checkpoint'); await until(() => responses.length === 1);
    f.prompt('already-inbox', { delivery: 'auto' });
    f.configure({ holdmodel: true }); f.send({ t: 'set_model', model: selected }); f.prompt('later', { delivery: 'auto' });
    await until(() => f.calls().some(c => c.t === 'model-start')); responses[0].writeHead(200).end('{}');
    await sleep(30); assert.ok(!f.calls().some(c => c.t === 'input'));
    f.configure({ release: true }); await until(() => responses.length === 2); responses[1].writeHead(200).end('{}');
    await until(() => f.calls().filter(c => c.t === 'input').length === 3);
    assert.deepEqual(f.calls().filter(c => c.t === 'input').map(c => c.id), ['checkpoint', 'already-inbox', 'later']);
    assert.ok(f.calls().filter(c => c.t === 'input').every(c => c.model === selected));
  }, { changesUrl: `http://127.0.0.1:${server.address().port}` }); }
  finally { for (const res of responses) res.end(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
});


test('Stop holds not-yet-offered input until one explicit Send', { timeout: 10000 }, () => use(async f => {
  f.configure({ holdmodel: true }); f.send({ t: 'set_model', model: selected }); f.prompt('paused');
  await until(() => f.calls().some(c => c.t === 'model-start')); f.send({ t: 'interrupt' });
  await until(() => f.calls().some(c => c.t === 'interrupt')); f.configure({ release: true });
  await until(() => f.calls().some(c => c.t === 'model-done')); await sleep(30);
  assert.ok(!f.calls().some(c => c.t === 'input'));
  const snapshot = f.events().filter(e => e.t === 'queue.snapshot').at(-1).snapshot;
  assert.equal(snapshot.held, true); assert.equal(snapshot.entries.find(e => e.id === 'paused').phase, 'saved');
  const send = { t: 'queue.send', key: 'explicit-paused', id: 'paused', expectedRevision: snapshot.revision };
  f.send(send); f.send(send); await until(() => f.calls().some(c => c.id === 'paused')); await sleep(30);
  assert.equal(f.calls().filter(c => c.id === 'paused').length, 1); assert.equal(f.calls().find(c => c.id === 'paused').model, selected);
}));

test('host process restart restores last durable values after unsaved application', { timeout: 10000 }, () => use(async f => {
  await f.breakStore(); f.send({ t: 'set_model', model: selected }); f.send({ t: 'set_effort', effort: 'max' });
  await until(() => f.read().effort === 'max'); assert.equal(f.read().settingsSaved, false);
  await f.stop(); f.repairStore(); await f.start();
  assert.equal(f.read().model, initial); assert.equal(f.read().effort, 'medium');
}));


async function sendHeldOnce(f, id) {
  const snapshot = f.events().filter(e => e.t === 'queue.snapshot').at(-1).snapshot;
  assert.equal(snapshot.held, true);
  assert.equal(snapshot.entries.find(e => e.id === id).phase, 'saved');
  const command = { t: 'queue.send', key: `resume-${id}`, id, expectedRevision: snapshot.revision };
  f.send(command); f.send(command);
  await until(() => f.calls().some(c => c.id === id), 'explicit Send recovery'); await sleep(40);
  assert.equal(f.calls().filter(c => c.id === id).length, 1, 'exact duplicate Send does not repeat input');
  assert.equal(f.calls().find(c => c.id === id).model, selected);
}

test('Stop during pending setting and compaction cannot release checkpoint-held prompt', {timeout:10000}, async()=>{
 const responses=[];const server=http.createServer((req,res)=>{req.resume();responses.push(res);if(responses.length>1)res.writeHead(200).end('{}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {await use(async f=>{
  f.prompt('checkpoint-root');await until(()=>responses.length===1,'first baseline');
  f.configure({holdmodel:true});f.send({t:'set_model',model:selected});await until(()=>f.calls().some(c=>c.t==='model-start'),'model start');
  f.configure({compact:'start'});await until(()=>f.read().compacting,'compacting');
  responses[0].writeHead(200).end('{}');await sleep(40);
  assert.ok(!f.calls().some(c=>c.t==='input'),'checkpoint still held');
  f.send({t:'interrupt'});await until(()=>f.calls().some(c=>c.t==='interrupt'),'interrupt observed');
  f.configure({release:true});await until(()=>f.calls().some(c=>c.t==='model-done'),'model acknowledged');
  f.configure({compact:'end'});await until(()=>!f.read().compacting,'compaction ends');await sleep(150);
  const observation={inputs:f.calls().filter(c=>c.t==='input'),calls:f.calls(),snapshot:f.events().filter(e=>e.t==='queue.snapshot').at(-1).snapshot};
  assert.equal(observation.inputs.length,0,'Stop must retain checkpoint-held input until explicit Send');
  await sendHeldOnce(f, 'checkpoint-root');
 },{changesUrl:`http://127.0.0.1:${server.address().port}`});}
 finally{for(const r of responses)r.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Stop during active-turn compaction retains a steer previously held for settings', {timeout:10000}, ()=>use(async f=>{
 f.prompt('active-root');await until(()=>f.calls().some(c=>c.id==='active-root'),'active root consumed');
 const turn=f.events().filter(e=>e.t==='queue.snapshot').at(-1).capabilities.activeTurnId;assert.ok(turn);
 f.configure({holdmodel:true});f.send({t:'set_model',model:selected});await until(()=>f.calls().some(c=>c.t==='model-start'),'model start');
 f.prompt('settings-held-steer',{delivery:'steer',expectedTurnId:turn});
 await until(()=>f.events().some(e=>e.t==='queued'&&e.id==='settings-held-steer'),'steer held by host');
 f.configure({compact:'start'});await until(()=>f.read().compacting,'compaction starts on active turn');
 f.configure({release:true});await until(()=>f.calls().some(c=>c.t==='model-done'),'model acknowledged');await sleep(40);
 assert.equal(f.calls().filter(c=>c.t==='input').length,1,'steer remains held before Stop');
 f.send({t:'interrupt'});await until(()=>f.calls().some(c=>c.t==='interrupt'),'interrupt observed');
 f.configure({compact:'end'});await until(()=>!f.read().compacting,'compaction ends');await sleep(150);
 const observation={inputs:f.calls().filter(c=>c.t==='input'),calls:f.calls(),snapshot:f.events().filter(e=>e.t==='queue.snapshot').at(-1).snapshot};
 assert.equal(observation.inputs.length,1,'Stop must retain settings/compaction-held steer until explicit Send');
 await sendHeldOnce(f, 'settings-held-steer');
}));

test('Stop also revokes pending auto-release intents admitted during compaction', {timeout:10000}, ()=>use(async f=>{
 f.prompt('auto-root');await until(()=>f.calls().some(c=>c.id==='auto-root'),'active root consumed');
 f.configure({compact:'start'});await until(()=>f.read().compacting,'compaction starts');
 f.configure({holdmodel:true});f.send({t:'set_model',model:selected});await until(()=>f.calls().some(c=>c.t==='model-start'),'model starts');
 f.prompt('compaction-auto',{delivery:'auto'});
 await until(()=>f.events().some(e=>e.t==='queue.snapshot'&&e.snapshot.entries.some(x=>x.id==='compaction-auto'&&x.phase==='saved')),'auto admission remains saved');
 f.send({t:'interrupt'});await until(()=>f.calls().some(c=>c.t==='interrupt'),'interrupt observed');
 f.configure({release:true});await until(()=>f.calls().some(c=>c.t==='model-done'),'model acknowledged');
 f.configure({compact:'end'});await until(()=>!f.read().compacting,'compaction ends');await sleep(150);
 const observation={inputs:f.calls().filter(c=>c.t==='input'),calls:f.calls(),snapshot:f.events().filter(e=>e.t==='queue.snapshot').at(-1).snapshot};
 assert.equal(observation.inputs.length,1,'Stop must revoke old compaction auto-release intent until explicit Send');
 await sendHeldOnce(f, 'compaction-auto');
}));


test('Uninterrupted PostCompact releases a settings-held steer exactly once', { timeout: 10000 }, () => use(async f => {
  f.prompt('normal-root'); await until(() => f.calls().some(c => c.id === 'normal-root'));
  const turn = f.events().filter(e => e.t === 'queue.snapshot').at(-1).capabilities.activeTurnId;
  f.configure({ holdmodel: true }); f.send({ t: 'set_model', model: selected });
  await until(() => f.calls().some(c => c.t === 'model-start'));
  f.prompt('normal-steer', { delivery: 'steer', expectedTurnId: turn });
  await until(() => f.events().some(e => e.t === 'queued' && e.id === 'normal-steer'));
  f.configure({ compact: 'start' }); await until(() => f.read().compacting);
  f.configure({ release: true }); await until(() => f.calls().some(c => c.t === 'model-done'));
  await sleep(40); assert.ok(!f.calls().some(c => c.id === 'normal-steer'));
  f.configure({ compact: 'end' }); await until(() => f.calls().some(c => c.id === 'normal-steer'));
  await sleep(40); assert.equal(f.calls().filter(c => c.id === 'normal-steer').length, 1);
  assert.equal(f.calls().find(c => c.id === 'normal-steer').model, selected);
}));
