import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSubagents } from '../src/subagents.ts';

test('real subagent reader separates 945M total tokens from output rate and exposes no raw samples', () => {
  const root = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-activity-rate.'));
  const keys = ['AB_CLAUDE_DIRS','AB_CODEX_DIRS','AB_HOSTS_DIR','AB_FLEET_RUNS','AB_CODEX_RUNS'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalNow = Date.now, now = Date.now();
  Date.now = () => now;
  const parentSession = 'activity-parent-fixture', workerSession = 'activity-worker-fixture';
  const parent = { id: 'parent', name: 'Fixture Zero', session: parentSession, cwd: root, tool: 'claude' };
  try {
    for (const key of keys) { const dir = path.join(root, key); mkdirSync(dir,{recursive:true}); process.env[key] = dir; }
    const claude = path.join(process.env.AB_CLAUDE_DIRS, 'projects', 'fixture');
    const subdir = path.join(claude, parentSession, 'subagents'); mkdirSync(subdir,{recursive:true});
    writeFileSync(path.join(claude, parentSession + '.jsonl'), JSON.stringify({type:'user',cwd:root,sessionId:parentSession,message:{content:'Synthetic fixture only'}})+'\n');
    const line = (id, at, out) => JSON.stringify({type:'assistant',timestamp:new Date(at).toISOString(),message:{id,usage:{input_tokens:100000,cache_read_input_tokens:900000000,output_tokens:out},content:[{type:'text',text:'Synthetic output'}]}})+'\n';
    writeFileSync(path.join(subdir,'agent-fixture.jsonl'), line('a',now-10000,100)+line('b',now,600));
    writeFileSync(path.join(subdir,'agent-fixture.meta.json'),JSON.stringify({name:'CLAUDE-FIXTURE',description:'Fixture reader'}));
    const codex = path.join(process.env.AB_CODEX_DIRS,'sessions'); mkdirSync(codex,{recursive:true});
    const file = path.join(codex,workerSession+'.jsonl');
    const usage = (at, output, total) => JSON.stringify({type:'event_msg',timestamp:new Date(at).toISOString(),payload:{type:'token_count',info:{total_token_usage:{total_tokens:total,output_tokens:output}}}})+'\n';
    writeFileSync(file,JSON.stringify({type:'session_meta',timestamp:new Date(now-20000).toISOString(),payload:{cwd:root}})+'\n'+usage(now-10000,1000,945000000)+usage(now,1500,945600000));
    const crew = [{id:'worker',name:'CODEX-FIXTURE',session:workerSession,cwd:root,tool:'codex',lead:parent.name,status:'working'}];
    let result = listSubagents(parent,crew);
    const codexRow = result.rows.find(row=>row.name==='CODEX-FIXTURE');
    const claudeRow = result.rows.find(row=>row.name==='CLAUDE-FIXTURE');
    assert.ok(codexRow,'Codex row found'); assert.ok(claudeRow,'Claude row found');
    assert.equal(codexRow.tokens,945600000); assert.equal(codexRow.rate,50); assert.equal(codexRow.rateAt,now); assert.equal(codexRow.rateWindowMs,30000);
    assert.equal(claudeRow.rate,60); assert.equal('outputSamples' in codexRow,false); assert.equal('outputSamples' in claudeRow,false);
    // An input/cache-only accounting update at the same output count cannot alter throughput.
    appendFileSync(file,usage(now,1500,1945600000));
    result=listSubagents(parent,crew); assert.equal(result.rows.find(row=>row.name==='CODEX-FIXTURE').rate,50);
    Date.now=()=>now+31000;
    result=listSubagents(parent,crew); assert.equal(result.rows.find(row=>row.name==='CODEX-FIXTURE').rate,undefined);
  } finally {
    Date.now=originalNow;
    for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    rmSync(root,{recursive:true});
  }
});
