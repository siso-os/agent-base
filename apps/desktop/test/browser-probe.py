#!/usr/bin/env python3
"""Hidden WKWebView acceptance probe: no node, agents, installed app or visible window.
Run after: heavy -- cargo build --features browser-test (in apps/desktop).
"""
import http.server, json, os, pathlib, subprocess, threading, time
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'test' / 'evidence'
OUT.mkdir(exist_ok=True)
results = []
phase = 'personal-set'
profile = 'personal'
cookie_name = 'siso_s1_'+str(time.time_ns())
security = {}
PORT = 5498
SCRIPT = r'''
const invoke = async (c,a={}) => { await fetch('/progress',{method:'POST',body:JSON.stringify({command:c})}); return window.__TAURI_INTERNALS__.invoke(c,a); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
const result = {phase:PHASE,profile:PROFILE};
try {
 const origin = location.origin;
 await invoke('browser_open',{tab:'probe',rawUrl:origin+'/cookie/'+(PHASE.endsWith('set')?'set':'read'),profile:PROFILE,x:0,y:80,width:1000,height:650});
 await sleep(2000);
 result.cookie = JSON.parse(await invoke('browser_test_observe',{tab:'probe',snapshot:false}));
 if (typeof result.cookie === 'string') result.cookie=JSON.parse(result.cookie);
 const found=result.cookie.cookie.includes(COOKIE_NAME+'='+PROFILE);
 if(PHASE==='HALO-clean'){if(result.cookie.cookie.includes(COOKIE_NAME+'='))throw Error('personal cookie leaked to HALO');result.isolated=true;}
 else if(!found)throw Error('persistent profile cookie missing');
 for (const rawUrl of ['javascript:alert(1)','file:///etc/passwd']) {
  let rejected=false; try { await invoke('browser_navigate',{tab:'probe',rawUrl}); } catch {rejected=true;}
  if (!rejected) throw Error('unsafe URL accepted');
 }
 await invoke('browser_bounds',{tab:'probe',x:10,y:90,width:980,height:620});
 await invoke('browser_visible',{tab:'probe',visible:false});
 await invoke('browser_visible',{tab:'probe',visible:true});
 result.controls=true;
 result.security=await (await fetch('/security-result')).json();
 if(!result.security.denied)throw Error('child app-command rejection not observed');
 if(PHASE==='personal-read') {
  await invoke('browser_navigate',{tab:'probe',rawUrl:origin+'/one'}); await sleep(1200);
  await invoke('browser_navigate',{tab:'probe',rawUrl:origin+'/two'}); await sleep(1200);
  await invoke('browser_action',{tab:'probe',action:'back'}); await sleep(1200);
  if(!(await invoke('browser_url',{tab:'probe'})).endsWith('/one')) throw Error('back failed');
  await invoke('browser_action',{tab:'probe',action:'forward'}); await sleep(1200);
  if(!(await invoke('browser_url',{tab:'probe'})).endsWith('/two')) throw Error('forward failed');
  await invoke('browser_action',{tab:'probe',action:'reload'}); await sleep(1200);
  result.history=true;
  await invoke('browser_navigate',{tab:'probe',rawUrl:'https://accounts.google.com/'}); await sleep(6000);
  result.google=JSON.parse(await invoke('browser_test_observe',{tab:'probe',snapshot:false}));
  if(typeof result.google==='string') result.google=JSON.parse(result.google);
  await invoke('browser_navigate',{tab:'probe',rawUrl:'https://github.com/'}); await sleep(9000);
  result.github=JSON.parse(await invoke('browser_test_observe',{tab:'probe',snapshot:true}));
  if(typeof result.github==='string') result.github=JSON.parse(result.github);
  await sleep(2000);
 }
 await invoke('browser_close',{tab:'probe'}); result.ok=true;
} catch(e) {result.error=String(e);result.ok=false;}
await fetch('/result',{method:'POST',body:JSON.stringify(result)});
})();
'''
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def handle(self):
        try: super().handle()
        except (ConnectionResetError, BrokenPipeError): pass
    def do_GET(self):
        if self.path=='/security-result':
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(security).encode());return
        self.send_response(200)
        self.send_header('Content-Type','text/html')
        if self.path == '/cookie/set':
            self.send_header('Set-Cookie',cookie_name+'='+profile+'; Max-Age=86400; SameSite=Lax; Path=/')
        # Sites refuse framing but work as native pages.
        if not self.path.startswith('/fixture'):
            self.send_header('X-Frame-Options','DENY')
        self.end_headers()
        if self.path.startswith('/fixture'):
            page='<title>S1 native browser gate</title><h1>Personal profile — native page tab</h1><script>'+SCRIPT.replace('PHASE',json.dumps(phase)).replace('PROFILE',json.dumps(profile)).replace('COOKIE_NAME',json.dumps(cookie_name))+'</script>'
        else:
            page='<title>S1 '+self.path+'</title><h1>'+self.path+'</h1><p>Native WebKit cookie probe</p><script>window.__TAURI_INTERNALS__.invoke("browser_close").then(()=>fetch("/security",{method:"POST",body:JSON.stringify({denied:false})}),()=>fetch("/security",{method:"POST",body:JSON.stringify({denied:true})}));</script>'
        self.wfile.write(page.encode())
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/progress':
            print(phase+': '+json.dumps(data),flush=True)
        elif self.path == '/security':
            security.update(data)
        else:
            results.append(data)
            (OUT/'native-probe.json').write_text(json.dumps(results,indent=2)+'\n')
        self.send_response(200);self.end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    modes=['personal-set','HALO-clean','HALO-set','personal-read','HALO-read']
    for index,mode in enumerate(modes):
        phase=mode
        profile=mode.split('-')[0]
        security.clear()
        env={**os.environ,'AB_PORT':str(PORT),'AB_HIDDEN':'1','AB_BROWSER_FIXTURE':'fixture','AB_BROWSER_SHOT':str(OUT/'github.tiff')}
        proc=subprocess.Popen([str(ROOT/'target/debug/agent-base')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            deadline=time.time()+90
            while len(results)<(index+1) and time.time()<deadline and proc.poll() is None:
                time.sleep(.25)
            if len(results)<(index+1):
                raise RuntimeError('fixture timed out or app exited: '+mode+'; results='+json.dumps(results))
        finally:
            proc.terminate()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill();proc.wait()
        time.sleep(2)
    (OUT/'native-probe.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps([{k:v for k,v in r.items() if k not in ['github','google']} for r in results],indent=2))
    if not all(r.get('ok') for r in results): raise SystemExit(1)
finally:
    server.shutdown()
