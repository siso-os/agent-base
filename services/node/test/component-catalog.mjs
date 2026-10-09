import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readComponentCatalog, syncComponentCatalog } from '../src/component-catalog.ts';
import { readProductMap } from '../src/product-map.ts';

function fixture(t, records = [{ id: 'chat', name: 'Original', pages: [], unknown: { keep: true } }, { id: 'library', pages: [] }]) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'component-catalog-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'components.json'), JSON.stringify({ hub: 'Fixture', customEnvelope: { retained: true }, docs: [{ id: 'how', file: 'README.md' }], components: records }, null, 2) + '\n');
  return root;
}
function manifest(root, id, record) {
  mkdirSync(path.join(root, id), { recursive: true });
  writeFileSync(path.join(root, id, 'component.json'), JSON.stringify(record, null, 2) + '\n');
}

test('legacy fallback and unknown envelope/record fields survive migration exactly', t => {
  const root = fixture(t), original = JSON.parse(readFileSync(path.join(root, 'components.json')));
  assert.deepEqual(readComponentCatalog(root), original);
  for (const record of original.components) manifest(root, record.id, record);
  assert.deepEqual(readComponentCatalog(root), original);
  assert.deepEqual(syncComponentCatalog(root, true), { changed: false, components: 2 });
});

test('one manifest edit is immediately visible without changing the catalog or another owner', t => {
  const root = fixture(t);
  manifest(root, 'chat', { id: 'chat', name: 'Manifest title', customNew: { value: 1 } });
  manifest(root, 'library', { id: 'library', name: 'Other owner', pages: [] });
  const catalogBefore = readFileSync(path.join(root, 'components.json'), 'utf8');
  const otherBefore = readFileSync(path.join(root, 'library/component.json'), 'utf8');
  const ratingBefore = '{"rating":{"value":"ok","source":"user-input","at":"2026-10-06T00:00:00Z","note":"fixture only"},"privateFixture":"preserved"}';
  writeFileSync(path.join(root, 'chat/surface.json'), ratingBefore);
  assert.equal(readProductMap({ hubRoot: root }).rows[0].name, 'Manifest title');
  assert.deepEqual(readComponentCatalog(root).components[0].unknown, { keep: true });
  assert.deepEqual(syncComponentCatalog(root, true), { changed: true, components: 2 });
  assert.equal(readFileSync(path.join(root, 'components.json'), 'utf8'), catalogBefore);
  assert.deepEqual(syncComponentCatalog(root), { changed: true, components: 2 });
  assert.deepEqual(syncComponentCatalog(root), { changed: false, components: 2 });
  assert.equal(JSON.parse(readFileSync(path.join(root, 'components.json'))).components[0].name, 'Manifest title');
  assert.equal(readFileSync(path.join(root, 'library/component.json'), 'utf8'), otherBefore);
  assert.equal(readFileSync(path.join(root, 'chat/surface.json'), 'utf8'), ratingBefore);
});

test('new components are discovered in deterministic ID order after existing records', t => {
  const root = fixture(t);
  manifest(root, 'zebra', { id: 'zebra', extra: 'preserve' });
  manifest(root, 'alpha', { id: 'alpha', pages: [] });
  assert.deepEqual(readComponentCatalog(root).components.map(r => r.id), ['chat', 'library', 'alpha', 'zebra']);
  syncComponentCatalog(root);
  assert.equal(syncComponentCatalog(root, true).changed, false);
});

test('malformed legacy IDs and duplicate rows fail without rewriting anything', t => {
  for (const id of ['../outside', '/absolute', 'CHAT', 'a/b', 'a\\b', 'a%2fb', '', 'a'.repeat(81)]) {
    const root = fixture(t, [{ id }]);
    const before = readFileSync(path.join(root, 'components.json'), 'utf8');
    assert.throws(() => syncComponentCatalog(root), /Invalid/);
    assert.equal(readFileSync(path.join(root, 'components.json'), 'utf8'), before);
  }
  assert.throws(() => readComponentCatalog(fixture(t, [{ id: 'chat' }, { id: 'chat' }])), /Duplicate/);
});

test('manifest IDs must match their directory and malformed JSON never falls back silently', t => {
  const root = fixture(t);
  for (const value of [{ id: 'library' }, { id: '../chat' }, [], null]) {
    manifest(root, 'chat', value);
    assert.throws(() => readComponentCatalog(root));
  }
  writeFileSync(path.join(root, 'chat/component.json'), '{broken');
  assert.throws(() => readComponentCatalog(root), SyntaxError);
  manifest(root, 'chat', { id: 'chat' });
  manifest(root, 'bad id', { id: 'chat' });
  assert.throws(() => readComponentCatalog(root), /directory ID/);
});

test('traversal, malformed page IDs and duplicate page/proof IDs are refused', t => {
  const root = fixture(t);
  for (const file of ['../escape', '/escape', 'round/../../escape', 'round\\escape', 'round/%2e%2e/escape', 'round//escape']) {
    manifest(root, 'chat', { id: 'chat', pages: [{ id: 'doc', file }] });
    assert.throws(() => readComponentCatalog(root), /path/);
  }
  for (const key of ['pages', 'proofRefs']) {
    const entry = { id: 'doc', component: 'library', file: 'README.md' };
    manifest(root, 'chat', { id: 'chat', [key]: [entry, entry] });
    assert.throws(() => readComponentCatalog(root), /duplicate/);
    manifest(root, 'chat', { id: 'chat', [key]: [{ ...entry, id: '../bad' }] });
    assert.throws(() => readComponentCatalog(root), /Invalid/);
  }
});

test('oversized and non-object records are refused', t => {
  const root = fixture(t);
  manifest(root, 'chat', { id: 'chat', large: 'x'.repeat(256_000) });
  assert.throws(() => readComponentCatalog(root), /oversized/);
  writeFileSync(path.join(root, 'components.json'), '[]');
  assert.throws(() => readComponentCatalog(root), /object/);
});

test('catalog, known component, manifest and root symlinks cannot be followed', t => {
  const outside = fixture(t);
  const root = fixture(t);
  symlinkSync(outside, path.join(root, 'chat'));
  assert.throws(() => readComponentCatalog(root), /Symbolic/);
  const other = fixture(t);
  mkdirSync(path.join(other, 'chat'));
  symlinkSync(path.join(outside, 'components.json'), path.join(other, 'chat/component.json'));
  assert.throws(() => readComponentCatalog(other), /Symbolic/);
  symlinkSync(outside, path.join(other, 'linked-root'));
  assert.throws(() => readComponentCatalog(path.join(other, 'linked-root')), /Symbolic/);
  const linked = path.join(other, 'catalog-root');
  mkdirSync(linked);
  symlinkSync(path.join(outside, 'components.json'), path.join(linked, 'components.json'));
  assert.throws(() => readComponentCatalog(linked), /Symbolic/);
});

test('CLI check reports drift without writing, sync exports compatibility then check passes', t => {
  const root = fixture(t);
  manifest(root, 'chat', { id: 'chat', name: 'CLI title' });
  const cli = path.resolve(import.meta.dirname, '../../../tools/ui-hub-catalog.mjs');
  const run = command => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, command, root], { encoding: 'utf8' });
  assert.equal(run('check').status, 1);
  assert.equal(run('sync').status, 0);
  assert.equal(run('check').status, 0);
  assert.equal(run('invalid').status, 2);
});
