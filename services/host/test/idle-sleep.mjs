import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSleep } from '../src/idle-sleep.ts';
const ready = { state: 'idle', queue: 0, questions: 0, approvals: 0, children: 0, keepAwake: false, idleSince: 100, now: 1_200_100, minutes: 20 };
test('only a finished, unblocked idle host at its deadline may sleep', () => {
  assert.equal(shouldSleep(ready), true);
  for (const state of ['working', 'blocked', 'stopped']) assert.equal(shouldSleep({ ...ready, state }), false);
  for (const field of ['queue', 'questions', 'approvals', 'children']) assert.equal(shouldSleep({ ...ready, [field]: 1 }), false, field);
  for (const override of [{ keepAwake: true }, { idleSince: null }, { now: ready.now - 1 }, { minutes: 0 }, { minutes: -1 }, { minutes: NaN }, { minutes: Infinity }]) assert.equal(shouldSleep({ ...ready, ...override }), false);
});
