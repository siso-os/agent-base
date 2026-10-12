// node --test tools/test/ab-host-sync.test.mjs: the seat host follows a deploy without overwriting anyone's edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SYNC = path.resolve('tools/ab-host-sync');
function fixture() {
  const d = mkdtempSync(path.join(tmpdir(), 'hs-')), repo = path.join(d, 'repo'), state = path.join(d, 'state');
  mkdirSync(path.join(repo, 'services/host/src'), { recursive: true }); mkdirSync(path.join(repo, 'stack/plugin/agents'), { recursive: true }); mkdirSync(state);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  const commit = (host, agents, pkg = '{}') => { writeFileSync(path.join(repo, 'services/host/src/host.ts'), host); writeFileSync(path.join(repo, 'services/host/package.json'), pkg); for (const [n, t] of Object.entries(agents)) writeFileSync(path.join(repo, `stack/plugin/agents/${n}.md`), t); git('add', '-A'); git('commit', '-qm', host); return git('rev-parse', 'HEAD'); };
  git('init', '-q');
  const head = commit('v1', { worker: 'w1' }), live = commit('v2', { worker: 'w1' }), next = commit('v3', { worker: 'w1', scout: 's1' }, '{"sdk":"new"}');
  git('reset', '-q', '--hard', head); git('checkout', '-q', live, '--', 'services/host');   // the checkout runs `live`, HEAD stays
  writeFileSync(path.join(state, 'live.jsonl'), JSON.stringify({ sha: live }) + '\n');
  const bin = path.join(d, 'bin'); mkdirSync(bin);
  const pnpm = ok => { writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\necho ${ok ? 'ok' : 'ERR_PNPM_OUTDATED_LOCKFILE no'}\nexit ${ok ? 0 : 1}\n`); chmodSync(path.join(bin, 'pnpm'), 0o755); };
  pnpm(true);
  const run = sha => spawnSync(SYNC, [sha], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AB_LIVE_CHECKOUT: repo, AB_LIVE_STATE: state } });
  const read = f => readFileSync(path.join(repo, f), 'utf8');
  return { repo, git, run, read, next, pnpm };
}

test('brings services/host and stack to the deployed sha, then says nothing to do', () => {
  const f = fixture();
  const r = f.run(f.next);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.read('services/host/src/host.ts'), 'v3');
  assert.equal(f.read('stack/plugin/agents/scout.md'), 's1');
  assert.equal(f.git('rev-parse', 'refs/host-live'), f.next);
  assert.match(f.run(f.next).stdout, /already at/);
});
test("someone's edit refuses the whole sync and changes nothing", () => {
  const f = fixture();
  writeFileSync(path.join(f.repo, 'services/host/src/host.ts'), 'my edit');
  const r = f.run(f.next);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /host\.ts is edited/);
  assert.equal(f.read('services/host/src/host.ts'), 'my edit');
  assert.throws(() => f.read('stack/plugin/agents/scout.md'));
});
test('a failed dependency install still syncs the code and leaves package.json exactly as it was', () => {
  const f = fixture(); f.pnpm(false);
  const before = f.git('ls-files', '-s', 'services/host/package.json');
  const r = f.run(f.next);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dependencies NOT installed/);
  assert.equal(f.read('services/host/src/host.ts'), 'v3');
  assert.equal(f.read('services/host/package.json'), '{}');
  assert.equal(f.git('ls-files', '-s', 'services/host/package.json'), before);
});
test('a file the deployed sha deleted is removed, unless someone edited it', () => {
  const f = fixture();
  assert.equal(f.run(f.next).status, 0);
  const head = f.git('rev-parse', 'HEAD');
  f.git('reset', '-q', '--hard', f.next); f.git('rm', '-q', 'stack/plugin/agents/scout.md'); f.git('commit', '-qm', 'drop scout');
  const gone = f.git('rev-parse', 'HEAD');
  f.git('reset', '-q', '--hard', head); f.git('checkout', '-q', f.next, '--', 'services/host', 'stack');
  const r = f.run(gone);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removed 1 file/);
  assert.throws(() => f.read('stack/plugin/agents/scout.md'));
});
