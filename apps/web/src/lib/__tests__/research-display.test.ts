// @ts-nocheck
import { researchJobMetadata, researchRunMetadata, reportedRunUsage } from '../../../../../services/node/src/research';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { researchFaceName, researchFleetUsage, researchJobName, researchTokenLabel } from '../research-display';

describe('truthful research identities and usage', () => {
  it('prefers reported titles, derives a readable ID fallback and keeps faces tied to identity', () => {
    expect(researchJobName({id:'01-storage-review'})).toBe('Storage review');
    expect(researchJobMetadata({id:'x',title:'Storage review',name:'Opaque'}).name).toBe('Storage review');
    expect(researchFaceName({name:'fleet',machine:'mini'},{id:'x',name:'Before'})).toBe(researchFaceName({name:'fleet',machine:'mini'},{id:'x',name:'After'}));
  });
  it('distinguishes explicit zero from absent, negative, partial or estimated usage', () => {
    expect(researchJobMetadata({usage:{input_tokens:0,output_tokens:0}}).tokens).toBe(0);
    expect(researchJobMetadata({usage:{input_tokens:5}}).tokens).toBeNull();
    expect(researchJobMetadata({tokens:-2}).tokens).toBeNull();
    expect(researchJobMetadata({tokens:'300'}).tokens).toBeNull();
    expect(researchJobMetadata({tokens:300,estimated:true}).tokens).toBeNull();
    expect(researchTokenLabel({tokens:0})).toBe('0 tokens');expect(researchTokenLabel({})).toBe('Tokens unavailable');
  });
  it('sums only explicit completed-turn counters and never substitutes character estimates', () => {
    const raw=[{type:'item.completed',item:{text:'a'.repeat(10000)}},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:50,output_tokens:20}},{type:'turn.completed',usage:{input_tokens:30,output_tokens:10}}].map(JSON.stringify).join('\n');
    expect(reportedRunUsage(raw)).toMatchObject({tokens:160,tokensIn:130,tokensOut:30,usageSource:'run-log'});
    expect(reportedRunUsage('{broken\n'+JSON.stringify({type:'item.completed',item:{text:'unknown'}})).tokens).toBeNull();
    expect(reportedRunUsage(JSON.stringify({type:'turn.completed',usage:{input_tokens:5}})).tokens).toBeNull();
  });
  it('reads only an admitted local run and leaves remote or outside references unavailable', async () => {
    const base=path.resolve('.agents/scratchpads/landing-20261006');
    const file=path.join(base,'canvas-usage-fixture.jsonl');
    mkdirSync(base,{recursive:true});  // a fresh checkout or worktree has no scratchpads yet
    writeFileSync(file.slice(0,-6)+'.meta.json',JSON.stringify({worker:'fleet/job',name:'Storage review'}));
    writeFileSync(file, JSON.stringify({type:'turn.completed',usage:{input_tokens:30,output_tokens:10}})+'\n');
    vi.stubEnv('AB_CODEX_RUNS',base);
    try {
      expect(await researchRunMetadata(`LOG ${file}`,'local','fleet/job')).toMatchObject({tokens:40,usageSource:'run-log'});
      expect(await researchRunMetadata(`LOG ${file}`,'mini','fleet/job')).toEqual({});
      expect(await researchRunMetadata(`LOG ${file}`,'local','other/job')).toEqual({});
      vi.stubEnv('AB_CODEX_RUNS',path.resolve('apps/web/src/lib/__tests__'));
      expect(await researchRunMetadata(`LOG ${file}`,'local','fleet/job')).toEqual({});
    } finally { vi.unstubAllEnvs(); }
  });
  it('makes incomplete fleet totals explicit instead of treating missing jobs as zero', () => {
    expect(researchFleetUsage({jobs:[{tokens:100},{tokens:null}]})).toBe('100 reported tokens · 1 job unavailable');
    expect(researchFleetUsage({jobs:[{tokens:null}]})).toBe('Tokens unavailable');
    expect(researchFleetUsage({jobs:[{tokens:0}]})).toBe('0 reported tokens');
  });
});
