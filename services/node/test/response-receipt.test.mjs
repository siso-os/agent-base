// 12 Oct, Shaan: "I seem to be getting some response interrupted ... I don't know if it's actually interrupting my response".
// Any error anywhere in a turn marked its finished reply "Response interrupted". Now only an error nothing was said after.
import assert from 'node:assert/strict';
import test from 'node:test';
import { responseReceipt } from '../../../apps/web/src/lib/chat-bank.ts';

const said = (text) => ({ k: 'said', key: text, text });
const error = (text) => ({ k: 'error', key: text, kind: 'api', text, at: 1 });
const turn = (work, answer, endedAt = 5) => ({ key: 't', me: null, work, answer, done: true, ms: 1, endedAt });

test('an error the agent answered after: the reply is complete, not interrupted', () => {
  assert.equal(responseReceipt(turn([error('API Error: 529 overloaded'), said('trying again')], [said('Done: shipped.')]), new Set([5]), false).status, 'complete');
});
test('an error with nothing said after it: interrupted, with its words', () => {
  const r = responseReceipt(turn([said('working on it'), error('API Error: 500')], []), new Set(), false);
  assert.deepEqual(r, { status: 'failed', failure: 'API Error: 500' });
});
test('the last of two errors decides', () => {
  assert.equal(responseReceipt(turn([error('one'), said('ok'), error('two')], []), new Set(), false).status, 'failed');
});
test('no error: as before', () => {
  assert.equal(responseReceipt(turn([], [said('hi')]), new Set([5]), false).status, 'complete');
  assert.equal(responseReceipt(turn([], [said('hi')]), new Set(), true).status, 'streaming');
});
