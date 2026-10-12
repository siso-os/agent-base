import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeAccountId, projectAccounts, createAccountReader, mergeBilling } from '../src/claude-accounts.ts';
import { ClaudeUsagePoller, readClaudeUsage, credentialService, createSeatReadings } from '../src/claude-usage.ts';
import { contextMix, contextFiles } from '../src/context-mix.ts';
import { contextGradient } from '../../../packages/siso-composer/src/context-segments.ts';
const reading={week:{pct:18,resetsAt:2000},fiveHour:{pct:3,resetsAt:1000},at:900,ageMs:100,stale:false};
test('account identity requires the explicit profile; two same-model seats stay distinct',()=>{
 assert.equal(claudeAccountId('/fixture/.config/claude-siso-3','/fixture'),'claude-siso-3');
 assert.equal(claudeAccountId('/fixture/.claude-siso','/fixture'),'claude-siso');
 assert.equal(claudeAccountId('/other/.claude-siso','/fixture'),null);
 assert.equal(claudeAccountId(undefined,'/fixture'),null);
 assert.equal(claudeAccountId('claude-opus-5-5','/fixture'),null);
});
test('public rows whitelist fields and never read the protected account',()=>{
 const called=[];
 const rows=projectAccounts({renewals:[{id:'claude-siso',renews:'2026-11-08T00:00:00Z',renewalStatus:'active',email:'private-identity-sentinel'}],credits:[{id:'claude-siso',credits:[{left:42,ends:'2026-11-01T00:00:00Z',token:'secret-sentinel'}]},{id:'claude-fahmy',credits:[{left:900}]}]}, id=>{called.push(id);return reading;},1000,false);
 assert.deepEqual(called,['claude-siso-3','claude-siso']);
 assert.equal(rows[1].credits[0].left,42);assert.equal(rows[1].renewsAt,Date.parse('2026-11-08T00:00:00Z'));
 assert.equal(rows[2].week,null);assert.equal(rows[2].credits,null);assert.equal(rows[2].billingAt,null);
 assert.doesNotMatch(JSON.stringify(rows),/sentinel|email|token/);
 assert.equal(rows[0].credits,null);
});
test('billing unavailable stays unknown; stale readings retain their sample time',async()=>{
 let now=1000,calls=0;
 const reader=createAccountReader(async()=>{calls++;if(calls>1)throw new Error('private-error');return {renewals:[],credits:[{id:'claude-siso',credits:[{left:0}]}]};},()=>now);
 let value=reader(()=>null);assert.equal(value.refreshing,true);assert.equal(value.accounts[1].credits,null);
 await new Promise(r=>setImmediate(r));value=reader(()=>null);assert.equal(value.accounts[1].credits[0].left,0);assert.equal(value.accounts[1].billingAt,1000);
 now+=300001;reader(()=>null);await new Promise(r=>setImmediate(r));value=reader(()=>null);
 assert.equal(value.accounts[1].billingStale,true);assert.equal(value.accounts[1].billingAt,1000);assert.equal(calls,2);
});
test('protected profile cannot reach either injected usage reader or keychain code',async()=>{
 let calls=0;const poller=new ClaudeUsagePoller(async()=>{calls++;return reading;});
 await poller.refresh('/fixture/.config/claude-fahmy');assert.equal(calls,0);
 await assert.rejects(()=>readClaudeUsage('/fixture/.claude-fahmy'),/Read-only/);
});
test('ring source fractions occupy only observed context, including invalid and missing data',()=>{
 assert.equal(contextGradient(null,[{label:'files',value:2,color:'blue'}]),undefined);
 assert.equal(contextGradient(70,[]),undefined);
 assert.equal(contextGradient(50,[{label:'files',value:3,color:'blue'},{label:'chat',value:1,color:'gold'},{label:'invalid',value:-1,color:'red'}]),'conic-gradient(blue 0% 37.5%,gold 37.5% 50%,rgb(255 255 255 / .1) 50% 100%)');
});
test('changed-file marker refreshes even while the transcript cache is warm; escapes stay unknown',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-model-context.'));
 try{
 const source=path.join(root,'example.ts'),session=path.join(root,'session.jsonl');writeFileSync(source,'one');utimesSync(source,1000,1000);
 const recs=[{type:'assistant',message:{content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:source}}]}},{type:'user',timestamp:new Date(2000000).toISOString(),message:{content:[{type:'tool_result',tool_use_id:'read',content:'one'}]}}];
 writeFileSync(session,recs.map(r=>JSON.stringify(r)).join('\n'));
 assert.equal(contextMix(session,root).files[0].state,'unchanged');
 utimesSync(source,3000,3000);assert.equal(contextMix(session,root).files[0].state,'changed');
 assert.deepEqual(contextFiles([{file:'../outside',at:2000000},{file:'missing',at:null}],root).map(f=>f.state),['unknown','unknown']);
 recs.push({type:'system',subtype:'compact_boundary'});writeFileSync(session,recs.map(r=>JSON.stringify(r)).join('\n'));assert.equal(contextMix(session,root).files.length,0);
 }finally{rmSync(root,{recursive:true});}
});

test('a successful credit read cannot freshen or erase a failed renewal, and vice versa',()=>{
 const first=mergeBilling(null,{renewals:[{id:'claude-siso',renews:'2026-11-08T00:00:00Z',renewalStatus:'active'}],credits:[{id:'claude-siso',credits:[{left:25}]}]},1000);
 const next=mergeBilling(first,{renewals:[],credits:[{id:'claude-siso',credits:[{left:20}]}]},2000);
 const rows=projectAccounts(next,()=>null,2000,false);
 assert.equal(rows[1].renewsAt,Date.parse('2026-11-08T00:00:00Z'));assert.equal(rows[1].credits[0].left,20);assert.equal(rows[1].billingAt,1000);assert.equal(rows[1].billingStale,true);
 const failed=mergeBilling(next,{renewals:[],credits:[{id:'claude-siso',credits:null}]},3000);
 assert.equal(failed.credits[0].credits[0].left,20);assert.equal(failed.credits[0].at,2000);assert.equal(failed.credits[0].stale,true);
});
test('global credential override cannot attribute one account to another',()=>{
 const before=process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
 try{process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR='/fixture/.claude-siso';assert.throws(()=>credentialService('/fixture/.config/claude-siso-3'),/conflicts/);assert.match(credentialService('/fixture/.claude-siso'),/^Claude Code-credentials-/);}
 finally{if(before===undefined)delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;else process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR=before;}
});

test('context reads reject a stale seat session before resolving any transcript',async()=>{
 const {agentSessionRoutes}=await import('../src/routes/agent-session.area.ts');
 let receipt=null;
 const route=agentSessionRoutes({sessionOf:new Map([['fixture','current-session']]),cwdOf:new Map(),json:(_res,code,body)=>{receipt={code,body};},listAgents:async()=>{throw new Error('must not scan agents');}});
 await route.handle({method:'GET',url:'/api/agents/fixture/context?session=previous-session'},{},[]);
 assert.equal(receipt.code,409);assert.equal(receipt.body.error,'Context session changed');
});
test('an account with no usage says why, in fixed words, never the error text (Shaan, 10 Oct: "My Fuse Heritage one isn\'t showing stuff")',async()=>{
 const fails={'/f/a':new Error('Claude usage HTTP 401'),'/f/b':new Error('Claude credentials unavailable'),'/f/c':new Error('Claude usage HTTP 429'),'/f/d':new Error('private-token-sentinel at fetch')};
 const poller=new ClaudeUsagePoller(async dir=>{if(fails[dir])throw fails[dir];return {fiveHour:{pct:1,resetsAt:null},week:{pct:2,resetsAt:null}};},()=>1000);
 for(const dir of ['/f/a','/f/b','/f/c','/f/d','/f/ok'])await poller.refresh(dir);
 assert.match(poller.why('/f/a'),/sign-in has expired/);assert.match(poller.why('/f/b'),/no Claude sign-in found/);assert.match(poller.why('/f/c'),/rate-limiting/);
 assert.equal(poller.why('/f/d'),'Anthropic did not answer');assert.equal(poller.why('/f/ok'),null);
 const rows=projectAccounts(null,id=>id==='claude-siso-3'?reading:null,null,true,id=>id==='claude-siso'?poller.why('/f/a'):'never for read-only');
 assert.equal(rows[0].usageWhy,null,'a fresh reading carries no reason');assert.match(rows[1].usageWhy,/expired/);assert.equal(rows[2].usageWhy,null,'the read-only account is never read');
 assert.doesNotMatch(JSON.stringify(rows),/sentinel|token/);
});
test('a login read by its owner hosts uses their reading and is not read again (fuzeheritage: 7 hosts, the node got 429s)',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ab-seats-'));let now=1_000_000;
 const seat=(at,week,config='/f/.claude-siso')=>JSON.stringify({configDir:config,rateLimits:{five_hour:{used_percentage:4,resets_at:'2026-10-10T12:00:00Z'},seven_day:{used_percentage:week,resets_at:null},at}});
 writeFileSync(path.join(dir,'h1.json'),seat(now-60_000,27));writeFileSync(path.join(dir,'h2.json'),seat(now-30_000,28));writeFileSync(path.join(dir,'h3.json'),'{half-written');
 writeFileSync(path.join(dir,'h4.json'),seat(now-1000,90,'/f/.config/claude-siso-3'));
 let reads=0;const poller=new ClaudeUsagePoller(async()=>{reads++;throw new Error('Claude usage HTTP 429');},()=>now,createSeatReadings(dir,()=>now));
 await poller.refresh('/f/.claude-siso');assert.equal(reads,0,'a host read it 30 s ago: no read of the endpoint');
 const got=poller.get('/f/.claude-siso');assert.equal(got.week.pct,28,'the newest host reading');assert.equal(got.stale,false);assert.equal(got.fiveHour.resetsAt,Date.parse('2026-10-10T12:00:00Z'));
 now+=200_000;
 await poller.refresh('/f/.claude-siso');assert.equal(reads,1,'hosts gone quiet: the node reads it itself');
 assert.equal(poller.get('/f/.claude-siso').stale,true);assert.match(poller.why('/f/.claude-siso'),/rate-limiting/);
 assert.equal(poller.get('/f/.claude-fahmy'),null,'the read-only login never takes a seat reading');
 now+=600_000;assert.equal(poller.get('/f/.config/claude-siso-3'),null,'a stopped host\'s reading (over 10 min old) is never shown');
 rmSync(dir,{recursive:true,force:true});
});
