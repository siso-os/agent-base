// heavy -- node services/node/test/bell-ui.mjs
// Real React bell; synthetic API and native IPC adapter only. No live node, agent, or account access.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const { createServer }=createRequire(path.join(root,'apps/web/package.json'))('vite');
const shots=path.join(root,'ui-hub/bell');mkdirSync(shots,{recursive:true});
const server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),logLevel:'error',optimizeDeps:{entries:['preview/bell.html']},server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'block-live-bell-api',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/api/')||req.url?.startsWith('/term')||req.url?.startsWith('/chat/')){res.statusCode=410;res.end('Synthetic preview only');return;}next();});}}]});
await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}/preview/bell.html`;
let browser;const results=[];
const pass=name=>{results.push(name);console.log(`PASS ${name}`);};
try {
  if(!process.argv.includes('--catalogue-only')) {
  browser=await webkit.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto(url+'?before');
    await page.getByRole('button',{name:'Needs you',exact:true}).click();
    await page.locator('#agent-notifications').waitFor();
    await page.screenshot({path:path.join(shots,`before-${width}.png`)});
  }
  pass('origin/main baseline screenshots at 1440 and 390');
  await page.setViewportSize({width:1440,height:900});await page.goto(url);
  const bell=page.getByTestId('notifications-bell');
  await bell.focus();await page.keyboard.press('Enter');
  await page.getByRole('dialog',{name:'Notifications',exact:true}).waitFor();
  assert.equal(await page.locator('.an-item').count(),3);
  assert.equal(await page.locator('.an-item__identity strong').first().innerText(),'Agent Zero');
  assert.equal(await bell.locator('[data-agent]').getAttribute('data-agent'),'Agent Zero');
  assert.equal(await bell.locator('.ab-bell__count').innerText(),'3');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.getElementById('agent-notifications')?.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog',{name:'Notifications',exact:true}).count(),0);
  assert.equal(await bell.evaluate(el=>el===document.activeElement),true);
  pass('Enter opens; Tab navigates panel; Escape closes and restores bell focus; Agent Zero leads');
  await bell.click();
  const row=id=>page.locator(`[data-bell-row="activity:fixture-${id}"]`);
  await row(0).getByRole('button',{name:'Mark read',exact:true}).click();
  assert.equal(await row(0).getByRole('button',{name:'Approve once',exact:true}).isEnabled(),true);
  assert.equal(await bell.locator('.ab-bell__count').innerText(),'3');
  await page.getByRole('button',{name:'Read outcomes',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ab-bell__count')?.textContent==='2');
  pass('reading requests never resolves them; bulk read affects outcomes only');
  await row(0).getByRole('combobox').selectOption('15');
  assert.equal(await page.locator('.an-item').count(),2);
  await page.locator('[data-shelf=later]').click();
  assert.equal(await page.locator('.an-item').count(),1);
  assert.match(await page.locator('.ab-bell-later').innerText(),/Back in 15 min/);
  await page.reload();await bell.click();await page.locator('[data-shelf=later]').click();
  assert.equal(await page.locator('.an-item').count(),1);
  await row(0).getByRole('button',{name:'Bring back'}).click();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-shelf')==='later');
  await page.locator('[data-shelf=needs]').click();
  assert.equal(await page.locator('.an-item').count(),2);
  pass('snooze survives reload in Later; Bring back restores request and keeps keyboard focus');
  await row(0).getByRole('button',{name:'Approve once'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-shelf=needs][aria-pressed=true]').length&&document.querySelectorAll('.an-item').length===1);
  assert.equal(await row(1).getByRole('button',{name:'Approve once'}).isEnabled(),true);
  const commands=await page.evaluate(()=>window.bellFixture.commands);
  assert.equal(commands.length,1);assert.equal(commands[0].ref.hostInstanceId,'fixture-host-0');
  assert.equal(commands[0].ref.sessionId,'fixture-session-0');assert.equal(commands[0].expectedRevision,1);assert.equal(commands[0].action.requestId,'same-request-id');
  pass('Approve once sends exact identity/revision; same request on another agent stays pending');
  await row(1).getByRole('button',{name:'Open chat'}).click();
  assert.match(await page.getByTestId('fixture-status').innerText(),/Opened chat for Astra/);
  await bell.click();await page.locator('[data-shelf=needs]').click();assert.equal(await page.locator('.an-item').count(),1);
  pass('Open chat chooses exact agent and reading it leaves request pending');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Needs you',exact:true}).click();
  await page.evaluate(()=>window.bellFixture.setMode('uncertain'));
  await row(0).getByRole('button',{name:'Approve once'}).click();
  await page.getByRole('alert').filter({hasText:'Delivery uncertain'}).waitFor();
  assert.equal(await row(0).getByRole('button',{name:'Approve once'}).isDisabled(),true);
  await page.locator('[data-shelf=outcomes]').click();await page.locator('[data-shelf=needs]').click();
  assert.equal(await row(0).getByRole('button',{name:'Approve once'}).isDisabled(),true);
  await row(0).getByRole('combobox').selectOption('15');await page.locator('[data-shelf=later]').click();
  assert.equal(await row(0).getByRole('button',{name:'Approve once'}).isDisabled(),true);
  await page.keyboard.press('Escape');await bell.click();await page.locator('[data-shelf=later]').click();
  assert.equal(await row(0).getByRole('button',{name:'Approve once'}).isDisabled(),true);
  assert.equal((await page.evaluate(()=>window.bellFixture.commands)).length,1);
  pass('uncertain delivery stays blocked across filters, Later and bell reopen');
  const reloadPage=await browser.newPage({viewport:{width:390,height:900}});
  await reloadPage.goto(url);await reloadPage.getByTestId('notifications-bell').click();
  await reloadPage.evaluate(()=>window.bellFixture.setMode('uncertain'));
  await reloadPage.locator('[data-bell-row="activity:fixture-0"]').getByRole('button',{name:'Approve once'}).click();
  await reloadPage.getByRole('alert').filter({hasText:'Delivery uncertain'}).waitFor();
  await reloadPage.reload();await reloadPage.getByTestId('notifications-bell').click();
  assert.equal(await reloadPage.locator('[data-bell-row="activity:fixture-0"]').getByRole('button',{name:'Approve once'}).isDisabled(),true);
  assert.match(await reloadPage.getByRole('alert').innerText(),/Previous delivery is unconfirmed/);
  await reloadPage.close();
  pass('uncertain delivery remains blocked after a full page reload');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Needs you',exact:true}).click();
  await page.evaluate(()=>window.bellFixture.setMode('stale'));
  await row(0).getByRole('button',{name:'Approve once'}).click();
  await page.getByRole('alert').filter({hasText:'Request changed'}).waitFor();
  assert.equal(await row(0).getByRole('button',{name:'Approve once'}).isDisabled(),true);
  pass('stale request is refused and its approval control locks');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Snoozed',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Withdraw first request'}).click();await bell.click();
  await page.locator('[data-shelf=outcomes]').click();
  assert.match(await page.locator('.an-item').first().innerText(),/Request ended/);
  assert.equal(await page.getByRole('button',{name:'Approve once'}).count(),0);
  pass('withdrawn request moves to Outcomes without claiming approval');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Needs you',exact:true}).click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Toggle feed unavailable'}).click();await bell.click();
  assert.equal(await row(0).getByRole('button',{name:'Approve once'}).isDisabled(),true);
  pass('unavailable feed disables request commands');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for(const state of ['Nothing','Needs you','Outcomes only','Snoozed','Many (35)']) {
      await page.keyboard.press('Escape');await page.getByRole('button',{name:state,exact:true}).click();
      if(state==='Snoozed')await page.locator('[data-shelf=later]').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${state} document overflow at ${width}`);
      assert.equal(await page.locator('#agent-notifications').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${state} panel overflow at ${width}`);
      if(state==='Many (35)') {assert.equal(await page.locator('.an-item').count(),35);await page.locator('.an-item').last().scrollIntoViewIfNeeded();}
      const slug=state==='Needs you'?'':`-${state.toLowerCase().replace(/[^a-z]+/g,'-').replace(/-$/,'')}`;
      await page.screenshot({path:path.join(shots,`after${slug}-${width}.png`)});
    }
  }
  pass('all five states render at 1440 and 390; all 35 rows reachable; no horizontal overflow');
  // Exercise the real mountPage overlay detector with a synthetic IPC layer. No Tauri instance needed.
  await page.setViewportSize({width:1440,height:900});await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    window.bellNativeCalls=[];
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{window.bellNativeCalls.push({command,...args});if(command==='browser_url')return 'about:blank';if(command==='browser_audio')return false;}};
    const slot=document.createElement('div');slot.id='bell-native-slot';Object.assign(slot.style,{position:'fixed',top:'50px',left:'10px',width:'1400px',height:'830px',pointerEvents:'none'});document.body.append(slot);
    const api=await import('/src/lib/webview.ts');window.bellNativeApi=api;window.bellNativeController=api.mountPage(slot,'about:blank',()=>{},()=>{},'bell-synthetic','bell-fixture');
  });
  await page.waitForFunction(()=>window.bellNativeCalls.some(c=>c.command==='browser_open'));
  await bell.click();
  await page.waitForFunction(()=>window.bellNativeCalls.some(c=>c.command==='browser_visible'&&c.visible===false));
  assert.equal(await page.evaluate(()=>{
    const panel=document.querySelector('#agent-notifications'),box=panel.getBoundingClientRect();
    return panel.contains(document.elementFromPoint(box.left+20,box.top+20))&&Number(getComputedStyle(document.querySelector('.ab-attention-anchor')).zIndex)>Number(getComputedStyle(document.querySelector('.bell-preview__strip')).zIndex);
  }),true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.bellNativeCalls.some(c=>c.command==='browser_visible'&&c.visible===true));
  await page.evaluate(async()=>{window.bellNativeController.dispose();await window.bellNativeApi.closePage('bell-fixture');document.getElementById('bell-native-slot').remove();});
  pass('bell layers above top strip; real webview overlay detector hides/restores synthetic native page');
  assert.deepEqual(errors,[]);pass('zero browser runtime errors');
  writeFileSync(path.join(shots,'browser-results.json'),JSON.stringify({date:'2026-10-08',url,engine:'headless WebKit',scope:'Synthetic data and IPC; not native Tauri or live-agent proof',passed:results.length,results},null,2)+'\n');
  console.log(`PASS bell browser ${results.length}/${results.length}`);
  }
  if(process.argv.includes('--catalogue')||process.argv.includes('--catalogue-only')) {
    await browser?.close();browser=null;
    const tool=path.join(process.env.HOME,'SISO_Workspace/Great_Library_of_SISO/banks/siso-ui-hub/bin/uihub');
    const reports=[];
    for(const width of [1440,390]) {
      const counts=[];
      for(const baseline of [true,false]) {
        let output;
        try { output=(await promisify(execFile)(tool,['check',url+(baseline?'?before':''),'--surface','dashboard','--width',String(width),'--wait','3','--js',"document.querySelector('.bell-preview__states button:nth-child(2)').click()",'--out',path.join(shots,`catalogue-${baseline?'before':'after'}-${width}.jpg`)],{timeout:90000})).stdout; }
        catch(error) { if(error.code!==1)throw error;output=error.stdout; if(!output)console.error(String(error.stderr).slice(-1800)); }
        assert.match(output,/visible elements/,'catalogue must observe the page');
        reports.push(output);
        counts.push([...output.matchAll(/(?:FAIL|ok  |note)\s+(\d+) (.+?) \(/g)].map(m=>({name:m[2],count:Number(m[1])})));
      }
      for(const after of counts[1]) {
        const before=counts[0].find(item=>item.name===after.name);
        if(before)assert.ok(after.count<=before.count,`${width}: new catalogue finding ${after.name}: ${before.count} -> ${after.count}`);
      }
    }
    writeFileSync(path.join(shots,'catalogue-check.txt'),reports.join('\n'));
    console.log('PASS uihub dashboard audit: no new findings at 1440 and 390');
  }
} finally {await browser?.close();await server.close();console.log('CLEANUP bell browser and fixture server stopped');}
