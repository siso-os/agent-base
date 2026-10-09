// Rendered WebKit regression for mountPage. The IPC adapter below is a fixture,
// NOT Tauri/native proof. Run with a caller-owned AB_BROWSER_TEST_TMP directory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = process.env.AB_BROWSER_TEST_TMP;
assert(scratch?.includes('.siso-ephemeral-browser-'), 'supply a disposable directory with an exit cleanup trap');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const { webkit } = createRequire(path.join(root, 'services/node/package.json'))('playwright');
const profile = 'synthetic-visibility-a';
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#171815;color:#eee;font:16px system-ui}header{height:60px;padding:12px;box-sizing:border-box}
#slot{position:absolute;left:240px;top:60px;right:0;bottom:0}iframe{border:0;background:white}
[role=menu]{position:absolute;z-index:2;background:#34382d;padding:24px;top:80px;left:260px}
[hidden]{display:none!important}.css-hidden{display:none}
</style><header>Browser visibility regression · synthetic profile</header><div id="slot"></div>
<!-- Same persistent hidden-menu contract as MicButton's Voice options. -->
<dialog id="spotlight">Spotlight fixture</dialog>
<div id="voice" role="menu" aria-label="Voice options" hidden>Read replies aloud</div>
<div hidden><div role="dialog">Hidden ancestor</div></div>
<div class="css-hidden" role="menu">CSS-hidden menu</div>
<div role="dialog" style="visibility:hidden">Invisible dialog</div>
<script type="module">
import { mountPage, closePage } from '/apps/web/src/lib/webview.ts';
window.calls=[];window.errors=[];
const pages=new Map();
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
 window.calls.push({command,...args});
 let frame=pages.get(args.tab);
 if(command==='browser_open'){
  frame=document.createElement('iframe');frame.title='Synthetic rendered page';
  frame.dataset.profile=args.profile;frame.style.position='fixed';
  frame.dataset.loading='1';frame.addEventListener('load',()=>{frame.dataset.loading='0';});
  frame.src=args.rawUrl;pages.set(args.tab,frame);document.body.append(frame);
 }
 if(command==='browser_open'||command==='browser_bounds')Object.assign(frame.style,{left:args.x+'px',top:args.y+'px',width:args.width+'px',height:args.height+'px'});
 if(command==='browser_visible')frame.hidden=!args.visible;
 if(command==='browser_navigate'){frame.dataset.loading='1';frame.src=args.rawUrl;}
 if(command==='browser_close'){frame?.remove();pages.delete(args.tab);}
 if(command==='browser_url')return frame?.dataset.loading==='0'?frame.contentWindow.location.href:'';
 if(command==='browser_audio')return false;
}};
window.openFixture=()=>{window.controller=mountPage(document.getElementById('slot'),location.origin+'/synthetic/read',()=>{},e=>window.errors.push(e),'${profile}','fixture-tab');};
window.closeFixture=async()=>{window.controller.dispose();await closePage('fixture-tab');};
window.openFixture();
</script>`;

let context;
const server = await createServer({ configFile:false, root, cacheDir:path.join(scratch,'vite'), optimizeDeps:{noDiscovery:true}, server:{host:'127.0.0.1',port:0,watch:null}, plugins:[{
 name:'synthetic-browser-fixture', configureServer(vite){vite.middlewares.use((req,res,next)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(req.url?.startsWith('/synthetic/')){
   res.setHeader('Content-Type','text/html');
   if(req.url==='/synthetic/set')res.setHeader('Set-Cookie','siso_visibility=identity-a; Max-Age=3600; SameSite=Lax; Path=/');
   const identity=/siso_visibility=identity-a/.test(req.headers.cookie??'')?'identity-a':'empty';
   res.end('<style>body{font:28px system-ui;background:#e8f0dd;color:#172511;padding:48px}</style><h1>Rendered '+req.url+'</h1><p id="identity">'+identity+'</p>');return;
  }
  if(req.url==='/api/browser/diagnostic'){res.end('{}');return;}
  next();
 });}
}] });
const receipt={proof:'headless WebKit + iframe IPC fixture; NOT native Tauri',checks:[],screens:[]};
try {
 await server.listen();
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const launch=async(name)=>{
  const c=await webkit.launchPersistentContext(path.join(scratch,name),{headless:true,viewport:{width:1440,height:900}});
  await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await c.newPage();page.setDefaultTimeout(4000);
  await page.goto(base);await page.waitForFunction(()=>window.controller);
  return {c,page};
 };
 let run=await launch(profile);context=run.c;let page=run.page;
 const rendered=async(label)=>{
  await page.locator('iframe').waitFor({state:'visible'});
  await page.frameLocator('iframe').getByRole('heading',{name:'Rendered /synthetic/'+label,exact:true}).waitFor();
 };
 await rendered('read');receipt.checks.push('hidden attribute, hidden ancestor, display:none and visibility:hidden do not hide a page');
 await page.evaluate(()=>{document.getElementById('voice').hidden=false;});
 await page.locator('iframe').waitFor({state:'hidden'});
 await page.evaluate(()=>{document.getElementById('voice').hidden=true;});
 await rendered('read');receipt.checks.push('visible menu hides page; dismissal restores it');
 await page.evaluate(()=>document.getElementById('spotlight').showModal());
 await page.waitForFunction(()=>document.querySelector('iframe').hidden);
 await page.evaluate(()=>document.getElementById('spotlight').close());
 await rendered('read');receipt.checks.push('native dialog open hides page; close restores same page without reload');
 await page.evaluate(()=>window.controller.navigate(location.origin+'/synthetic/set'));
 await rendered('set');assert.equal(await page.frameLocator('iframe').locator('#identity').textContent(),'empty');
 await page.evaluate(()=>window.controller.navigate(location.origin+'/synthetic/read'));
 await rendered('read');assert.equal(await page.frameLocator('iframe').locator('#identity').textContent(),'identity-a');
 await page.evaluate(()=>window.closeFixture());await page.evaluate(()=>window.openFixture());
 await rendered('read');assert.equal(await page.frameLocator('iframe').locator('#identity').textContent(),'identity-a');
 receipt.checks.push('navigate renders a different document; explicit close/reopen retains synthetic cookie');
 for(const width of [1440,1024]){
  await page.setViewportSize({width,height:900});
  await page.waitForFunction(w=>Math.round(document.querySelector('iframe').getBoundingClientRect().width)===w-240,width);
  const file=`loading-20261006-${width}.png`;
  await page.screenshot({path:path.join(scratch,file)});receipt.screens.push(file);
 }
 assert.deepEqual(await page.evaluate(()=>window.errors),[]);
 assert((await page.evaluate(()=>window.calls.filter(c=>c.command==='browser_open'))).every(c=>c.profile===profile));
 await context.close();context=null;
 run=await launch(profile);context=run.c;page=run.page;
 await rendered('read');assert.equal(await page.frameLocator('iframe').locator('#identity').textContent(),'identity-a');
 receipt.checks.push('persistent WebKit context reopened from disk retains synthetic identity');
 await context.close();context=null;
 run=await launch('synthetic-visibility-b');context=run.c;page=run.page;
 await rendered('read');assert.equal(await page.frameLocator('iframe').locator('#identity').textContent(),'empty');
 receipt.checks.push('separate synthetic WebKit context has no first-profile cookie');
 receipt.ok=true;
} catch(error){receipt.ok=false;receipt.error=error.message;throw error;}
finally{
 await context?.close();await server.close();
 await writeFile(path.join(scratch,'visibility-regression.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}
