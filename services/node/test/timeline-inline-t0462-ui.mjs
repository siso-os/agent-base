// Sealed Activity fixture; never starts a node or connects to agents.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import { webkit, suitePort } from './suite-runtime.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, '.astra/t0462'); mkdirSync(shots, { recursive: true });
const before = process.env.BEFORE === '1';
const history = new Map(before ? ['Timeline.tsx','Timeline.css'].map(file => [file, execFileSync('git', ['show', `93db8881:apps/web/src/components/${file}`], { cwd: root, encoding: 'utf8' })]) : []);
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {TimelinePage} from '/src/components/Timeline.tsx';
import '/src/index.css'; import '/src/components/AgentPanel.css';
const agent={id:'fixture',name:'Fixture',zero:false};
createRoot(document.getElementById('root')).render(<main style={{maxWidth:700,margin:'0 auto',padding:16}}><h1>Activity</h1><TimelinePage a={agent} onPage={p=>window.openedPage=p} onIntent={()=>{}} onSubagent={()=>{}}/></main>);`;
let server, browser; const results = [];
try {
 server = await createServer({root:path.join(root,'apps/web'),logLevel:'error',
  plugins:[{name:'sealed-timeline',enforce:'pre',load(id){for(const [file, code] of history) if(id.endsWith(`/src/components/${file}`)) return code;},configureServer(v){v.middlewares.use((req,res,next)=>{
    if(req.url==='/timeline-fixture'){res.setHeader('content-type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.astra-timeline-fixture.tsx"></script></body></html>');}

    else if(/^\/(api|chat|term)\b/.test(req.url??'')){res.statusCode=410;res.end('sealed');} else next();});}}],
  server:{host:'127.0.0.1',port:await suitePort(),strictPort:true,hmr:false,watch:{ignored:['**/*']}}});
 // Serve an actual TSX entry in the disposable fixture directory so Vite performs normal React transforms.
 const entry = path.join(root,'apps/web/.astra-timeline-fixture.tsx'); writeFileSync(entry, fixture);
 await server.listen(); const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await webkit.launch({headless:true});
 for(const width of [1440,390]) {
  const height=width===390?844:900; const errors=[];
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',s=>s.close());
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.fallback():r.abort());
  let day;
  await page.route(`${origin}/api/**`,r=>{
   const u=new URL(r.request().url());
   if(u.pathname==='/api/pipeline')return r.fulfill({json:{pending:[]}});
   if(u.pathname==='/api/timeline') {
    const asked=u.searchParams.get('day'); day??=asked;
    const base={k:'task',who:'FIXTURE',state:'tested',text:'Recorded fixture instructions',outcome:'The list stays readable.',revision:'fixture-revision'};
    return r.fulfill({json:{day:asked,unavailable:[],moments:asked===day?[
     {...base,id:'one',t:`${day}T12:10:00`,title:'First useful outcome',short:'First useful outcome',gallery:'/fixture-gallery'},
     {...base,id:'two',t:`${day}T12:00:00`,title:'Second useful outcome',short:'Second useful outcome'}]:[]}});
   }
   return r.fulfill({status:404,json:{}});
  });
  await page.goto(`${origin}/timeline-fixture`);
  const row=page.locator('[data-moment-id="one"]');await row.waitFor();
  await row.click();await page.getByTestId('timeline-detail').waitFor();
  if(!before){
   assert.equal(await row.getAttribute('aria-expanded'),'true');
   assert.equal(await page.locator('[data-moment-id="two"]').count(),1,'neighbour remains mounted');
   assert.equal(await page.getByRole('group',{name:'Show',exact:true}).count(),1,'filters remain present');
   await page.getByRole('button',{name:'Open gallery'}).click();
   assert.equal(await page.evaluate(()=>window.openedPage.url),`${origin}/fixture-gallery`);
   await page.getByText('Recorded details · instructions, files and commits').click();
   assert.match(await page.getByTestId('timeline-detail').innerText(),/fixture-revision/);
  }
  await page.screenshot({path:path.join(shots,`${before?'before':'after'}-${width}.png`)});
  const checker = path.join(homedir(), 'SISO_Workspace/Great_Library_of_SISO/banks/siso-ui-hub/bin/pagecheck.js');
  if (existsSync(checker)) {
   const report = JSON.parse(await page.evaluate(readFileSync(checker, 'utf8')));
   writeFileSync(path.join(shots, `${before?'before':'after'}-pagecheck-${width}.json`), JSON.stringify(report, null, 2));
   if(!before) for(const [rule, result] of Object.entries(report)) if(result && typeof result === 'object' && 'n' in result) assert.equal(result.n,0,`uihub dashboard rule: ${rule}`);
  }
  if(!before){
   await page.getByRole('button',{name:'Close details'}).click();
   assert.equal(await row.getAttribute('aria-expanded'),'false');
   await page.waitForFunction(()=>document.activeElement?.getAttribute('data-moment-id')==='one');
   await page.keyboard.press('Enter');assert.equal(await row.getAttribute('aria-expanded'),'true');
   await page.getByRole('button',{name:'Close details'}).click();
   await page.getByRole('button',{name:'Pages',exact:true}).click();
   assert.equal(await page.getByTestId('timeline-moment').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  }
  assert.deepEqual(errors,[]);results.push({width,height});await page.close();
 }
 console.log('PASS timeline inline',JSON.stringify({before,results}));
} finally {await browser?.close();await server?.close(); const {unlinkSync}=await import('node:fs');try{unlinkSync(path.join(root,'apps/web/.astra-timeline-fixture.tsx'));}catch{}}
