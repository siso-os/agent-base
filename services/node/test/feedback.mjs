import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createFeedbackHandler, insertFeedback } from '../src/feedback.ts';

const now = new Date(2026, 9, 5, 3, 55);
const note = { comp: 'side-nav', part: 'zero-strip', words: 'this is too cramped', url: 'http://fixture/#zero', viewport: { width: 1440, height: 900 } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=';
test('new day precedes older history; an existing heading receives each remark once', () => {
  const current = '# Side nav · feedback\n\nHis words, newest first.\n\n## 4 Oct 2026\n- old\n';
  const first = insertFeedback(current, '- first', now);
  assert.ok(first.indexOf('## 5 Oct 2026') < first.indexOf('## 4 Oct 2026'));
  const second = insertFeedback(first, '- second', now);
  assert.equal(second.match(/## 5 Oct 2026/g).length, 1);
  assert.ok(second.indexOf('- second') < second.indexOf('- first'));
  assert.match(second, /## 4 Oct 2026\n- old/);
});

test('isolated feedback HTTP: validation, exact task argv, escaping and concurrent saves', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), '.siso-ephemeral-feedback.'));
  const root = path.join(scratch, 'hub'), calls = path.join(scratch, 'calls.jsonl'), cli = path.join(scratch, 'task');
  let server;
  try {
    await mkdir(path.join(root, 'side-nav'), { recursive: true });
    await writeFile(cli, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n'); console.log('t-0412');\n`, { mode: 0o700 });
    const handler = createFeedbackHandler(root, cli, () => now);
    server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/api/feedback`;
    const post = b => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) });
    for (const bad of [{ ...note, comp: '../outside' }, { ...note, png: 'data:image/jpeg;base64,AAAA' }, { ...note, png: 'data:image/png;base64,AAAA' }, { ...note, words: '' }, { ...note, viewport: { width: -1, height: 900 } }]) assert.equal((await post(bad)).status, 400);
    assert.equal((await post('x'.repeat(2 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await post('{')).status, 400);
    assert.deepEqual(await readdir(path.join(root, 'side-nav')), []);
    const r = await post({ ...note, png }); assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, task: 't-0412', file: 'ui-hub/side-nav/FEEDBACK.md' });
    const argv = JSON.parse((await readFile(calls, 'utf8')).trim());
    assert.deepEqual(argv.slice(0, -1), ['add', '--his=this is too cramped', '--owner', 'AGENT-BASE', '--stage', 'thought', '--project=agent-base', '--']);
    assert.match(argv.at(-1), /^Side nav › zero-strip: this is too cramped · crop: \/.+\/side-nav\/shots\/feedback\/2026-10-05-0355-zero-strip-[a-f0-9]{8}\.png$/);
    const cropFiles = await readdir(path.join(root, 'side-nav/shots/feedback'));
    assert.equal(cropFiles.length, 1);
    assert.equal((await readFile(path.join(root, 'side-nav/shots/feedback', cropFiles[0]))).toString('base64'), png.split(',')[1]);
    const text = await readFile(path.join(root, 'side-nav/FEEDBACK.md'), 'utf8');
    assert.match(text, /## 5 Oct 2026\n- ~03:55 · "this is too cramped" · part `zero-strip` · \[crop\]\(shots\/feedback\/.*\.png\) · t-0412/);
    const replies = await Promise.all(Array.from({ length: 5 }, (_, i) => post({ ...note, words: `remark ${i}\n[not a link](path)` })));
    assert.ok(replies.every(r => r.status === 200));
    const all = await readFile(path.join(root, 'side-nav/FEEDBACK.md'), 'utf8');
    assert.equal(all.match(/## 5 Oct 2026/g).length, 1);
    for (let i = 0; i < 5; i++) assert.equal(all.split(`remark ${i}`).length - 1, 1);
    assert.ok(all.includes('\\[not a link\\](path)'));
    // Storage failure has no success response and creates no task.
    const previousCalls = (await readFile(calls, 'utf8')).split('\n').length;
    await writeFile(path.join(root, 'chat'), 'a file where the folder should be');
    assert.equal((await post({ ...note, comp: 'chat' })).status, 500);
    assert.equal((await readFile(calls, 'utf8')).split('\n').length, previousCalls);
  } finally {
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await rm(scratch, { recursive: true, force: true });
  }
});
