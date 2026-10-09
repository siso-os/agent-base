#!/usr/bin/env python3
"""Exercise the real built App/PageView in hidden WKWebView, without any laptop node.
--dev opens a visible dev window ONLY when Shaan runs it; automated tests stay hidden.
"""
import http.server, json, os, pathlib, subprocess, sys, threading, time, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
WEB=ROOT.parent/'web/dist'
OUT=ROOT/'test/evidence'
OUT.mkdir(exist_ok=True)
DEV='--dev' in sys.argv
PORT=5497 if DEV else 5495
reports=[]
TABS=[{'id':'tab:s1-github','kind':'web','title':'GitHub'},{'id':'tab:s1-local','kind':'web','title':'Local probe'}]
NAV={TABS[0]['id']:{'url':'https://github.com/','back':[],'fwd':[],'n':0},TABS[1]['id']:{'url':f'http://127.0.0.1:{PORT}/one','back':[],'fwd':[],'n':0}}
PRELOAD=''
if not DEV:
    PRELOAD='<script>localStorage.removeItem("agent-base:arc-profiles");localStorage.setItem("agent-base:open-tabs",'+json.dumps(json.dumps(TABS))+');localStorage.setItem("agent-base:tab-nav",'+json.dumps(json.dumps(NAV))+');localStorage.setItem("agent-base:open","[]");localStorage.removeItem("agent-base:active");localStorage.setItem("agent-base:browser-profile:tab:s1-local","personal");</script>'
DRIVER=r'''
<script>
(()=>{
const reportError=error=>fetch('/result',{method:'POST',body:JSON.stringify({ok:false,error:String(error)})});
window.addEventListener('error',e=>reportError(e.message));
window.addEventListener('unhandledrejection',e=>reportError(e.reason));
fetch('/progress',{method:'POST',body:JSON.stringify({stage:'driver started'})});
const ipc=(c,a={})=>window.__TAURI_INTERNALS__.invoke(c,a);
const status=()=>ipc('browser_test_status');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn)=>{for(let i=0;i<60;i++){if(fn())return;await sleep(200);}throw Error('DOM wait timed out');};
const clickTab=label=>[...document.querySelectorAll('[role=tab]')].find(e=>label==='Local probe'?e.title.startsWith(location.origin):e.title.startsWith('https://github.com'))?.click();
const address=()=>document.querySelector('.siso-page__address');
const go=async url=>{
 const el=address();
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,url);
 el.dispatchEvent(new Event('input',{bubbles:true}));
 await sleep(100);
 el.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await sleep(1500);
};
(async()=>{
const r={};
try {
 await wait(()=>document.querySelectorAll('[role=tab]').length>=2);
 clickTab('Local probe');
 await fetch('/progress',{method:'POST',body:JSON.stringify({stage:'local clicked'})});
 await wait(()=>document.querySelector('[data-native-browser]'));
 await sleep(1500);
 r.nativeSlot=!!document.querySelector('[data-native-browser]') && !document.querySelector('.siso-page iframe');
 if(!r.nativeSlot)throw Error('not a native page tab');
 await go(location.origin+'/two');
 document.querySelector('[aria-label="Back"]').click();await sleep(1800);
 r.back=address().value.endsWith('/one');if(!r.back)throw Error('address did not follow native Back');
 document.querySelector('[aria-label="Forward"]').click();await sleep(1800);
 r.forward=address().value.endsWith('/two');if(!r.forward)throw Error('address did not follow native Forward');
 document.querySelector('[aria-label="Reload"]').click();await sleep(500);
 const menu=document.createElement('div');menu.setAttribute('role','menu');document.body.append(menu);await sleep(350);
 r.menuHidden=(await status())[0]===0;
 menu.remove();await sleep(350);r.menuRestored=(await status())[0]===1;
 document.dispatchEvent(new Event('dragstart',{bubbles:true}));await sleep(350);
 r.dragHidden=(await status())[0]===0;
 document.dispatchEvent(new Event('dragend',{bubbles:true}));await sleep(350);
 r.dragRestored=(await status())[0]===1;
 if(!r.menuHidden||!r.menuRestored||!r.dragHidden||!r.dragRestored)throw Error('overlay visibility failed');
 const slot=document.querySelector('[data-native-browser]');
 const before=await status();
 slot.style.marginLeft='20px';await sleep(500);r.resized=(await status())[3]<before[3];
 slot.style.marginLeft='';await sleep(500);if(!r.resized)throw Error('native rectangle did not follow layout');
 clickTab('GitHub');await sleep(9000);
 r.github=JSON.parse(await ipc('browser_test_observe',{snapshot:true}));if(typeof r.github==='string')r.github=JSON.parse(r.github);
 await ipc('browser_test_observe',{snapshot:true,mainSnapshot:true});await sleep(1200);
 r.oneLive=(await status())[5]===2;
 if(!r.oneLive || !r.github.title.includes('GitHub'))throw Error('tab rebuild or GitHub render failed');
 clickTab('Local probe');await sleep(1800);
 r.savedUrl=address().value.endsWith('/two');if(!r.savedUrl)throw Error('URL not restored on tab rebuild');
 const fixture=await (await fetch('/arc-fixture')).text();
 const transfer=new DataTransfer();transfer.items.add(new File([fixture],'StorableSidebar.json',{type:'application/json'}));
 const file=document.querySelector('input[type=file]');file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}));await sleep(900);
 r.arcProfiles=document.querySelector('[aria-label="Browser profile"]').value==='arc:space-fake-personal';
 await go('https://personal.invalid/');
 r.arcPinned=!!document.querySelector('[aria-label="Unpin"]');
 clickTab('GitHub');await sleep(700);
 [...document.querySelectorAll('[role=tab]')].find(e=>e.title.startsWith('https://personal.invalid'))?.click();await sleep(900);
 r.arcProfileRestored=document.querySelector('[aria-label="Browser profile"]').value==='arc:space-fake-personal';
 r.arcPinRestored=!!document.querySelector('[aria-label="Unpin"]');
 if(!r.arcProfiles||!r.arcPinned||!r.arcProfileRestored||!r.arcPinRestored)throw Error('Arc profile or pin did not survive tab rebuild');
 document.querySelector('[aria-label^="New tab"]')?.click();await sleep(350);
 const chooser=document.querySelector('[aria-label="Browser profile"]');chooser.value='arc:space-fake-personal';chooser.dispatchEvent(new Event('change',{bubbles:true}));await sleep(350);
 r.arcPinLibrary=!!document.querySelector('.siso-newtab button[title="https://personal.invalid/"]');
 if(!r.arcPinLibrary)throw Error('imported pins not accessible on new-tab page');
 const profiles=document.querySelector('[aria-label="Browser profile"]');
 profiles.value='new-profile';profiles.dispatchEvent(new Event('change',{bubbles:true}));await sleep(300);
 const name=document.querySelector('[aria-label="New profile name"]');
 name.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await sleep(200);
 r.emptyNameRejected=!!document.querySelector('[role=alert]');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'AB022 fake account');
 name.dispatchEvent(new Event('input',{bubbles:true}));await sleep(100);
 name.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await sleep(500);
 const namedId=profiles.value;
 r.namedProfile=namedId.startsWith('profile:')&&[...profiles.options].some(o=>o.value===namedId&&o.text==='AB022 fake account');
 r.namedStored=JSON.parse(localStorage.getItem('agent-base:arc-profiles')).some(p=>p.id===namedId&&p.name==='AB022 fake account');
 profiles.value='personal';profiles.dispatchEvent(new Event('change',{bubbles:true}));await sleep(200);
 profiles.value=namedId;profiles.dispatchEvent(new Event('change',{bubbles:true}));await sleep(200);
 r.namedSelected=profiles.value===namedId;
 if(!r.emptyNameRejected||!r.namedProfile||!r.namedStored||!r.namedSelected)throw Error('named profile creation or persistence failed');
 await ipc('browser_test_observe',{snapshot:true,mainSnapshot:true});await sleep(1500);
 r.ok=true;
}catch(e){r.ok=false;r.error=String(e);}
await fetch('/result',{method:'POST',body:JSON.stringify(r)});
})();
})();
</script>
'''
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def handle(self):
        try:super().handle()
        except (ConnectionResetError,BrokenPipeError):pass
    def do_GET(self):
        path=urllib.parse.urlsplit(self.path).path
        if not path.startswith('/api/'):print('GET '+path,flush=True)
        self.send_response(200)
        self.send_header('Cache-Control','no-store')
        if path=='/api/agents':
            content=json.dumps({'agents':[],'domains':[],'pinnedPages':[],'recentPages':[]}).encode();ctype='application/json'
        elif path.startswith('/assets/'):
            file=WEB/path.lstrip('/')
            content=file.read_bytes();ctype='text/css' if file.suffix=='.css' else 'text/javascript'
        elif path=='/arc-fixture':
            content=(ROOT/'test/fixtures/StorableSidebar.json').read_bytes();ctype='application/json'
        elif path=='/driver.js':
            content=DRIVER.replace('<script>','').replace('</script>','').encode();ctype='text/javascript'
        elif path=='/ui':
            content=(WEB/'index.html').read_text().replace('<head>','<head>'+PRELOAD).replace('</body>',('' if DEV else '<script src="/driver.js"></script>')+'</body>').encode();ctype='text/html'
        else:
            self.send_header('X-Frame-Options','DENY')
            content=('<title>S1 '+path+'</title><h1>'+path+'</h1><p>Native page; framing denied.</p>').encode();ctype='text/html'
        self.send_header('Content-Type',ctype);self.end_headers();self.wfile.write(content)
    def do_POST(self):
        body=self.rfile.read(int(self.headers.get('Content-Length',0)))
        if self.path=='/progress':print(body.decode(),flush=True)
        if self.path=='/result':
            reports.append(json.loads(body));(OUT/'ui-probe.json').write_text(json.dumps(reports[-1],indent=2)+'\n')
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{}')
server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
env={**os.environ,'AB_PORT':str(PORT),'AB_BROWSER_FIXTURE':'ui?run='+str(time.time_ns()),'AB_BROWSER_SHOT':str(OUT/'github-tab.tiff')}
if DEV:env.pop('AB_HIDDEN',None)
else:env['AB_HIDDEN']='1'
proc=subprocess.Popen([str(ROOT/'target/debug/agent-base')],env=env)
try:
    if DEV:
        print('Dev-only browser: + tab → https://accounts.google.com/ . Quit with Cmd+Q; rerun this command to check the login.',flush=True)
        proc.wait()
    else:
        deadline=time.time()+80
        while not reports and proc.poll() is None and time.time()<deadline:time.sleep(.25)
        if not reports:raise RuntimeError('UI fixture timed out')
        # Keep routine output compact; full command evidence is in ui-probe.json.
        print(json.dumps({k:v for k,v in reports[-1].items() if k not in ['commands','github']},indent=2))
        if not reports[-1]['ok']:raise SystemExit(1)
finally:
    if proc.poll() is None:
        proc.terminate()
        try:proc.wait(timeout=10)
        except subprocess.TimeoutExpired:proc.kill();proc.wait()
    server.shutdown()
