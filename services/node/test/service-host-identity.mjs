// Hermetic identity regressions: display names and recycled panes cannot adopt a sealed chat.
import assert from 'node:assert/strict';
import { bindServiceRows } from '../src/service-hosts.ts';

const host = (name, session, pane = null, lead = null) => ({ name, session, pane, lead, cwd: '/fixture', state: 'live', activity: 'idle', context: null, model: null, token: 'fixture-private', port: 1, pid: 1, file: `${session}.json`, startedAt: 1, updatedAt: null, tokensIn: null, tokensOut: null, tokensPerSecond: null });
const row = (id, session, pane = '') => ({ id, name: 'Agent Zero', zero: true, session, pane, cwd: '/fixture' });

const sealed = row('sealed', 'old');
const separate = bindServiceRows([sealed], [host('A0', 'new')]);
assert.equal(separate.length, 2);
assert.equal(separate[0].session, 'old');
assert.equal(separate[0].serviceHost, undefined);
assert.equal(separate[1].session, 'new');
const reusedPane = bindServiceRows([row('old', 'old', 'w1:p1')], [host('A0', 'new', 'w1:p1')]);
assert.equal(reusedPane[0].session, 'old');
assert.equal(reusedPane[0].serviceHost, undefined);

const hosts = [host('A0', 'one', 'w1:p1', 'FIRST'), host('A0', 'two', 'w1:p2', 'SECOND'), host('A0', 'three')];
const joined = bindServiceRows([row('one', 'one', 'w1:p1'), row('two', 'two', 'w1:p2')], hosts);
assert.deepEqual(joined.map(r => r.session), ['one', 'two', 'three']);
assert.deepEqual(joined.slice(0, 2).map(r => r.hostParent), ['FIRST', 'SECOND']);
assert.equal(new Set(joined.map(r => r.id)).size, 3);
assert.equal(bindServiceRows([row('one', 'one'), row('duplicate', 'one')], [hosts[0]]).filter(r => r.serviceHost).length, 1);
assert.ok(!JSON.stringify(joined).includes('fixture-private'));
// A live seat without a harness name reports its own activity, not herdr's pane status (6 Oct: an idle seat counted as working).
const quiet = bindServiceRows([{ id: 'ui', name: 'AGENT BASE', session: 'ui', pane: 'w7:p3Z', cwd: '/fixture', status: 'working' }], [host('UI', 'ui', 'w7:p3Z')]);
assert.equal(quiet[0].status, 'idle');
const down = bindServiceRows([{ id: 'ui', name: 'AGENT BASE', session: 'ui', pane: 'w7:p3Z', cwd: '/fixture', status: 'working' }], [{ ...host('UI', 'ui', 'w7:p3Z'), state: 'down' }]);
assert.equal(down[0].status, 'working');
console.log('PASS: live seat status follows its activity; distinct same-name sessions; no display-name/reused-pane adoption; one binding per host; exact parent metadata; no private token');
