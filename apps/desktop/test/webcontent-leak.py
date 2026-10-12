#!/usr/bin/env python3
"""Do closed browser pages give their WebKit process back? (A0, 10 Oct: "Agent Base desktop app holds 20 GB in 68 WebKit
processes ... the old ones never exit".) The hidden app opens and closes 12 tabs and swaps 6 hover prefetches across two
profiles, on local fixture pages only; the count of WebContent processes started since launch is read before, during and
15 s after; then the SISO Browser window opens and closes 4 times. No node, no agents, no visible window, no external URL.
Run after: heavy -- cargo build --features browser-test (in apps/desktop); AB_BIN overrides the binary.
"""
import http.server, json, os, pathlib, subprocess, sys, threading, time
ROOT = pathlib.Path(__file__).resolve().parents[1]
BIN = os.environ.get('AB_BIN') or str(ROOT / 'target/debug/agent-base')
PORT = 5497
TABS, PREFETCHES, WINDOWS = 12, 6, 4
marks = {}
done = threading.Event()
SCRIPT = r'''
const invoke = (c,a={}) => window.__TAURI_INTERNALS__.invoke(c,a);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const mark = async (name) => { await fetch('/mark',{method:'POST',body:JSON.stringify({name})}); await sleep(400); };
(async()=>{
 try {
  await sleep(1500); await mark('booted');
  for (let i=0;i<TABS;i++) {
   await invoke('browser_open',{tab:'leak-'+i,rawUrl:location.origin+'/page/'+i,profile:i%2?'HALO':'personal',x:0,y:80,width:900,height:600});
   await sleep(1500);
   if (i===TABS-1) await mark('last-open');
   await invoke('browser_close',{tab:'leak-'+i});
  }
  await mark('tabs-closed');
  for (let i=0;i<PREFETCHES;i++) { await invoke('browser_prefetch',{rawUrl:location.origin+'/hover/'+i,profile:i%2?'HALO':'personal',width:900,height:600}); await sleep(1500); }
  await mark('prefetched');
  for (let i=0;i<WINDOWS;i++) { await invoke('browser_window',{open:true,tab:'win-'+i,rawUrl:location.origin+'/win/'+i,title:'fixture'}); await sleep(2500); await invoke('browser_window',{open:false}); await sleep(1500); }
  await mark('windows');
  await sleep(15000); await mark('settled');
  await fetch('/done',{method:'POST',body:'{}'});
 } catch (e) { await fetch('/done',{method:'POST',body:JSON.stringify({error:String(e)})}); }
})();
'''.replace('TABS', str(TABS)).replace('PREFETCHES', str(PREFETCHES)).replace('WINDOWS', str(WINDOWS))

def webcontent(since):
    """WebContent processes started at or after `since` (epoch s): this app's, on a machine where nothing else starts them."""
    out = subprocess.run(['ps', '-axo', 'pid=,etime=,rss=,comm='], capture_output=True, text=True).stdout
    now, rows = time.time(), []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4 or 'WebKit.WebContent' not in parts[3]: continue
        e, secs = parts[1], 0
        d, _, e = e.rpartition('-')
        for f in e.split(':'): secs = secs * 60 + int(f)
        secs += int(d or 0) * 86400
        if now - secs >= since - 1: rows.append((int(parts[0]), int(parts[2])))
    return {'count': len(rows), 'rssMB': round(sum(r for _, r in rows) / 1024)}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers()
        body = '<title>WebContent leak probe</title><script>' + SCRIPT + '</script>' if self.path.startswith('/fixture') else \
            '<title>fixture ' + self.path + '</title><h1>fixture page ' + self.path + '</h1><p>' + 'synthetic text ' * 400 + '</p>'
        self.wfile.write(body.encode())
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])) or b'{}')
        if self.path == '/mark': marks[data['name']] = webcontent(started)
        elif self.path == '/done': marks['error'] = data.get('error'); done.set()
        self.send_response(200); self.end_headers()

server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
started = time.time()
env = {**os.environ, 'AB_PORT': str(PORT), 'AB_HIDDEN': '1', 'AB_BROWSER_FIXTURE': 'fixture'}
proc = subprocess.Popen([BIN], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    if not done.wait(180): marks['error'] = 'timed out'
finally:
    proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    server.shutdown()
print(json.dumps(marks))
if marks.get('error'): sys.exit(2)
booted, settled = marks['booted']['count'], marks['settled']['count']
# Bounded: the app's own page plus the one live prefetch (and WebKit's spare), never one per closed page.
ok = settled - booted <= 3 and marks['windows']['count'] - booted <= 3
print(f"{'PASS' if ok else 'FAIL'} webcontent: {booted} at boot, {marks['last-open']['count']} with the 12th tab open, "
      f"{marks['tabs-closed']['count']} after 12 closes, {marks['prefetched']['count']} after {PREFETCHES} prefetch swaps, "
      f"{marks['windows']['count']} after the window opened and closed {WINDOWS} times, {settled} 15 s later ({marks['settled']['rssMB']} MB)")
sys.exit(0 if ok else 1)
