// Actual host entry points and sockets, synthetic provider only. Restarts only processes this test owns.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-question-host.'));
const fake = path.join(import.meta.dirname, 'fake-question-recovery-provider.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let n = 0; n < 200; n++) { const value = fn(); if (value) return value; await sleep(30); } throw Error('Question host fixture timed out'); };
const children = new Set(), sockets = new Set();
async function start(provider, stage, resume) {
  const directory = path.join(scratch, provider), name = `QA-QUESTION-${provider}`, proof = path.join(scratch, provider + '-proof');
  const env = { ...process.env, HERDR_ENV: '0', AB_WORKSPACE_RECEIPT: '', AB_HOSTS_DIR: directory, AB_ACTIVITY_DIR: path.join(directory, 'activity'), AB_PROMPT_QUEUE_DIR: path.join(directory, 'queues'), AB_QUESTION_JOURNAL_DIR: path.join(directory, 'questions'), AB_CODEX_BIN: fake, AB_HOST_SDK: fake, AB_SERVICE_NAME: name, AB_FAKE_QUESTION_STAGE: stage, AB_FAKE_QUESTION_PROOF: proof };
  const args = provider === 'codex' ? ['--name',name,'--model','fixture-model'] : ['--name',name,'--no-stack'];
  if (resume) args.push('--resume', resume);
  const child = spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,`services/host/src/${provider === 'codex' ? 'codex-host' : 'host'}.ts`),...args],{cwd:scratch,env,stdio:['ignore','ignore','pipe']});
  children.add(child); child.once('exit',()=>children.delete(child));
  let errors=''; child.stderr.on('data',d=>errors+=d);
  const descriptor = await until(()=>{
    if(child.exitCode!==null) throw Error(errors || 'Fixture host exited');
    try { const h=JSON.parse(readFileSync(path.join(directory,`name-${name}.json`))); return h.pid===child.pid && h.session && h.port ? h : null; } catch { return null; }
  });
  const ws = new WebSocket(`ws://127.0.0.1:${descriptor.port}/ws?token=${descriptor.token}`); sockets.add(ws); ws.once('close',()=>sockets.delete(ws));
  const frames=[]; ws.on('message',m=>frames.push(JSON.parse(m))); await until(()=>frames.some(e=>e.t==='hello'));
  return { child, ws, frames, descriptor, proof, async stop() { ws.close(); if(child.exitCode===null) { const ended=new Promise(r=>child.once('exit',r)); child.kill('SIGTERM'); await ended; } } };
}
const native = host => host.frames.find(e=>e.t==='question')?.request ?? host.frames.find(e=>e.t==='hello')?.pendingQuestions[0];
const command = (q,id) => ({t:'answer_question',id:q.id,hostInstance:q.hostInstance,session:q.session,submissionId:id,action:'answer',answers:{[q.questions[0].id]:['B']}});
try {
  for(const provider of ['codex','claude']) {
    const first=await start(provider,'seed'); const q=await until(()=>native(first));
    await first.stop(); assert.ok(!existsSync(first.proof),'shutdown must not fabricate an answer');
    const quiet=await start(provider,'quiet',q.session); const hello=quiet.frames.find(e=>e.t==='hello');
    assert.equal(hello.pendingQuestions.length,0); assert.equal(hello.questionRecovery.records.length,1);
    assert.equal(hello.questionRecovery.records[0].phase,'unconfirmed'); assert.equal(hello.questionRecovery.records[0].actionable,false);
    quiet.ws.send(JSON.stringify(command(q,'stale-after-restart')));
    await until(()=>quiet.frames.some(e=>e.t==='question_failed')); assert.ok(!existsSync(first.proof)); await quiet.stop();
    const rebound=await start(provider,'rebind',q.session); const current=await until(()=>native(rebound));
    assert.deepEqual(current.recoveredFrom,{id:q.id,hostInstance:q.hostInstance}); assert.notEqual(current.hostInstance,q.hostInstance); assert.notEqual(current.id,q.id);
    rebound.ws.send(JSON.stringify(command(q,'old-host')));
    const a=command(current,'current-immutable'); rebound.ws.send(JSON.stringify(a)); rebound.ws.send(JSON.stringify(a));
    await until(()=>rebound.frames.some(e=>e.t==='question_done'&&e.id===current.id&&e.outcome==='answered'));
    await until(()=>rebound.frames.some(e=>e.t==='text'&&e.text.includes('Provider accepted')));
    rebound.ws.send(JSON.stringify(a)); await sleep(60);
    assert.deepEqual(readFileSync(first.proof,'utf8').trim().split('\n').map(JSON.parse),[{provider,answer:'B'}]);
    await rebound.stop();
    const completed=await start(provider,'quiet',q.session); const final=completed.frames.find(e=>e.t==='hello');
    assert.equal(final.pendingQuestions.length,0); assert.equal(final.questionRecovery.submissions.find(s=>s.id==='current-immutable').phase,'complete');
    completed.ws.send(JSON.stringify(a)); await until(()=>completed.frames.some(e=>e.t==='question_failed'));
    assert.equal(readFileSync(first.proof,'utf8').trim().split('\n').length,1); await completed.stop();
    console.log(`PASS ${provider}: host restart exposes unconfirmed non-actionable history; no replay without provider; fresh native callback rebinds; stale/duplicate answers send once; completed receipt survives another restart`);
  }
} finally {
  for(const ws of sockets) ws.close();
  for(const child of children) { const ended=new Promise(r=>child.once('exit',r)); child.kill('SIGTERM'); await ended; }
  rmSync(scratch,{recursive:true,force:true});
}
