#!/usr/bin/env python3
"""Hidden native probe for password sites (9 Oct: the siso-ui-hub worker showed a blank page). A fixture server asks for
HTTP Basic; the page must ask the shell (browser-auth), a wrong password must ask again marked retry, the right one must
load the page, a cancel must answer WebKit without a crash, and the password must never reach the app's log.
Own account store, no agents, no installed app; credentials are kept for this run only. Needs the debug build:
  cargo build --features browser-test   then   heavy -- python3 test/browser-site-auth.py"""
import base64, http.server, json, os, pathlib, subprocess, threading, time, uuid
ROOT = pathlib.Path(__file__).resolve().parents[1]
USER, PASSWORD = 'fixture', 'pw-' + uuid.uuid4().hex[:12]
result = None
SCRIPT = r"""
(async () => {
 const ipc = window.__TAURI_INTERNALS__, invoke = (c,a={}) => ipc.invoke(c,a);
 const sleep = ms => new Promise(r => setTimeout(r,ms));
 const asks = [];
 await invoke('plugin:event|listen', { event: 'browser-auth', target: { kind: 'AnyLabel', label: 'main' }, handler: ipc.transformCallback(e => asks.push(e.payload)) });
 const until = async (test, ms) => { const end = Date.now()+ms; while (Date.now()<end) { const v = await test(); if (v) return v; await sleep(200); } return null; };
 const result = { steps: {} };
 try {
  await invoke('browser_open',{tab:'auth-0',profile:PROFILE,rawUrl:location.origin+'/secret',x:100,y:80,width:1000,height:650});
  const first = await until(() => asks[0], 15000);
  result.steps.asked = first ? { host: first.host, realm: first.realm, retry: first.retry, tab: first.tab } : null;
  result.steps.pending = (await invoke('browser_auth_pending',{tab:'auth-0'})).length;
  if (first) await invoke('browser_auth',{id:first.id,user:USER,password:'wrong'});
  const second = await until(() => asks[1], 15000);
  result.steps.retried = second ? second.retry : null;
  if (second) await invoke('browser_auth',{id:second.id,user:USER,password:PASSWORD});
  result.steps.loaded = await until(async () => (await invoke('browser_title',{tab:'auth-0'})) === 'Behind the password', 15000) === true;
  await invoke('browser_close',{tab:'auth-0'});
  // Cancel: WebKit gets its answer and the page stays (no crash, no hang).
  await invoke('browser_open',{tab:'auth-1',profile:PROFILE,rawUrl:location.origin+'/secret2',x:100,y:80,width:1000,height:650});
  const third = await until(() => asks.find(a => a.tab === 'auth-1'), 15000);
  if (third) await invoke('browser_auth',{id:third.id,user:null,password:null});
  await sleep(1000);
  result.steps.cancelled = Boolean(third) && (await invoke('browser_auth_pending',{tab:'auth-1'})).length === 0;
  // Closing a page that is still asking answers it first.
  await invoke('browser_open',{tab:'auth-2',profile:PROFILE,rawUrl:location.origin+'/secret3',x:100,y:80,width:1000,height:650});
  result.steps.closedWhileAsking = Boolean(await until(() => asks.find(a => a.tab === 'auth-2'), 15000));
  await invoke('browser_close',{tab:'auth-2'});
  await invoke('browser_close',{tab:'auth-1'});
  await sleep(1500);
  result.steps.alive = (await invoke('browser_auth_pending',{tab:'auth-2'})).length === 0;
  const s = result.steps;
  result.ok = Boolean(s.asked && s.asked.host === '127.0.0.1' && s.asked.realm === 'Fixture realm' && !s.asked.retry && s.pending === 1 && s.retried === true && s.loaded && s.cancelled && s.closedWhileAsking && s.alive);
 } catch (e) { result.ok = false; result.error = String(e).slice(0, 200); }
 await fetch('/result',{method:'POST',body:JSON.stringify(result)});
})();
"""
GOOD = 'Basic ' + base64.b64encode(f'{USER}:{PASSWORD}'.encode()).decode()
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  if self.path.startswith('/secret'):
   if self.headers.get('Authorization') != GOOD or self.path != '/secret':
    realm = 'Fixture realm' + self.path[len('/secret'):]  # /secret2 and /secret3 are other realms: a saved password is not theirs
    self.send_response(401); self.send_header('WWW-Authenticate',f'Basic realm="{realm}"'); self.send_header('Content-Length','0'); self.end_headers(); return
   body = b'<title>Behind the password</title><p>in</p>'
  else:
   body = ('<title>Site auth fixture</title><p>shell</p>' + ('<script>'+SCRIPT.replace('PROFILE',json.dumps(profile)).replace('USER',json.dumps(USER)).replace('PASSWORD',json.dumps(PASSWORD))+'</script>' if self.path=='/fixture' else '')).encode()
  self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Content-Length',str(len(body))); self.end_headers()
  try: self.wfile.write(body)
  except (BrokenPipeError, ConnectionResetError): pass
 def do_POST(self):
  global result
  value=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
  if self.path=='/result': result=value
  self.send_response(200); self.end_headers()
profile='ab-site-auth-fixture-'+uuid.uuid4().hex
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
env={**os.environ,'AB_HIDDEN':'1','AB_BROWSER_FIXTURE':'fixture','AB_PORT':str(server.server_port)}
logs=pathlib.Path.home()/'Library/Logs/com.siso.agent-base'
offsets={p:p.stat().st_size for p in logs.glob('*.log')} if logs.exists() else {}
proc=subprocess.Popen([str(ROOT/'target/debug/agent-base')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 deadline=time.monotonic()+120
 while result is None and proc.poll() is None and time.monotonic()<deadline: time.sleep(.25)
 crashed = proc.poll()
 leaked=False
 for p in logs.glob('*.log'):
  with p.open('rb') as f:
   f.seek(offsets.get(p,0)); leaked = leaked or PASSWORD.encode() in f.read()
 if result is None: result={'ok':False,'error':'no-result','exit':crashed}
 result['passwordLogged']=leaked
 result['ok']=result.get('ok') and not leaked and crashed is None
 output=ROOT/'test/evidence/site-auth-probe.json'
 output.write_text(json.dumps(result,indent=2)+'\n')
 print(output.read_text())
 if not result['ok']: raise SystemExit(1)
finally:
 if proc.poll() is None:
  proc.terminate()
  try: proc.wait(timeout=10)
  except subprocess.TimeoutExpired: proc.kill(); proc.wait()
 server.shutdown(); server.server_close()
