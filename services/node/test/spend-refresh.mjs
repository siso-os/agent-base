import assert from 'node:assert/strict';
import { createSpendReader } from '../src/spend.ts';
const report = day => ({ day, claude_usd_equiv: 0, codex_credits: [0, 0], attributed_to_plan_items: 0, projects: [{project: 'fixture-project', claude_usd_equiv: 0, codex_credits: [0, 0], owners: []}], plan_items: [] });
const start = new Date(2026, 9, 6, 12).getTime();
let checks = 0;
for (const failure of ['timeout', 'malformed', 'schema', 'unavailable']) {
  let clock = start, mode = 'success', calls = 0;
  const read = async () => { calls++; if (mode === 'timeout') throw Object.assign(new Error('fixture'), { killed: true }); if (mode === 'unavailable') throw new Error('fixture'); return mode === 'malformed' ? '{' : JSON.stringify(mode === 'schema' ? {...report('2026-10-06'), projects: [{}]} : report('2026-10-06')); };
  const spend = createSpendReader({ reportMs: 60_000,  read, today: async () => 0, now: () => clock });
  const first = await spend(); assert.equal(first.attribution.state, 'fresh');
  await Promise.all([spend(), spend()]); assert.equal(calls, 1);
  mode = failure; clock += 61_000;
  const failed = await spend(); assert.deepEqual(failed.data, first.data); assert.equal(failed.attribution.state, 'stale'); assert.equal(failed.attribution.reason, failure); assert.equal(failed.attribution.observedAt, start); assert.equal(failed.attribution.attemptedAt, clock); assert.equal(failed.today.from, 'tokens');
  mode = 'success'; clock += 61_000; assert.equal((await spend()).attribution.state, 'fresh');
  const initial = createSpendReader({ reportMs: 60_000, read: async () => { mode = failure; return read(); }, today: async () => null, now: () => clock});
  const unavailable = await initial(); assert.equal(unavailable.source, 'pending'); assert.equal(unavailable.attribution.state, 'unavailable'); assert.equal(unavailable.attribution.observedAt, null); assert.equal(unavailable.today, undefined);
  checks++;
}
// The report can stay yesterday's while today's Tokens observation advances independently.
let clock = new Date(2026, 9, 6, 23, 59, 50).getTime(), count = 0;
const midnight = createSpendReader({ reportMs: 60_000, read: async () => { count++; return JSON.stringify(report('2026-10-06')); }, today: async () => 0, now: () => clock});
await midnight(); clock += 20_000;
const rolled = await midnight(); assert.equal(count, 2); assert.equal(rolled.attribution.state, 'stale'); assert.equal(rolled.attribution.reason, 'day-mismatch'); assert.equal(rolled.data.day, '2026-10-06'); assert.equal(rolled.today.day, '2026-10-07'); checks++;
// Midnight during an in-flight usage scan cannot relabel the prior day's value.
clock = new Date(2026, 9, 6, 23, 59, 59).getTime();
const spanning = createSpendReader({ reportMs: 60_000, read: async () => JSON.stringify(report('2026-10-06')), today: async () => { clock += 2_000; return 0; }, now: () => clock});
assert.equal((await spanning()).today, undefined); checks++;
// Refresh is single-flight including the independent today read.
let resolve; let calls = 0;
const concurrent = createSpendReader({ reportMs: 60_000, read: () => { calls++; return new Promise(r => { resolve = r; }); }, today: async () => Number.NaN, now: () => start});
const a = concurrent(), b = concurrent(); resolve(JSON.stringify(report('2026-10-06')));
assert.deepEqual(await a, await b); assert.equal(calls, 1); assert.equal((await a).today, undefined); checks++;
for (const invalid of ['2026-99-99', '2026-02-30', 'not-a-day']) {
 const reader = createSpendReader({ reportMs: 60_000, read: async () => JSON.stringify(report(invalid)), today: async () => null, now: () => start});
 assert.equal((await reader()).attribution.reason, 'schema');
} checks++;
// t-0570: a slow report never holds today's Tokens figure back; the answer comes within `wait`, and the report replaces it when it lands.
{
 let clock = start, finish, reads = 0;
 const slow = createSpendReader({ reportMs: 60_000,  read: () => { reads++; return new Promise(r => { finish = r; }); }, today: async () => 78.83, now: () => clock, wait: 50 });
 const t0 = Date.now(), early = await slow();
 assert.ok(Date.now() - t0 < 1000, 'answered without waiting for the report');
 assert.equal(early.today.usd, 78.83); assert.equal(early.source, 'pending'); assert.equal(early.attribution.state, 'unavailable');
 const again = await slow(); assert.equal(reads, 1, 'one report run at a time'); assert.equal(again.today.usd, 78.83);
 finish(JSON.stringify(report('2026-10-06'))); await new Promise(r => setTimeout(r, 0));
 const landed = await slow(); assert.equal(landed.source, 'stack-opt'); assert.equal(landed.attribution.state, 'fresh'); assert.equal(landed.today.usd, 78.83); assert.equal(reads, 1, 'the landed report is served, not re-run');
 // A later slow refresh keeps the last report (stale only once it has failed) and today's figure.
 clock += 61_000; const second = slow(); const kept = await second; assert.equal(reads, 2); assert.equal(kept.source, 'stack-opt'); assert.equal(kept.today.usd, 78.83);
 finish('{'); await new Promise(r => setTimeout(r, 0)); const failed = await slow(); assert.equal(failed.attribution.state, 'stale'); assert.equal(failed.attribution.reason, 'malformed'); assert.equal(failed.today.usd, 78.83);
 checks++;
}
console.log(`PASS spend refresh: ${checks} synthetic scenarios; no external commands, filesystem reports or scanners invoked`);

// t-0586: by default the report runs at most every 5 min; today's figure still refreshes each minute.
{
  let clock = new Date(2026, 9, 9, 12).getTime(), reads = 0, usd = 1;
  const spend = createSpendReader({ read: async () => { reads++; return JSON.stringify(report('2026-10-09')); }, today: async () => usd, now: () => clock });
  await spend(); clock += 61_000; usd = 2;
  const minute = await spend(); assert.equal(reads, 1); assert.equal(minute.today.usd, 2); assert.equal(minute.attribution.state, 'fresh');
  clock += 4 * 60_000; await spend(); assert.equal(reads, 2);
}
