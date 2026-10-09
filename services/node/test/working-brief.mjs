import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readWorkingBrief} from '../src/working-brief.ts';
import {agentSessionRoutes} from '../src/routes/agent-session.area.ts';
const root=mkdtempSync(path.join(process.env.TMPDIR??tmpdir(),'.siso-ephemeral-working-brief.'));
const cleanup=()=>rmSync(root,{recursive:true});
process.once('exit',cleanup);
for(const sig of ['SIGHUP','SIGINT','SIGTERM'])process.once(sig,()=>{cleanup();process.exit(1);});
try {
 assert.equal(readWorkingBrief(root).state,'missing');
 mkdirSync(path.join(root,'.agents'));
 const file=path.join(root,'.agents/HANDOFF.md');
 writeFileSync(file,'# Handoff\n\n## Current outcome\nShip the reviewed page.\n\nNext: verify every route.\n\n## Earlier\nOld context.');
 const brief=readWorkingBrief(root);
 assert.equal(brief.state,'available');assert.equal(brief.heading,'Current outcome');assert.equal(brief.source,'.agents/HANDOFF.md');
 assert.match(brief.text,/Next: verify/);assert.doesNotMatch(brief.text,/Old context/);assert.ok(Date.parse(brief.updated));
 writeFileSync(file,'## Current\n'+ 'a'.repeat(20000));
 assert.equal(readWorkingBrief(root).text.length,6000);assert.equal(readWorkingBrief(root).truncated,true);
 writeFileSync(file,Buffer.alloc(1_000_001));assert.equal(readWorkingBrief(root).state,'unavailable');
 writeFileSync(file,'not\0text');assert.equal(readWorkingBrief(root).state,'unavailable');
 assert.equal(readWorkingBrief(path.join(root,'personal','private')).state,'private');
 assert.equal(readWorkingBrief('../unknown').state,'unavailable');
 const other=path.join(root,'fallback');mkdirSync(other);writeFileSync(path.join(other,'HANDOFF.md'),'The plain working brief.');
 assert.equal(readWorkingBrief(other).text,'The plain working brief.');
 let response;
 const route=agentSessionRoutes({MACHINE_KEY:'fixture-local',listAgents:async()=>[
  {id:'local',cwd:other,machineKey:'fixture-local'},{id:'remote',cwd:other,machineKey:'fixture-remote'}
 ],json:(_res,status,body)=>{response={status,body};}});
 const res={setHeader:()=>{}};
 await route.handle({method:'GET',url:'/api/agents/local/working-brief'},res,[]);
 assert.equal(response.status,200);assert.equal(response.body.text,'The plain working brief.');
 await route.handle({method:'GET',url:'/api/agents/remote/working-brief'},res,[]);
 assert.equal(response.body.state,'unavailable');assert.equal(response.body.text,null);
 await route.handle({method:'GET',url:'/api/agents/unknown/working-brief'},res,[]);
 assert.equal(response.status,404);
 assert.equal(await route.handle({method:'POST',url:'/api/agents/local/working-brief'},res,[]),false);
 console.log('PASS working brief: bounded section, provenance, absent/private/binary/oversize states, fallback');
 console.log('PASS working brief route: exact local agent, remote refusal, unknown agent and GET-only');
} finally {cleanup();process.removeListener('exit',cleanup);}
