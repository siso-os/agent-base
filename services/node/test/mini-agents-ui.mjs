// t-0549: the Servers page's Mac mini page lists what runs there with CPU and RAM, and Collect work / Stop say what they did.
// Synthetic full app, sealed API; run with heavy. Never the live node.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const {createServer}=createRequire(path.join(root,'apps/web/package.json'))('vite');
let server,browser;const results=[];
try{
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),logLevel:'error',plugins:[{name:'sealed-api',configureServer(v){v.middlewares.use((req,res,next)=>{if(/^\/(api|chat|term)\b/.test(req.url??'')){res.statusCode=410;res.end('Fixture only');return;}next();});}}],server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:{ignored:['**/*']}}});
 await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await webkit.launch({headless:true});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(phone=>{localStorage.setItem('agent-base:space','"servers"');if(phone)localStorage.setItem('agent-base:sidebar-open','false');},width<600);
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.fallback():route.abort());
  const posts=[];
  await page.route(`${base}/api/**`,route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(p==='/api/servers/mini/agents')return route.fulfill({json:{agents:[{name:'AGENT-BASE',activity:'working',model:'claude-opus-5-5',cwd:'/Users/x/agent-base',context:null,cpu:12.5,rssMb:1536,startedAt:1}]}});
   if(req.method()==='POST'&&p.endsWith('/collect')){posts.push(p);return route.fulfill({status:202,json:{sent:true,phase:'saved'}});}
   if(req.method()==='POST'&&p.endsWith('/stop')){posts.push(p);return route.fulfill({status:500,json:{error:'Failed to stop agent'}});}
   let body=fixtureResponse(p,'fixture');
   if(p==='/api/servers')body={...body,servers:body.servers.map(s=>({...s,key:'mini',name:'mac-mini',here:false}))};
   return body===undefined?route.fulfill({status:404,body:'{}'}):route.fulfill({json:body});
  });
  await page.goto(base);
  const door=page.getByRole('button',{name:'Open mac-mini'}).first();await door.waitFor({state:'attached',timeout:20000});await door.dispatchEvent('click');
  const row=page.getByTestId('mini-agent-row');await row.waitFor({timeout:15000});
  const text=await row.textContent();
  assert.match(text,/AGENT-BASE/);assert.match(text,/12\.5% CPU/);assert.match(text,/1\.5 GB/);
  await row.getByRole('button',{name:'Collect work'}).click({timeout:5000});
  await page.getByTestId('mini-agent-notice').filter({hasText:'Asked to commit, push and report'}).waitFor();
  await row.getByRole('button',{name:'Stop',exact:true}).first().click();
  await row.getByText('Stop AGENT-BASE?').waitFor();
  await row.getByRole('button',{name:'Stop',exact:true}).last().click();
  await page.getByTestId('mini-agent-notice').filter({hasText:'Failed to stop agent'}).waitFor();
  assert.deepEqual(posts,['/api/servers/mini/agents/AGENT-BASE/collect','/api/servers/mini/agents/AGENT-BASE/stop']);
  await page.getByTestId('mini-agent-row').screenshot({path:path.join(root,`ui-hub/servers/mini-agents-${width}.png`)});
  assert.deepEqual(errors,[]);results.push({width,row:'cpu+ram',collect:'said',stopFailure:'said'});await page.close();
 }
 console.log(JSON.stringify({results}));
}finally{await browser?.close();await server?.close();}
