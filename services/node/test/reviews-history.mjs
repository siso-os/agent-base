import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {consoleProjection,readReviews,toReview,markOpened} from '../src/reviews.ts';
const dir=await mkdtemp(join(tmpdir(),'.siso-ephemeral-reviews-')), opened=join(dir,'opened.json');
process.env.AB_PORT='54899';
const p=consoleProjection();p.setBase('http://console.test');
const events=[
 {type:'post',id:'page',kind:'card',url:'https://example.test/one',title:'First',ts:'2026-10-01T00:00:00Z'},
 {type:'answer',card:'page',text:'Approved',ts:'2026-10-02T00:00:00Z'},
 {type:'resolve',card:'page',ts:'2026-10-03T00:00:00Z'},
 {type:'post',id:'page',kind:'card',url:'https://example.test/two',title:'Second',ts:'2026-10-04T00:00:00Z'},
 {type:'answer',card:'page',text:'Approved if you fix the footer',ts:'2026-10-05T00:00:00Z'},
 {type:'post',id:'html',kind:'html',title:'HTML',ts:'2026-10-01T00:00:00Z'},
 {type:'answer',card:'html',text:'Looks good'},
 {type:'post',id:'html',kind:'html',title:'HTML updated'},
 {type:'post',id:'status',kind:'status',body:'Working'},
];events.forEach(p.accept);
p.accept({type:'post',id:'page',kind:'card',url:'https://example.test/one',title:'First revisited'});
assert.equal(p.cards().length,3);
const reviews=p.cards().map(c=>toReview(c,'http://console.test',{}));
assert.equal(reviews[0].verdict,'approved');assert.equal(reviews[1].verdict,'feedback');assert.equal(reviews[2].verdict,'approved');
assert.equal(reviews[2].url,'http://console.test/card/html/html');
assert.equal(toReview({id:'x',status:'unapproved'},'http://console.test',{}).verdict,'none');
assert.equal(toReview({id:'x',resolved:true},'http://console.test',{}).verdict,'none');
assert.equal(toReview({id:'x',feedback:'LGTM, ship it'},'http://console.test',{}).verdict,'approved');
const note=consoleProjection();note.setBase('http://console.test');note.accept({type:'post',id:'note',kind:'note',body:'See [one](https://example.test/one) and https://example.test/two.'});note.accept({type:'answer',card:'note',text:'Approved'});assert.equal(note.cards().length,2);assert.ok(note.cards().every(c=>toReview(c,'http://console.test',{}).verdict==='approved'));
assert.equal(toReview({id:'x',ts:1e100},'http://console.test',{}).at,null);
await Promise.all([markOpened('first',opened),markOpened('second',opened)]);
assert.deepEqual(Object.keys(JSON.parse(await readFile(opened,'utf8'))).sort(),['first','second']);
const journal=join(dir,'events.jsonl');await writeFile(journal,events.map(e=>JSON.stringify(e)).join('\n'));
process.env.AB_CONSOLE_EVENTS=journal;
let r=await readReviews('http://console.test',opened);
assert.equal(r.coverage,'console-journal');assert.equal(r.availability,'available');assert.equal(r.reviews.length,3);
delete process.env.AB_CONSOLE_EVENTS;
let mode='events', cancelled=0;
const server=http.createServer((req,res)=>{
 if(mode==='events'&&req.url==='/events'){
  res.writeHead(200,{'content-type':'text/event-stream'});res.write(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));res.write('data: {"type":"ready"}\n\n');req.on('close',()=>cancelled++);return;
 }
 if(mode==='legacy'&&req.url==='/api/cards'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"cards":[]}');}
 res.writeHead(404);res.end();
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try{
 r=await readReviews(base,opened);assert.equal(r.coverage,'console-replay');assert.equal(r.reviews.length,3);
 mode='legacy';r=await readReviews(base,opened);assert.equal(r.availability,'available');assert.equal(r.reviews.length,0);
 mode='down';r=await readReviews(base,opened);assert.equal(r.availability,'unavailable');assert.ok(r.error);assert.equal(r.coverage,'none');
 assert.ok(cancelled>0);
 assert.equal((await readReviews(null,opened)).availability,'disabled');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log('PASS reviews: durable URLs, actual answer history, approval boundaries, concurrent opens, journal/replay/legacy readers, unavailable versus empty, replay disconnect');
