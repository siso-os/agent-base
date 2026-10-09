// t-0562: one record per agent. The reconciler merges the registry, the live rows and the owner cards, each agent once;
// a live agent with no entry is recorded unplaced and nothing is filed under an owner by itself; dead copies the resolver
// hides are archived; an owner's card words merge into its file. Fixture dirs only; never the live node or live state.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { archiveShadowed, navFromRecords, readCards, reconcile, recordUnplaced, writeCard } from '../src/agent-records.ts';

const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-agent-records-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('each agent once: live beats planned, offline owners stay, ghosts are counted not shown', () => {
  const registry = {
    'AGENT-BASE': { kind: 'owner', project: 'Agent Base', machine: 'mini', role: 'Agent Base app' },
    'ab-zero': { kind: 'owner', project: 'Agent Base' },
    'OLD-HELPER': { kind: 'worker', owner: 'AGENT-BASE', project: 'Agent Base' },
    'UI-T0570': { placed: 'unplaced', seen: '2026-10-09T00:00:00Z' },
  };
  const rows = [
    { name: 'AGENT-BASE', status: 'idle', away: true, machineKey: 'mini' },
    { name: 'AGENT-BASE', status: 'working', away: true, machineKey: 'mini', host: { pid: 42, port: 5500, state: 'live', model: 'claude-opus' } },
    { name: 'UI-T0570', status: 'idle', machineKey: 'laptop' },
    { name: 'Codex thread', key: 'codexapp/abc', status: 'working' },
    { name: 'GONE-HOST', pane: '', key: 'service/GONE-HOST', status: 'idle', host: { state: 'down', pid: 9 } },
    { name: 'configs-1', pane: '', key: 'service/configs-1', status: 'idle', hostParent: 'ASTRA-CONFIGS', host: { state: 'live', pid: 10 } },
  ];
  const cards = [{ name: 'AGENT-BASE', title: 'Agent Base', summary: 'Shipping t-0570', asks: ['look at the nav'], machine: 'laptop', page: 'https://example.com/ab' }];
  const { records, stale } = reconcile({ registry, rows, cards, machine: 'laptop' });
  assert.deepEqual(records.map(r => r.id), ['AGENT-BASE', 'CONFIGS-1', 'UI-T0570', 'AB-ZERO'], 'live first, the offline owner after; no Codex thread, no down host, no ghost worker');
  const job = records.find(r => r.id === 'CONFIGS-1');
  assert.deepEqual([job.owner, job.placed], ['ASTRA-CONFIGS', 'set'], 'its spawner placed it');
  assert.equal(stale, 1, 'OLD-HELPER is a ghost: counted, not listed');
  const ab = records[0];
  assert.deepEqual([ab.state, ab.live, ab.runtime?.pid, ab.model, ab.machine], ['working', true, 42, 'claude-opus', 'mini']);
  assert.deepEqual([ab.label, ab.summary, ab.needsYou, ab.links], ['Agent Base app', 'Shipping t-0570', ['look at the nav'], ['https://example.com/ab']]);
  assert.deepEqual(ab.conflicts, ['card says laptop, it runs on mini'], 'the card that disagrees with where it runs is named; "Mac mini" and "mini" agree');
  assert.equal(records.find(r => r.id === 'UI-T0570').placed, 'unplaced');
  assert.deepEqual([records[3].state, records[3].name, records[3].placed], ['offline', 'ab-zero', 'set']);
});

test('a live agent with no entry is recorded unplaced; entries placed by hand are never touched', () => {
  const registry = { 'AB-ZERO': { kind: 'owner', project: 'Agent Base' }, 'AGENT-BASE': { kind: 'owner', project: 'Agent Base' } };
  const rows = [
    { name: 'AB-ZERO', cwd: '/w/_data/worktrees/siso-internal-labs-agent-base/zero', pane: 'w7:p1' },
    { name: 'AGENT-BASE', cwd: '/w/_data/worktrees/siso-internal-labs-agent-base/train', pane: 'w7:p2' },
    { name: 'NEW-HELPER', cwd: '/w/_data/worktrees/siso-internal-labs-agent-base/lane', pane: 'w7:p3' },
    { name: 'ab-zero', cwd: '/x', pane: 'w7:p9' },
    { name: 'Agent Zero', zero: true, pane: 'w7:p0' },
    { name: 'configs-1-94f33a06', pane: '', key: 'service/configs-1-94f33a06', hostParent: 'ASTRA-CONFIGS', host: { state: 'live' } },
    { name: 'GONE-HOST', pane: '', key: 'service/GONE-HOST', host: { state: 'down' } },
  ];
  const before = structuredClone(registry);
  assert.deepEqual(recordUnplaced(registry, rows, Date.parse('2026-10-09T01:00:00Z')), ['NEW-HELPER']);
  assert.deepEqual(registry['NEW-HELPER'], { placed: 'unplaced', seen: '2026-10-09T01:00:00.000Z' }, 'no owner, no project: not filed under AGENT-BASE');
  assert.deepEqual(registry['AB-ZERO'], before['AB-ZERO'], 'AB-ZERO stays an owner (the 8 Oct misfiling)');
  assert.equal(registry['Agent Zero'], undefined);
  assert.equal(registry['configs-1-94f33a06'], undefined, 'a job its spawner placed needs no entry');
  assert.equal(registry['GONE-HOST'], undefined, 'a down host is not a running agent');
  assert.deepEqual(recordUnplaced(registry, rows), [], 'a second read records nothing');
});

test('dead copies the resolver set aside are archived; live, recent, kept and remote files stay', () => {
  const hosts = path.join(dir, 'hosts'); mkdirSync(hosts);
  const old = (Date.now() - 3600_000) / 1000;
  const put = (f, body, fresh = false) => { const p = path.join(hosts, f); writeFileSync(p, JSON.stringify(body)); if (!fresh) utimesSync(p, old, old); return p; };
  const kept = put('w7_p52.json', { name: 'OPERATOR-UI', pid: 1 });
  put('w7_p49.json', { name: 'OPERATOR-UI', pid: 999001 });
  put('name-HEALTH.json', { name: 'HEALTH', pid: 999002, runnerPid: 2 });
  put('w7_p60.json', { name: 'FRESH', pid: 999003 }, true);
  put('remote-mini-1.json', { name: 'RESEARCH', pid: 999004 });
  put('w7_p70.json', { name: 'ALIVE', pid: 3 });
  const day = (Date.now() - 2 * 86400_000) / 1000;
  const helper = put('name-dev-trace-1.json', { name: 'dev-trace-1', pid: 999005, harness: 'codex', lead: 'HALO-HER-ALONE' }); utimesSync(helper, day, day);
  // FAHMY's real file: Agent Zero started it, so it names a lead; the registry says owner, and that decides.
  const owner = put('name-FAHMY.json', { name: 'FAHMY', pid: 999006, harness: 'codex', lead: 'Agent Zero' }); utimesSync(owner, day, day);
  const young = put('name-dev-trace-2.json', { name: 'dev-trace-2', pid: 999007, harness: 'codex', lead: 'HALO-HER-ALONE' });
  const archive = path.join(dir, 'archive');
  const moved = archiveShadowed(hosts, new Set([kept, helper, owner, young]), { archive, alive: pid => pid < 1000, registry: { Fahmy: { kind: 'owner', workspace: 'clients' } } });
  assert.deepEqual(moved.sort(), ['name-dev-trace-1.json', 'w7_p49.json'], 'a dead shadowed copy, and a codex helper a day dead');
  assert.ok(existsSync(path.join(archive, 'w7_p49.json')) && !existsSync(path.join(hosts, 'w7_p49.json')), 'moved, not deleted');
  for (const f of ['name-FAHMY.json', 'name-dev-trace-2.json', 'w7_p52.json', 'name-HEALTH.json', 'w7_p60.json', 'remote-mini-1.json', 'w7_p70.json']) assert.ok(existsSync(path.join(hosts, f)), `${f} stays`);
});

test("an owner's card words merge into its own file; an unreadable card is never overwritten", () => {
  const owners = path.join(dir, 'owners'); mkdirSync(owners);
  writeFileSync(path.join(owners, 'AGENT-BASE.json'), JSON.stringify({ name: 'AGENT-BASE', title: 'Agent Base', status: 'building', next: 'land t-0570' }));
  assert.equal(writeCard('AGENT-BASE', { summary: 'Shipped', needsYou: ['look at the nav'] }, { dir: owners, now: Date.parse('2026-10-09T02:00:00Z') }), null);
  const card = JSON.parse(readFileSync(path.join(owners, 'AGENT-BASE.json'), 'utf8'));
  assert.deepEqual([card.status, card.next, card.summary, card.needsYou, card.updated], ['building', 'land t-0570', 'Shipped', ['look at the nav'], '2026-10-09T02:00:00.000Z']);
  assert.equal(writeCard('NEW-ONE', { summary: 'hello' }, { dir: owners, title: 'New one' }), null);
  assert.equal(JSON.parse(readFileSync(path.join(owners, 'NEW-ONE.json'), 'utf8')).title, 'New one');
  writeFileSync(path.join(owners, 'BROKEN.json'), '{ not json');
  assert.match(writeCard('BROKEN', { summary: 'x' }, { dir: owners }), /unreadable/);
  assert.equal(readFileSync(path.join(owners, 'BROKEN.json'), 'utf8'), '{ not json');
  assert.match(writeCard('../escape', { summary: 'x' }, { dir: owners }), /cannot have a card/);
  assert.deepEqual(readCards(owners).map(c => c.name).sort(), ['AGENT-BASE', 'NEW-ONE']);
});

test('the nav reads the records: unplaced agents become owners, helpers a +N on their owner, a stopped owner offline', () => {
  // The 9 Oct live shape: IMAGE-GEN ran with no entry and was hidden; A0's and LANDING-ART's helpers were nowhere; FAHMY's host was down yet read idle.
  const registry = { 'IMAGE-GEN': { placed: 'unplaced', seen: '2026-10-09T00:00:00Z' }, 'LANDING-ART': { placed: 'unplaced' }, FAHMY: { kind: 'owner', workspace: 'clients' }, 'AGENT-BASE': { kind: 'owner', project: 'Agent Base' } };
  const rows = [
    { name: 'Agent Zero', zero: true, pane: 'w1:p0', navOwner: false },
    { name: 'AGENT-BASE', pane: 'w1:p2', navOwner: true },
    { name: 'IMAGE-GEN', pane: '', key: 'service/IMAGE-GEN', host: { state: 'live' }, navOwner: false },
    { name: 'LANDING-ART', pane: '', key: 'service/LANDING-ART', host: { state: 'live' }, navOwner: false },
    { name: 'LANDING-OG-1', pane: '', key: 'service/LANDING-OG-1', hostParent: 'LANDING-ART', host: { state: 'live' }, navOwner: false },
    { name: 'IMG-GLASS', pane: '', key: 'service/IMG-GLASS', hostParent: 'Agent Zero', host: { state: 'live' }, navOwner: false },
    { name: 'IMG-OLD', pane: '', key: 'service/IMG-OLD', hostParent: 'Agent Zero', host: { state: 'down' }, navOwner: false },
    { name: 'FAHMY', pane: '', key: 'service/FAHMY', host: { state: 'down' }, navOwner: true },
    { name: 'Codex thread', key: 'codexapp/1', navOwner: true },
    { name: 'eco-blog', key: 'MB/codex-worker-eco-blog', pane: '', codexWorker: true, row: 'live', status: 'done', lead: 'Agent Zero', navOwner: false },
    { name: 'NO-ENTRY', pane: '', key: 'service/NO-ENTRY', host: { state: 'live' }, navOwner: false },
  ];
  navFromRecords(rows, registry, 'laptop');
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.deepEqual([by['IMAGE-GEN'].navOwner, by['LANDING-ART'].navOwner], [true, true], 'running and unplaced: shown, in Playground');
  assert.deepEqual([by['LANDING-OG-1'].navOwner, by['IMG-GLASS'].navOwner], [false, false], 'helpers are never rows');
  assert.deepEqual([by['LANDING-ART'].navHelpers, by['Agent Zero'].navHelpers, by['AGENT-BASE'].navHelpers], [1, 1, undefined], 'a stopped helper is not counted');
  assert.deepEqual([by.FAHMY.navOwner, by.FAHMY.navOffline, by['AGENT-BASE'].navOffline], [true, true, undefined], 'a stopped owner keeps its place, offline');
  assert.equal(by['Codex thread'].navOffline, undefined, 'views are left alone');
  assert.deepEqual([by['eco-blog'].navOwner, by['NO-ENTRY'].navOwner], [false, false], 'a finished codex job and a row with no unplaced entry are not promoted (9 Oct: 180 jobs in Playground)');
});
