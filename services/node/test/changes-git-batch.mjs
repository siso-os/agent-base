import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const { captureReviewRevision, listChangedFiles } = await import('../src/changes-git.ts');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const root = await mkdtemp(path.join(tmpdir(), 'ab changes\nbatch-test-'));
const oldTmpdir = process.env.TMPDIR;
process.env.TMPDIR = root;
try {
const repoPath = path.join(root, 'repo');
await mkdir(repoPath); // the directory is empty and private; git init below owns it
const repo = await realpath(repoPath); // macOS /var -> /private/var must match source containment checks
const run = (...args) => git(repo, ...args);
run('init', '-q');
run('config', 'user.name', 'Synthetic Fixture');
run('config', 'user.email', 'fixture@example.invalid');
await writeFile(path.join(repo, 'tracked.txt'), 'baseline\n');
run('add', '--', 'tracked.txt');
run('commit', '-qm', 'baseline');

// The hostile filter is configured after the tracked deletion is committed, so the
// fixture can create its baseline without invoking that filter.
await writeFile(path.join(repo, 'white space\nname.txt'), 'literal\nnew\n');
await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');
await chmod(path.join(repo, 'tracked.txt'), 0o755);
await symlink('tracked.txt', path.join(repo, 'link')); 
await writeFile(path.join(repo, 'deleted.txt'), 'to delete\n');
run('add', '--', 'deleted.txt');
run('commit', '-qm', 'second baseline');
await rm(path.join(repo, 'deleted.txt'));
run('config', 'filter.forbidden.clean', 'false');
run('config', 'filter.forbidden.required', 'true');
await writeFile(path.join(repo, '.gitattributes'), '* filter=forbidden\n');
const indexBefore = await readFile(path.join(repo, '.git/index'));

const beforeSpools = new Set((await readdir(tmpdir())).filter(n => n.startsWith('ab-changes-index-')));
const captured = await captureReviewRevision(repo, { kind: 'uncommitted' });
assert.ok(/^[a-f0-9]{40,64}$/.test(captured.revision.treeOid));
assert.deepEqual(await readFile(path.join(repo, '.git/index')), indexBefore /* private index is never modified */);
const files = await listChangedFiles(repo, captured.revision, captured.untracked);
const byPath = new Map(files.map(file => [file.newPath ?? file.oldPath, file]));
assert.equal(byPath.get('white space\nname.txt').newPath, 'white space\nname.txt');
assert.equal(byPath.get('tracked.txt').newMode, '100755');
assert.equal(byPath.get('link').newMode, '120000');
assert.equal(byPath.get('deleted.txt').change, 'deleted');
assert.equal(byPath.get('deleted.txt').newPath, null);
const afterSpools = new Set((await readdir(tmpdir())).filter(n => n.startsWith('ab-changes-index-')));
assert.deepEqual(afterSpools, beforeSpools);

// Measure the checked-in implementation against the exact HEAD source on one
// unchanged synthetic 500-file task. The shim counts each real git executable
// invocation and can force the batched hash phase to fail after spools exist.
const benchmarkRepoPath = path.join(root, 'benchmark-repo');
await mkdir(benchmarkRepoPath);
const benchmarkRepo = await realpath(benchmarkRepoPath);
const benchmarkGit = (...args) => execFileSync('git', ['-C', benchmarkRepo, ...args], { encoding: 'utf8' }).trim();
benchmarkGit('init', '-q');
benchmarkGit('config', 'user.name', 'Synthetic Fixture');
benchmarkGit('config', 'user.email', 'fixture@example.invalid');
for (let i = 0; i < 500; i++) await writeFile(path.join(benchmarkRepo, `file-${i}.txt`), `synthetic ${i}\n`);
benchmarkGit('add', '--', '.');
benchmarkGit('commit', '-qm', 'benchmark baseline');
for (let i = 0; i < 500; i++) await writeFile(path.join(benchmarkRepo, `file-${i}.txt`), `synthetic changed ${i}\n`);
const benchmarkIndexBefore = await readFile(path.join(benchmarkRepo, '.git/index'));
const benchmarkBin = path.join(root, 'benchmark-bin');
await mkdir(benchmarkBin);
const benchmarkLog = path.join(root, 'git-spawns.log');
const benchmarkGitShim = path.join(benchmarkBin, 'git');
await writeFile(benchmarkGitShim, `#!/bin/sh
printf 'x\\n' >> "$BENCHMARK_GIT_LOG"
case " $* " in *' --stdin-paths '*) if [ "$BENCHMARK_FAIL_BATCH" = 1 ]; then printf 'invalid\\n'; exit 0; fi;; esac
exec /usr/bin/git "$@"
`, { mode: 0o700 });
const baselineRef = process.env.AB_SNAPSHOT_BASELINE_REF;
const baselineModulePath = path.resolve(import.meta.dirname, '../src/changes-git-baseline-benchmark.ts');
process.once('exit', () => { try { unlinkSync(baselineModulePath); } catch {} });
let baseline;
if (baselineRef) {
  const baselineSource = execFileSync('git', ['show', `${baselineRef}:services/node/src/changes-git.ts`], { encoding: 'utf8' });
  await writeFile(baselineModulePath, baselineSource);
  baseline = await import(baselineModulePath);
}
const originalPath = process.env.PATH;
process.env.PATH = `${benchmarkBin}:${originalPath}`;
process.env.BENCHMARK_GIT_LOG = benchmarkLog;
const measure = async module => {
  await writeFile(benchmarkLog, '');
  const started = performance.now();
  const result = await module.captureReviewRevision(benchmarkRepo, { kind: 'uncommitted' });
  const elapsedMs = performance.now() - started;
  const spawns = (await readFile(benchmarkLog, 'utf8')).trim().split('\n').filter(Boolean).length;
  return { result, elapsedMs, spawns };
};
const after = await measure({ captureReviewRevision });
assert.ok(after.spawns <= 30, `batched Git count exceeded budget: ${after.spawns}`);
assert.deepEqual(await readFile(path.join(benchmarkRepo, '.git/index')), benchmarkIndexBefore);
console.log(`changes-git-batch current (instrumented shim): ${after.spawns} git children; ${after.elapsedMs.toFixed(2)}ms`);
if (baseline) {
  const before = await measure(baseline);
  assert.equal(after.result.revision.treeOid, before.result.revision.treeOid);
  assert.equal(after.result.revision.id, before.result.revision.id);
  assert.ok(after.spawns < before.spawns, `batched Git count did not improve: ${before.spawns} -> ${after.spawns}`);
  console.log(`changes-git-batch benchmark (instrumented shim): ${before.spawns} -> ${after.spawns} git children; ${before.elapsedMs.toFixed(2)}ms -> ${after.elapsedMs.toFixed(2)}ms`);
}

const beforeFailureSpools = new Set((await readdir(tmpdir())).filter(n => n.startsWith('ab-changes-index-')));
process.env.BENCHMARK_FAIL_BATCH = '1';
await assert.rejects(() => captureReviewRevision(benchmarkRepo, { kind: 'uncommitted' }), error => error.code === 'snapshot-unavailable');
delete process.env.BENCHMARK_FAIL_BATCH;
const afterFailureSpools = new Set((await readdir(tmpdir())).filter(n => n.startsWith('ab-changes-index-')));
assert.deepEqual(afterFailureSpools, beforeFailureSpools);
process.env.PATH = originalPath;
if (baseline) await unlink(baselineModulePath).catch(() => {});

// SHA-256 repositories are accepted when the installed Git supports them.
const shaRepo = path.join(root, 'sha256');
await mkdir(shaRepo);
const shaRepoReal = await realpath(shaRepo);
let shaSupported = true;
try { git(shaRepoReal, 'init', '-q', '--object-format=sha256'); }
catch (error) {
  shaSupported = false;
  assert.match(String(error), /not supported|unknown option|object format/i);
}
if (shaSupported) {
  git(shaRepoReal, 'config', 'user.name', 'Synthetic Fixture');
  git(shaRepoReal, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(shaRepoReal, 'file'), 'sha256\n');
  git(shaRepoReal, 'add', '--', 'file');
  git(shaRepoReal, 'commit', '-qm', 'sha256 baseline');
  await writeFile(path.join(shaRepoReal, 'file'), 'sha256 changed\n');
  const sha = await captureReviewRevision(shaRepoReal, { kind: 'uncommitted' });
  assert.equal(sha.revision.treeOid.length, 64);
}

// A rejected over-budget capture still removes its private index and every spool.
await writeFile(path.join(repo, 'too-large'), Buffer.alloc(16 * 1024 * 1024 + 1, 65));
const beforeBudget = new Set((await readdir(tmpdir())).filter(n => n.startsWith('ab-changes-index-')));
await assert.rejects(() => captureReviewRevision(repo, { kind: 'uncommitted' }), error => error.code === 'output-limit');
const afterBudget = new Set((await readdir(tmpdir())).filter(n => n.startsWith('ab-changes-index-')));
assert.deepEqual(afterBudget, beforeBudget);
console.log('changes-git-batch: PASS (raw bytes, modes, symlink, deletion, SHA-256-if-supported, cleanup)');
} finally {
if (oldTmpdir === undefined) delete process.env.TMPDIR;
else process.env.TMPDIR = oldTmpdir;
await unlink(path.resolve(import.meta.dirname, '../src/changes-git-baseline-benchmark.ts')).catch(() => {});
await rm(root, { recursive: true, force: true });
}
