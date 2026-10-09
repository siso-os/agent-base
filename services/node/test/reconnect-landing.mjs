// A scratch Git graph: patch-equivalent commits count as landed, and git work yields to sockets/timers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-reconnect-landing.'));
const repo=path.join(dir,'repo'), bin=path.join(dir,'bin');mkdirSync(repo);mkdirSync(bin);
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','--initial-branch=main');git('config','user.name','RECONNECT fixture');git('config','user.email','fixture@localhost');
writeFileSync(path.join(repo,'base'),'base');git('add','base');git('commit','-m','base');const base=git('rev-parse','HEAD');
git('switch','-c','ui/lab');writeFileSync(path.join(repo,'work'),'work');git('add','work');git('commit','-m','unlanded work');const work=git('rev-parse','HEAD');
git('update-ref','refs/remotes/origin/ui/lab',work);git('update-ref','refs/remotes/origin/main',base);
for(const b of ['old/idea','pr/x','archive/x']){git('switch','-c',b,base);writeFileSync(path.join(repo,b.replace('/','-')),b);git('add','.');git('commit','-m',`work on ${b}`);git('update-ref',`refs/remotes/origin/${b}`,git('rev-parse','HEAD'));}git('switch','ui/lab');
writeFileSync(path.join(bin,'git'),'#!/bin/sh\nif [ "$1" = "cherry" ]; then sleep 0.2; fi\nexec /usr/bin/git "$@"\n',{mode:0o755});
process.env.PATH=`${bin}:${process.env.PATH}`;process.env.AB_LANDING_FETCH='0';
const {readLanding,laneOf}=await import('../src/landing.ts');
// Who means to land: ui/lab's lane has a live owner; old/idea has neither a PR nor one; pr/x has an open PR; archive/x never counts.
const intent={prs:async()=>new Map([['pr/x',12]]),owners:async()=>new Set(['ui'])};
let ticks=0;const timer=setInterval(()=>ticks++,5);const one=readLanding(repo,intent),two=readLanding(repo,intent);assert.equal(one,two,'one outstanding report per repo');
const before=await one;clearInterval(timer);assert.ok(ticks>5,'git cherry must not block event loop');
assert.deepEqual(before.branches.map(b=>[b.branch,b.why]).sort(),[['pr/x','PR #12 open'],['ui/lab','UI is live']]);assert.equal(before.branches.find(b=>b.branch==='ui/lab').commits,1);
assert.deepEqual(before.parked.map(b=>[b.branch,b.why]).sort(),[['archive/x','archived'],['old/idea','no open PR, and no live OLD']]);assert.equal(laneOf('ui/lab'),'ui');
git('switch','main');git('cherry-pick',work);git('update-ref','refs/remotes/origin/main',git('rev-parse','HEAD'));
const after=await readLanding(repo,intent);assert.deepEqual(after.branches.map(b=>b.branch),['pr/x'],'cherry-picked patch is landed');assert.equal(after.live.behind,0);
assert.equal((await readLanding(path.join(dir,'missing'))).branches.length,0,'missing git repo is harmless');
console.log('PASS async report coalescing/timer responsiveness, intent (PR, live owner, parked with why), patch equivalence, cache invalidation and missing repo');
