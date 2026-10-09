import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sleepSummary } from '../src/host-sleep.ts';
import { readServiceHosts } from '../src/service-hosts.ts';
import { agentSessionRoutes } from '../src/routes/agent-session.area.ts';
import { signalRunner } from '../../host/src/idle-sleep.ts';
const dir=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-sleep-readers.'));
try {
 const now=Date.now(),file=path.join(dir,'sleep.jsonl');
 writeFileSync(file,[{name:'fixture-one',at:now-100,rssMB:90},{name:'fixture-two',at:now-200,rssMB:110},{name:'old',at:now-7200000,rssMB:1000},{name:'future',at:now+1,rssMB:9}].map(JSON.stringify).join('\n')+'\nmalformed\n');
 assert.deepEqual(sleepSummary(file,now),{count:2,chats:2,rssMB:200,measured:2,lastAt:now-200});
 assert.ok(!JSON.stringify(sleepSummary(file,now)).includes('fixture-one'));
 assert.equal(sleepSummary(path.join(dir,'missing')).count,0);
 const host={name:'SLEEP-READ',pid:12345,runnerPid:12346,port:12347,token:'fixture-private-token',session:'fixture-session',state:'asleep',child:'running',asleepAt:now,rssAtSleep:90};
 writeFileSync(path.join(dir,'name-SLEEP-READ.json'),JSON.stringify(host));
 let probes=0;
 const sleeping=await readServiceHosts({dir,processAlive:pid=>pid===12346,portHealthy:()=>{probes++;return false;},launchdLoaded:()=>false});
 assert.equal(sleeping.hosts[0].state,'asleep');assert.equal(probes,0);assert.ok(!JSON.stringify(sleeping.publicHosts).includes(host.token));
 const dead=await readServiceHosts({dir,processAlive:()=>false,portHealthy:()=>false,launchdLoaded:()=>false});assert.equal(dead.hosts[0].state,'down');
 assert.throws(()=>signalRunner({...host,runnerPid:process.pid}),/identity changed/,'never signal an unrelated live process');
 let result;
 const route=agentSessionRoutes({ALLOWED_ORIGINS:new Set(['http://fixture']),MACHINE_KEY:'local',json:(_res,status,body)=>{result={status,body};},readBody:async()=>'{"action":"wake"}',listAgents:async()=>[{id:'remote',session:'fixture-session',machineKey:'elsewhere'}]});
 await route.handle({method:'POST',url:'/api/agents/remote/sleep',headers:{origin:'http://foreign'}},{},[]);assert.equal(result.status,403);
 await route.handle({method:'POST',url:'/api/agents/remote/sleep',headers:{origin:'http://fixture'}},{},[]);assert.equal(result.status,404);
 console.log('PASS bounded sleep summary, private fields excluded, dead runner down, unrelated PID not signalled, origin/local identity gates');
} finally {rmSync(dir,{recursive:true});}
