// Optional macOS acceptance: real hidden Tauri/WKWebView, production mountPage,
// local synthetic pages and fresh synthetic profiles. Never opens an owned account.
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
const profile = `synthetic-native-visibility-${randomUUID()}`;
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
let pending, child;
const receipt = { proof: 'real hidden Tauri and native WKWebView; synthetic local pages only', profile, checks: [], diagnostics: [], ok: false };
const html = (phase) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#171815;color:#eee;font:16px system-ui}header{height:60px;padding:20px}
#slot{position:absolute;left:240px;top:60px;right:0;bottom:0}
[role=menu]{position:absolute;top:80px;left:260px;background:#444;padding:20px}
[hidden]{display:none!important}.css-hidden{display:none}
</style><header>Native Browser acceptance · synthetic profile</header><div id="slot"></div>
<div id="voice" role="menu" aria-label="Voice options" hidden>Read replies aloud</div>
<div hidden><div role="dialog">Hidden ancestor</div></div><div class="css-hidden" role="menu">CSS-hidden menu</div>
<div role="dialog" style="visibility:hidden">Invisible dialog</div>
<script type="module">
import { mountPage, closePage } from '/apps/web/src/lib/webview.ts';
const phase=${JSON.stringify(phase)},profile=${JSON.stringify(profile)}+(phase==='separate'?'-other':'');
const checks=[],errors=[];let controller;
const invoke=(command,args={})=>window.__TAURI_INTERNALS__.invoke(command,args);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,description)=>{const end=Date.now()+12000;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=String(e);}await wait(180);}throw Error(description+': '+JSON.stringify(last));};
const observe=async(snapshot=false)=>{let value=await invoke('browser_test_observe',{snapshot,mainSnapshot:false});for(let n=0;n<3&&typeof value==='string';n++)value=JSON.parse(value);return value;};
const rendered=async(name)=>until(async()=>{const value=await observe();return value?.title==='Synthetic '+name?value:false;},'native page '+name);
const shown=async(value)=>until(async()=>{const s=await invoke('browser_test_status');return s[0]===value&&s[3]>100&&s[4]>100?s:false;},'native visibility '+value);
const open=()=>{controller=mountPage(document.getElementById('slot'),location.origin+'/synthetic/read',()=>{},e=>errors.push(e),profile,'native-fixture',undefined,()=>{});};
try{
 if(!window.__TAURI_INTERNALS__?.invoke)throw Error('real Tauri bridge missing');
 open();let page=await rendered('read');await shown(1);
 checks.push('hidden menus and dialogs leave native child visible');
 if(phase==='seed'){
  if(page.cookie)throw Error('fresh synthetic profile unexpectedly has a cookie');
  document.getElementById('voice').hidden=false;await shown(0);
  document.getElementById('voice').hidden=true;await shown(1);
  checks.push('visible menu hides native child and dismissal restores it');
  controller.navigate(location.origin+'/synthetic/set');await rendered('set');
  controller.navigate(location.origin+'/synthetic/read');page=await rendered('read');
  if(!page.cookie?.includes('siso_s1_visibility=identity-a'))throw Error('synthetic cookie missing after navigation');
  checks.push('native navigation renders a new page and preserves synthetic identity');
  controller.dispose();await closePage('native-fixture');open();page=await rendered('read');await shown(1);
  if(!page.cookie?.includes('siso_s1_visibility=identity-a'))throw Error('synthetic cookie missing after close/reopen');
  checks.push('native explicit close and reopen preserves synthetic identity');
  await observe(true);await wait(700);
 }else if(phase==='restart'){
  if(!page.cookie?.includes('siso_s1_visibility=identity-a'))throw Error('synthetic cookie missing after process restart');
  checks.push('native process restart preserves synthetic identity');
 }else{
  if(page.cookie)throw Error('separate profile shares first profile cookie');
  checks.push('separate native profile has no first-profile cookie');
 }
 if(errors.length)throw Error(errors.join('; '));
 await fetch('/result',{method:'POST',body:JSON.stringify({phase,ok:true,checks,status:await invoke('browser_test_status')})});
}catch(error){await fetch('/result',{method:'POST',body:JSON.stringify({phase,ok:false,checks,error:String(error)})});}
</script>`;

const server = await createServer({ configFile: false, root, cacheDir: path.join(output, 'vite-native'),
  optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [{ name: 'native-visibility-fixture', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/native') { res.setHeader('Content-Type', 'text/html'); res.end(html(url.searchParams.get('phase'))); return; }
      if (url.pathname.startsWith('/synthetic/')) {
        const name = url.pathname.split('/').pop();
        if (name === 'set') res.setHeader('Set-Cookie', 'siso_s1_visibility=identity-a; Max-Age=3600; SameSite=Lax; Path=/');
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>Synthetic ${name}</title><style>body{padding:50px;background:#dcebd3;color:#17331e;font:28px system-ui}</style><h1>Native page rendered</h1><p>Local synthetic ${name} document</p><p>Browser visibility acceptance</p>`); return;
      }
      if (['/result', '/progress', '/api/browser/diagnostic'].includes(url.pathname)) {
        let body = ''; req.on('data', c => { if (body.length < 12000) body += c; });
        req.on('end', () => { try {
          const value = JSON.parse(body);
          if (url.pathname === '/result') pending?.(value);
          else receipt.diagnostics.push({ path: url.pathname, ...value });
        } catch {} res.setHeader('Content-Type', 'application/json'); res.end('{}'); }); return;
      }
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
  for (const phase of ['seed', 'restart', 'separate']) {
    let timer;
    const result = new Promise((resolve, reject) => { pending = resolve; timer = setTimeout(() => reject(Error(`native ${phase} timed out`)), 85000); });
    child = spawn(binary, [], { cwd: root, env: { ...process.env, AB_HIDDEN: '1', AB_PORT: String(port),
      AB_BROWSER_FIXTURE: `native?phase=${phase}`, AB_BROWSER_SHOT: path.join(output, 'native-visibility.tiff') }, stdio: 'ignore' });
    const resultValue = await result.finally(() => { clearTimeout(timer); pending = undefined; });
    receipt.checks.push(resultValue); await stop();
    assert(resultValue.ok, resultValue.error);
  }
  receipt.ok = true;
} catch (error) { receipt.error = String(error); process.exitCode = 1; }
finally {
  await stop(); await server.close();
  await writeFile(path.join(output, 'native-visibility.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ok: receipt.ok, checks: receipt.checks, error: receipt.error }));
}
