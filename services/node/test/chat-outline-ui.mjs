import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { webkit, suitePort } from './suite-runtime.mjs';
const root=path.resolve(import.meta.dirname,'../../..'), require=createRequire(path.join(root,'apps/web/package.json'));
const {createServer}=require('vite'), port=await suitePort(), before=process.argv.includes('--before');
const baseline=before ? execFileSync('git',['show','ae558eaeb6984c1d159baa51b8eacc34780ada08:apps/web/src/components/ChatView.tsx'],{cwd:root,encoding:'utf8'}) : null;
const server=await createServer({root:path.join(root,'apps/web'),configFile:false,plugins:[...(before?[{name:'baseline-chat',enforce:'pre',load(id){if(id===path.join(root,'apps/web/src/components/ChatView.tsx'))return baseline;}}]:[]),require('@vitejs/plugin-react').default(),require('@tailwindcss/vite').default()],resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:['preview/chat-outline.html']},server:{host:'127.0.0.1',port,strictPort:true}});
let browser;
const promptCount=page=>page.evaluate(()=>window.fixture.sent.filter(m=>m.t==='prompt').length);
async function openPage(width) {
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**/api/**',r=>r.fulfill({json:{agents:[],tasks:[],groups:[],projects:[],workspaces:[]}}));
  await page.goto(`http://127.0.0.1:${port}/preview/chat-outline.html`,{waitUntil:'networkidle'});
  await page.getByTestId('chat-view').waitFor(); await page.waitForFunction(()=>document.querySelector('[data-connected="1"]'));
  return page;
}
async function search(page,text) {
  await page.keyboard.press('Meta+f'); const input=page.getByRole('textbox',{name:'Find in chat'}); await input.fill(text);
  await page.waitForFunction(()=>!document.querySelector('[role="search"]')?.textContent.includes('Searching older'));
  await page.waitForTimeout(160); return input;
}
try {
 await server.listen(); browser=await webkit.launch({headless:true});
 for(const width of [1440,390]) {
  const page=await openPage(width), errors=[];page.on('pageerror',e=>errors.push(e.message));
  const box=page.locator('textarea').first();await box.fill('Keep this draft while the connection recovers.');
  await page.evaluate(()=>window.fixture.start());await page.getByText('The first part has arrived.',{exact:false}).first().waitFor();
  await page.evaluate(()=>window.fixture.drop());
  if(!before) {
   await page.getByTestId('received-marker').waitFor();await page.getByTestId('recovery-strip').waitFor();
   assert.match(await page.getByTestId('recovery-strip').innerText(),/reconnecting/);
   const marker=page.getByTestId('received-marker');assert.equal(await marker.locator('..').getByRole('button',{name:'Copy reply',exact:true}).count(),0);
  }
  await page.screenshot({path:path.join(root,`ui-hub/chat/outline-${before?'before':'recovery'}-20261008-${width}.png`),fullPage:true});
  if(before) {await page.close();continue;}
  await page.getByRole('button',{name:'Ask it to continue',exact:true}).waitFor();
  await page.getByRole('button',{name:'Ask it to continue',exact:true}).click();assert.equal(await box.inputValue(),'Keep this draft while the connection recovers.');assert.equal(await promptCount(page),0);
  await box.fill('');await page.getByRole('button',{name:'Ask it to continue',exact:true}).click();assert.equal(await box.inputValue(),'continue from where you stopped');assert.equal(await promptCount(page),0);
  await box.fill('Check my delivery');await box.press('Enter');await page.getByText('Delivery not known',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),0);
  await page.evaluate(()=>window.fixture.drop());await page.waitForTimeout(1700);assert.equal(await promptCount(page),1,'reconnection never resends');
  await page.evaluate(()=>window.fixture.receipt('failed'));await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  await page.evaluate(()=>window.fixture.receipt('accepted'));await page.getByRole('button',{name:'Retry',exact:true}).waitFor({state:'hidden'});
  await page.evaluate(()=>window.fixture.complete());await page.getByTestId('received-marker').waitFor({state:'hidden'});
  await page.getByTestId('recovery-strip').waitFor({state:'hidden',timeout:12_000});
  await box.focus();let input=await search(page,'older archive needle');
  await page.getByRole('search').getByText('1 of 1',{exact:true}).waitFor();assert.ok(await page.locator('.chat-outline-row').count()<=12,'outline is virtualised');
  await input.press('Escape');assert.equal(await box.evaluate(el=>el===document.activeElement),true,'Esc returns composer focus');
  await box.fill('/');assert.equal(await page.getByRole('textbox',{name:'Find in chat'}).count(),0,'composer slash stays in composer');await box.fill('');
  await page.getByLabel('Conversation thread',{exact:true}).focus();await page.keyboard.press('/');await page.getByRole('textbox',{name:'Find in chat'}).waitFor();
  input=page.getByRole('textbox',{name:'Find in chat'});await input.fill('folded tool needle');await page.getByRole('search').getByText('1 of 1',{exact:true}).waitFor();
  await page.locator('.ca-output').filter({hasText:'folded tool needle'}).waitFor();
  await input.fill('deep code needle');await page.getByRole('search').getByText('1 of 1',{exact:true}).waitFor();
  await page.waitForTimeout(160);
  const highlighted=await page.evaluate(()=>{
    const highlight=CSS.highlights?.get('chat-find-current');const range=highlight?.values().next().value;
    if(!range)return null;const r=range.getBoundingClientRect();return {text:range.toString(),top:r.top,bottom:r.bottom};
  });
  assert.equal(highlighted?.text,'deep code needle');assert.ok(highlighted.top>60&&highlighted.bottom<1000,'exact code match is visible');
  const top=await page.locator('.siso-chat__list').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>window.fixture.start());await page.waitForTimeout(150);assert.ok(Math.abs(await page.locator('.siso-chat__list').evaluate(el=>el.scrollTop)-top)<5,'new reply does not yank find');
  await input.fill('ship queue');await page.getByRole('search').getByText('1 of 15',{exact:true}).waitFor();await input.press('Enter');await page.getByRole('search').getByText('2 of 15',{exact:true}).waitFor();await input.press('Shift+Enter');await page.getByRole('search').getByText('1 of 15',{exact:true}).waitFor();
  await page.screenshot({path:path.join(root,`ui-hub/chat/outline-find-20261008-${width}.png`),fullPage:true});
  await input.press('Escape');const toggle=page.getByRole('button',{name:/^Outline /});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  const row=page.locator('.chat-outline-row').first();await row.focus();await row.press('Enter');await page.waitForTimeout(50);assert.ok(await page.locator('.siso-chat__turn.is-jump').count()>0,'outline click flashes answer');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');assert.deepEqual(errors,[]);
  console.log(`PASS ${width}: recovery, exact receipts, no resend, find older/folded/code, focus, outline and no overflow`);await page.close();
 }
 if(!before) {
  const a=await openPage(1440),b=await openPage(1440);await a.evaluate(()=>window.fixture.start());await a.waitForTimeout(80);await a.evaluate(()=>{window.fixture.setMode('changed');window.fixture.drop();});
  await a.getByText('This is a new session · earlier messages are history',{exact:true}).waitFor();assert.equal(await b.getByTestId('recovery-strip').count(),0);await a.getByTestId('new-session-boundary').waitFor();
  await b.evaluate(()=>window.fixture.delayOlder(true));await b.keyboard.press('Meta+f');await b.getByRole('textbox',{name:'Find in chat'}).fill('missing old text');await b.getByText('Couldn’t search older turns.',{exact:false}).waitFor({timeout:10_000});
  console.log('PASS independent windows, changed session and explicit older-search failure');await a.close();await b.close();
 }
} finally {await browser?.close();await server.close();}
