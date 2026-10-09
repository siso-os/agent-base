// Browser speed, native (t-0494): real hidden Tauri and WKWebView, production mountPage, local synthetic pages on a fresh
// synthetic profile. Times what Shaan feels: a cold tab (click → page on screen → loaded) and a warm switch between two
// awake tabs (click → the other page on screen), 12 switches, median and worst. Build first: cargo build --features
// browser-test (apps/desktop). Prints one JSON line; AB_SPEED_OUT names a file to keep it in.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

assert.equal(process.platform, 'darwin', 'native acceptance requires macOS');
const root = path.resolve(import.meta.dirname, '../../..');
const output = process.env.AB_NATIVE_RECEIPTS;
assert(output && path.isAbsolute(output), 'AB_NATIVE_RECEIPTS must name a caller-owned absolute directory');
await mkdir(output, { recursive: true });
const binary = path.join(root, 'apps/desktop/target/debug/agent-base');
await access(binary);
const profile = `synthetic-browser-speed-${randomUUID()}`;
const tab = 'popout-fixture';
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
let pending, child;
const receipt = { proof: 'real hidden Tauri and native WKWebView; synthetic local pages only', profile, checks: [], diagnostics: [], ok: false };
const style = '<style>body{margin:0;background:#171815;color:#eee;font:16px system-ui}header{height:60px;padding:20px}#slot{position:absolute;left:240px;top:60px;right:0;bottom:0}</style>';

const main = () => `<!doctype html><meta charset="utf-8">${style}<header>Browser speed · synthetic profile</header><div id="slot"></div>
<script type="module">
import * as wv from '/apps/web/src/lib/webview.ts';
const { mountPage } = wv; const prefetchPage = wv.prefetchPage;
const profile=${JSON.stringify(profile)};
const invoke=(command,args={})=>window.__TAURI_INTERNALS__.invoke(command,args);
const pages=async()=>JSON.parse(await invoke('browser_test_pages'));
const at=(list,name)=>list.find(p=>p.url.includes('/synthetic/'+name));
// Poll as fast as the bridge answers: the first moment the condition holds is the number.
const until=async(fn,what,ms=15000)=>{const end=performance.now()+ms;while(performance.now()<end){const v=await fn();if(v)return v;}throw Error(what+' timed out');};
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const r={};let current;
const mount=(name,tab)=>{current=mountPage(document.getElementById('slot'),location.origin+'/synthetic/'+name,()=>{},()=>{},profile,tab,undefined,()=>{});};
try{
 if(!window.__TAURI_INTERNALS__?.invoke)throw Error('real Tauri bridge missing');
 let t=performance.now();mount('a','speed-a');
 await until(async()=>at(await pages(),'a')?.shown,'a shown');r.coldVisibleMs=Math.round(performance.now()-t);
 await until(async()=>(await invoke('browser_url',{tab:'speed-a#'+profile}))!=='','a loaded');r.coldLoadedMs=Math.round(performance.now()-t);
 t=performance.now();current.dispose();mount('b','speed-b');
 await until(async()=>{const l=await pages();return at(l,'b')?.shown&&!at(l,'a')?.shown;},'b shown');r.coldSecondVisibleMs=Math.round(performance.now()-t);
 const warm=[];let on='b';
 for(let i=0;i<12;i++){
  const next=on==='a'?'b':'a';
  t=performance.now();current.dispose();mount(next,'speed-'+next);
  await until(async()=>{const l=await pages();return at(l,next)?.shown&&!at(l,on)?.shown;},'switch '+i);
  warm.push(performance.now()-t);on=next;
 }
 r.warmSwitchMedianMs=Math.round(median(warm));r.warmSwitchWorstMs=Math.round(Math.max(...warm));r.warmSwitchesMs=warm.map(Math.round);
 const p0=performance.now();for(let i=0;i<20;i++)await pages();r.probeCostMs=+((performance.now()-p0)/20).toFixed(1);
 // A page that takes 600 ms to answer, as a real site does: clicked cold, then clicked after resting on it for 300 ms.
 const loaded=async(name,tab)=>until(async()=>{const l=await pages();return at(l,name)?.shown&&(await invoke('browser_url',{tab:tab+'#'+profile}))!=='';},name+' loaded');
 t=performance.now();current.dispose();mount('slow-cold','speed-c');await loaded('slow-cold','speed-c');r.slowClickLoadedMs=Math.round(performance.now()-t);
 if(typeof prefetchPage==='function'){
  prefetchPage(location.origin+'/synthetic/slow-hover',profile);await new Promise(d=>setTimeout(d,300));
  t=performance.now();current.dispose();mount('slow-hover','speed-h');await loaded('slow-hover','speed-h');r.slowHoverThenClickLoadedMs=Math.round(performance.now()-t);
 }
 await fetch('/result',{method:'POST',body:JSON.stringify({ok:true,...r})});
}catch(error){await fetch('/result',{method:'POST',body:JSON.stringify({ok:false,...r,error:String(error)})});}
</script>`;

// The SISO Browser window's side, at /?window=browser&tab=…&url=…: mount the tab it was given, as BrowserWindow does.
const popped = () => `<!doctype html><meta charset="utf-8">${style}<header>SISO Browser window</header><div id="slot"></div>
<script type="module">
import { mountPage } from '/apps/web/src/lib/webview.ts';
const q=new URLSearchParams(location.search);
mountPage(document.getElementById('slot'),q.get('url'),()=>{},e=>fetch('/progress',{method:'POST',body:JSON.stringify({windowError:String(e)})}),${JSON.stringify(profile)},q.get('tab'),undefined,()=>{});
</script>`;

const server = await createServer({ configFile: false, root, cacheDir: path.join(output, 'vite-speed'),
  optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [{ name: 'browser-window-fixture', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/native-window') { res.setHeader('Content-Type', 'text/html'); res.end(main()); return; }
      if (url.pathname === '/' && url.searchParams.get('window') === 'browser') {
        receipt.diagnostics.push({ window: Object.fromEntries(url.searchParams) });
        res.setHeader('Content-Type', 'text/html'); res.end(popped()); return;
      }
      if (url.pathname.startsWith('/synthetic/')) {
        if (url.pathname.includes('/slow-')) await new Promise((done) => setTimeout(done, 600));
        const name = url.pathname.split('/').pop();
        if (name === 'set') res.setHeader('Set-Cookie', 'siso_s1_window=identity-w; Max-Age=3600; SameSite=Lax; Path=/');
        res.setHeader('Content-Type', 'text/html');
        const title = name === 'live' ? `<script>document.title='Live '+Math.random().toString(36).slice(2)</script>` : `<title>Synthetic ${name}</title>`;
        res.end(`${title}<style>body{padding:50px;background:#dcebd3;color:#17331e;font:28px system-ui}</style><h1>Native page rendered</h1><p>Local synthetic ${name} document</p>`); return;
      }
      if (['/result', '/progress', '/api/browser/diagnostic'].includes(url.pathname)) {
        let body = ''; req.on('data', c => { if (body.length < 12000) body += c; });
        req.on('end', () => { try {
          const value = JSON.parse(body);
          if (url.pathname === '/result') pending?.(value);
          else receipt.diagnostics.push({ path: url.pathname, ...value });
        } catch {} res.setHeader('Content-Type', 'application/json'); res.end('{}'); }); return;
      }
      if (url.pathname === '/api/registry' || url.pathname === '/api/browser/state') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
      next();
    });
  } }] });

const stop = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const owned = child;
  await new Promise(resolve => { const timer = setTimeout(resolve, 8000); owned.once('exit', () => { clearTimeout(timer); resolve(); }); owned.kill('SIGTERM'); });
  if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGKILL');
  child = undefined;
};
try {
  await server.listen(); const port = server.httpServer.address().port;
  let timer;
  const result = new Promise((resolve, reject) => { pending = resolve; timer = setTimeout(() => reject(Error('browser speed timed out')), 120000); });
  child = spawn(binary, [], { cwd: root, env: { ...process.env, AB_HIDDEN: '1', AB_PORT: String(port),
    AB_BROWSER_FIXTURE: 'native-window', AB_BROWSER_SHOT: path.join(output, 'browser-window.tiff') }, stdio: 'ignore' });
  const value = await result.finally(() => { clearTimeout(timer); pending = undefined; });
  receipt.checks.push(value);
  assert(value.ok, value.error);
  receipt.ok = true;
} catch (error) { receipt.error = String(error); process.exitCode = 1; }
finally {
  await stop(); await server.close();
  await writeFile(path.join(output, process.env.AB_SPEED_OUT || 'browser-speed.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ok: receipt.ok, checks: receipt.checks, error: receipt.error }));
}
