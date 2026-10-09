import json,time,urllib.request,urllib.parse
from pathlib import Path
OUT=Path(__file__).resolve().parents[4]/'.agents/scratchpads/landing-20261006'
identity={'userId':'codex-owner-space','sessionKey':f'fixture-{time.time_ns()}'};checks=[]
def req(route,body=None,method=None):
 url='http://127.0.0.1:9377'+route+('?' if '?' not in route else '&')+urllib.parse.urlencode(identity)
 data=json.dumps({**identity,**body}).encode() if body is not None else None
 with urllib.request.urlopen(urllib.request.Request(url,data=data,headers={'Content-Type':'application/json'},method=method),timeout=30) as r:return r.read()
def post(route,body):return json.loads(req(route,body))
BASE='http://127.0.0.1:5498/preview/owner-space.html?run='+identity['sessionKey']
tab=post('/tabs',{'url':BASE})['tabId']
def ev(s):return post(f'/tabs/{tab}/evaluate',{'expression':s}).get('result')
def click(s):ev('document.querySelector('+json.dumps(s)+').click()');time.sleep(.12)
def check(label,ok):
 checks.append({'check':label,'pass':bool(ok)})
 if not ok:raise AssertionError(label)
def ready(s):
 for _ in range(100):
  if ev('!!document.querySelector('+json.dumps(s)+')'):return
  time.sleep(.15)
 raise AssertionError('not rendered '+s)
try:
 ready('[data-testid=question-card]')
 ready('.owner-space-work__tasks article')
 click('input[type=radio]');click('#remount')
 check('draft survives component remount',ev('document.querySelector("input[type=radio]").checked'))
 click('#disconnect')
 check('disconnected draft remains and send disabled',ev('document.querySelector("input[type=radio]").checked && document.querySelector("[data-testid=question-card] footer button:nth-child(2)").disabled'))
 click('#disconnect');click('#fail');click('[data-testid=question-card] footer button:nth-child(2)');time.sleep(.35)
 check('failed answer retained without success claim',ev('document.querySelector(".owner-space-work__question").textContent.includes("unavailable") && document.querySelector("input[type=radio]").checked'))
 check('retry waits for fresh native snapshot',ev('document.querySelector("[data-testid=question-card] footer button:nth-child(2)").disabled'))
 click('#remount');check('failed draft survives reload',ev('document.querySelector("input[type=radio]").checked'))
 click('#fail');click('#refresh')
 check('fresh snapshot permits explicit retry',ev('!document.querySelector("[data-testid=question-card] footer button:nth-child(2)").disabled'))
 ev('document.querySelector("[data-testid=question-card] footer button:nth-child(2)").click();document.querySelector("[data-testid=question-card] footer button:nth-child(2)").click()');time.sleep(.4)
 check('duplicate clicks submit once',ev('document.querySelector("#calls").textContent==="2 sends"'))
 check('native receipt shown with task-delivery limit',ev('document.querySelector(".owner-space-work__question").textContent.includes("native receipt recorded") && document.querySelector(".owner-space-work__question").textContent.includes("task delivery is still separate")'))
 post(f'/tabs/{tab}/navigate',{'url':BASE});ready('.owner-space-work__question');check('receipt survives full page reload',ev('document.querySelector(".owner-space-work__question").textContent.includes("native receipt recorded")'))
 click('.owner-space-work__tasks article>button');ready('.owner-space-work__record')
 check('recorded dossier evidence and history visible',ev('document.querySelector(".owner-space-work__record").textContent.includes("side-nav") && document.querySelector(".owner-space-work__record").textContent.includes("fixture-check.json")'))
 check('task stage is not landing readiness',ev('document.querySelector(".owner-space-work__record").textContent.includes("Landing readiness is not established")'))
 click('.owner-space-work>button');check('existing owner chat callback used',ev('document.querySelector("#opened").textContent==="Chat opened"'))
 for w in [1440,390]:
  post(f'/tabs/{tab}/viewport',{'width':w,'height':1000});time.sleep(.2)
  check(f'no horizontal overflow at {w}',ev('document.documentElement.scrollWidth<=innerWidth'))
  (OUT/f'owner-space-{w}.png').write_bytes(req(f'/tabs/{tab}/screenshot'))
 print(json.dumps({'passed':sum(c['pass'] for c in checks),'total':len(checks)}))
finally:
 req(f'/tabs/{tab}',method='DELETE');(OUT/'owner-space-browser-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
