// @ts-expect-error Vitest is supplied by the repository check runner via pnpm dlx.
import { describe, expect, it } from 'vitest';
import { validAccountSnapshot } from '../../components/ClaudeAccounts';
import { freshSessionUsage } from '../../components/ProviderUsageMeters';
const account = {id:'claude-siso',name:'fuzeheritage',readOnly:false,week:{pct:12,resetsAt:500000},usageAt:1000,usageStale:false,renewsAt:null,renewalStatus:null,credits:null,billingAt:null,billingStale:true};
describe('account display trust and freshness',()=>{
 it('rejects malformed responses and rows instead of keeping a fresh badge',()=>{
  expect(validAccountSnapshot({accounts:[account],refreshing:false})).toBe(true);
  for(const value of [{},{accounts:[]},{accounts:[null],refreshing:false},{accounts:[{...account,week:{pct:NaN}}],refreshing:false},{accounts:[{...account,name:'private-sentinel'}],refreshing:false},{accounts:[account,account],refreshing:false}])expect(validAccountSnapshot(value)).toBe(false);
 });
 it('never turns an old, failed, expired or future limit into fresh usage through session activity',()=>{
  const session={fiveHour:{pct:20,resetsAt:900000},week:{pct:30,resetsAt:1000000},at:400000,limitsAt:1000,limitsStale:false};
  expect(freshSessionUsage(session,401000)).toEqual([]);
  expect(freshSessionUsage({...session,limitsAt:400000},401000)).toEqual([20,30]);
  expect(freshSessionUsage({...session,limitsAt:400000,limitsStale:true},401000)).toEqual([]);
  expect(freshSessionUsage({...session,limitsAt:500000},401000)).toEqual([]);
  expect(freshSessionUsage({...session,limitsAt:400000,week:{pct:30,resetsAt:400000}},401000)).toEqual([]);
 });
});
