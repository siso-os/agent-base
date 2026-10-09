// Optional macOS acceptance for t-0439, the SISO Browser window: real hidden Tauri and WKWebView, production mountPage,
// a local synthetic page on a fresh synthetic profile. A page pops out into the window and back as the SAME live document
// (a random title set by the page's script survives; a reload would roll a new one), keeps its cookie, and the window it
// left cannot hide it. Build first: cargo build --features browser-test (apps/desktop). Never opens an owned account.
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
const profile = `synthetic-browser-window-${randomUUID()}`;
const tab = 'popout-fixture';
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
let pending, child;
const receipt = { proof: 'real hidden Tauri and native WKWebView; synthetic local pages only', profile, checks: [], diagnostics: [], ok: false };
const style = '<style>body{margin:0;background:#171815;color:#eee;font:16px system-ui}header{height:60px;padding:20px}#slot{position:absolute;left:240px;top:60px;right:0;bottom:0}</style>';

// Agent Base's side: open the page, pop it out, try to hide it from here, close the window, show it here again.
const main = () => `<!doctype html><meta charset="utf-8">${style}<header>Agent Base · pop-out acceptance</header><div id="slot"></div>
<script type="module">
import { mountPage, onPageMoved, browserWindow } from '/apps/web/src/lib/webview.ts';
const profile=${JSON.stringify(profile)},tab=${JSON.stringify(tab)},key=tab+'#'+profile;
const checks=[],errors=[],moves=[];
const invoke=(command,args={})=>window.__TAURI_INTERNALS__.invoke(command,args);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,description)=>{const end=Date.now()+15000;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=String(e);}await wait(180);}throw Error(description+': '+JSON.stringify(last));};
const observe=async()=>{let v=await invoke('browser_test_observe',{snapshot:false,mainSnapshot:false});for(let n=0;n<3&&typeof v==='string';n++)v=JSON.parse(v);return v;};
const status=()=>invoke('browser_test_status');
const state=async(shown,popped,description)=>until(async()=>{const s=await status();return s[0]===shown&&s[6]===popped?s:false;},description);
let controller;
const open=(url)=>{controller=mountPage(document.getElementById('slot'),url,()=>{},e=>errors.push(e),profile,tab,undefined,()=>{});};
try{
 if(!window.__TAURI_INTERNALS__?.invoke)throw Error('real Tauri bridge missing');
 onPageMoved((k,to)=>{if(k===key)moves.push(to);});
 open(location.origin+'/synthetic/set');
 await until(async()=>(await observe())?.title==='Synthetic set','page set');
 controller.navigate(location.origin+'/synthetic/live');
 const live=await until(async()=>{const v=await observe();return v?.title?.startsWith('Live ')?v:false;},'live page');
 if(!live.cookie?.includes('siso_s1_window=identity-w'))throw Error('cookie missing before pop-out');
 await state(1,0,'shown in Agent Base');
 checks.push('page renders in Agent Base');
 await browserWindow(true,{tab,url:location.origin+'/synthetic/live',title:'Fixture'});
 const out=await state(1,1,'shown in the SISO Browser window');
 const there=await observe();
 if(there.title!==live.title)throw Error('not the same live document after pop-out: '+there.title+' vs '+live.title);
 if(!there.cookie?.includes('siso_s1_window=identity-w'))throw Error('cookie missing after pop-out');
 await until(()=>moves.includes('browser'),'Agent Base hears the page moved');
 checks.push('pop-out moves the same live document (title '+live.title+'), cookie kept, Agent Base told; bounds '+out.slice(1,5).join(','));
 await invoke('browser_visible',{tab:key,visible:false});await wait(400);
 const still=await status();if(still[0]!==1||still[6]!==1)throw Error('Agent Base hid a page it no longer holds: '+still);
 controller.dispose();await wait(400);
 const after=await status();if(after[0]!==1||after[6]!==1)throw Error('leaving the tab in Agent Base hid the popped-out page: '+after);
 checks.push('the window a page left cannot hide it (browser_visible and tab teardown are no-ops)');
 await browserWindow(false);
 await state(0,0,'back in Agent Base, hidden, after the window closed');
 await until(()=>moves.includes('main'),'Agent Base hears the page came back');
 open(location.origin+'/synthetic/live');
 await state(1,0,'shown again in Agent Base');
 const back=await observe();
 if(back.title!==live.title)throw Error('not the same live document after coming back: '+back.title);
 checks.push('closing the window brings the same live document back to Agent Base');
 if(moves.join()!=='browser,main')throw Error('each move heard once, in order; heard '+moves.join());
 checks.push('Agent Base hears each move exactly once');
 if(errors.length)throw Error(errors.join('; '));
 await fetch('/result',{method:'POST',body:JSON.stringify({ok:true,checks,moves})});
}catch(error){await fetch('/result',{method:'POST',body:JSON.stringify({ok:false,checks,moves,errors,error:String(error)})});}
</script>`;

// The SISO Browser window's side, at /?window=browser&tab=…&url=…: mount the tab it was given, as BrowserWindow does.
const popped = () => `<!doctype html><meta charset="utf-8">${style}<header>SISO Browser window</header><div id="slot"></div>
<script type="module">
import { mountPage } from '/apps/web/src/lib/webview.ts';
const q=new URLSearchParams(location.search);
mountPage(document.getElementById('slot'),q.get('url'),()=>{},e=>fetch('/progress',{method:'POST',body:JSON.stringify({windowError:String(e)})}),${JSON.stringify(profile)},q.get('tab'),undefined,()=>{});
</script>`;

const server = await createServer({ configFile: false, root, cacheDir: path.join(output, 'vite-window'),
  optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [{ name: 'browser-window-fixture', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/native-window') { res.setHeader('Content-Type', 'text/html'); res.end(main()); return; }
      if (url.pathname === '/' && url.searchParams.get('window') === 'browser') {
        receipt.diagnostics.push({ window: Object.fromEntries(url.searchParams) });
        res.setHeader('Content-Type', 'text/html'); res.end(popped()); return;
      }
      if (url.pathname.startsWith('/synthetic/')) {
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
  const result = new Promise((resolve, reject) => { pending = resolve; timer = setTimeout(() => reject(Error('browser window acceptance timed out')), 120000); });
  child = spawn(binary, [], { cwd: root, env: { ...process.env, AB_HIDDEN: '1', AB_PORT: String(port),
    AB_BROWSER_FIXTURE: 'native-window', AB_BROWSER_SHOT: path.join(output, 'browser-window.tiff') }, stdio: 'ignore' });
  const value = await result.finally(() => { clearTimeout(timer); pending = undefined; });
  receipt.checks.push(value);
  assert(value.ok, value.error);
  receipt.ok = true;
} catch (error) { receipt.error = String(error); process.exitCode = 1; }
finally {
  await stop(); await server.close();
  await writeFile(path.join(output, 'browser-window.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ok: receipt.ok, checks: receipt.checks, error: receipt.error }));
}
