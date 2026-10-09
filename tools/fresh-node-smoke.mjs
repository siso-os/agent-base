// Fresh-node smoke (see .agents/ASTRA.md): node tools/fresh-node-smoke.mjs <repo> <port>; times /api/timeline, page load, /api/agents.
import {createRequire} from 'node:module';
const require=createRequire(process.argv[2]+'/services/node/package.json');const {webkit}=require('playwright');
const port=process.argv[3];
for(let i=0;i<120;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,250));}
const t0=Date.now(); const tl=fetch(`http://127.0.0.1:${port}/api/timeline`).then(r=>console.log('timeline',r.status,Date.now()-t0,'ms'));
const b=await webkit.launch();const page=await b.newPage();
const t=Date.now();await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded',timeout:6000}).then(()=>console.log('page ok',Date.now()-t,'ms')).catch(e=>console.log('PAGE FAIL',e.message.split('\n')[0]));
for(let i=0;i<5;i++){const s=Date.now();await fetch(`http://127.0.0.1:${port}/api/agents`);console.log('agents',Date.now()-s,'ms');}
await tl; await b.close();
