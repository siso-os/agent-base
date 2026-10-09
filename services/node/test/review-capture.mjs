import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createReviewCapture,readReviewCaptures,assistantReviewUrls,safeReviewUrl} from '../src/review-capture.ts';
import {readReviews,markOpened} from '../src/reviews.ts';
import {codexItem} from '../../host/src/codex-events.ts';
import {lineToEvents} from '../src/transcript.ts';

const root=await mkdtemp(path.resolve('.agents/scratchpads/landing-20261006/review-capture-fixture-'));
const file=path.join(root,'reviews-delivered.json'),opened=path.join(root,'reviews-opened.json');
const now=Date.now()-1000;
let resolved=null,calls=0,checks=0;
const make=()=>createReviewCapture({file,now:()=>now,resolve:async()=>{calls++;return resolved;}});
const capture=make();
const bind=(adapter,event,sessionId='session-1')=>{
 const ref={adapter,agentId:'agent-1',sessionId,messageId:event.id};
 resolved={...ref,by:'A0',deliveredAt:now,boundary:'assistant-message-complete',event};return ref;
};
const native=codexItem({type:'agentMessage',id:'native-message',text:'Open [review](https://review.test/native). Approved is just my prose.'},true,now-1)[0];
let ref=bind('native',native);
let results=await Promise.all([capture(ref),capture(ref)]);
assert.equal(results.reduce((n,r)=>n+r.captured,0),1);checks++;
assert.equal((await make()(ref)).captured,0);checks++;
const firstId=results[0].ids[0];
await markOpened(firstId,opened);
assert.equal((await capture(ref)).captured,0);
let review=(await readReviews(null,opened,file)).reviews[0];
assert.equal(review.opened,true);assert.equal(review.verdict,'none');assert.equal(review.provenance.messageId,native.id);assert.deepEqual(review.history.map(h=>h.kind),['posted','opened']);checks++;
const legacy=lineToEvents({type:'assistant',uuid:'legacy-message',timestamp:new Date(now-1).toISOString(),message:{content:[{type:'thinking',thinking:'https://review.test/reasoning'},{type:'tool_use',id:'tool',name:'Bash',input:{command:'https://review.test/tool'}},{type:'text',text:'See https://review.test/legacy and https://review.test/shared?view=page'}]}});
const legacyText=legacy.find(e=>e.t==='text');ref=bind('legacy',legacyText);
assert.equal((await capture(ref)).captured,2);checks++;
assert.equal((await readReviewCaptures(file)).length,3);checks++;
for (const event of [...legacy.filter(e=>e.t!=='text'),{...legacyText,t:'user'},{...legacyText,t:'note'},{...legacyText,t:'tool_done'},{...legacyText,t:'text_delta'},{...legacyText,parent:'child'}]) {
 const r=bind('legacy',{...event,id:'rejected-event'});await assert.rejects(capture(r),/delivered assistant text/);checks++;
}
ref=bind('native',native);
for(const patch of [{sessionId:'other-session'},{agentId:'other-agent'},{adapter:'legacy'},{messageId:'other-message'},{boundary:'stream-delta'},{deliveredAt:now+1}]) {
 const saved=resolved;resolved={...resolved,...patch};await assert.rejects(capture(ref),/provenance/);resolved=saved;checks++;
}
let beforeCalls=calls;
await assert.rejects(capture({...ref,text:'https://forged.test'}),/reference/);assert.equal(calls,beforeCalls);checks++;
await assert.rejects(capture({...ref,sessionId:'x\nprivate'}),/reference/);checks++;
await assert.rejects(capture({...ref,messageId:'undefined:0'}),/reference/);checks++;
resolved=null;await assert.rejects(capture(ref),/unverified/);checks++;
ref=bind('native',{...native,text:'Replacement https://review.test/mutated'});await assert.rejects(capture(ref),/identity changed/);checks++;
assert.equal((await readReviewCaptures(file)).length,3);checks++;
const savedText=await readFile(file,'utf8');assert.ok(!savedText.includes('Approved is just my prose'));assert.ok(!savedText.includes('reasoning'));assert.ok(!savedText.includes('tool_use'));checks++;
assert.equal((await stat(file)).mode&0o777,0o600);checks++;
assert.deepEqual(assistantReviewUrls('See https://review.test/a_(b). and [b](https://review.test/b).\n```sh\nhttps://review.test/code\n```\n> https://review.test/quote\n`https://review.test/inline` ![image](https://review.test/image)\n<a href="https://review.test/html">text</a>'),['https://review.test/a_(b)','https://review.test/b']);checks++;
for(const url of ['javascript:alert(1)','file:///private','https://user:pass@review.test','https://review.test/?token=fixture','https://review.test/?q=private','https://review.test/#token-fixture','https://review.test/?X-Amz-Signature=fixture','https://review.test/\\escape','https://review.test/\nprivate']) {assert.equal(safeReviewUrl(url),null);checks++;}
assert.equal(safeReviewUrl('http://127.0.0.1:54680/review?view=page#footer'),'http://127.0.0.1:54680/review?view=page#footer');checks++;
assert.deepEqual(assistantReviewUrls('<https://review.test/autolink>'),['https://review.test/autolink']);checks++;
assert.throws(()=>assistantReviewUrls('x'.repeat(128*1024+1)),/bound/);checks++;
assert.throws(()=>assistantReviewUrls(Array.from({length:25},(_,i)=>`https://review.test/${i}`).join(' ')),/too many/);checks++;
ref=bind('native',{...native,id:'next-message',text:'https://review.test/new'});
await writeFile(file+'.lock','fixture');await assert.rejects(capture(ref),/busy/);await unlink(file+'.lock');assert.equal(await readFile(file,'utf8'),savedText);checks++;
const journal=path.join(root,'console.jsonl');await writeFile(journal,JSON.stringify({type:'post',id:'console-review',url:'https://review.test/console',agent:'A0',ts:new Date(now).toISOString()})+'\n'+JSON.stringify({type:'answer',card:'console-review',text:'Approved',ts:new Date(now+1).toISOString()})+'\n');
process.env.AB_CONSOLE_EVENTS=journal;
let merged=await readReviews('http://console.test',opened,file);assert.equal(merged.coverage,'console-and-chat');assert.equal(merged.reviews.length,4);assert.equal(merged.reviews.find(r=>r.id==='console-review').verdict,'approved');assert.equal(merged.reviews.filter(r=>r.provenance).every(r=>r.verdict==='none'),true);checks++;
delete process.env.AB_CONSOLE_EVENTS;
const decorated=JSON.parse(savedText);decorated.reviews[0].approved=true;decorated.reviews[0].answers=[{text:'Approved'}];await writeFile(file,JSON.stringify(decorated));
assert.equal((await readReviews(null,opened,file)).reviews.every(r=>r.verdict==='none'),true);checks++;
await writeFile(file,'corrupt fixture');await assert.rejects(capture(ref));assert.equal(await readFile(file,'utf8'),'corrupt fixture');checks++;
merged=await readReviews(null,opened,file);assert.equal(merged.availability,'unavailable');assert.match(merged.error,/Captured chat/);checks++;
console.log(`PASS review-capture: ${checks} assertions; actual native/legacy adapter fixtures, verified identity, idempotence, private bounded store, independent opened/verdict history; no real chat read or launch`);
