import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { alive, wakeRunner } from '../src/idle-sleep.ts';
const root = path.resolve(import.meta.dirname, '../../..');
const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-sleep-claude.'));
const hosts = path.join(dir, 'hosts'), file = path.join(hosts, 'name-SLEEP-CLAUDE.json'), seat = path.join(dir, 'seat.json');
const pause = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { const end = Date.now() + 15_000; while (Date.now() < end) { if (await fn()) return; await pause(30); } throw Error('Claude sleep fixture timeout'); };
const read = () => JSON.parse(readFileSync(file));
let runner; const sockets = [];
try {
  mkdirSync(hosts); mkdirSync(path.join(dir, '.claude/projects/lab'), { recursive: true });
  writeFileSync(path.join(dir, '.claude/projects/lab/sleep-claude-session.jsonl'), '');
  writeFileSync(seat, JSON.stringify({ name: 'SLEEP-CLAUDE', session: 'sleep-claude-session', login_launcher: 'claude' }));
  // Isolate homedir consumers without changing HOME or reading any actual account directory.
  const shim = path.join(dir, 'fixture-home.mjs');
  writeFileSync(shim, `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; os.homedir=()=>${JSON.stringify(dir)}; syncBuiltinESMExports();`);
  const env = { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(shim).href}`, HERDR_ENV: '0', AB_HOSTS_DIR: hosts, AB_SEAT_FILE: seat, AB_PROMPT_QUEUE_DIR: path.join(dir, 'queues'), AB_HOST_SDK: path.join(root, 'services/host/test/fake-sdk.mjs'), AB_IDLE_SLEEP_MIN: '0.05' };
  delete env.AB_WORKSPACE_RECEIPT; delete env.AB_EXACT_RESUME; delete env.AB_BACKEND_SELECTION; delete env.AB_SERVICE_HOST_ENTRY;
  runner = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(root, 'services/host/src/service-runner.ts'), '--harness', 'claude', '--name', 'SLEEP-CLAUDE', '--model', 'fixture-model', '--resume', 'sleep-claude-session'], { cwd: dir, env, stdio: ['ignore','ignore','pipe'] });
  let errors = ''; runner.stderr.on('data', chunk => errors += chunk);
  await until(() => { if (runner.exitCode !== null) throw Error(errors); try { return read().port && read().session; } catch { return false; } });
  async function turn(text) {
    const host = read(), ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`), frames = [];
    sockets.push(ws); ws.on('message', raw => frames.push(JSON.parse(raw)));
    await until(() => frames.some(e => e.t === 'hello'));
    ws.send(JSON.stringify({t:'prompt',text}));
    await until(() => frames.some(e => e.t === 'result'));
    assert.ok(frames.some(e => e.t === 'text' && e.text === text));
  }
  const first = read(); await turn('Claude fixture before sleep');
  await until(() => read().state === 'asleep' && !alive(first.pid)); assert.ok(alive(runner.pid));
  const next = await wakeRunner(file); assert.equal(next.session, first.session); assert.notEqual(next.pid, first.pid);
  await turn('Claude fixture after wake');
  await until(() => read().state === 'asleep');
  console.log('PASS Claude fake SDK sleeps, runner stays alive, same session wakes and answers, sleeps again');
} finally {
  for (const ws of sockets) ws.close();
  if (runner && runner.exitCode === null) { runner.kill('SIGTERM'); await new Promise(r => runner.once('exit', r)); }
  rmSync(dir, {recursive:true});
}
