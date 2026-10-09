import assert from 'node:assert/strict';
import { CODEX_QUOTA_SOURCE, codexQuotaEvidence } from '../src/quota-provenance.ts';

export const now = Date.parse('2026-10-06T00:00:00Z');
export const target = { hostId:'fixture-host', accountId:'fixture-account', model:'gpt-6-astra', limitId:'codex' };
export const reading = {
  source:CODEX_QUOTA_SOURCE, hostId:target.hostId, observedAt:now,
  response:{ accountId:target.accountId, ordinaryUsageAllowed:true, rateLimits:{limitId:'legacy-unrelated'}, rateLimitsByLimitId:{codex:{
    limitId:'codex', spendControlReached:false, rateLimitReachedType:null,
    primary:{usedPercent:40,windowDurationMins:300,resetsAt:now/1000+3600},
    secondary:{usedPercent:20,windowDurationMins:10080,resetsAt:now/1000+86400},
  }}},
};

// The fixture exports are shared with admission tests without running this suite on import.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  let checks=0;
  const check=(name,mutate,expected,pattern)=>{
    const r=structuredClone(reading),t=structuredClone(target);mutate?.(r,t);
    const result=codexQuotaEvidence(r,t,now);assert.equal(result.ok,expected,name);
    if(pattern)assert.match(result.reason,pattern,name);checks++;return result;
  };
  const good=check('Provider account, host, bucket and original time retained',null,true);
  assert.deepEqual(good.quota,{...target,source:CODEX_QUOTA_SOURCE,observedAt:now,ordinaryUsageAllowed:true,spendControlReached:false,rateLimitReachedType:null,windows:[{durationMins:300,usedPercent:40,resetsAt:now+3600_000},{durationMins:10080,usedPercent:20,resetsAt:now+86400_000}],individualLimit:null});checks++;
  check('Host mismatch',(r)=>r.hostId='other',false,/host/);
  check('Account mismatch',(r)=>r.response.accountId='other',false,/account/);
  check('Account absent',(r)=>delete r.response.accountId,false,/account/);
  check('Email is not account identity',(r)=>{delete r.response.accountId;r.response.email='fixture@example.test'},false,/account/);
  check('Missing target binding',(_r,t)=>delete t.accountId,false,/identity/);
  check('No pooled token source',(r)=>r.source='newest Codex token_count event',false,/source/);
  check('Original timestamp stale',(r)=>r.observedAt-=300_001,false,/stale/);
  check('Future timestamp',(r)=>r.observedAt+=1,false,/stale/);
  check('Stale flag',(r)=>r.stale=true,false,/stale/);
  check('Malformed stale flag',(r)=>r.stale='false',false,/stale/);
  check('No bucket fallback',(r)=>r.response.rateLimitsByLimitId={},false,/bucket/);
  check('Bucket identity mismatch',(r)=>r.response.rateLimitsByLimitId.codex.limitId='other',false,/bucket/);
  check('Explicit legacy bucket accepted',(r)=>{r.response.rateLimits=r.response.rateLimitsByLimitId.codex;delete r.response.rateLimitsByLimitId},true);
  check('Unlabelled legacy bucket rejected',(r)=>{r.response.rateLimits=r.response.rateLimitsByLimitId.codex;delete r.response.rateLimitsByLimitId;delete r.response.rateLimits.limitId},false,/bucket/);
  check('Duplicate duration',(r)=>r.response.rateLimitsByLimitId.codex.secondary.windowDurationMins=300,false,/invalid|ambiguous/);
  check('No inferred duration',(r)=>r.response.rateLimitsByLimitId.codex.primary.windowDurationMins=60,false,/windows/);
  check('String percentage rejected',(r)=>r.response.rateLimitsByLimitId.codex.primary.usedPercent='40',false,/windows/);
  check('Unknown percentage rejected',(r)=>r.response.rateLimitsByLimitId.codex.primary.usedPercent=null,false,/windows/);
  check('Fractional wire percentage rejected',(r)=>r.response.rateLimitsByLimitId.codex.primary.usedPercent=.5,false,/windows/);
  const single=check('Provider-declared single window retained',(r)=>r.response.rateLimitsByLimitId.codex.primary=null,true);assert.equal(single.quota.windows.length,1);checks++;
  check('Omitted window rejected',(r)=>delete r.response.rateLimitsByLimitId.codex.primary,false,/windows/);
  check('Both windows null rejected',(r)=>{const b=r.response.rateLimitsByLimitId.codex;b.primary=null;b.secondary=null},false,/windows/);
  check('Missing reset rejected',(r)=>r.response.rateLimitsByLimitId.codex.primary.resetsAt=null,false,/windows/);
  check('Millisecond reset cannot be read as seconds',(r)=>r.response.rateLimitsByLimitId.codex.primary.resetsAt=now+3600_000,false,/windows/);
  check('Malformed individual limit rejected',(r)=>r.response.rateLimitsByLimitId.codex.individualLimit={remainingPercent:100},false,/individual/);
  const unknown=check('Missing permission remains unknown',(r)=>delete r.response.ordinaryUsageAllowed,true);assert.equal(unknown.quota.ordinaryUsageAllowed,null);checks++;
  console.log(`PASS quota-provenance: ${checks} focused cases; synthetic provider responses only`);
}
