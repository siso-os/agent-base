#!/usr/bin/env python3
"""Hidden native load probe: own account store, no agents, no installed app, no cookies."""
import hashlib, http.server, json, os, pathlib, subprocess, threading, time, uuid
ROOT = pathlib.Path(__file__).resolve().parents[1]
result = None
SCRIPT = r"""
(async () => {
 const invoke = (c,a={}) => window.__TAURI_INTERNALS__.invoke(c,a);
 const sleep = ms => new Promise(r => setTimeout(r,ms));
 const result = { pages: [] };
 try {
  for (const [i,url] of [location.origin+'/page', 'https://kikas-logos.pages.dev/', 'https://www.google.com/search?q=you'].entries()) {
   const tab = 'loading-'+i;
   await invoke('browser_open',{tab,profile:PROFILE,rawUrl:url,x:100,y:80,width:1000,height:650});
   const until = Date.now()+20000;
   let loaded = false;
   while (Date.now()<until) {
    if (await invoke('browser_url',{tab})) { loaded = true; break; }
    await sleep(250);
   }
   result.pages.push({tab,loaded});
   await invoke('browser_close',{tab});
  }
  await invoke('browser_open',{tab:'loading-failure',profile:PROFILE,rawUrl:location.origin+'/hang?private=DO_NOT_LOG',x:100,y:80,width:1000,height:650});
  await sleep(32000);
  result.failureUnfinished = (await invoke('browser_url',{tab:'loading-failure'})) === '';
  await invoke('browser_close',{tab:'loading-failure'});
  result.ok = result.pages.every(p => p.loaded) && result.failureUnfinished;
 } catch { result.ok=false; result.error='native-command-error'; }
 await fetch('/result',{method:'POST',body:JSON.stringify(result)});
})();
"""
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  if self.path.startswith('/hang'):
   threading.Event().wait(45)
  self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers()
  content = '<title>Native load fixture</title><p>loaded</p>'
  if self.path=='/fixture': content += '<script>'+SCRIPT.replace('PROFILE',json.dumps(profile))+'</script>'
  try: self.wfile.write(content.encode())
  except (BrokenPipeError, ConnectionResetError): pass
 def do_POST(self):
  global result
  value=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
  if self.path=='/result': result=value
  self.send_response(200); self.end_headers()
profile='ab-web-tabs-fixture-'+uuid.uuid4().hex
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
env={**os.environ,'AB_HIDDEN':'1','AB_BROWSER_FIXTURE':'fixture','AB_PORT':str(server.server_port)}
log=pathlib.Path.home()/'Library/Logs/com.siso.agent-base/node.log'
log_offset=log.stat().st_size if log.exists() else 0
proc=subprocess.Popen([str(ROOT/'target/debug/agent-base')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 deadline=time.monotonic()+80
 while result is None and proc.poll() is None and time.monotonic()<deadline: time.sleep(.25)
 with log.open() as stream:
  stream.seek(log_offset)
  lines=stream.read().splitlines()
 if result:
  expected='browser-page-'+hashlib.sha256(b'siso.agent-base.browser.tab.v1:loading-failure').hexdigest()[:20]
  notes=[json.loads(line) for line in lines if '"browser-load"' in line]
  result['failureLogged']=any(n.get('tab')==expected and n.get('status')=='timeout-no-finish' for n in notes)
  result['privateQueryLogged']=any('DO_NOT_LOG' in line for line in lines)
  result['ok']=result['ok'] and result['failureLogged'] and not result['privateQueryLogged']
 output=ROOT/'test/evidence/loading-probe.json'
 output.write_text(json.dumps(result or {'ok':False,'error':'no-result','exit':proc.poll()},indent=2)+'\n')
 print(output.read_text())
 if not result or not result.get('ok'): raise SystemExit(1)
finally:
 if proc.poll() is None:
  proc.terminate()
  try: proc.wait(timeout=10)
  except subprocess.TimeoutExpired: proc.kill(); proc.wait()
 server.shutdown(); server.server_close()
