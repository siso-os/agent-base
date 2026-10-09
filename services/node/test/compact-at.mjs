import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { compactAtRows } from '../src/compact-at.ts';
import { agentActionsRoutes } from '../src/routes/agent-actions.area.ts';

test('compact-at route uses detached argv, validates Claude identity and reads durable selections', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ab-compact-at-'));
  const file = path.join(dir, 'compact-at.json'), args = path.join(dir, 'argv.json'), bin = path.join(dir, 'compact-at');
  const oldBin = process.env.AB_COMPACT_AT_BIN, oldFile = process.env.AB_COMPACT_AT_FILE;
  process.env.AB_COMPACT_AT_BIN = bin; process.env.AB_COMPACT_AT_FILE = file;
  await writeFile(file, JSON.stringify({ LIBRARY: 30 }));
  await writeFile(bin, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(args)},JSON.stringify(process.argv.slice(2)));const f=${JSON.stringify(file)},s=JSON.parse(fs.readFileSync(f));s[process.argv[2]]=Number(process.argv[3]);fs.writeFileSync(f,JSON.stringify(s));`, {mode:0o700});
  const rows = [{name:'LIBRARY',tool:'claude'},{name:'NEW',tool:'siso'},{name:'CODEX',tool:'codex'}, {name:'DUP',tool:'claude'}, {name:'DUP',tool:'claude'}];
  const route = agentActionsRoutes({ALLOWED_ORIGINS:new Set(['http://fixture']), listAgents:async()=>rows,
    readBody:async req=>{let body='';for await(const part of req)body+=part;return body;},
    json:(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}});
  const server = http.createServer((req,res)=>void route.handle(req,res,[]).catch(e=>{res.writeHead(500);res.end(e.message);}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/api/agents/`;
  const post=(name,pct,extra={})=>fetch(`${url}${encodeURIComponent(name)}/compact-at`,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify({pct})});
  try {
    assert.deepEqual((await compactAtRows(rows)).map(r=>r.compactAt),[30,35,undefined,35,35]);
    for(const pct of [9,91,12.5,'50',null]) assert.equal((await post('LIBRARY',pct)).status,400);
    assert.equal((await post('MISSING',50)).status,404);
    assert.equal((await post('CODEX',50)).status,409);
    assert.equal((await post('DUP',50)).status,409);
    assert.equal((await post('LIBRARY',50,{origin:'https://foreign.test'})).status,403);
    assert.equal((await fetch(`${url}LIBRARY/compact-at`)).status,405);
    const result=await post('LIBRARY',50);assert.equal(result.status,202);assert.deepEqual(await result.json(),{pending:true,pct:50});
    for(let i=0;i<100;i++){if((await compactAtRows(rows))[0].compactAt===50)break;await new Promise(r=>setTimeout(r,20));}
    assert.deepEqual(JSON.parse(await readFile(args,'utf8')),['LIBRARY','50']);
    assert.equal((await compactAtRows(rows))[0].compactAt,50,'fresh readers recover persisted selection');
    for(const pct of [10,90]){assert.equal((await post('LIBRARY',pct)).status,202);for(let i=0;i<100;i++){if((await compactAtRows(rows))[0].compactAt===pct)break;await new Promise(r=>setTimeout(r,20));}assert.equal((await compactAtRows(rows))[0].compactAt,pct);}
    process.env.AB_COMPACT_AT_BIN=path.join(dir,'missing');assert.equal((await post('LIBRARY',35)).status,502);
  } finally {
    server.closeAllConnections();await new Promise(r=>server.close(r));
    if(oldBin===undefined)delete process.env.AB_COMPACT_AT_BIN;else process.env.AB_COMPACT_AT_BIN=oldBin;
    if(oldFile===undefined)delete process.env.AB_COMPACT_AT_FILE;else process.env.AB_COMPACT_AT_FILE=oldFile;
  }
});
