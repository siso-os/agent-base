import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { suitePort } from './suite-runtime.mjs';
import path from 'node:path';
import { webkit } from 'playwright';
import { usageFixture } from './usage-versions-fixture.mjs';
const port=await suitePort();
const base=process.env.AB_USAGE_URL || `http://127.0.0.1:${port}`;
const server=process.env.AB_USAGE_URL ? null : spawn(process.execPath,[path.resolve('apps/web/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port)],{cwd:path.resolve('apps/web'),env:{...process.env,AB_NODE:'1'},stdio:['ignore','pipe','pipe']});
let browser;
let serverLog='';server?.stdout.on('data',chunk=>{serverLog=(serverLog+chunk).slice(-2000);});server?.stderr.on('data',chunk=>{serverLog=(serverLog+chunk).slice(-2000);});
const stop=async()=>{await browser?.close();if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');const timeout=setTimeout(()=>server.kill('SIGKILL'),3000);await exited;clearTimeout(timeout);}};
process.once('SIGTERM',()=>void stop());
process.once('SIGINT',()=>void stop());
let passed=0;
const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+name);passed++;};
try {
 if(server){let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base,{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,150));}assert.ok(ready,'isolated Vite started: '+serverLog);}
 browser=await webkit.launch({headless:true});
 const page=await browser.newPage();
 page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base)return route.abort();
  if(route.request().headers().accept?.includes('text/event-stream'))return route.fulfill({contentType:'text/event-stream',body:': synthetic fixture\n\n'});
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:usageFixture(url.pathname)});
  if(/^\/(term|chat)\//.test(url.pathname))return route.abort();
  return route.continue();
 });
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});
  await page.goto(base+'/preview/usage-versions.html');
  // Usage lane (9 Oct): the answer's login cards lead; the money band's account cards fold under "Accounts in detail".
  await page.getByTestId('usage-login').first().waitFor();
  check(width+' answer names both logins with their 5-hour reset',await page.getByTestId('usage-login').count()===2&&await page.getByTestId('usage-login').first().innerText().then(t=>/5 hours[\s\S]*resets in/.test(t)));
  await page.getByTestId('usage-accounts-detail').locator('summary').click();
  await page.getByTestId('money-account').first().waitFor();
  check(width+' four original Stats cards',await page.locator('[data-testid=stat-bar] [data-cell]').count()===4);
  check(width+' original shipping graph retained',await page.getByTestId('stats-ship').isVisible());
  check(width+' two Claude accounts',await page.getByTestId('money-account').count()===2);
  check(width+' renewal beside account',await page.getByTestId('money-account').first().innerText().then(t=>t.includes('Week renews')));
  check(width+' exhausted account visible',await page.getByTestId('money-account').nth(1).innerText().then(t=>t.includes('100%')));
  await page.getByRole('button',{name:'Today spend: open supplied snapshot'}).click();
  await page.getByRole('combobox').selectOption('Fixture project');
  check(width+' project selection preserves Today total',await page.getByTestId('spend-total').innerText().then(t=>t.includes('$42.50')));
  await page.getByRole('button',{name:'attribution stale',exact:true}).click();
  // The dial is a Peek now (rail peek, t-0501): the fixture control sits outside it, so clicking it closes the peek. Reopen.
  if(!await page.getByTestId('spend-total').isVisible())await page.getByRole('button',{name:'Today spend: open supplied snapshot'}).click();
  check(width+' stale attribution retains headline',await page.getByTestId('spend-total').innerText().then(t=>t.includes('$42.50')));
  check(width+' stale attribution labelled',await page.getByText('Last known snapshot. Current attribution is unverified.').isVisible());
  await page.getByRole('combobox').focus();
  await page.keyboard.press('Escape');
  await page.locator('.td-panel').waitFor({state:'detached'});
  check(width+' spend Escape returns focus',await page.getByRole('button',{name:'Today spend: open supplied snapshot'}).evaluate(el=>el===document.activeElement));
  await page.screenshot({path:'ui-hub/tokens/after-usage-'+width+'.png',fullPage:true});
  await page.getByTestId('money-account').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:'ui-hub/tokens/after-accounts-'+width+'.png',fullPage:true});
  const versions=page.getByRole('button',{name:'Versions',exact:true});
  await versions.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Versions',exact:true});
  await dialog.waitFor();
  check(width+' source preview live all show',await dialog.locator('.usage-version-steps li').count()===3);
  check(width+' updated web distinct from node',await dialog.innerText().then(t=>t.includes('bbbbbbbb')&&t.includes('cccccccc')));
  check(width+' above top strip and webview overlay contract',await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return el.getAttribute('role')==='dialog'&&el.matches(':modal')&&el.contains(document.elementFromPoint(r.left+r.width/2,r.top+20));}));
  await page.keyboard.press('Tab');
  check(width+' Tab remains within modal',await dialog.evaluate(el=>el.contains(document.activeElement)));
  await page.screenshot({path:'ui-hub/tokens/after-versions-'+width+'.png',fullPage:true});
  await page.keyboard.press('Escape');
  check(width+' Versions Escape restores trigger focus',await versions.evaluate(el=>el===document.activeElement));
  check(width+' no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.usage-page').scrollWidth<=document.querySelector('.usage-page').clientWidth));
 }
 for(const state of ['update available','update applying','version unknown','no recording']) {
  await page.getByRole('button',{name:state,exact:true}).click();
  if(state==='update applying')check('three sequenced applying lights',await page.locator('.usage-version-steps li').evaluateAll(es=>es.map(e=>getComputedStyle(e).animationDelay).join(',')==='0s,0.35s,0.7s'));
  if(state==='version unknown')check('unknown evidence explicit',await page.locator('.usage-version-steps').innerText().then(t=>(t.match(/Unknown/g)||[]).length===3));
  if(state==='no recording')check('no recording does not invent events',await page.getByText('Session recording unavailable: no session selected.').isVisible());
 }
 await page.getByRole('button',{name:'update applying',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});
 check('reduced motion stops sequential animation',await page.locator('.usage-version-steps li').first().evaluate(el=>getComputedStyle(el).animationName==='none'));
 await page.getByTestId('provider-usage').focus();await page.keyboard.press('Enter');
 check('bottom usage orb links to Usage',await page.evaluate(()=>JSON.parse(decodeURIComponent(location.hash.slice(4))).s==='tokens'));
 // Both legacy routes exercise the actual app and the same Usage page. Every API is synthetic.
 for(const at of [{s:'tokens',v:{kind:'chat'},a:null,o:null},{s:'agents',v:{kind:'tab',id:'stats'},a:null,o:null}]) {
  await page.goto(base+'/#at='+encodeURIComponent(JSON.stringify(at)));
  await page.getByTestId('usage-page').waitFor({timeout:20000});
  check(at.s+' route opens Usage',await page.getByRole('heading',{name:'Usage',exact:true}).isVisible());
 }
 check('no browser exceptions: '+JSON.stringify(errors),errors.length===0);
 console.log(`PASS usage-versions: ${passed} checks`);
} finally {await stop();}
