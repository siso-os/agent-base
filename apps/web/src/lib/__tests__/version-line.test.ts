// @ts-expect-error Vitest is supplied by pnpm dlx in the repo check, not a web build dependency.
import { describe,it,expect } from 'vitest';
import { versionSha,versionLineState } from '../version-line';
import { spendDialData } from '../spend-dial';
import { localDay } from '../spend';
describe('usage provenance',()=>{
 it('rejects absent and invalid revisions',()=>{expect(versionSha('HEAD')).toBeNull();expect(versionLineState()).toBe('Version unknown');});
 it('compares complete source and live revisions',()=>{const base={source:{ref:'HEAD',sha:'aaaaaaaa'},preview:{ref:'refs/preview',sha:'unknown'},live:{ref:'refs/live',sha:'bbbbbbbb'},layers:{node:'unknown',web:'unknown'}};expect(versionLineState(base)).toBe('Source differs from live');expect(versionLineState({...base,live:{ref:'refs/live',sha:'aaaaaaaa'}})).toBe('Source matches live');});
 it('never substitutes attribution for today',()=>{const now=Date.now();const data=spendDialData({source:'stack-opt',today:{from:'tokens',usd:42.5,day:localDay(),observedAt:now},attribution:{source:'stack-opt',scope:'report-day',state:'stale',day:localDay(),observedAt:now,attemptedAt:now,reason:'timeout'},data:{day:localDay(),claude_usd_equiv:900,codex_credits:[1,2],attributed_to_plan_items:0,plan_items:[],projects:[]}});expect(data.headline.usd).toBe(42.5);expect(data.snapshot?.state).toBe('stale');});
});
