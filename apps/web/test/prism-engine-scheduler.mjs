import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const source = await readFile(new URL('../../../packages/halo-face/prism-engine.ts', import.meta.url), 'utf8');
function fixture(src = source) {
  const js = ts.transpileModule(src, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let now=0, serial=0, frames=0, wakes=0, mutation;
  const attrs=new Set();
  const queue=new Map(), listeners=new Map(), media={matches:false,addEventListener:(t,fn)=>add('media',fn)};
  const add=(t,fn)=>{const set=listeners.get(t)??new Set();set.add(fn);listeners.set(t,set)};
  const emit=(t,e={})=>{for(const fn of [...(listeners.get(t)??[])])fn(e)};
  const remove=(t,fn)=>listeners.get(t)?.delete(fn);
  const set=(fn,ms,kind)=>{const id=++serial;queue.set(id,{fn,at:now+Math.max(0,ms),kind});return id};
  const document={hidden:false,addEventListener:add,documentElement:{hasAttribute:k=>attrs.has(k)}}, window={matchMedia:()=>media,addEventListener:add,removeEventListener:remove,setTimeout:(fn,ms)=>set(fn,ms,'timer')};
  const module={exports:{}};
  const c=vm.createContext({MutationObserver:class {constructor(fn){mutation=fn}observe(){}},module,exports:module.exports,document,window,performance:{now:()=>now},clearTimeout:id=>queue.delete(id),requestAnimationFrame:fn=>set(fn,1000/60,'raf'),cancelAnimationFrame:id=>queue.delete(id),require:()=>({faceIdentity:()=>({key:17,family:'codex',features:{head:0,sides:0,top:0,eyes:0}}),featureNames:{head:[0],sides:[0],top:[0],eyes:[0]},projectHue:()=>200})});
  new vm.Script(js).runInContext(c);
  const node=()=>{const values=new Map(),groups=new Map();return {style:{setProperty:(k,v)=>values.set(k,v),getPropertyValue:k=>values.get(k)??''},classList:{add(){},remove(){}},dataset:{},setAttribute(){},removeAttribute(){},innerHTML:'',querySelector:k=>{if(!groups.has(k))groups.set(k,node());return groups.get(k)},querySelectorAll:k=>{if(!groups.has(k))groups.set(k,node());return [groups.get(k)]},addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:24,height:24})}};
  const advance=ms=>{const end=now+ms;let iterations=0;while(true){const due=[...queue].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert.ok(++iterations<100000,'scheduler must not spin');now=due[1].at;queue.delete(due[0]);if(due[1].kind==='raf')frames++;else wakes++;due[1].fn(now)}now=end};
  return {make:o=>new module.exports.PrismFace(node(),o),advance,emit,document,media,queue,sleep:(attr,on,notify=true)=>{on?attrs.add(attr):attrs.delete(attr);if(notify)mutation()},get frames(){return frames},get wakes(){return wakes},get now(){return now}};
}
const f=fixture(), nav=f.make({size:24,status:'waiting',track:true,interactive:true});
assert.equal(f.frames,0);assert.equal(f.queue.size,1);
f.advance(899);assert.equal(nav.elapsed,0);f.advance(18);assert.ok(nav.elapsed>=900 && nav.elapsed<918,'first glance occurs on first paint after wall-time deadline');
f.advance(6083);assert.ok(f.frames<300,`settled nav sleeps: ${f.frames} frames/7s`);
// Nonzero settled gaze and unused accessory offsets must not force animation.
nav.x=nav.tx=2;nav.y=nav.ty=1;nav.vx=nav.vy=0;nav.ax=1;nav.ay=1;nav.gesture=0;nav.blinkStart=-1000;assert.equal(nav.needsFrame(),false);
nav.pointer=true;nav.nextLook=nav.elapsed-1000;nav.nextBlink=nav.elapsed+500;assert.ok(nav.nextWakeMs()>0,'tracked pointer ignores expired glance deadline');
nav.blinkStart=nav.elapsed;assert.equal(nav.needsFrame(),true,'blink animates until reopened');nav.blinkStart=-1000;
f.emit('pointermove',{clientX:24,clientY:24});assert.ok([...f.queue.values()].some(x=>x.at-f.now<=nav.frameMs),'pointer wakes by next allowed face frame');f.advance(400);assert.ok(nav.x>2,'pointer changes gaze');
f.document.hidden=true;f.emit('visibilitychange');assert.equal(f.queue.size,0);f.advance(1000);f.document.hidden=false;f.emit('visibilitychange');assert.ok(f.queue.size>0);
nav.pause(true);assert.equal(f.queue.size,0,'pause cancels all work');nav.pause(false);assert.ok(f.queue.size>0);
f.media.matches=true;f.emit('media');assert.equal(f.queue.size,0);f.media.matches=false;f.emit('media');assert.ok(f.queue.size>0);
const beforeSleep=f.frames;f.sleep('data-doze',true);assert.equal(f.queue.size,0);f.advance(20000);assert.equal(f.frames,beforeSleep,'app idle executes zero animation callbacks');f.sleep('data-doze',false,false);nav.boop();assert.equal(nav.gesture,780,'first input wakes before MutationObserver delivery');f.sleep('data-doze',false);assert.ok(f.queue.size>0);f.sleep('data-still',true);assert.equal(f.queue.size,0);f.sleep('data-still',false);assert.ok(f.queue.size>0);
nav.status('blocked');assert.equal(f.queue.size,0);nav.status('working');assert.ok(f.queue.size>0);nav.destroy();assert.equal(f.queue.size,0);
const beforePortrait=f.frames, portrait=f.make({size:64,status:'waiting'});f.advance(1000);assert.ok(f.frames-beforePortrait>=28 && f.frames-beforePortrait<=31,'portrait keeps 30fps breath');portrait.destroy();assert.equal(f.queue.size,0);
const blink=fixture(), face=blink.make({size:24,status:'waiting'});face.pointer=true;face.nextBlink=50;face.syncMotion();blink.advance(300);assert.ok(face.elapsed>=205);assert.equal(face.el.querySelector('.pf-eye').style.getPropertyValue('--blink'),'1.000','blink finishes open');face.destroy();
const pending=fixture(), p=pending.make({size:24,status:'waiting'});pending.advance(400);const remaining=p.nextWakeMs();assert.equal(remaining,500,'sleep deadline subtracts elapsed wall time');p.destroy();
const greet=fixture(), g=greet.make({size:24,status:'waiting',interactive:true});greet.advance(800);g.boop();greet.advance(100);assert.ok(g.gesture>600,'gesture duration starts at click, excluding prior sleep');greet.advance(800);assert.ok(g.gesture<=0);g.destroy();
const counts=[];
for(const [name,src] of [['baseline',execFileSync('git',['show','d365c727:packages/halo-face/prism-engine.ts'],{encoding:'utf8'})],['candidate',source]]){
 const sim=fixture(src), n=sim.make({size:24,status:'waiting',track:true});sim.advance(60000);counts.push({name,seconds:60,raf:sim.frames,timers:sim.wakes});n.destroy();assert.equal(sim.queue.size,0);
}
assert.ok(counts[1].raf<counts[0].raf*.7,JSON.stringify(counts));
console.log(JSON.stringify({passed:['deadline','settled gaze','pointer','blink completion','hidden','pause','reduced motion','status','destroy','portrait breath','wall-time','app doze/still wake'],counts}));
