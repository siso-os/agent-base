import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentOutputRate } from '../src/subagent-rate.ts';
import { measuredWorkerRate, workerRateSummary } from '../../../apps/web/src/lib/subagent-rate.ts';
const now = 100_000;
const points = [{ at: now - 10_000, tokens: 1000 }, { at: now, tokens: 1500 }];
test('output counters use source time, not total-token jumps or poll duration', () => {
  assert.equal(recentOutputRate(points, now), 50);
  assert.equal(recentOutputRate(points, now + 5000), 500 / 15);
  assert.equal(recentOutputRate(points, now + 31_000), undefined);
  assert.equal(recentOutputRate([{ at: now - 10_000, tokens: 945600000 }, { at: now, tokens: 945600500 }], now), 50);
});
test('missing baseline, duplicate timestamps, resets and long reporting gaps do not spike', () => {
  assert.equal(recentOutputRate([points[1]], now), undefined);
  assert.equal(recentOutputRate([{ at: now, tokens: 10 }, { at: now, tokens: 40 }], now), undefined);
  assert.equal(recentOutputRate([...points, { at: now + 1000, tokens: 1 }], now + 1000), undefined);
  assert.equal(recentOutputRate([{ at: now - 90_000, tokens: 10 }, { at: now, tokens: 6000 }], now), undefined);
  assert.equal(recentOutputRate([{ at: now - 1000, tokens: 20 }, { at: now, tokens: 20 }], now), 0);
  assert.equal(recentOutputRate([{ at: NaN, tokens: 50 }, { at: now, tokens: Infinity }], now), undefined);
});
const row = { running: true, kind: 'codex', rate: 52.2, rateAt: now, rateWindowMs: 30_000 };
test('legacy, malformed and stale rates are unavailable; a measured zero is zero', () => {
  assert.equal(measuredWorkerRate({ running: true, kind: 'codex', rate: 40493 }, now), undefined);
  assert.equal(measuredWorkerRate(row, now + 10_001), undefined);
  assert.equal(measuredWorkerRate({ ...row, rate: NaN }, now), undefined);
  assert.equal(measuredWorkerRate({ ...row, rate: -5 }, now), undefined);
  assert.equal(measuredWorkerRate({ ...row, rateAt: now + 5000 }, now), undefined);
  assert.equal(measuredWorkerRate({ ...row, rate: 0 }, now), 0);
});
test('summary excludes finished workers and shells, shows estimate and partial coverage', () => {
  const s = workerRateSummary([row, { ...row, rate: 20, estimated: true }, { ...row, rate: 1000, running: false }, { ...row, kind: 'shell' }, { running: true, kind: 'claude', tokens: 1e9 }], now);
  assert.equal(s.value, 72.2); assert.equal(s.label, '~72.2+'); assert.equal(s.measured, 2); assert.equal(s.total, 3);
  assert.equal(workerRateSummary([{ ...row, rateAt: 0 }], now).label, '—');
});
