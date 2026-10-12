// 12 Oct, Shaan: "images can't get sent to yourself, I think it's because you're on the Mac Mini". A prompt to a remote chat
// names this machine's upload paths; the copier puts each image in the remote's uploads folder and names those instead.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { remoteImageCopier } from '../src/remote-uploads.ts';

const uploads = mkdtempSync(path.join(tmpdir(), 'ab-uploads-'));
const img = path.join(uploads, 'shot-1.png');
writeFileSync(img, Buffer.from('fixture-png'));
const fake = () => {
  const calls = [];
  return { calls, run: async (args, input) => { calls.push({ args, input: input?.toString() }); return args[1].startsWith('mkdir') ? '/Users/remote' : ''; } };
};

test('a prompt with an image: copied over the alias, the prompt names the remote copy', async () => {
  const f = fake();
  const out = JSON.parse(await remoteImageCopier('mini-fast', uploads, f.run)(JSON.stringify({ t: 'prompt', key: 'k', text: 'look', images: [img] })));
  assert.deepEqual(out.images, ['/Users/remote/.local/state/agent-base/uploads/shot-1.png']);
  assert.equal(out.text, 'look');
  assert.equal(f.calls[0].args[0], 'mini-fast');
  assert.equal(f.calls[1].args[1], "cat > '/Users/remote/.local/state/agent-base/uploads/shot-1.png'");
  assert.equal(f.calls[1].input, 'fixture-png');
});
test('other frames and image-less prompts pass untouched; the home is asked once', async () => {
  const f = fake();
  const copy = remoteImageCopier('mini-fast', uploads, f.run);
  for (const t of ['{"t":"interrupt"}', JSON.stringify({ t: 'prompt', text: 'hi', images: [] }), 'not json']) assert.equal(await copy(t), t);
  assert.equal(f.calls.length, 0);
  await copy(JSON.stringify({ t: 'prompt', text: 'a', images: [img] }));
  await copy(JSON.stringify({ t: 'prompt', text: 'b', images: [img] }));
  assert.equal(f.calls.filter(c => c.args[1].startsWith('mkdir')).length, 1);
});
test('an image outside uploads, or a failed copy, leaves the prompt as it was', async () => {
  const outside = JSON.stringify({ t: 'prompt', text: 'x', images: ['/etc/hosts'] });
  assert.equal(await remoteImageCopier('mini-fast', uploads, fake().run)(outside), outside);
  const inside = JSON.stringify({ t: 'prompt', text: 'x', images: [img] });
  assert.equal(await remoteImageCopier('mini-fast', uploads, async () => { throw new Error('ssh down'); })(inside), inside);
});
