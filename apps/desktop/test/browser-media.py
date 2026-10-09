#!/usr/bin/env python3
"""Media check in the persistent personal WK child; no node, no visible windows."""
import http.server,json,os,pathlib,subprocess,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'test/evidence/media-probe.json'
PORT=5496
results=[]
SCRIPT='''
(()=>{
const ipc=(c,a={})=>window.__TAURI_INTERNALS__.invoke(c,a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const decode=s=>{let v=JSON.parse(s);return typeof v==='string'?JSON.parse(v):v;};
(async()=>{
const r={};
try {
 await ipc('browser_open',{tab:'probe',rawUrl:'https://www.youtube.com/watch?v=jNQXAC9IVRw',profile:'personal',x:0,y:80,width:1200,height:750});
 await fetch('/progress',{method:'POST',body:JSON.stringify({stage:'youtube opened'})});await sleep(10000);await ipc('browser_test_media',{tab:'probe',start:true});await sleep(9000);
 r.youtube=decode(await ipc('browser_test_media',{tab:'probe',start:false}));
 for(const [name,url] of [['spotify','https://open.spotify.com/'],['appleMusic','https://music.apple.com/']]){
  await fetch('/progress',{method:'POST',body:JSON.stringify({stage:name})});await ipc('browser_navigate',{tab:'probe',rawUrl:url});await sleep(12000);
  await ipc('browser_test_media',{tab:'probe',start:true});await sleep(1500);
  r[name]=decode(await ipc('browser_test_media',{tab:'probe',start:false}));
 }
 await ipc('browser_close',{tab:'probe'});r.observed=true;
}catch(e){r.error=String(e);}
await fetch('/result',{method:'POST',body:JSON.stringify(r)});
})();
})();
'''
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def handle(self):
  try:super().handle()
  except(ConnectionResetError,BrokenPipeError):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers()
  self.wfile.write(('<title>S1 media</title><script>'+SCRIPT+'</script>').encode())
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.path=='/progress':print(json.dumps(data),flush=True)
  if self.path=='/result':results.append(data);OUT.write_text(json.dumps(data,indent=2)+'\n')
  self.send_response(200);self.end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
proc=subprocess.Popen([str(ROOT/'target/debug/agent-base')],env={**os.environ,'AB_PORT':str(PORT),'AB_HIDDEN':'1','AB_BROWSER_FIXTURE':'media?run='+str(time.time_ns())})
try:
 deadline=time.time()+100
 while not results and proc.poll() is None and time.time()<deadline:time.sleep(.25)
 if not results:raise RuntimeError('media probe timed out')
 print(json.dumps(results[0],indent=2))
 if not results[0].get('observed'):raise SystemExit(1)
finally:
 if proc.poll() is None:
  proc.terminate()
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
 server.shutdown()
