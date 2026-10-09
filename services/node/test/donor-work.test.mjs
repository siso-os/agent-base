import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createDonorWorkReader } from '../src/donor-work.ts';
import { donorWorkRoute } from '../src/routes/donor-work.route.ts';
import { dispatchRoute } from '../src/routes/registry.ts';
import { donorFixture, hash } from './donor-work-fixture.mjs';

const fixture = async t => { const f = await donorFixture(); t.after(() => f.close()); return f; };

test('same names and project-local task IDs map only by the full donor identity', async t => {
  const f = await fixture(t), before = await f.files(), data = await f.reader();
  assert.equal(data.state, 'ready');
  const [a, b] = data.projects;
  assert.equal(a.name, b.name); assert.equal(a.tasks[0].title, b.tasks[0].title);
  assert.equal(a.tasks[0].ref.taskId, b.tasks[0].ref.taskId);
  assert.notEqual(a.tasks[0].key, b.tasks[0].key);
  assert.equal(a.tasks[0].destination.taskId, 't-alpha');
  assert.equal(b.tasks[0].destination.taskId, 't-beta');
  assert.equal(a.tasks[0].state, 'doing'); assert.equal(a.tasks[0].destination.canonicalStage, 'live');
  assert.equal(a.tasks[0].owner, 'donor-owner');
  assert.equal(a.tasks[1].destination.state, 'unmapped');
  assert.equal(a.tasks[0].ref.snapshotRevision, hash(before[1]));
  assert.deepEqual(await f.files(), before);
});

test('renames do not change identity; unmapped projects are not silently inferred', async t => {
  const f = await fixture(t), before = await f.reader();
  f.snapshot.projects[0].name = 'Renamed donor project'; f.snapshot.projects[0].tasks[0].title = 'Renamed task';
  f.config.projects.pop(); await f.save();
  const after = await f.reader();
  assert.equal(after.projects[0].key, before.projects[0].key);
  assert.equal(after.projects[0].tasks[0].destination.taskId, 't-alpha');
  assert.equal(after.projects[1].destination.state, 'unmapped');
  assert.equal(after.projects[1].tasks[0].destination.state, 'unmapped');
});

test('changed snapshot bytes fail closed before reading any canonical source', async t => {
  const f = await fixture(t); await writeFile(f.snapshotFile, JSON.stringify({ ...f.snapshot, extra: true }));
  const data = await f.reader(); assert.equal(data.state, 'unavailable'); assert.deepEqual(data.projects, []);
  assert.equal(f.targetReads, 0); assert.ok(!JSON.stringify(data).includes(f.root));
});

test('reviewed hash does not excuse a different source or future capture', async t => {
  for (const mutation of [v => v.source.id = 'other-source', v => v.source.revision = 'b'.repeat(40), v => v.capturedAt = '2099-01-01T00:00:00Z']) {
    const f = await fixture(t); f.snapshot = structuredClone(f.snapshot); mutation(f.snapshot); await f.save();
    assert.equal((await f.reader()).state, 'unavailable'); assert.equal(f.targetReads, 0);
  }
});

test('duplicate donor keys, destination merges and unknown mapped records are refused', async t => {
  const mutations = [
    f => f.snapshot.projects.push(f.snapshot.projects[0]),
    f => f.snapshot.projects[0].tasks.push(f.snapshot.projects[0].tasks[0]),
    f => f.config.projects[1].projectId = 'project-A',
    f => f.config.projects[1].tasks[0].taskId = 't-alpha',
    f => f.config.projects.push(f.config.projects[0]),
    f => f.config.projects[0].tasks.push(f.config.projects[0].tasks[0]),
    f => f.config.projects[0].donorProjectId = 'absent',
    f => f.config.projects[0].tasks[0].donorTaskId = 'absent',
  ];
  for (const mutate of mutations) { const f = await fixture(t); mutate(f); await f.save(); assert.equal((await f.reader()).state, 'unavailable'); }
});

test('exact canonical ID lookup cannot join by title or case', async t => {
  const f = await fixture(t); f.targets = { projects: ['project-a', 'Same project title'], tasks: [{ id: 't-ALPHA', stage: 'live', available: true }] };
  let data = await f.reader(); assert.equal(data.projects[0].destination.state, 'missing'); assert.equal(data.projects[0].tasks[0].destination.state, 'missing');
  f.targets.projects = ['project-A']; data = await f.reader();
  assert.equal(data.projects[0].destination.state, 'mapped'); assert.equal(data.projects[0].tasks[0].destination.state, 'missing');
});

test('target outage or ambiguous index preserves donor truth but disables destination links', async t => {
  const f = await fixture(t);
  for (const targets of [
    { projects: null, tasks: null },
    { projects: ['project-A', 'project-A'], tasks: f.targets.tasks },
    { projects: ['project-A'], tasks: null },
    { projects: ['project-A'], tasks: [{ id: 't-alpha', stage: 'live', available: false }] },
    { projects: ['project-A'], tasks: [f.targets.tasks[0], f.targets.tasks[0]] },
  ]) { f.targets = targets; const data = await f.reader(); assert.equal(data.state, 'ready'); assert.equal(data.projects[0].tasks[0].state, 'doing'); assert.equal(data.projects[0].tasks[0].destination.state, 'unavailable'); }
});

test('staleness comes from capture time, not a freshly touched file', async t => {
  const f = await fixture(t); f.snapshot.capturedAt = new Date(f.now - 2 * 86_400_000).toISOString(); await f.save();
  assert.equal((await f.reader()).state, 'stale');
});

test('revoked config and malformed source never leave a last-good donor cache', async t => {
  const f = await fixture(t); assert.equal((await f.reader()).projects.length, 2);
  await unlink(f.configFile); assert.deepEqual((await f.reader()).projects, []);
  await f.save(); await writeFile(f.snapshotFile, '{'); f.config.snapshot.sha256 = hash('{');
  await writeFile(f.configFile, JSON.stringify(f.config)); assert.equal((await f.reader()).state, 'unavailable');
});

test('missing config is explicit, and invalid paths/IDs/oversize files expose no path or payload', async t => {
  const f = await fixture(t);
  assert.equal((await createDonorWorkReader({ configFile: '', readTargets: async () => { throw Error('must not read'); } })()).state, 'unconfigured');
  for (const mutate of [
    x => x.config.snapshot.path = '../outside.json',
    x => x.config.projects[0].tasks[0].taskId = '../private',
    x => x.config.projects[0].projectId = 'project-A\n',
    x => x.snapshot.projects[0].tasks[0].id = 'bad\nidentity',
  ]) { const x = await fixture(t); mutate(x); await x.save(); const data = await x.reader(); assert.equal(data.state, 'unavailable'); assert.ok(!JSON.stringify(data).includes(x.root)); }
  await writeFile(f.snapshotFile, 'x'.repeat(2 * 1024 * 1024 + 1)); assert.equal((await f.reader()).state, 'unavailable');
});

test('non-regular snapshot is refused before read and unsupported private area is excluded', async t => {
  const f = await fixture(t); f.config.snapshot.path = f.root; await writeFile(f.configFile, JSON.stringify(f.config));
  assert.equal((await f.reader()).state, 'unavailable');
  const pipe = path.join(f.root, 'synthetic-pipe'); execFileSync('mkfifo', [pipe]);
  f.config.snapshot.path = pipe; await writeFile(f.configFile, JSON.stringify(f.config));
  assert.equal((await f.reader()).state, 'unavailable');
  const other = await fixture(t); other.snapshot.projects[0].area = 'personal'; await other.save(); assert.equal((await other.reader()).state, 'unavailable');
});

test('projection carries no donor profile, repository, timeline or transport fields', async t => {
  const f = await fixture(t); Object.assign(f.snapshot.projects[0], { agents: [{ pane_id: 'synthetic-pane' }], repos: [{ path: '/synthetic/private-repo' }], timeline: [{ text: 'synthetic private checkin' }] });
  Object.assign(f.snapshot.projects[0].tasks[0], { profile: 'synthetic-profile', terminal: 'synthetic-terminal' });
  await f.save(); const body = JSON.stringify(await f.reader());
  for (const excluded of ['synthetic-pane', 'private-repo', 'private checkin', 'synthetic-profile', 'synthetic-terminal']) assert.ok(!body.includes(excluded));
});

test('default target resolver reuses synthetic canonical task reader and leaves both stores untouched', async t => {
  const f = await fixture(t), tasksDir = path.join(f.root, 'tasks'), registry = path.join(f.root, 'registry.json');
  await mkdir(tasksDir); const updated = new Date(f.now).toISOString();
  const task = { id: 't-alpha', title: 'Canonical title differs', stage: 'tested', project: 'Canonical display label', priority: 'P1', updated, owner: 'canonical-owner' };
  await writeFile(path.join(tasksDir, 'INDEX.json'), JSON.stringify({ updated, tasks: [task] }));
  await writeFile(path.join(tasksDir, 't-alpha.json'), JSON.stringify(task)); await writeFile(registry, JSON.stringify({ projects: [{ id: 'project-A', name: 'Different canonical project' }] }));
  const files = [registry, path.join(tasksDir, 'INDEX.json'), path.join(tasksDir, 't-alpha.json')], before = await Promise.all(files.map(x => readFile(x, 'utf8')));
  const prev = { tasks: process.env.AB_A0_TASKS, registry: process.env.AB_REGISTRY };
  try {
    process.env.AB_A0_TASKS = tasksDir; process.env.AB_REGISTRY = registry;
    const data = await createDonorWorkReader({ configFile: f.configFile, now: () => f.now })();
    assert.equal(data.projects[0].tasks[0].destination.state, 'mapped'); assert.equal(data.projects[0].tasks[0].destination.canonicalStage, 'tested');
    assert.equal(data.projects[0].tasks[0].owner, 'donor-owner'); assert.equal(data.projects[1].destination.state, 'missing');
    assert.deepEqual(await Promise.all(files.map(x => readFile(x, 'utf8'))), before);
  } finally { for (const [key, value] of [['AB_A0_TASKS', prev.tasks], ['AB_REGISTRY', prev.registry]]) value === undefined ? delete process.env[key] : process.env[key] = value; }
});

test('actual HTTP route is GET-only, exact-project scoped and ignores request-controlled source paths', async t => {
  const f = await fixture(t), routes = [donorWorkRoute(f.reader)];
  const server = http.createServer(async (req, res) => {
    if (await dispatchRoute(routes, req, res, new URL(req.url, 'http://fixture').pathname)) return;
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${origin}/api/donor/work?file=/private&source=http://invalid.test`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).projects.length, 2);
  response = await fetch(`${origin}/api/donor/work/projects/alpha`); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.projects.length, 1); assert.equal(data.projects[0].ref.projectId, 'alpha');
  assert.equal((await fetch(`${origin}/api/donor/work/projects/Same%20project%20title`)).status, 400);
  assert.equal((await fetch(`${origin}/api/donor/work/projects/absent`)).status, 404);
  assert.equal((await fetch(`${origin}/api/donor/work/projects/%E0`)).status, 400);
  assert.equal((await fetch(`${origin}/api/donor/work/projects/a%2Fb`)).status, 400);
  const reads = f.targetReads; assert.equal((await fetch(`${origin}/api/donor/work`, { method: 'POST', body: '{}' })).status, 404); assert.equal(f.targetReads, reads);
});
