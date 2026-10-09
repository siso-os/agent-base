import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { serveAsleepChat } from '../../node/src/sleep-chat.ts';
import { controlSleep } from '../../node/src/host-sleep.ts';
import { alive, wakeRunner } from '../src/idle-sleep.ts';
import { readServiceHosts, bindServiceRows } from '../../node/src/service-hosts.ts';
const root = path.resolve(import.meta.dirname, '../../..');
const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-sleep-wake.'));
const hosts = path.join(dir, 'hosts'), file = path.join(hosts, 'name-SLEEP-LAB.json');
const read = () => JSON.parse(readFileSync(file, 'utf8'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async fn => { const end = Date.now() + 15_000; while (Date.now() < end) { if (await fn()) return; await pause(25); } throw Error('sleep fixture deadline exceeded'); };
const env = { ...process.env, HERDR_ENV: '0', AB_HOSTS_DIR: hosts, AB_PROMPT_QUEUE_DIR: path.join(dir, 'queue'), AB_IDLE_SLEEP_MIN: '0.05', AB_CODEX_BIN: path.join(root, 'services/host/test/fake-sleep-codex.mjs'), SLEEP_HISTORY: path.join(dir, 'history.json'), SLEEP_DELIVERIES: path.join(dir, 'deliveries.jsonl'), SLEEP_CHILD_ID:path.join(dir,'child-id'), SLEEP_GRANDCHILD: path.join(dir, 'grandchild') };
delete env.AB_WORKSPACE_RECEIPT; delete env.AB_BACKEND_SELECTION; delete env.AB_EXACT_RESUME;
let runner, ws, gateway; const sockets = [];
async function connect(host) {
  const socket = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`), frames = [];
  sockets.push(socket); socket.on('message', raw => frames.push(JSON.parse(raw)));
  await until(() => frames.some(m => m.t === 'hello'));
  return { socket, frames };
}
async function cli(text) {
  const prompt = path.join(dir, `${text}.txt`); writeFileSync(prompt, text);
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(root, 'services/host/src/service-control.ts'), 'send', '--name', 'SLEEP-LAB', '--prompt-file', prompt, '--timeout', '15'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x);
    p.once('exit', code => resolve({ code, out: out.trim(), err }));
  });
}
try {
  runner = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(root, 'services/host/src/service-runner.ts'), '--harness', 'codex', '--name', 'SLEEP-LAB', '--model', 'fixture-model'], { cwd: dir, env, stdio: 'ignore' });
  await until(() => { try { return read().port && read().runnerPid === runner.pid; } catch { return false; } });
  const original = read();
  ({ socket: ws } = await connect(original));
  ws.send(JSON.stringify({ t: 'prompt', text: 'grandchild' }));
  await until(() => read().state === 'asleep');
  await until(() => !alive(original.pid));
  const grandchild = Number(readFileSync(env.SLEEP_GRANDCHILD, 'utf8'));
  await until(() => !alive(grandchild));
  assert.ok(alive(runner.pid)); assert.ok(read().rssAtSleep > 0);
  const rows = await readServiceHosts({ dir: hosts, launchdLoaded: () => false });
  assert.equal(rows.hosts[0].state, 'asleep'); assert.equal(bindServiceRows([], rows.hosts)[0].session, original.session);
  assert.equal(rows.hosts[0].activity, 'idle'); assert.ok(!JSON.stringify(rows.publicHosts).includes(original.token));
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'sleep.jsonl'), 'utf8').trim()).name, 'SLEEP-LAB');
  console.log('PASS asleep descriptor, runner retained, owned grandchild reaped, memory recorded, rows survive a new reader');
  const [one, two] = await Promise.all([cli('wake-one'), cli('wake-two')]);
  assert.deepEqual([one.code, two.code], [0, 0], one.err + two.err);
  assert.equal(one.out, 'Reply: wake-one'); assert.equal(two.out, 'Reply: wake-two');
  const deliveries = readFileSync(env.SLEEP_DELIVERIES, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(deliveries.length, 3); assert.equal(new Set(deliveries.slice(1).map(r => r.pid)).size, 1);
  assert.ok(deliveries.every(r => r.thread === original.session));
  console.log('PASS simultaneous senders wake once, same thread, each message delivered exactly once');
  await until(()=>read().state==='asleep');
  gateway = new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(r=>gateway.once('listening',r));
  const sleeping = (await readServiceHosts({dir:hosts,launchdLoaded:()=>false})).hosts[0];
  gateway.on('connection', client => serveAsleepChat(client,sleeping,Array.from({length:1000},(_,i)=>({t:i%2?'text':'user',id:`history-${i}`,text:'Synthetic saved history'})),(next,early)=>{
    const upstream=new WebSocket(`ws://127.0.0.1:${next.port}/ws?token=${next.token}`); sockets.push(upstream);
    upstream.on('message',raw=>{client.send(raw.toString());if(JSON.parse(raw).t==='hello')for(const frame of early.splice(0))upstream.send(frame);});
    client.on('message',raw=>upstream.send(raw.toString()));client.once('close',()=>upstream.close());upstream.once('close',()=>client.close());
  }));
  const peer=new WebSocket(`ws://127.0.0.1:${gateway.address().port}`), gatewayFrames=[];sockets.push(peer);
  peer.on('message',raw=>gatewayFrames.push(JSON.parse(raw)));
  await until(()=>gatewayFrames.some(m=>m.t==='hello' && m.sleep));
  assert.ok(gatewayFrames[0].log.some(m=>m.text==='Synthetic saved history'));
  assert.ok(gatewayFrames[0].log.length<=240); assert.equal(gatewayFrames[0].more,true);
  peer.send(JSON.stringify({t:'older',before:gatewayFrames[0].before}));
  await until(()=>gatewayFrames.some(m=>m.t==='older' && m.events.length>0));
  peer.send('null'); peer.send(JSON.stringify({t:'prompt',key:'too-large',messageId:'too-large',text:'x'.repeat(513*1024)}));
  await until(()=>gatewayFrames.some(m=>m.t==='prompt.receipt' && m.key==='too-large' && m.phase==='failed'));
  await pause(100);assert.equal(read().state,'asleep');
  peer.send(JSON.stringify({t:'prompt',text:'bridge-wake',key:'bridge-key',messageId:'bridge-key'}));
  await until(()=>gatewayFrames.some(m=>m.t==='result'));
  assert.equal(readFileSync(env.SLEEP_DELIVERIES,'utf8').split('\n').filter(x=>x.includes('bridge-wake')).length,1);
  peer.close(); console.log('PASS node sleep bridge reads history without waking; send wakes and forwards exactly once');
  const liveHost = (await readServiceHosts({dir:hosts,launchdLoaded:()=>false})).hosts[0];
  await controlSleep(liveHost,true); assert.equal(read().keepAwake,true);
  await controlSleep(liveHost,false); assert.equal(read().keepAwake,false);
  console.log('PASS explicit Keep awake control confirms a durable host receipt');

  const { socket, frames } = await connect(read());
  socket.send(JSON.stringify({ t: 'keep_awake', value: true }));
  await until(() => read().keepAwake === true); await pause(3200); assert.equal(read().state, 'idle');
  socket.send(JSON.stringify({ t: 'keep_awake', value: false }));
  await until(() => read().state === 'asleep');
  // Send at the durable asleep boundary; it may precede host exit/runner wait.
  const race = await cli('exit-race'); assert.equal(race.code, 0, race.err); assert.equal(race.out, 'Reply: exit-race');
  assert.equal(readFileSync(env.SLEEP_DELIVERIES, 'utf8').split('\n').filter(x => x.includes('exit-race')).length, 1);
  console.log('PASS Keep awake toggle and send during sleep transition');
  const blocked = await connect(read()); blocked.socket.send(JSON.stringify({ t: 'prompt', text: 'blocked' }));
  await until(() => read().state === 'blocked'); await pause(3200); assert.ok(alive(read().pid)); assert.equal(read().state, 'blocked');
  console.log('PASS approval holds the host awake beyond the idle deadline');
  blocked.socket.send(JSON.stringify({t:'approve',id:'100',allow:true}));
  await until(()=>read().state==='idle');
  blocked.socket.send(JSON.stringify({t:'prompt',text:'child'}));
  await until(()=>blocked.frames.some(m=>m.t==='task' && m.task.status==='running'));
  await until(()=>read().state==='idle');
  await pause(3400); assert.ok(alive(read().pid)); assert.equal(read().state,'idle');
  await until(()=>blocked.frames.some(m=>m.t==='task' && m.task.status==='done'));
  await until(()=>read().state==='asleep');
  console.log('PASS idle parent cannot sleep while its managed child is running');
  const childFile=path.join(hosts,readdirSync(hosts).find(f=>f.startsWith('name-SLEEP-CHILD')));
  await until(()=>JSON.parse(readFileSync(childFile)).state==='asleep');
  const childSession=JSON.parse(readFileSync(childFile)).session;
  const follow=await cli('follow-child'); assert.equal(follow.code,0,follow.err);
  await until(()=>readFileSync(env.SLEEP_DELIVERIES,'utf8').includes('child-follow-up'));
  const followRows=readFileSync(env.SLEEP_DELIVERIES,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.input==='child-follow-up');
  assert.equal(followRows.length,1);assert.equal(followRows[0].thread,childSession);
  console.log('PASS a restored parent wakes its own sleeping child for one same-thread follow-up');


} finally {
  for (const socket of sockets) socket.close();
  const childRunners = readdirSync(hosts).filter(f=>f.startsWith('name-SLEEP-CHILD')).map(f=>JSON.parse(readFileSync(path.join(hosts,f))).runnerPid);
  for (const pid of childRunners) if (alive(pid)) process.kill(pid,'SIGTERM');
  if (runner && runner.exitCode === null) { runner.kill('SIGTERM'); await new Promise(resolve => runner.once('exit', resolve)); }
  for (const pid of childRunners) await until(()=>!alive(pid));
  if(gateway)await new Promise(r=>gateway.close(r));
  rmSync(dir, { recursive: true });
}
