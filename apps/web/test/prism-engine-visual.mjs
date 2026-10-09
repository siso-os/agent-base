import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'../../..'), out=path.join(root,'.agents/runs/2026-10-09-face-sleep');
const {webkit}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const identity=compile(fs.readFileSync(path.join(root,'packages/halo-face/identity.ts'),'utf8'));
const css=fs.readFileSync(path.join(root,'packages/halo-face/prism-face.css'),'utf8');
const candidate=compile(fs.readFileSync(path.join(root,'packages/halo-face/prism-engine.ts'),'utf8'));
const previous=compile(execFileSync('git',['show','4714dea5:packages/halo-face/prism-engine.ts'],{cwd:root,encoding:'utf8'}));
const browser=await webkit.launch({headless:true});
try {
 const results={};
 for(const [name,code] of [['previous',previous],['candidate',candidate]]) {
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  await page.route('**/*',r=>r.abort());
  await page.setContent(`<style>${css}body{background:#111;color:#eee;font:14px sans-serif;display:grid;grid-template-columns:repeat(6,1fr);gap:24px;padding:24px}section{text-align:center}.pf{margin:12px}</style>`);
  results[name]=await page.evaluate(({identity,code})=>{
   Object.defineProperty(performance,'now',{value:()=>0});
   window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};window.setTimeout=()=>1;
   window.IntersectionObserver=class{observe(){}unobserve(){}};
   const load=(text,require=()=>{})=>{const module={exports:{}};new Function('module','exports','require',text)(module,module.exports,require);return module.exports};
   const id=load(identity), {PrismFace}=load(code,()=>id), states=['working','waiting','needs-shaan','blocked','done','offline'], out=[];
   for(const size of [32,64]) for(const family of ['codex','claude']) for(const status of states){
    const section=document.createElement('section'),host=document.createElement('span');section.textContent=`${family} ${status} ${size}`;section.append(host);document.body.append(section);
    const f=new PrismFace(host,{name:'FIXTURE',family,status,size});
    f.x=f.tx=2.123;f.y=f.ty=1.234;f.ax=f.x*.35;f.ay=f.y*.3;f.vx=f.vy=f.avx=f.avy=0;f.elapsed=59;f.blinkStart=0;f.nextLook=f.nextBlink=Infinity;f.tick(16);
    const style=selector=>{const s=getComputedStyle(host.querySelector(selector));return {transform:s.transform,opacity:s.opacity,display:s.display}};
    out.push({family,status,size,head:style('.pf-head'),gaze:style('.pf-gaze'),top:style('.pf-top'),eye:style('.pf-eye'),svg:host.querySelector('svg').outerHTML.replace(/ style="[^"]*"/g,'')});
   }
   return out;
  },{identity,code});
  await page.screenshot({path:path.join(out,`poses-${name}.png`),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.locator('.pf-head,.pf-gaze,.pf-top,.pf-eye').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).transform==='none'));
  assert.equal(reduced,true,`${name}: reduced motion overrides transforms`);
  await page.close();
 }
 for(let i=0;i<results.previous.length;i++) assert.deepEqual(results.candidate[i],results.previous[i],`pose ${i} must keep computed transforms, state styles and SVG artwork`);
 fs.writeFileSync(path.join(out,'visual-check.json'),JSON.stringify({cases:results.candidate.length,pass:true,compared:['SVG artwork','computed transforms','opacity','display','reduced motion'],poses:results.candidate.map(({svg,...p})=>p)},null,2)+'\n');
 console.log(JSON.stringify({pass:true,cases:results.candidate.length,reducedMotion:true}));
} finally {await browser.close();}
