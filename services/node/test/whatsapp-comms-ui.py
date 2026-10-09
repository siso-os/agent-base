#!/usr/bin/env python3
"""Camofox synthetic UI regression. Requires whatsapp-preview-server.mjs on 5498."""
import json, urllib.request, time
from pathlib import Path
from urllib.parse import urlencode
BASE='http://localhost:9377'
identity={'userId':'astra-comms-ui-test','sessionKey':'round-20261006'}
shotdir=Path('domain-base/communications')
results=[]
def call(route,data=None,method=None):
    if data is None:
        req=urllib.request.Request(BASE+route+'?'+urlencode(identity),method=method)
    else:
        req=urllib.request.Request(BASE+route,data=json.dumps({**identity,**data}).encode(),headers={'Content-Type':'application/json'},method=method)
    try:
        with urllib.request.urlopen(req,timeout=40) as r: return json.load(r)
    except urllib.error.HTTPError as e: raise RuntimeError(str(e.code)+': '+e.read().decode()[:1000]) from None
def check(name,condition):
    results.append({'check':name,'pass':bool(condition)})
    assert condition,name
    print('PASS:',name,flush=True)
tab=call('/tabs',{'url':'http://127.0.0.1:5498/ui-hub/whatsapp/preview.html'})['tabId']
def action(verb,data={}):return call('/tabs/'+tab+'/'+verb,data)
def evaluate(expression):return action('evaluate',{'expression':expression}).get('result')
def until(expression):
    for i in range(50):
        if evaluate(expression):return
        time.sleep(.1)
    raise AssertionError('UI state did not arrive: '+expression)
def click(selector):return action('click',{'selector':selector})
def typein(text):return action('type',{'selector':'textarea[aria-label="Message"]','text':text,'clear':True})
def stats():return json.load(urllib.request.urlopen('http://127.0.0.1:5498/fixture/stats'))['sends']
def shot(name):
    with urllib.request.urlopen(BASE+'/tabs/'+tab+'/screenshot?'+urlencode(identity)) as r:(shotdir/name).write_bytes(r.read())
try:
    action('viewport',{'width':1440,'height':900})
    until('document.querySelectorAll(".wa-row").length>0')
    click('.wa-folder .wa-row')
    until('document.querySelector("textarea") && !document.querySelector("textarea").disabled')
    initial=stats()
    typein('FAIL')
    check('typing never sends',stats()==initial)
    click('[aria-label="Send message"]')
    until('document.querySelector("[role=alert]")?.textContent.includes("limit")')
    check('rejection retains draft',evaluate('document.querySelector("textarea").value==="FAIL"'))
    click('.wa-row:has-text("Demo client group")')
    until('document.querySelector(".wa-chat-head h2")?.textContent.includes("Demo client group")')
    check('other chat has its own draft',evaluate('document.querySelector("textarea").value===""'))
    click('.wa-folder .wa-row')
    until('document.querySelector("textarea")?.value==="FAIL"')
    check('draft survives chat switch',True)
    typein('Synthetic deliberate send')
    # Exercise two synchronous explicit form submissions, before React can render the busy state.
    evaluate('(()=>{const f=document.querySelector(".wa-compose form"); f.requestSubmit(); f.requestSubmit(); return true;})()')
    until('document.querySelector(".wa-send-status")?.textContent.includes("Accepted")')
    check('double-submit makes one gateway call',stats()==initial+2)
    check('accepted clears draft only after receipt',evaluate('document.querySelector("textarea").value===""'))
    if not evaluate('document.querySelector(".wa-organise button").textContent.includes("Unpin")'): click('.wa-organise button:has-text("Pin chat")')
    until('document.querySelector(".wa-organise button")?.textContent.includes("Unpin")')
    if not evaluate('document.querySelector(".wa-save-message[aria-pressed=true]")'): click('.wa-msg[data-id="fixture-message"] [aria-label="Save message"]')
    until('document.querySelector(".wa-save-message[aria-pressed=true]")!==null')
    typein('Private synthetic draft')
    action('refresh')
    until('document.querySelectorAll(".wa-row").length>0')
    click('.wa-folder .wa-row')
    until('document.querySelector("textarea")?.value==="Private synthetic draft"')
    check('reload preserves draft pins and saved references',evaluate('document.querySelector(".wa-organise button").textContent.includes("Unpin") && document.querySelector(".wa-save-message[aria-pressed=true]")!==null'))
    shot('regression-1440.png')
    # Long heading geometry at both requested widths.
    click('.wa-row:has-text("Demo client group")')
    for width in [1440,1024]:
        action('viewport',{'width':width,'height':900})
        geometry=evaluate('(()=>{const h=document.querySelector(".wa-chat-head").getBoundingClientRect(),m=document.querySelector(".wa-msgs").getBoundingClientRect(),c=document.querySelector(".wa-compose").getBoundingClientRect();return {header:h.height,top:m.top,bottom:m.bottom,composerTop:c.top,composerBottom:c.bottom,scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight};})()')
        check('long heading bounds '+str(width),geometry['header']<=60 and geometry['top']<geometry['bottom'] and geometry['bottom']<=geometry['composerTop']+1 and geometry['composerBottom']<=geometry['height'] and geometry['scroll']<=geometry['width'])
        shot('regression-long-'+str(width)+'.png')
    click('.wa-folder .wa-row')
    typein('UNKNOWN'); click('[aria-label="Send message"]')
    until('document.querySelector("[role=alert]")?.textContent.includes("uncertain")')
    check('unknown delivery locks duplicate send and retains draft',evaluate('document.querySelector("textarea").value==="UNKNOWN" && document.querySelector(".wa-send").disabled'))
    unknown_count=stats()
    action('refresh');until('document.querySelectorAll(".wa-row").length>0');click('.wa-folder .wa-row')
    until('document.querySelector("textarea")?.value==="UNKNOWN"')
    check('unknown outcome remains locked after reload',evaluate('document.querySelector(".wa-send").disabled') and stats()==unknown_count)
    shot('regression-uncertain-1024.png')
    click('#fixture-nav button:has-text("Rolodex preview")')
    until('document.querySelector(".rolodex-space")!==null')
    click('.rolodex-row')
    click('.rolodex-provenance summary')
    click('.rolodex-import-launch > button')
    until('document.querySelector(".rolodex-import > section")!==null')
    check('source-backed import preview rendered',evaluate('document.querySelectorAll("[data-import-status=new]").length===1 && document.querySelector(".rolodex-provenance").textContent.includes("source-record")'))
    shot('regression-rolodex-1024.png')
    click('[aria-label="Import Avery Fixture"]')
    click('.rolodex-import-confirm button')
    until('document.querySelector(".rolodex-import [role=status]")!==null')
    click('.rolodex-import-launch > button')
    until('document.querySelector(".rolodex-import > section")!==null')
    check('repeat import preview is unchanged',evaluate('document.querySelectorAll("[data-import-status=known]").length===1'))
    action('viewport',{'width':1440,'height':900});shot('regression-rolodex-1440.png')
finally:
    call('/tabs/'+tab,method='DELETE')
    Path('domain-base/communications/regression-ui-results.json').write_text(json.dumps(results,indent=2)+'\n')
