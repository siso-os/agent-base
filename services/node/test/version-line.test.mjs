import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveVersionLine,readVersionLine} from '../src/version.ts';
test('missing or invalid stage evidence never borrows HEAD or web',()=>{
 const v=resolveVersionLine({source:'aaaaaaaa',servedWeb:'bbbbbbbb',preview:'HEAD',live:'../main'});
 assert.equal(v.source.sha,'aaaaaaaa');assert.equal(v.preview.sha,'unknown');assert.equal(v.live.sha,'unknown');assert.equal(v.layers.node,'unknown');assert.equal(v.layers.web,'bbbbbbbb');
});
test('web update preserves independent node revision',()=>{
 const v=resolveVersionLine({runningNode:'aaaaaaaa',servedWeb:'bbbbbbbb',source:'cccccccc',preview:'dddddddd',live:'eeeeeeee'});
 assert.equal(v.layers.node,'aaaaaaaa');assert.equal(v.layers.web,'bbbbbbbb');assert.equal(v.preview.sha,'dddddddd');assert.equal(v.live.sha,'eeeeeeee');
});
test('actual refs and served directory are used even when HEAD differs',()=>{
 const dir=mkdtempSync(path.join(process.env.TMPDIR??tmpdir(),'.siso-ephemeral-version-line.'));
 try {
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-b','main');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');
 writeFileSync(path.join(dir,'fixture'),'one');git('add','fixture');git('commit','-m','one');const live=git('rev-parse','HEAD');git('update-ref','refs/live',live);
 writeFileSync(path.join(dir,'fixture'),'two');git('add','fixture');git('commit','-m','two');const source=git('rev-parse','HEAD');
 git('checkout','-b','fixture');writeFileSync(path.join(dir,'fixture'),'three');git('add','fixture');git('commit','-m','three');
 const web=path.join(dir,'served');mkdirSync(web);writeFileSync(path.join(web,'DEPLOYED_SHA'),source);
 const result=readVersionLine(dir,web);assert.equal(result.source.sha,git('rev-parse','HEAD'));assert.equal(result.live.sha,live);assert.equal(result.preview.sha,'unknown');assert.equal(result.layers.node,'unknown');assert.equal(result.layers.web,source);assert.notEqual(result.source.sha,result.live.sha);
 } finally {rmSync(dir,{recursive:true});}
});
