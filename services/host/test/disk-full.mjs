// t-0504: the real host on a real full disk. Its host file and prompt queue live on a 4 MB disk image that is filled until
// the kernel answers ENOSPC; the host must stay up, keep taking prompts, say "Disk full" in its chat, and save again once
// space comes back. Synthetic SDK and herdr (reporting-fixture.mjs); no live agent, no network.
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const source = path.resolve(import.meta.dirname, '../src/host.ts');
const fixture = path.join(import.meta.dirname, 'reporting-fixture.mjs');
const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-host-diskfull.'));
const image = path.join(dir, 'small.dmg'), mount = path.join(dir, 'mnt');
mkdirSync(mount);
execFileSync('hdiutil', ['create', '-size', '4m', '-fs', 'HFS+', '-volname', 'abdiskfull', '-quiet', image]);
execFileSync('hdiutil', ['attach', '-nobrowse', '-quiet', '-mountpoint', mount, image]);
const hosts = path.join(mount, 'hosts'), queues = path.join(mount, 'queues');
mkdirSync(hosts); mkdirSync(queues);
const herdr = path.join(dir, 'herdr');
writeFileSync(herdr, '#!/bin/sh\nexit 0\n'); chmodSync(herdr, 0o700);
const env = {
  PATH: process.env.PATH, HOME: dir, TMPDIR: dir,
  HERDR_ENV: '1', HERDR_PANE_ID: 'synthetic-pane', HERDR_BIN_PATH: herdr,
  AB_HOSTS_DIR: hosts, AB_PROMPT_QUEUE_DIR: queues, AB_DISK_PATH: mount, AB_DISK_RETRY_MS: '400',
  AB_ACTIVITY_DIR: path.join(dir, 'activity'), AB_HOST_SDK: fixture,
  AB_UPLOADS: path.join(dir, 'uploads'), AB_CHILD_ID: 'fixture-child',
};
const observations = [], frames = [], results = [];
let child, ws, stderr = '', commandId = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, label, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    if (child?.exitCode != null) throw Error(`Host exited ${child.exitCode}: ${stderr}`);
    await sleep(20);
  }
  throw Error(`Timeout: ${label}; ${stderr.slice(-600)}`);
}
async function command(op, data = {}) {
  const id = `command-${++commandId}`;
  child.send({ op, ...data, id });
  await until(() => observations.some(e => e.kind === 'ack' && e.id === id), op);
}
const check = (name, ok) => { results.push({ name, ok: !!ok }); console.log(JSON.stringify({ check: name, ok: !!ok })); };
const hostFile = path.join(hosts, 'synthetic-pane.json');
const host = () => JSON.parse(readFileSync(hostFile, 'utf8'));
const filler = path.join(mount, 'filler');
function fill() {
  const fd = openSync(filler, 'w'); const chunk = Buffer.alloc(64 * 1024, 1);
  try { for (;;) writeSync(fd, chunk); } catch (e) { if (e.code !== 'ENOSPC') throw e; } finally { closeSync(fd); }
  // The last few blocks too, so even a tiny write fails.
  const fd2 = openSync(filler + '-tail', 'w'); const b = Buffer.alloc(512, 1);
  try { for (;;) writeSync(fd2, b); } catch (e) { if (e.code !== 'ENOSPC') throw e; } finally { closeSync(fd2); }
}
const start = id => ({ type: 'stream_event', event: { type: 'message_start', message: { id } } });
try {
  child = fork(source, ['--name', 'DISKFULL-FIXTURE', '--resume', 'synthetic-session-a', '--no-stack'], {
    cwd: dir, env, execArgv: ['--experimental-strip-types', '--no-warnings', '--import', fixture], silent: true,
  });
  child.stdout.resume(); child.stderr.on('data', d => { stderr += d; });
  child.on('message', e => observations.push(e));
  await until(() => { try { return host().port; } catch { return false; } }, 'host ready');
  const { port, token } = host();
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  ws.on('message', v => frames.push(JSON.parse(v)));
  await until(() => frames.some(e => e.t === 'hello'), 'hello');

  fill();
  let probe = 'written'; try { writeFileSync(path.join(mount, 'probe'), 'x'.repeat(4096)); } catch (e) { probe = e.code; }
  check('the disk image is really full (ENOSPC)', probe === 'ENOSPC');

  // Work goes on: a run starts and streams (state changes write the host file), and he queues a prompt (queue write).
  ws.send(JSON.stringify({ t: 'prompt', text: 'queued on a full disk', key: 'full-1', messageId: 'full-1', delivery: 'auto', images: [] }));
  await until(() => observations.some(e => e.kind === 'input' && e.id === 'full-1'), 'SDK took the prompt');
  await command('events', { events: [start('on-full-disk'), { type: 'assistant', message: { id: 'on-full-disk', content: [{ type: 'text', text: 'Still working on a full disk' }] } }, { type: 'system', subtype: 'informational', level: 'notice', content: 'mark-1' }] });
  await until(() => frames.some(e => e.t === 'note' && e.text === 'mark-1'), 'events processed');
  await until(() => frames.some(e => e.t === 'error' && /^Disk full/.test(e.text)), 'disk full card');
  check('the agent says "Disk full" in its chat', true);
  await sleep(1200);
  check('the host is still running after ENOSPC on its writes', child.exitCode === null);
  check('it still streams: the run text reached the chat', frames.some(e => e.t === 'text' && e.text === 'Still working on a full disk'));
  check('herdr (A0\'s tree) was told "disk full"', observations.some(e => e.kind === 'herdr' && e.args.includes('--message') && e.args[e.args.indexOf('--message') + 1].startsWith('disk full')));

  rmSync(filler, { force: true }); rmSync(filler + '-tail', { force: true });
  // A 4 MB image is always under 5 GB, so "room again" reads as "Disk low" here; on a real disk it says "has room again".
  const fullAt = frames.findIndex(e => e.t === 'error' && /^Disk full/.test(e.text));
  await until(() => frames.slice(fullAt + 1).some(e => e.t === 'error' && /^Disk (low|has room again)/.test(e.text)), 'room again', 8000);
  check('with room again it says so (here: low, the image is 4 MB)', true);
  await until(() => { try { return host().disk && host().disk.full === false; } catch { return false; } }, 'host file saved again', 8000);
  check('its host file is saved again, marked not full', host().disk.full === false);
  const saved = readdirSync(queues).filter(f => f.endsWith('.json')).map(f => readFileSync(path.join(queues, f), 'utf8')).join('\n');
  check('the prompt queued during the full disk was saved, not lost', saved.includes('full-1'));
  check('the host is still running at the end', child.exitCode === null);
} catch (e) { check(`ran to the end: ${e.message}`, false); }
finally {
  ws?.close(); child?.kill('SIGTERM'); await sleep(300);
  try { execFileSync('hdiutil', ['detach', '-quiet', '-force', mount]); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ diskFull: passed === results.length ? 'PASS' : 'FAIL', passed, of: results.length }));
if (passed !== results.length) process.exitCode = 1;
