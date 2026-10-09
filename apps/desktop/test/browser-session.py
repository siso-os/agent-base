#!/usr/bin/env python3
"""Sign-in status on a disposable native store, against a LOCAL page that sets a fake SID cookie (never Google).
Run 1 signs in (cookie set by a page on the store) and reads the status with the page awake and after it closes;
run 2 is a fresh launch that reads the status with no page at all, as the launch check does.
Build first: cd apps/desktop && cargo build --features browser-test
python3 apps/desktop/test/browser-session.py
"""
import hashlib, http.server, json, os, pathlib, shutil, subprocess, threading, time, uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
PORT = 5497
ACCOUNT = 'session-test-' + uuid.uuid4().hex[:8]
reports = []
blanks = []
SCRIPT = r'''
(()=>{
const ipc=(c,a={})=>window.__TAURI_INTERNALS__.invoke(c,a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const send=r=>fetch('/result',{method:'POST',body:JSON.stringify(r)});
(async()=>{
 const phase=new URLSearchParams(location.search).get('phase'), account=new URLSearchParams(location.search).get('account');
 const r={phase};
 try {
  if(phase==='signin'){
   await ipc('browser_open',{tab:'s',rawUrl:location.origin+'/set',profile:account,x:0,y:0,width:400,height:300});
   for(let i=0;i<40&&!(await ipc('browser_url',{tab:'s'}));i++) await sleep(250);
   r.awake=await ipc('browser_session_state',{account});
   await ipc('browser_close',{tab:'s'});
   await sleep(300);
   r.closed=await ipc('browser_session_state',{account});
   await sleep(4000); // WebKit writes cookies to disk lazily; a real quit gives it this time, a test kill does not
  } else {
   r.launch=await ipc('browser_session_state',{account});
   r.other=await ipc('browser_session_state',{account:account+'-never'});
  }
 } catch(e){ r.error=String(e); }
 await send(r);
})();
})();
'''
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html')
        if self.path.startswith('/set'): self.send_header('Set-Cookie', 'SID=FAKE; Max-Age=3600; Path=/')
        self.end_headers()
        if self.path == '/api/browser/blank': blanks.append(1); return
        self.wfile.write(b'<title>set</title>ok' if self.path.startswith('/set') else ('<title>session fixture</title><script>' + SCRIPT + '</script>').encode())
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/result': reports.append(data)
        self.send_response(200); self.end_headers()

def run(phase):
    reports.clear()
    env = {**os.environ, 'AB_PORT': str(PORT), 'AB_HIDDEN': '1', 'AB_BROWSER_FIXTURE': f'fixture?phase={phase}&account={ACCOUNT}', 'AB_BROWSER_SESSION_URL': f'http://127.0.0.1:{PORT}/'}
    proc = subprocess.Popen([str(ROOT / 'target/debug/agent-base')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 60
        started = time.monotonic()
        while not reports and proc.poll() is None and time.monotonic() < deadline: time.sleep(.25)
        return {**reports[0], 'seconds': round(time.monotonic() - started, 1)} if reports else {'phase': phase, 'error': 'timed out'}
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()

server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
server.handle_error = lambda *a: None  # the app is killed between runs; its dropped connections are not failures
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    first = run('signin'); time.sleep(1)
    root = pathlib.Path.home() / 'Library/WebKit/agent-base/WebsiteDataStore'
    store = root / str(uuid.UUID(bytes=hashlib.sha256(f'siso.agent-base.browser.profile.v1:{ACCOUNT}'.encode()).digest()[:16])).upper()
    first['onDisk'] = sorted(str(p.relative_to(store)) for p in store.rglob('*Cookies*')) if store.exists() else None
    second = run('launch')
finally:
    server.shutdown()
    root = pathlib.Path.home() / 'Library/WebKit/agent-base/WebsiteDataStore'
    for acct in (ACCOUNT, ACCOUNT + '-never'):
        store = root / str(uuid.UUID(bytes=hashlib.sha256(f'siso.agent-base.browser.profile.v1:{acct}'.encode()).digest()[:16])).upper()
        if store.exists() and not store.is_symlink(): shutil.rmtree(store)
result = {'signin': first, 'launch': second, 'blankLoads': len(blanks)}
# browser_session_state answers [signed in, cookie names, Google cookie count] (t-0242): names and a count, never a value.
signed = lambda proof: isinstance(proof, list) and proof[0] is True and 'SID' in proof[1] and proof[2] >= 1
ok = signed(first.get('awake')) and signed(first.get('closed')) and signed(second.get('launch')) and second.get('other') == [False, [], 0]
print(json.dumps({**result, 'status': 'PASS' if ok else 'FAIL'}))
raise SystemExit(0 if ok else 1)
