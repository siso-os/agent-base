import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
// Only the owned source is loaded; React hooks, network and interval scheduling are synthetic.
const source = readFileSync(new URL('./spend.ts', import.meta.url), 'utf8');
let effect, snapshot, refresh;
const original = { fetch: globalThis.fetch, window: globalThis.window, hooks: globalThis.__spendHooks };
globalThis.__spendHooks = { useEffect(fn) { effect = fn; }, useSyncExternalStore(_subscribe, read) { snapshot = read; return read(); } };
const code = stripTypeScriptTypes(source).replace('import { useEffect, useSyncExternalStore } from "react";', 'const {useEffect, useSyncExternalStore} = globalThis.__spendHooks;');
const lib = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const day = lib.localDay(), at = Date.now();
const good = {source:'stack-opt', data:{day, claude_usd_equiv:1, codex_credits:[0,0], attributed_to_plan_items:0, projects:[{project:'fixture-project', claude_usd_equiv:1,codex_credits:[0,0],owners:[]}],plan_items:[]}, attribution:{source:'stack-opt',scope:'report-day',state:'fresh',observedAt:at,attemptedAt:at,day,reason:null},today:{usd:0,from:'tokens',day,observedAt:at}};
let checks = 0;
assert.deepEqual(lib.acceptSpend(null, good), good);
assert.equal(lib.todayUsd({...good,today:undefined}), null);
assert.notEqual(lib.todayUsd(good), null);
assert.equal(lib.todayUsd({...good,today:{...good.today,day:'2000-01-01'}}), null);
assert.equal(lib.todayUsdShort({...good,today:undefined}), null); checks++;
for (const invalid of [null, {}, {...good,data:{...good.data,projects:[{}]}}, {...good,attribution:{...good.attribution,observedAt:'now'}}, {...good,today:{...good.today,usd:'invalid'}}]) {
 const result = lib.acceptSpend(good,invalid,at+1);
 assert.deepEqual(result.data,good.data); assert.equal(result.attribution.state,'stale'); assert.equal(result.attribution.observedAt,at); assert.equal(result.today,undefined);
 assert.equal(lib.acceptSpend(null,invalid).attribution.state,'unavailable');
} checks++;
const pending = {source:'pending',attribution:{source:'stack-opt',scope:'report-day',state:'unavailable',observedAt:null,attemptedAt:at+1,day:null,reason:'timeout'},today:good.today};
assert.deepEqual(lib.acceptSpend(good,pending).data,good.data);
assert.equal(lib.acceptSpend(good,pending).attribution.state,'stale');
assert.equal(lib.acceptSpend(null,pending).source,'pending');
assert.equal(lib.todayUsd(pending),lib.todayUsd(good)); checks++;
let response = good, failure = null, fetches = 0;
globalThis.window = { setInterval(fn) { refresh = fn; return 1; }, clearInterval(id) { assert.equal(id,1); } };
globalThis.fetch = async (url, options) => { assert.equal(url,'/api/spend'); assert.equal(options.cache,'no-store'); assert.ok(options.signal instanceof AbortSignal); fetches++; if (failure === 'timeout') throw new DOMException('fixture','TimeoutError'); return {ok: failure !== 'http', json: async () => { if (failure === 'malformed') throw new SyntaxError('fixture'); return response; }}; };
try {
 assert.equal(lib.useSpend(),null);
 const cleanup = effect(); await new Promise(r=>setImmediate(r)); assert.equal(snapshot().attribution.state,'fresh');
 for (const mode of ['timeout','malformed','http','schema']) {
  failure = mode; response = mode === 'schema' ? {} : good;
  await refresh(); assert.equal(snapshot().attribution.state,'stale'); assert.deepEqual(snapshot().data,good.data); assert.equal(snapshot().today,undefined);
  failure = null; response = good; await refresh(); assert.equal(snapshot().attribution.state,'fresh');
 }
 assert.equal(fetches,9); cleanup(); checks++;
} finally { globalThis.fetch=original.fetch; globalThis.window=original.window; globalThis.__spendHooks=original.hooks; }
console.log(`PASS browser spend store: ${checks} synthetic groups; transport/schema retention, unavailable, source/day separation and recovery`);
