"""Rendered synthetic acceptance; no live launch or registry writes."""
import json,time,urllib.request,urllib.parse,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'.agents/scratchpads/landing-20261006'
API='http://127.0.0.1:9377';BASE='http://127.0.0.1:5497/preview/launch-org.html'
identity={'userId':'codex-launch-org','sessionKey':f'acceptance-{time.time_ns()}'}
results=[]
def req(route,body=None,method=None):
    route+=('&' if '?' in route else '?')+urllib.parse.urlencode(identity)
    raw=json.dumps({**(body or {}),**identity}).encode() if body is not None else None
    for attempt in range(20):
        try:
            with urllib.request.urlopen(urllib.request.Request(API+route,data=raw,headers={'Content-Type':'application/json'},method=method),timeout=40) as r:return r.read()
        except urllib.error.HTTPError as e:
            if e.code!=409 or attempt==19:print(e.read().decode()[:600]);raise
            time.sleep(.2)
def post(route,body):return json.loads(req(route,body))
def check(name,good):
    results.append({'check':name,'pass':bool(good)})
    if not good:raise AssertionError(name)
tab=post('/tabs',{'url':BASE})['tabId']
def ev(expr):return post(f'/tabs/{tab}/evaluate',{'expression':expr}).get('result')
def ready(sel):
    for _ in range(80):
        if ev(r'!!document.querySelector('+json.dumps(sel)+')'):return
        time.sleep(.1)
    raise AssertionError('Did not render '+sel)
def click(sel):ev(r'document.querySelector('+json.dumps(sel)+').click()');time.sleep(.1)
def key(k):post(f'/tabs/{tab}/press',{'key':k});time.sleep(.1)
def fill(sel,v):ev(r'(()=>{let i=document.querySelector('+json.dumps(sel)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+json.dumps(v)+');i.dispatchEvent(new Event("input",{bubbles:true}));})()');time.sleep(.1)
def nav(query=''):post(f'/tabs/{tab}/navigate',{'url':BASE+query});ready('[data-testid=workspace-choices]')
def shot(name):(OUT/name).write_bytes(req(f'/tabs/{tab}/screenshot'))
try:
    ready('.ab-workspace-choice__repo:not(:disabled)');click('[data-testid=org-view-tree]')
    check('native repo/mode selects removed',ev(r'!document.querySelector("select")'))
    check('Own worktree is the default',ev(r'document.querySelector(".ab-workspace-choice__mode button").getAttribute("aria-pressed")==="true"'))
    click('.ab-workspace-choice__repo')
    check('search receives initial focus',ev(r'document.activeElement.getAttribute("aria-label")==="Find a repository"'))
    fill('[type=search]','/fixture/projects/research')
    check('repository search matches full path',ev(r'document.querySelectorAll("[role=menuitem]").length===1'))
    key('Enter');check('Enter in search does not submit or choose',ev(r'document.querySelector("[data-testid=launch-count]").textContent==="0" && !!document.querySelector(".ab-workspace-picker")'))
    key('ArrowDown');key('Enter')
    check('keyboard chooses repository without launch',ev(r'document.querySelector("[data-testid=choice]").textContent.includes("research-with-a-deliberately-long") && document.querySelector("[data-testid=launch-count]").textContent==="0"'))
    check('choice restores trigger focus',ev(r'document.activeElement.classList.contains("ab-workspace-choice__repo")'))
    click('.ab-workspace-choice__mode button:nth-child(2)')
    check('shared checkout requires a reason',ev(r'document.querySelector("[aria-label=\"Shared checkout reason\"]").required && document.querySelector("[data-testid=launch]").disabled'))
    fill('[aria-label="Shared checkout reason"]','Review an existing session')
    click('.ab-workspace-choice__repo');key('Escape')
    check('Escape closes picker, restores focus, retains reason',ev(r'!document.querySelector(".ab-workspace-picker") && document.activeElement.classList.contains("ab-workspace-choice__repo") && document.querySelector("[aria-label=\"Shared checkout reason\"]").value==="Review an existing session"'))
    ev(r'(()=>{const b=document.querySelector("[data-testid=launch]");b.click();b.click();})()');time.sleep(.1)
    check('synthetic caller single-flight makes one launch',ev(r'document.querySelector("[data-testid=launch-count]").textContent==="1" && document.querySelector(".ab-workspace-choice__repo").disabled'))
    time.sleep(.7);click('[data-testid=disable]')
    check('disabled state blocks all choice controls',ev(r'document.querySelector(".ab-workspace-choice__repo").disabled && document.querySelector(".ab-workspace-choice__mode").disabled && document.querySelector("[aria-label=\"Shared checkout reason\"]").disabled'))
    click('[data-testid=disable]')
    check('each owner identity renders once',ev(r'(()=>{const a=[...document.querySelectorAll("[data-owner-name]")].map(e=>e.dataset.ownerName);return a.length===4 && new Set(a).size===a.length;})()'))
    check('worker identities render once including nested and history',ev(r'(()=>{const a=[...document.querySelectorAll("[data-worker-id]")].map(e=>e.dataset.workerId);return a.length===5 && new Set(a).size===a.length;})()'))
    check('infrastructure separate from project owners',ev(r'!!document.querySelector(".hub-org__infrastructure [data-owner-name=EFFICIENCY]") && !document.querySelector(".hub-org__groups [data-owner-name=EFFICIENCY]")'))
    check('planned, unknown and vacant seats remain visible',ev(r'document.body.textContent.includes("PLANNED") && document.body.textContent.includes("MISSING") && document.body.textContent.includes("No owner recorded")'))
    check('active worker stays below its recorded owner',ev(r'!!document.querySelector("[data-owner-name=OWNER] [data-worker-id=a]")'))
    check('nested worker stays below its recorded worker',ev(r'!!document.querySelector("[data-worker-id=a] [data-worker-id=d]")'))
    check('turn finished stays current; settled history is folded',ev(r'!document.querySelector("[data-worker-id=b]").closest("details") && !document.querySelector("[data-worker-id=c]").closest("details").open'))
    check('purpose current task return owner retained',ev(r'document.querySelector("[data-worker-id=a]").textContent.includes("Purpose: Verify the release") && document.querySelector("[data-worker-id=a]").textContent.includes("Current task: Check the layout") && document.querySelector("[data-worker-id=d]").textContent.includes("Return to: ACTIVE")'))
    check('unresolved ownership remains separate',ev(r'!!document.querySelector("[aria-label=\"Workers with unresolved ownership\"] [data-worker-id=e]")'))
    ev(r'document.querySelector(".hub-org__history summary").focus()');key('Enter')
    check('keyboard expands finished history',ev(r'document.querySelector(".hub-org__history").open'))
    key('Enter');click('[data-worker-id=d] > button')
    check('worker opens by stable id',ev(r'document.querySelector("[data-testid=opened]").textContent==="ID: d"'))
    for w,h in [(1440,1100),(1024,1100),(390,1200)]:
        post(f'/tabs/{tab}/viewport',{'width':w,'height':h});time.sleep(.15)
        check(f'page no horizontal overflow at {w}',ev(r'document.documentElement.scrollWidth<=innerWidth'))
        shot(f'launch-org-{w}.png');click('.ab-workspace-choice__repo')
        check(f'repository menu fits viewport at {w}',ev(r'(()=>{const r=document.querySelector(".ab-workspace-picker").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()'))
        shot(f'launch-menu-{w}.png');key('Escape')
        ev(r'document.querySelector(".hub-org__infrastructure").scrollIntoView({block:"end"})');time.sleep(.1);shot(f'launch-org-infrastructure-{w}.png')
        ev(r'window.scrollTo(0,0)');time.sleep(.1)
    click('[data-testid=org-view-constellation]');ready('[data-testid=constellation]')
    check('constellation deduplicates current direct workers',ev(r'document.querySelectorAll("[data-testid=const-worker]").length===2'))
    check('constellation explains coverage limit',ev(r'document.body.textContent.includes("Tree contains the full supplied roster")'))
    shot('launch-org-constellation-390.png');click('[data-testid=org-view-tree]')
    nav('?repos=empty');time.sleep(.2)
    check('empty repository response is explicit',ev(r'document.body.textContent.includes("No repositories are available") && document.querySelector("[data-testid=launch]").disabled'))
    nav('?repos=error');ready('[role=alert]')
    check('failed repo fetch shows error and retry',ev(r'document.querySelector("[role=alert]").textContent.includes("Cannot load repositories")'))
    click('[data-testid=restore-repos]');click('[role=alert] button');time.sleep(.2);click('.ab-workspace-choice__repo')
    check('retry recovers repository list',ev(r'!document.querySelector("[role=alert]") && document.querySelectorAll("[role=menuitem]").length===2'))
    nav('?repos=slow')
    check('loading state disables repo picker',ev(r'document.querySelector("[data-testid=workspace-choices]").getAttribute("aria-busy")==="true" && document.querySelector(".ab-workspace-choice__repo").disabled'))
    ready('.ab-workspace-choice__repo:not(:disabled)')
    check('loading state completes',ev(r'document.querySelector("[data-testid=workspace-choices]").getAttribute("aria-busy")==="false"'))
    nav('?aliases=1');ready('[data-owner-name=AGENT-BASE]')
    check('approved aliases render a single owner seat',ev(r'document.querySelectorAll("[data-owner-name=AGENT-BASE]").length===1'))
    click('[data-owner-name=AGENT-BASE] > button')
    check('merged seat opens active main session by id',ev(r'document.querySelector("[data-testid=opened]").textContent==="ID: base-main"'))
    click('[data-owner-name=AGENT-BASE] [data-testid=org-alias-provenance] summary')
    check('merged seat retains both source names and states',ev(r'document.querySelector("[data-owner-name=AGENT-BASE] [data-testid=org-alias-provenance]").textContent.includes("AGENT-BASE: offline") && document.querySelector("[data-owner-name=AGENT-BASE] [data-testid=org-alias-provenance]").textContent.includes("AGENT BASE: live")'))
    click('[data-owner-name=AGENT-BASE] [data-testid=org-project-provenance] summary')
    check('legacy folder provenance remains visible',ev(r'document.querySelector("[data-testid=org-project-provenance]").textContent.includes("SISO Internal Labs") && document.querySelector("[data-testid=org-project-provenance]").textContent.includes("Agent Base")'))
    click('[data-owner-name=AGENT-BASE] [data-testid=org-owner-sessions] summary')
    check('additional live and historical sessions retained',ev(r'document.querySelectorAll("[data-owner-session-id]").length===2 && document.querySelector("[data-owner-session-id=base-old]").disabled && !document.querySelector("[data-owner-session-id=base-other]").disabled'))
    click('[data-owner-session-id=base-other]')
    check('secondary live owner session still opens by id',ev(r'document.querySelector("[data-testid=opened]").textContent==="ID: base-other"'))
    for w,h in [(1440,1000),(390,1000)]:
        post(f'/tabs/{tab}/viewport',{'width':w,'height':h});time.sleep(.1)
        ev(r'document.querySelector("[data-owner-name=AGENT-BASE]").scrollIntoView({block:"center"})');time.sleep(.1)
        check(f'alias provenance no horizontal overflow at {w}',ev(r'document.documentElement.scrollWidth<=innerWidth'))
        shot(f'launch-org-alias-{w}.png')
    print(json.dumps({'passed':sum(r['pass'] for r in results),'total':len(results)},indent=2))
finally:
    req(f'/tabs/{tab}',method='DELETE')
    (OUT/'launch-org-browser-checks.json').write_text(json.dumps(results,indent=2)+'\n')
