// t-0567, the task board: its lanes follow `bin/ask queue AGENT-BASE` (To do + Specced + Building = the queue), and his
// writes go through bin/ask and a0-task. A fixture store and stand-in CLIs that record their argv; never the live store.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-board-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const tasks = path.join(dir, 'tasks'), calls = path.join(dir, 'calls.jsonl'), ideas = path.join(dir, 'ideas.jsonl');
const { mkdirSync } = await import('node:fs');
mkdirSync(tasks);
Object.assign(process.env, { AB_A0_TASKS: tasks, AB_IDEAS: ideas, AB_BOARD_ORDER: path.join(dir, 'state/order.json'), AB_OWNER_CARDS: path.join(dir, 'owners'),
  AB_A0_TASK_CMD: path.join(dir, 'a0-task'), AB_ASK_CMD: path.join(dir, 'ask'), AB_WORKSPACE: dir, AB_LIVE_LOG: path.join(dir, 'no-live.jsonl') });

const now = Date.parse('2026-10-09T02:00:00+07:00');
const at = (h) => new Date(now - h * 3600_000).toISOString();
const put = (t) => writeFileSync(path.join(tasks, `${t.id}.json`), JSON.stringify({ owner: 'AGENT-BASE', project: 'agent-base', priority: 'P2', his: '', links: {}, evidence: [], history: [], ...t }));
put({ id: 't-0001', title: 'Old specced', stage: 'specced', created: at(50) });
put({ id: 't-0002', title: 'Newer specced, priority', stage: 'specced', priority: 'P1', created: at(40) });
put({ id: 't-0003', title: 'Urgent', stage: 'specced', priority: 'P0', created: at(30) });
put({ id: 't-0004', title: 'Being built', stage: 'building', created: at(20), links: { pr: 'https://github.com/sisodias/siso-internal-labs-agent-base/pull/84' } });
put({ id: 't-0005', title: 'Superseded by t-0006', stage: 'specced', created: at(19) });
put({ id: 't-0006', title: 'Replaces t-0005', stage: 'specced', created: at(18), supersedes: ['t-0005'] });
put({ id: 't-0007', title: 'Someone else', stage: 'specced', owner: 'LIBRARY', created: at(17) });
put({ id: 't-0008', title: 'A thought', stage: 'thought', his: 'maybe a thing', created: at(2) });
put({ id: 't-0009', title: 'Landed yesterday', stage: 'live', created: at(60), history: [{ stage: 'live', at: at(24), evidence: 'cce65eae11f8 live' }] });
put({ id: 't-0010', title: 'Landed long ago', stage: 'live', created: at(900), history: [{ stage: 'live', at: at(800) }] });
put({ id: 't-0011', title: 'Waiting on him', stage: 'feedback', created: at(10) });
writeFileSync(ideas, [
  { id: 'i-001', text: 'His idea', by: 'Shaan', his: 'his words', status: 'new', at: at(5) },
  { id: 'i-002', text: 'Done idea', by: 'SCOUT', status: 'integrated', at: at(4) },
  { id: 'i-003', text: 'An agent idea', by: 'SCOUT', his: null, status: 'new', at: at(3) },
].map(r => JSON.stringify(r)).join('\n') + '\n');
mkdirSync(path.join(dir, 'owners'));
writeFileSync(path.join(dir, 'owners/AGENT-BASE.json'), JSON.stringify({ name: 'AGENT-BASE', status: 'working', updated: at(1), summary: 'v143 live', next: 'sprint 1: the task board' }));

// Stand-ins for bin/ask and bin/a0-task: record argv, and change the fixture store the way the real ones do.
const cli = (name, body) => { const f = path.join(dir, name); writeFileSync(f, `#!/usr/bin/env node\nconst fs=require('fs'),path=require('path');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({cli:${JSON.stringify(name)},a})+'\\n');const T=${JSON.stringify(tasks)};${body}`); chmodSync(f, 0o755); };
cli('ask', `if(a[0]!=='new')process.exit(2);const flag=k=>(a.find(x=>x.startsWith('--'+k+'='))||'').slice(k.length+3);const title=a[a.indexOf('--')+1];
const n=fs.readdirSync(T).length+100;const id='t-0'+n;fs.writeFileSync(path.join(T,id+'.json'),JSON.stringify({id,title,his:flag('his'),owner:flag('owner'),project:flag('project'),stage:'specced',priority:'P2',created:new Date().toISOString(),links:{spec:'/x.md'},supersedes:flag('supersedes')?flag('supersedes').split(','):[]}));console.log(id+' /x.md');`);
cli('a0-task', `if(a[0]!=='set')process.exit(2);const f=path.join(T,a[1]+'.json'),t=JSON.parse(fs.readFileSync(f));for(const kv of a.slice(2).filter(x=>!x.startsWith('--'))){const[k,v]=kv.split('=');t[k]=v;}fs.writeFileSync(f,JSON.stringify(t));`);
const argv = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];

const { readBoard, createBoardWriter, titleOf } = await import('../src/board.ts');
const ids = (cards) => cards.map(c => c.id);

test('lanes follow bin/ask queue: open stages, owner AGENT-BASE, superseded folded under their replacement', async () => {
  const b = await readBoard(dir, 7, now);
  assert.equal(b.queue, 6, 't-0001 t-0002 t-0003 t-0004 t-0006 t-0011');
  const { ideas: i, specced, todo, building, landed } = b.lanes;
  assert.equal(specced.length + todo.length + building.length, b.queue, 'the lanes add up to the queue');
  assert.deepEqual(ids(todo), ['t-0003', 't-0002'], 'To do is P0/P1, P0 first until he orders it');
  assert.deepEqual(ids(specced), ['t-0001', 't-0006']);
  assert.deepEqual(specced[1].folds, ['t-0005']);
  assert.deepEqual(ids(building), ['t-0004', 't-0011']);
  assert.deepEqual(building[0].link, { label: 'PR 84', url: 'https://github.com/sisodias/siso-internal-labs-agent-base/pull/84' });
  assert.deepEqual(ids(i), ['t-0008', 'i-003', 'i-001'], 'thoughts and open farm ideas, newest first');
  assert.deepEqual(landed.flatMap(g => ids(g.cards)), ['t-0009'], 'last 7 days only');
  assert.equal((await readBoard(dir, 60, now)).lanes.landed.flatMap(g => g.cards).length, 2, 'older ones one click away');
  assert.deepEqual(b.sprint, { status: 'working', summary: 'v143 live', next: 'sprint 1: the task board', updated: at(1) });
});

test('a typed task becomes an ask with his words verbatim, at the top of To do', async () => {
  const write = createBoardWriter();
  const words = 'Make the board show\nwhat landed — "exactly" this';
  const r = await write({ op: 'tell', words, kind: 'task' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const made = r.body.id;
  const [ask, set] = argv().slice(-2);
  assert.deepEqual(ask.a, ['new', '--project=agent-base', '--owner=AGENT-BASE', `--his=${words}`, '--', 'Make the board show']);
  assert.deepEqual(set.a, ['set', made, 'priority=P1', '--by=shaan']);
  const b = await readBoard(dir, 7, Date.now());
  assert.equal(b.lanes.todo[0].id, made);
  assert.equal(b.lanes.todo[0].his, words);
  assert.equal(b.queue, 7);
});

test('a typed idea lands in Ideas at once, in the farm, marked his', async () => {
  const r = await createBoardWriter()({ op: 'tell', words: 'an idea for later', kind: 'idea' });
  assert.equal(r.body.id, 'i-004');
  const b = await readBoard(dir, 7, Date.now());
  assert.equal(b.lanes.ideas[0].id, 'i-004');
  assert.equal(b.lanes.ideas[0].by, 'Shaan');
});

test('Make it a task keeps the idea\'s words; the farm idea is taken, a thought is superseded', async () => {
  const write = createBoardWriter();
  const r = await write({ op: 'make-task', id: 'i-003' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(argv().at(-1).a[3], "--his=SCOUT's idea (i-003): An agent idea");
  const farm = readFileSync(ideas, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual([farm.find(i => i.id === 'i-003').status, farm.find(i => i.id === 'i-003').task], ['taken', r.body.id]);
  assert.equal(farm.length, 4, 'no idea lost in the rewrite');
  const t = await write({ op: 'make-task', id: 't-0008' });
  assert.equal(t.status, 200);
  assert.ok(argv().at(-1).a.includes('--supersedes=t-0008'));
  assert.ok(argv().at(-1).a.includes('--his=maybe a thing'));
  const b = await readBoard(dir, 7, Date.now());
  assert.ok(!ids(b.lanes.ideas).includes('t-0008') && !ids(b.lanes.ideas).includes('i-003'));
  assert.ok(ids(b.lanes.specced).includes(t.body.id) && ids(b.lanes.specced).includes(r.body.id), 'a made task waits in Specced');
});

test('his drag order holds, To do in and out moves priority', async () => {
  const write = createBoardWriter();
  let b = await readBoard(dir, 7, Date.now());
  const order = ids(b.lanes.todo).reverse();
  assert.equal((await write({ op: 'order', ids: order })).status, 200);
  b = await readBoard(dir, 7, Date.now());
  assert.deepEqual(ids(b.lanes.todo), order);
  assert.equal((await write({ op: 'todo', id: 't-0001', on: true })).status, 200);
  b = await readBoard(dir, 7, Date.now());
  assert.equal(b.lanes.todo.at(-1).id, 't-0001', 'joins at the end of To do');
  await write({ op: 'todo', id: 't-0001', on: false });
  b = await readBoard(dir, 7, Date.now());
  assert.ok(ids(b.lanes.specced).includes('t-0001'));
});

test('bad writes are refused before any CLI runs', async () => {
  const write = createBoardWriter(), n = argv().length;
  for (const w of [{ op: 'tell', words: '   ' }, { op: 'tell', words: 'x'.repeat(4001) }, { op: 'make-task', id: '../etc' }, { op: 'make-task', id: 't-0001' },
    { op: 'todo', id: 'x; rm' }, { op: 'order', ids: ['t-0001', 7] }, { op: 'order', ids: [] }, { op: 'nope' }, null]) {
    assert.equal((await write(w)).status, 400, JSON.stringify(w));
  }
  assert.equal(argv().length, n);
});

test('titles are the first line, cut at a word', () => {
  assert.equal(titleOf('short\nsecond line'), 'short');
  const long = titleOf('word '.repeat(40));
  assert.ok(long.length <= 101 && long.endsWith('…') && !long.includes('wor…'));
});
