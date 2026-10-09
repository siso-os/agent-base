import assert from 'node:assert/strict';
import path from 'node:path';
import { createCodexQuotaSource, probeCodexQuota, resolveLocalCodexBinding } from '../src/codex-quota-source.ts';
import { createResourceAdmission } from '../src/resource-admission.ts';
import { codexQuotaEvidence } from '../src/quota-provenance.ts';
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const context = { model: 'gpt-6-astra', repo: process.cwd(), task: {}, recovery: false };
const target = { hostId: 'fixture-host', accountId: 'fixture-account', model: context.model, limitId: 'codex' };
const binding = (mode = 'ok') => ({ target: { ...target }, fingerprint: 'fixture-binding', executable: process.execPath, args: [path.join(import.meta.dirname, 'fixtures/usage/quota-server.mjs'), mode], cwd: process.cwd(), env: { PATH: process.env.PATH } });
const hardware = async () => ({ at: Date.now(), pressure: 'normal', held: false, availableBytes: 1000, diskFreeBytes: 1000, diskFloorBytes: 1, rssBytes: 1, plannedBytes: 1, reserveBytes: 1, budgetBytes: 1000 });
const read = mode => probeCodexQuota(binding(mode), new AbortController().signal, 1000);
const good = await read('ok');
check('exact allowlisted protocol', () => assert.deepEqual(good.response._methods, ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']));
check('account never refreshes tokens', () => assert.deepEqual(good.response._requests[2].params, { refreshToken: false }));
check('quota excludes reset credits and no reserve opt-in', () => assert.deepEqual(good.response._requests[3].params, { excludeResetCreditDetails: true }));
check('no initial capability opts into reserve', () => assert.deepEqual(good.response._requests[0].params.capabilities, { experimentalApi: true }));
check('owned child fully closed', () => assert.throws(() => process.kill(good.response._pid, 0), { code: 'ESRCH' }));
check('provider account has matching independent binding', () => assert.equal(codexQuotaEvidence(good, target).ok, true));
check('fresh observation is actual completed read', () => assert.ok(good.observedAt <= Date.now() && Date.now() - good.observedAt < 2000));
for (const mode of ['api-key', 'malformed', 'oversized', 'mutation', 'provider-error']) {
  await assert.rejects(read(mode), error => error.message === 'Authenticated Codex quota source is unavailable'); checks++; console.log(`PASS reject ${mode} without private details`);
}
const start = Date.now(); await assert.rejects(probeCodexQuota(binding('hang'), new AbortController().signal, 70));
check('hung protocol hard deadline', () => assert.ok(Date.now() - start < 1000));
const controller = new AbortController(); const aborted = probeCodexQuota(binding('hang'), controller.signal, 1000); setTimeout(() => controller.abort(), 50); await assert.rejects(aborted); checks++; console.log('PASS abort closes owned probe');
await assert.rejects(probeCodexQuota(binding(), controller.signal)); checks++; console.log('PASS already aborted does not spawn');
await assert.rejects(probeCodexQuota({ ...binding(), executable: '/nonexistent-agent-base-quota-fixture' }, new AbortController().signal)); checks++; console.log('PASS executable disappearance closes safely');
for (const timeout of [0, -1, 4501, NaN]) { await assert.rejects(probeCodexQuota(binding(), new AbortController().signal, timeout)); checks++; console.log('PASS invalid deadline does not spawn'); }
let resolutions = 0;
const source = createCodexQuotaSource(context, { resolve: () => { resolutions++; return binding(); } });
const allowed = await createResourceAdmission({ ...source, hardware })(context);
check('authenticated producer enables valid admission', () => assert.equal(allowed.ok, true));
check('profile binding checked before and after producer and admission', () => assert.equal(resolutions, 4));
check('final launch pins the probed executable', () => assert.deepEqual(source.launchEnvironment(), { AB_CODEX_BIN: process.execPath }));
let pinStable = true;
const pinSource = createCodexQuotaSource(context, { resolve: () => ({ ...binding(), fingerprint: pinStable ? 'before' : 'changed-before-launch' }), probe: async () => good });
await createResourceAdmission({ ...pinSource, hardware })(context); pinStable = false;
check('final handoff refuses changed binding', () => assert.throws(() => pinSource.launchEnvironment()));
for (const mode of ['wrong-account', 'exhausted', 'permission-missing']) {
  const source = createCodexQuotaSource(context, { resolve: () => binding(mode) });
  const outcome = await createResourceAdmission({ ...source, hardware })(context);
  check(`admission denies ${mode}`, () => assert.equal(outcome.ok, false));
}
for (const switchAt of [2, 3, 4]) {
  let count = 0, probes = 0;
  const source = createCodexQuotaSource(context, { resolve: () => ({ ...binding(), fingerprint: ++count >= switchAt ? 'changed-account-profile-config-or-host' : 'original' }), probe: async () => { probes++; return good; } });
  const outcome = await createResourceAdmission({ ...source, hardware })(context);
  check(`binding switch at check ${switchAt} denies`, () => assert.equal(outcome.ok, false));
  if (switchAt === 2) check('changed binding never starts probe', () => assert.equal(probes, 0));
}
for (const change of [{ observedAt: Date.now() - 300001 }, { observedAt: Date.now() + 60000 }, { stale: true }, { hostId: 'other-host' }]) {
  const source = createCodexQuotaSource(context, { resolve: () => binding(), probe: async () => ({ ...good, ...change }) });
  const outcome = await createResourceAdmission({ ...source, hardware })(context);
  check('stale future or wrong-host evidence denied', () => assert.equal(outcome.ok, false));
}
check('specialized unmapped model fails before reading profile', () => assert.throws(() => resolveLocalCodexBinding({ ...context, model: 'gpt-6-luna' })));
for (const change of [r => r.response.rateLimitsByLimitId.specialized = { limitId: 'specialized' }, r => r.response.rateLimits.limitId = 'specialized', r => delete r.response.rateLimitsByLimitId]) {
  const r = structuredClone(good); change(r);
  const source = createCodexQuotaSource(context, { resolve: () => binding(), probe: async () => r });
  const outcome = await createResourceAdmission({ ...source, hardware })(context);
  check('additional or mismatched bucket cannot authorize', () => assert.equal(outcome.ok, false));
}
console.log(JSON.stringify({ ok: true, checks }));
