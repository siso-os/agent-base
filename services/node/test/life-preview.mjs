// Synthetic-only Life preview. Never forwards requests to the node or the real Life API.
// heavy -- node services/node/test/life-preview.mjs [port] [output-directory]
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repo = path.resolve(import.meta.dirname, '../../..');
// vite is apps/web's dependency; resolve it from there so the check runs in any worktree (pnpm does not hoist it).
const { build } = await import(pathToFileURL(createRequire(path.join(repo, 'apps/web/package.json')).resolve('vite')).href);
const port = Number(process.argv[2] || 5497);
const output = path.resolve(process.argv[3] || path.join(repo, 'apps/web/dist-life-preview'));
mkdirSync(output, { recursive: true });
if (!process.env.LIFE_PREVIEW_SKIP_BUILD) await build({ root: path.join(repo, 'apps/web'), configFile: path.join(repo, 'apps/web/vite.config.ts'), base: '/', logLevel: 'warn', build: { outDir: output, emptyOutDir: false, rollupOptions: { input: path.join(repo, 'apps/web/preview/life.html') } } });
if (process.env.LIFE_PREVIEW_BUILD_ONLY) process.exit(0);
const CONFIG = {
  version: 2, levelSize: 1000, streakMin: 200, dailyTarget: 1000,
  morning: ['wake','pushups','teeth','shower','cold_shower','supplements','meditation','plan'].map(key => ({key,label:key})),
  counters: [
    { key: 'water', label: 'Water', unit: 'ml', inc: 250, goal: 2000, good: 'up' },
    { key: 'cigarettes', label: 'Cigarettes', unit: '', inc: 1, goal: 0, good: 'down' },
    { key: 'cravings', label: 'Cravings resisted', unit: '', inc: 1, good: 'up' },
    { key: 'alcohol', label: 'Drinks', unit: '', inc: 1, goal: 0, good: 'down' },
    { key: 'weed', label: 'Weed', unit: 'sessions', inc: 1, goal: 0, good: 'down' },
    { key: 'coffee', label: 'Coffee', unit: 'cups', inc: 1, good: 'neutral' },
  ], checkout: [], food: { kcalTarget: 2400, proteinTarget: 150, mealXp: 10, mealXpMax: 40, proteinXp: 30 },
};
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = dayKey(new Date());
const events = new Map();
let mode = 'ok';
const shift = (day, n) => { const d = new Date(day+'T12:00:00'); d.setDate(d.getDate()+n); return dayKey(d); };
function add(day,kind,key,value,text) { const id = `fixture-${events.size}`; events.set(id,{id,day,kind,key,value,text,at:events.size}); }
for(let i=1;i<=35;i++) {
  if(i%6===0) continue;
  const day = shift(today,-i);
  for(const key of ['wake','teeth','shower','supplements','plan']) add(day,'check',key,1);
  if(i%3) for(const key of ['pushups','meditation','checkout']) add(day,'check',key,1);
  add(day,'set','wake_time',undefined,i%2?'07:15':'08:00');
  add(day,'set','bed_time',undefined,i%2?'23:30':'00:30');
  add(day,'set','pushup_reps',20+i);
  add(day,'add','water',1250+(i%4)*250);
}
function fold(day) {
  const state={ checks:{},sets:{},counters:{} };
  for(const e of [...events.values()].filter(e=>e.day===day).sort((a,b)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0))) {
    if(e.kind==='check') state.checks[e.key]=(e.value??1)!==0;
    else if(e.kind==='set') { const v=e.text??e.value; if(v===undefined||v==='') delete state.sets[e.key]; else state.sets[e.key]=v; }
    else state.counters[e.key]=Math.max(0,(state.counters[e.key]??0)+(e.value??0));
  }
  // The fixture proves client behavior, not Rust scoring parity.
  const items=Object.entries(state.checks).filter(([,v])=>v).map(([id])=>({id,label:id,xp:50}));
  if(state.counters.water) items.push({id:'water',label:'Water',xp:Math.min(40,Math.floor(state.counters.water/250)*5)});
  const meals=Object.keys(state.sets).filter(k=>k.startsWith('meal.')).length;
  if(meals) items.push({id:'food',label:'Meals',xp:Math.min(40,meals*10)});
  return {day,state,xp:{total:items.reduce((n,i)=>n+i.xp,0),items,target:1000}};
}
const server = createServer(async(req,res)=>{
  const url = new URL(req.url,`http://127.0.0.1:${port}`);
  const send=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/__fixture') {
    if(req.method==='POST') mode=url.searchParams.get('mode')||'ok';
    return send(200,{synthetic:true,mode,eventCount:events.size,pendingTestOnly:true});
  }
  if(url.pathname.startsWith('/api/life/')) {
    if(mode==='offline') return send(502,{offline:true});
    if(mode==='auth') return send(401,{});
    const sub=url.pathname.slice('/api/life'.length);
    if(sub==='/config') return send(200,CONFIG);
    if(sub.startsWith('/day/')) { if(mode==='slow') await new Promise(r=>setTimeout(r,1200)); return send(200,fold(sub.slice(5))); }
    if(sub==='/days') {
      if(mode==='range-fail') return send(502,{});
      const keys=[...new Set([...events.values()].map(e=>e.day))].filter(d=>d>=(url.searchParams.get('from')||'')&&d<=(url.searchParams.get('to')||''));
      return send(200,{days:keys.sort().map(fold),target:1000,streakMin:200});
    }
    if(sub==='/xp') {
      const n=Math.max(1,Math.min(366,Number(url.searchParams.get('days')||30)));
      const days=Array.from({length:n},(_,i)=>{const day=shift(today,i-n+1);return {day,xp:fold(day).xp.total};});
      const all=[...new Set([...events.values()].map(e=>e.day))].filter(d=>d<=today).map(fold),total=all.reduce((s,d)=>s+d.xp.total,0);
      return send(200,{total,level:Math.floor(total/1000)+1,intoLevel:total%1000,levelSize:1000,streak:3,streakMin:200,today:fold(today).xp.total,target:1000,best:Math.max(0,...all.map(d=>d.xp.total)),daysLogged:all.length,days});
    }
    if(sub==='/events'&&req.method==='POST') {
      let body='';for await(const c of req) body+=c;
      if(mode==='reject') return send(400,{error:'Synthetic rejected batch'});
      const q=JSON.parse(body).events;for(const e of q) events.set(e.id,e);
      if(mode==='lost-response') {req.socket.destroy();return;}
      return send(200,{accepted:q.length,duplicate:0});
    }
    return send(404,{});
  }
  const file=path.resolve(output,`.${url.pathname==='/'?'/preview/life.html':url.pathname}`);
  if(!file.startsWith(output+path.sep)) return send(403,{});
  try {const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream';res.writeHead(200,{'content-type':type});res.end(readFileSync(file));}catch{return send(404,{});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic Life preview: http://127.0.0.1:${port}/preview/life.html`));
