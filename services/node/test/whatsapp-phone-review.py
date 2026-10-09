#!/usr/bin/env python3
"""Final 390px interaction probe against the isolated COMMS_REVIEW_FIXTURE server only."""
import json, urllib.request, urllib.parse, time
from pathlib import Path
base='http://localhost:9377'
identity={'userId':'codex-comms-phone','sessionKey':str(time.time_ns())}
def request(route, data=None, method=None):
    r=urllib.request.Request(base+route+('?' + urllib.parse.urlencode(identity) if data is None else ''), data=None if data is None else json.dumps(identity|data).encode(), headers={'Content-Type':'application/json'}, method=method)
    with urllib.request.urlopen(r,timeout=40) as f:return json.load(f)
tab=request('/tabs',{'url':'http://127.0.0.1:5498/ui-hub/whatsapp/preview.html'})['tabId']
def action(verb,data={}):return request('/tabs/'+tab+'/'+verb,data)
def evaluate(expression):return action('evaluate',{'expression':expression}).get('result')
def until(expression):
    for _ in range(50):
        if evaluate(expression):return
        time.sleep(.1)
    raise AssertionError(expression)
def click(selector):
    request('/tabs/'+tab+'/snapshot')
    action('click',{'selector':selector})
def shot(name):
    with urllib.request.urlopen(base+'/tabs/'+tab+'/screenshot?'+urllib.parse.urlencode(identity)) as f:Path('domain-base/communications/'+name).write_bytes(f.read())
try:
    action('viewport',{'width':390,'height':844})
    until('document.querySelector(".wa-saved-nav")')
    click('.wa-saved-nav > button')
    click('.wa-saved-list > div:first-child .wa-saved-link')
    until('document.querySelector(".is-highlighted .wa-msg")?.dataset.id==="fixture-old"')
    click('#fixture-nav button:has-text("Rolodex preview")')
    until('document.querySelector(".rolodex-import-launch")')
    click('.rolodex-import-launch > button')
    until('document.querySelectorAll(".rolodex-import-record").length===28')
    action('type',{'selector':'[aria-label="Find contact to review"]','text':'Avery Fixture','clear':True})
    until('document.querySelectorAll(".rolodex-import-record").length===1')
    click('.rolodex-import-record summary')
    click('.rolodex-import-tools button:has-text("Select shown changes")')
    assert evaluate('document.querySelector(".rolodex-import-confirm").textContent.includes("1 selected")')
    assert evaluate('document.querySelector(".rolodex-import-confirm button").getBoundingClientRect().bottom<=innerHeight')
    shot('current-rolodex-selected-390.png')
    click('.rolodex-import-confirm button')
    until('document.querySelector(".rolodex-import-result")?.textContent.includes("1 contact imported")')
    shot('current-rolodex-success-390.png')
    click('.rolodex-import-result button')
    until('document.querySelector(".rolodex-import-result")?.textContent.includes("undone")')
    receipt={'width':390,'height':844,'savedHistoryNavigation':True,'visibleFilteredSelection':True,'reachableConfirmation':True,'subsetImport':True,'undo':True,'syntheticOnly':True}
    Path('domain-base/communications/phone-interaction.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))
finally:
    request('/tabs/'+tab,method='DELETE')
