#!/usr/bin/env python3
"""Email-only Google gate on a disposable native profile. Run on the mini only.
Build first: cd apps/desktop && cargo build --features browser-test
AB_GATE_MINI=1 python3 apps/desktop/test/browser-gate.py
"""
import hashlib, http.server, json, os, pathlib, subprocess, threading, time, uuid, shutil

if os.environ.get('AB_GATE_MINI') != '1':
    raise SystemExit('mini-only probe: set AB_GATE_MINI=1 via ab-mini')
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'test/evidence/ab-022'
OUT.mkdir(parents=True, exist_ok=True)
PORT = 5496
reports = []
SCRIPT = r'''
(()=>{
window.addEventListener('error',e=>fetch('/result',{method:'POST',body:JSON.stringify({status:'BLOCKED',error:e.message})}));
const ipc=(c,a={})=>window.__TAURI_INTERNALS__.invoke(c,a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const observe=async snapshot=>{let r=JSON.parse(await ipc('browser_test_observe',{tab:'probe',snapshot}));return typeof r==='string'?JSON.parse(r):r;};
(async()=>{
 const r={engine:'WKWebView',profile:'gate-test',status:'BLOCKED'};
 try {
  await ipc('browser_open',{tab:'probe',rawUrl:location.origin+'/blank',profile:'gate-test',x:0,y:0,width:1200,height:800});
  await sleep(2000);
  r.local=await observe(false);
  await ipc('browser_navigate',{tab:'probe',rawUrl:'https://accounts.google.com/'});
  await sleep(6000);
  for(let i=0;i<40;i++) {
   let step;try{step=await ipc('browser_test_google');}catch{await sleep(500);continue;}
   try{r.page=JSON.parse(JSON.parse(step));}catch{}
   if(i%10===0)await fetch('/progress',{method:'POST',body:JSON.stringify({step:step.slice(0,200)})});
   if(step.includes('submitted')){r.identifierSubmitted=true;break;}
   await sleep(500);
  }
  if(!r.identifierSubmitted)throw Error('identifier step not available');
  for(let i=0;i<40;i++) {
   try{r.page=await observe(false);}catch{await sleep(500);continue;}
   const text=r.page.text||'';
   if(/This browser or app may not be secure|Couldn't sign you in|Couldn’t sign you in/i.test(text)){r.status='FAIL';break;}
   if(/Enter your password|Verify it.s you|2.Step Verification|Check your phone|Get a verification code|Choose how to sign in/i.test(text)||/\/challenge\//.test(r.page.url)){r.status='PASS';break;}
   await sleep(500);
  }
  await sleep(5000);r.page=await observe(true);await sleep(1800);
 }catch(e){r.error=String(e);try{r.page=await observe(true);}catch{}await sleep(2500);}
 await fetch('/result',{method:'POST',body:JSON.stringify(r)});
})();
})();
'''
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers()
        self.wfile.write(('<title>AB-022 blank</title>' if self.path=='/blank' else '<title>AB-022 gate fixture</title><script>'+SCRIPT+'</script>').encode())
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/result': reports.append(data)
        else: print(json.dumps(data),flush=True)
        self.send_response(200); self.end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
result={'engine':'WKWebView','status':'BLOCKED'}
proc=None
try:
    env={**os.environ,'AB_PORT':str(PORT),'AB_HIDDEN':'1','AB_BROWSER_FIXTURE':'fixture','AB_BROWSER_SHOT':str(OUT/'gate-native.tiff')}
    proc=subprocess.Popen([str(ROOT/'target/debug/agent-base')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    deadline=time.monotonic()+90
    while not reports and proc.poll() is None and time.monotonic()<deadline: time.sleep(.25)
    result=reports[0] if reports else {**result,'error':'fixture timed out or process exited'}
finally:
    if proc:
        proc.terminate()
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    server.shutdown()
    # Delete only the deterministic gate-test store, after WKWebView is released.
    identifier=str(uuid.UUID(bytes=hashlib.sha256(b'siso.agent-base.browser.profile.v1:gate-test').digest()[:16]))
    # The debug executable's store root was observed on the mini. Never touch sibling profiles.
    root = pathlib.Path.home() / 'Library/WebKit/agent-base/WebsiteDataStore'
    store = root / identifier.upper()
    if store.is_symlink(): raise RuntimeError('gate store must not be a symlink')
    if store.exists(): shutil.rmtree(store)
    result['profileDeleted'] = not store.exists()
    if (OUT/'gate-native.tiff').exists():
        subprocess.run(['sips','-s','format','png',str(OUT/'gate-native.tiff'),'--out',str(OUT/'gate-native.png')],check=True,stdout=subprocess.DEVNULL)
        (OUT/'gate-native.tiff').unlink()
    (OUT/'gate.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='page'},indent=2))
raise SystemExit(0 if result['status']=='PASS' and result['profileDeleted'] else 1)
