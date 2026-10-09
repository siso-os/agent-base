// t-0549: a chat running on the Mac mini says so in its header (Shaan via Agent Zero, 8 Oct: "make your chat header and fleet
// row say 'Mac mini' so one click tells him"). Synthetic full app, sealed API, run with heavy; never the live node.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const {createServer}=createRequire(path.join(root,'apps/web/package.json'))('vite');
const shots=process.argv.includes('--shots');
let server,browser;const results=[];
try{
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),logLevel:'error',plugins:[{name:'sealed-api',configureServer(v){v.middlewares.use((req,res,next)=>{if(/^\/(api|chat|term)\b/.test(req.url??'')){res.statusCode=410;res.end('Fixture only');return;}next();});}}],server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:{ignored:['**/*']}}});
 await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await webkit.launch({headless:true});
 for(const [label,mini] of [['mini',true],['laptop',false]]){
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.fallback():route.abort());
  await page.route(`${base}/api/**`,route=>{
   const p=new URL(route.request().url()).pathname;let body=fixtureResponse(p,'fixture');
   if(p==='/api/agents'&&mini)body={...body,agents:body.agents.map(a=>({...a,away:true,machineKey:'mini',machine:'Mac mini'}))};
   return body===undefined?route.fulfill({status:404,body:'{}'}):route.fulfill({json:body});
  });
  await page.goto(base);
  const row=page.getByTestId('rail-row').first();await row.waitFor({timeout:20000});
  if(!await page.getByTestId('chat-head').count())await row.click();
  await page.getByTestId('chat-head').first().waitFor({timeout:15000});
  const chip=page.getByTestId('chat-head-machine');
  if(mini){await chip.first().waitFor({timeout:5000});assert.match(await chip.first().textContent(),/Mac mini/);}
  else assert.equal(await chip.count(),0);
  if(shots)await page.getByTestId('chat-head').first().screenshot({path:path.join(root,`ui-hub/chat-header/machine-chip-${label}-1440.png`)});
  assert.deepEqual(errors,[]);results.push({label,chip:mini?'Mac mini':'none'});await page.close();
 }
 console.log(JSON.stringify({results}));
}finally{await browser?.close();await server?.close();}
