// t-0583: a host on bypassPermissions never waits on an approval card; one in default mode still asks. Fake SDK, temp
// hosts dir, no herdr, no real Claude.
//   node --experimental-strip-types --no-warnings services/host/test/bypass-approvals.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
const root = path.resolve(import.meta.dirname, '../../..');
const fixture = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-bypass-approvals.'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 250; i++) { if (fn()) return; await sleep(40); } throw Error('fixture timeout'); }
async function run(mode) {
  const dir = path.join(fixture, mode), name = 'QA-' + mode;
  const env = { ...process.env, HERDR_ENV: '0', AB_HOSTS_DIR: dir, AB_PROMPT_QUEUE_DIR: path.join(dir, 'queues'), AB_HOST_SDK: path.join(root, 'services/host/test/fake-sdk.mjs'), FAKE_STEER_QUESTIONS: '1', FAKE_START_DELAY: '1', AB_SERVICE_NAME: name };
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(root, 'services/host/src/host.ts'), '--name', name, '--no-stack', '--permission-mode', mode], { cwd: fixture, env, stdio: 'ignore' });
  let ws; const frames = [];
  try {
    let h; await until(() => { try { h = JSON.parse(readFileSync(path.join(dir, `name-${name}.json`))); return h.port && h.session; } catch { return false; } });
    ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`); ws.on('message', m => frames.push(JSON.parse(m)));
    await until(() => frames.some(e => e.t === 'hello'));
    ws.send(JSON.stringify({ t: 'prompt', key: 'k1', messageId: 'k1', text: 'bash', images: [], delivery: 'auto', from: 'app' }));
    await until(() => frames.some(e => e.t === 'approval' || (e.t === 'text' && /^Bash: /.test(e.text ?? ''))));
    return { approval: frames.find(e => e.t === 'approval') ?? null, answer: frames.find(e => e.t === 'text' && /^Bash: /.test(e.text ?? ''))?.text ?? null };
  } finally { ws?.close(); child.kill(); }
}
const bypass = await run('bypassPermissions');
assert.equal(bypass.approval, null, 'no card under bypass');
assert.equal(bypass.answer, 'Bash: allow');
console.log('PASS bypassPermissions: the compound Bash command is allowed with no card');
const ask = await run('default');
assert.ok(ask.approval, 'default mode still shows a card');
assert.equal(ask.approval.tool, 'Bash');
console.log('PASS default: the same command waits on an approval card');
