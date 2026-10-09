"""Synthetic browser review: route every API request locally; never contact fleet hosts."""
import asyncio, json, os, socket, subprocess
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.agents/scratchpads/landing-20261006'
PATCH = '@@ -1,3 +1,3 @@\n const title = "Review";\n-old validation\n+new validation\n return title;\n'
FILE = dict(id='file-one',oldPath='src/review.ts',newPath='src/review.ts',oldBlobOid='a',newBlobOid='b',oldMode='100644',newMode='100644',change='modified',additions=1,deletions=1,content='available',untracked=False)
BINARY = {**FILE,'id':'file-binary','oldPath':None,'newPath':'assets/preview.png','content':'binary','change':'added','additions':None,'deletions':None}
ROWS = [dict(kind='context',oldLine=1,newLine=1,text='const title = "Review";'),dict(kind='deleted',oldLine=2,newLine=None,text='old validation'),dict(kind='added',oldLine=None,newLine=2,text='new validation'),dict(kind='context',oldLine=3,newLine=3,text='return title;')]
async def main():
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    server=subprocess.Popen(['pnpm','--filter','@agent-base/web','exec','vite','--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT,env={**os.environ,'AB_NODE':'9'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    checks=[];comments=[];posts=[];batches={};state={'revision':'revision-1','status':'queued','failure':None,'delay':False,'turnsMode':'valid'};console=[]
    def check(name, value):
        assert value,name
        checks.append(name);print('PASS',name,flush=True)
    async with async_playwright() as p:
      browser=None
      try:
        browser=await p.chromium.launch(headless=True,channel='chrome')
        page=await browser.new_page(viewport={'width':1440,'height':1000})
        page.on('pageerror',lambda e:console.append(str(e)))
        async def route(req):
            from urllib.parse import urlparse,parse_qs
            u=urlparse(req.request.url);q=parse_qs(u.query);path=u.path;session=q.get('sessionId',['fixture-session'])[0]
            data=req.request.post_data_json if req.request.method=='POST' else None
            def error(code,detail):return {'error':{'code':code,'detail':detail,'retryable':False}}
            result=None;status=200
            if session=='successor-session':result=error('stale-recipient','No captured source for this successor');status=409
            elif path.endswith('/turns'):
                mode=state['turnsMode']
                identity=dict(reviewKey='other-worktree' if mode=='wrong-key' else 'review-key',machineId='fixture',worktreeId='fixture-worktree',sessionId='other-session' if mode=='wrong-session' else session,agentKey='fixture-agent',readOnly=False)
                options=[{'id':'turn-1','label':'Turn 1 · captured edits','available':True},{'id':'missing-turn','label':'Turn 2 · completion not captured','available':False}]
                result={'identity':identity,'turns':[] if mode=='empty' else options[1:] if mode=='incomplete' else options}
                if mode=='unavailable':result=error('store-unavailable','Turn store cannot be read');status=409
                if mode=='delay':await asyncio.sleep(.6)
            elif path.endswith('/changes'):
                scope=q.get('scope',['workspace'])[0];turn=q.get('turnId',[''])[0]
                if turn=='missing-turn':result=error('snapshot-unavailable','Turn boundary was not captured');status=409
                else:
                    rev='revision-turn' if scope=='turn' else state['revision']
                    if state['delay'] and scope=='committed':await asyncio.sleep(.5)
                    identity=dict(reviewKey='review-key',machineId='fixture',worktreeId='fixture-worktree',sessionId=session,agentKey='fixture-agent',readOnly=False)
                    result=dict(identity=identity,revision=dict(id=rev,scope={'kind':scope,**({'turnId':turn} if scope=='turn' else {})},baseOid='a',headOid='b',treeOid='c',targetOid='a',capturedAt='2026-10-06T00:00:00Z'),files=[FILE,BINARY],patch=PATCH,truncated=True,sourceComplete=False,limits=dict(previewBytes=10000,fileBytes=10000,hunkBytes=10000,feedbackBytes=49000))
            elif '/files/' in path:
                f=BINARY if path.endswith('file-binary') else FILE
                result=dict(revisionId=q['revisionId'][0],file=f,patch=PATCH,hunks=[] if f['content']=='binary' else [dict(oldStart=1,oldCount=3,newStart=1,newCount=3,rows=ROWS)],oldText='old',newText='new')
            elif path.endswith('/comments') and data:
                c={**data,'id':'comment-'+str(len(comments)+1),'oldPath':FILE['oldPath'],'newPath':FILE['newPath'],'end':data['start'],'contentHash':'fixture-hash','oldRange':{'start':2,'count':1},'newRange':{'start':1,'count':0},'capturedHunk':PATCH,'createdAt':'2026-10-06T00:00:00Z','updatedAt':'2026-10-06T00:00:00Z','state':'draft','anchor':{'revisionId':data['revisionId'],'fileId':data['fileId'],'start':data['start'],'end':data['start']}}
                comments.append(c);result=c
            elif path.endswith('/comments'):result={'comments':comments}
            elif path.endswith('/resolve'):
                c=next(c for c in comments if c['id']==path.split('/')[-2]);c['state']='resolved';result=c
            elif path.endswith('/feedback'):
                posts.append(data)
                if state['failure']=='transport':
                    state['failure']=None
                    batches[data['clientKey']]={'batchId':'batch-'+str(len(posts)),'clientKey':data['clientKey'],'sessionId':session,'status':'uncertain'}
                    await req.abort();return
                if state['failure']=='reject':result=error('unstable-source','Refresh changes before sending feedback');status=409;state['failure']=None
                else:
                    result=batches.get(data['clientKey']) or dict(batchId='batch-'+str(len(posts)),clientKey=data['clientKey'],sessionId=session,status=state['status'])
                    batches[data['clientKey']]=result
                    if result['status'] in ['queued','submitted']:
                        for c in comments:
                            if c['id'] in data['commentIds']:c['state']='sent'
            elif '/feedback/' in path:
                key=path.split('/')[-1];result=batches.get(key) or error('invalid-input','Unknown feedback key')
                if key in batches and state['status']=='submitted':
                    result['status']='submitted'
                    for c in comments:
                        if c['state']=='draft' and c['id'] in next((x['commentIds'] for x in posts if x['clientKey']==key),[]):c['state']='sent'
            else:result=error('invalid-input','Unexpected fixture request');status=400
            await req.fulfill(status=status,content_type='application/json',body=json.dumps(result))
        await page.route('**/api/**',route)
        for _ in range(100):
            try:
                await page.goto(f'http://127.0.0.1:{port}/preview/changes-panel.html');break
            except Exception:await asyncio.sleep(.1)
        await page.get_by_role('button',name='Comment on old line 2').wait_for()
        check('inventory and honest omission notices',await page.get_by_text('2 changed files').count()==1 and await page.get_by_text('Source is incomplete;',exact=False).count()==1)
        await page.screenshot(path=str(OUT/'changes-panel-1440.png'))
        await page.get_by_role('button',name='Comment on old line 2').click()
        literal='<img src=x onerror=alert(1)> Keep the old validation ```'
        await page.get_by_role('textbox',name='Line comment').fill(literal)
        await page.get_by_role('button',name='Comment on old line 2').click()
        check('reselecting current line preserves typed text',await page.get_by_role('textbox',name='Line comment').input_value()==literal)
        await page.reload();await page.get_by_role('textbox',name='Line comment').wait_for()
        check('unfinished exact-line text survives reload',await page.get_by_role('textbox',name='Line comment').input_value()==literal)
        await page.get_by_role('button',name='Save comment',exact=True).click()
        await page.get_by_text(literal,exact=True).wait_for()
        check('old-side capture and no implicit feedback',comments[0]['start']=={'side':'old','line':2} and not posts)
        check('untrusted comment remains escaped text',await page.locator('.changes-comment img').count()==0)
        await page.reload();await page.get_by_text(literal,exact=True).wait_for()
        check('saved durable comment restored',await page.locator('.changes-comment').count()==1)
        await page.locator('.changes-send-button').evaluate('(b)=>{b.click();b.click();}')
        await page.get_by_text('Queued at the host',exact=True).wait_for()
        check('double click sends one batch with IDs only',len(posts)==1 and posts[0]['commentIds']==['comment-1'] and 'capturedHunk' not in posts[0])
        state['status']='submitted'
        await page.get_by_role('button',name='Check delivery',exact=True).click()
        await page.get_by_text('Submitted to the agent',exact=True).wait_for()
        check('queued reconciles to accepted, not work complete',await page.get_by_text('The host accepted the feedback. Work is not yet verified.').count()==1)
        await page.get_by_role('button',name='Comment on new line 2').click();await page.get_by_role('textbox',name='Line comment').fill('New-side draft retained after rejection')
        await page.get_by_role('button',name='Save comment',exact=True).click();await page.get_by_text('New-side draft retained after rejection',exact=True).wait_for()
        state['failure']='reject';await page.locator('.changes-send-button').click();await page.get_by_role('alert').filter(has_text='unstable-source').wait_for()
        check('structured failure keeps saved drafts',comments[1]['state']=='draft' and await page.locator('.changes-send-button').is_enabled())
        state['status']='failed';await page.locator('.changes-send-button').click();await page.get_by_text('Feedback failed',exact=True).wait_for()
        check('failed host receipt retains draft for deliberate retry',comments[1]['state']=='draft')
        await page.get_by_role('button',name='Prepare a new send',exact=True).click()
        state['failure']='transport';await page.locator('.changes-send-button').click();await page.get_by_text('Delivery unconfirmed',exact=True).wait_for()
        key=posts[-1]['clientKey'];await page.reload();await page.get_by_text('Delivery unconfirmed',exact=True).wait_for()
        check('unconfirmed outbox survives reload and blocks duplicate send',await page.locator('.changes-send-button').is_disabled())
        state['status']='uncertain';await page.get_by_role('button',name='Retry same batch',exact=True).click()
        await page.get_by_role('button',name='Check delivery',exact=True).wait_for()
        check('explicit retry retains original key',posts[-1]['clientKey']==key)
        state['status']='submitted';await page.get_by_role('button',name='Check delivery',exact=True).click();await page.get_by_text('Submitted to the agent',exact=True).wait_for()
        await page.get_by_role('combobox',name='Review scope').select_option('turn');await page.get_by_role('button',name='Comment on old line 2').wait_for()
        check('per-turn capture requested',await page.get_by_role('combobox',name='Captured turn').input_value()=='turn-1')
        await page.get_by_role('combobox',name='Captured turn').select_option('missing-turn');await page.get_by_role('alert').filter(has_text='snapshot-unavailable').wait_for()
        check('missing turn fails explicitly',await page.locator('.changes-diff').count()==0)
        await page.get_by_role('combobox',name='Review scope').select_option('workspace');await page.get_by_role('button',name='Comment on old line 2').wait_for()
        await page.get_by_role('button',name='assets/preview.png',exact=False).click();await page.get_by_text('binary content.',exact=False).wait_for()
        check('binary inventory disables inline comments',await page.get_by_role('button',name='Comment on old line 2').count()==0)
        await page.get_by_role('button',name='src/review.ts modified',exact=False).click();await page.get_by_role('button',name='Comment on old line 2').wait_for()
        await page.get_by_role('button',name='Comment on old line 2').click();await page.get_by_role('textbox',name='Line comment').fill('Earlier revision draft')
        state['revision']='revision-2';comments[0]['state']='obsolete';comments[0]['anchor']=None
        await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_text('This text belongs to an earlier snapshot.',exact=False).wait_for()
        check('refresh never silently reattaches unfinished draft',await page.get_by_role('button',name='Save comment',exact=True).is_disabled())
        check('obsolete captured comment kept for inspection',await page.get_by_text('Anchor no longer matches.',exact=False).count()==1)
        await page.get_by_role('button',name='Discard text',exact=True).click()
        state['delay']=True
        await page.get_by_role('combobox',name='Review scope').select_option('committed');await page.get_by_role('combobox',name='Review scope').select_option('turn')
        await page.wait_for_timeout(650)
        check('late scope response cannot replace current capture',await page.get_by_role('combobox',name='Review scope').input_value()=='turn' and await page.get_by_role('combobox',name='Captured turn').input_value()=='turn-1' and await page.get_by_role('button',name='Comment on old line 2').count()==1)
        await page.get_by_role('combobox',name='Review scope').select_option('workspace');await page.get_by_role('button',name='Comment on old line 2').wait_for()
        await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'changes-panel-390.png'),full_page=True)
        check('390px panel has no page overflow',await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        await page.get_by_role('button',name='Switch fixture session').click();await page.get_by_role('alert').filter(has_text='stale-recipient').wait_for()
        check('successor cannot inherit old session comments or outbox',await page.locator('.changes-comment').count()==0 and await page.locator('.changes-receipt').count()==0)
        await page.get_by_role('button',name='Switch fixture session').click();await page.get_by_role('button',name='Comment on new line 2').wait_for()
        await page.get_by_role('button',name='Comment on new line 2').click();await page.get_by_role('textbox',name='Line comment').fill('Storage failure preserves unsent feedback')
        await page.get_by_role('button',name='Save comment',exact=True).click();await page.get_by_text('Storage failure preserves unsent feedback',exact=True).wait_for()
        before=len(posts);await page.evaluate("() => { window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('fixture quota')}; }")
        await page.locator('.changes-send-button').click();await page.get_by_role('alert').filter(has_text='Feedback was not sent').wait_for()
        check('storage failure prevents sending and never invents unconfirmed receipt',len(posts)==before and await page.get_by_text('Delivery unconfirmed',exact=True).count()==0)
        await page.evaluate('() => { Storage.prototype.setItem=window.originalSetItem; }')
        state['turnsMode']='valid';await page.goto(f'http://127.0.0.1:{port}/preview/changes-panel.html?turnApi=1');await page.get_by_role('button',name='Comment on old line 2').wait_for()
        await page.get_by_role('combobox',name='Review scope').select_option('turn');await page.get_by_role('combobox',name='Captured turn').select_option('turn-1')
        check('same-session API turn picker uses safe labels and disables incomplete captures',await page.locator('select[aria-label="Captured turn"] option[value="missing-turn"]').is_disabled() and await page.get_by_role('textbox',name='Turn ID').count()==0)
        state['turnsMode']='empty';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_text('No turn captures are recorded',exact=False).wait_for()
        check('empty inventory has useful disabled picker',await page.get_by_role('combobox',name='Captured turn').is_disabled() and await page.locator('.changes-diff').count()==0)
        state['turnsMode']='incomplete';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_text('No turn has both',exact=False).wait_for()
        check('incomplete-only inventory is explicit',await page.get_by_role('combobox',name='Captured turn').is_disabled())
        state['turnsMode']='unavailable';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_role('alert').filter(has_text='Turn store cannot be read').wait_for()
        check('unavailable inventory shows typed error',await page.get_by_role('combobox',name='Captured turn').is_disabled())
        state['turnsMode']='wrong-session';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_role('alert').filter(has_text='Turn list belongs to a different session').wait_for()
        check('mismatched session inventory rejected',await page.get_by_role('combobox',name='Captured turn').is_disabled())
        state['turnsMode']='wrong-key';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_role('alert').filter(has_text='Turn list no longer matches').wait_for()
        check('same-session wrong-worktree inventory rejected',await page.get_by_role('combobox',name='Captured turn').is_disabled())
        state['turnsMode']='valid';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_role('button',name='Comment on old line 2').wait_for()
        await page.screenshot(path=str(OUT/'changes-turn-picker-390.png'))
        state['turnsMode']='delay';await page.get_by_role('button',name='Refresh',exact=True).click();await page.get_by_role('button',name='Switch fixture session').click();await page.wait_for_timeout(800)
        await page.get_by_role('combobox',name='Review scope').select_option('turn')
        check('late turn list never crosses successor session',await page.get_by_role('combobox',name='Captured turn').is_disabled() and await page.locator('select[aria-label="Captured turn"] option[value="turn-1"]').count()==0)
        check('no browser runtime errors',not console)
        (OUT/'changes-panel-browser-receipt.json').write_text(json.dumps({'checks':checks,'count':len(checks),'feedback_requests':len(posts),'live_agent_requests':0,'console_errors':console,'screenshots':['changes-panel-1440.png','changes-panel-390.png','changes-turn-picker-390.png']},indent=2))
      finally:
        try:
            os.killpg(server.pid,15);server.wait(timeout=10)
        finally:
            if browser:await browser.close()
asyncio.run(main())
