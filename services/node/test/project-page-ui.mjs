import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { webkit, suitePort } from './suite-runtime.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const { createServer } = require('vite');
const port = await suitePort();
const before = process.argv.includes('--before');
const server = await createServer({ root: path.join(root,'apps/web'), configFile:false,
 plugins:[require('@vitejs/plugin-react').default(),require('@tailwindcss/vite').default()],
 resolve:{dedupe:['react','react-dom']}, optimizeDeps:{entries:[`preview/${before?'project-dashboard':'project-page'}.html`]},
 server: { host:'127.0.0.1', port, strictPort:true } });
let browser;
try {
 await server.listen(); browser = await webkit.launch({headless:true});
 for (const width of [1440,390]) {
  const page = await browser.newPage({viewport:{width,height:1000}});
  await page.addInitScript(()=>{Object.defineProperty(window,'EventSource',{value:undefined});});
  await page.route('**/api/**', r => {
   const pathname=new URL(r.request().url()).pathname;
   if(pathname.startsWith('/api/org/project/')) {
    const id=decodeURIComponent(pathname.split('/').at(-1));
    return r.fulfill({json:{id,name:id,group:'labs',shown:true,order:0,owners:[]}});
   }
   if(pathname==='/api/a0/tasks')return r.fulfill({json:{tasks:[],counts:{},updated:'2026-10-08T02:00:00Z'}});
   if(pathname.startsWith('/api/spaces/'))return r.fulfill({json:{agents:[]}});
   if(pathname.endsWith('/working-brief'))return r.fulfill({json:{state:'available',source:'.agents/HANDOFF.md',updated:'2026-10-08T02:00:00Z',heading:'Synthetic route commitment',text:'Check the project route.',truncated:false}});
   return r.fulfill({json:{}});
  });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/preview/${before?'project-dashboard':'project-page'}.html`,{waitUntil:'networkidle'});
  await page.locator(before?'[data-testid=project-dashboard]':'[data-testid=project-page]').waitFor();
  if (!before) {
   await page.getByRole('tab',{name:'Tasks',exact:true}).click();
   await page.getByRole('button',{name:/STUDIO-BUILD/}).click();
   assert.equal(await page.locator('[data-task=demo-2]').count(),0,'executor filter');
   await page.getByRole('button',{name:'All work',exact:true}).click();
   assert.equal(await page.locator('[data-task=demo-2]').count(),1);
   await page.locator('[data-task=demo-1] summary').click();
   assert.equal(await page.locator('[data-task=demo-1] [data-task-step]').count(),40,'all forty steps retained');
   await page.locator('[data-task=demo-1] summary').click();
   const task=page.locator('[data-task=demo-1] .pp-task-main > button');
   await page.evaluate(async()=>{
    const {mountPage,closePage}=await import('/src/lib/webview.ts');
    window.fixtureCalls=[];
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{window.fixtureCalls.push({command,...args});if(command==='browser_url')return '';if(command==='browser_audio')return false;}};
    const slot=document.createElement('div');slot.id='fixture-webview';slot.style.cssText='position:fixed;left:0;top:0;width:100px;height:100px;pointer-events:none';document.body.append(slot);
    const controller=mountPage(slot,'https://fixture.invalid/',()=>{},()=>{},'fixture-profile','fixture-page');
    window.disposeFixture=async()=>{controller.dispose();await closePage('fixture-page');slot.remove();delete window.__TAURI_INTERNALS__;};
   });
   await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.command==='browser_open'));
   await task.focus(); await page.keyboard.press('Enter');
   await page.getByRole('dialog').waitFor({state:'visible'});
   await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.command==='browser_visible'&&c.visible===false));
   await page.evaluate(()=>{const strip=document.createElement('div');strip.id='fake-top-strip';strip.style.cssText='position:fixed;inset:0;z-index:2147483647;background:transparent;pointer-events:none';document.body.append(strip);});
   assert.ok(await page.getByRole('dialog').evaluate(d=>{const r=d.getBoundingClientRect();return d.contains(document.elementFromPoint(r.x+r.width/2,r.y+40));}),'dialog above strip');
   assert.equal(await page.locator('[role=dialog]').evaluate(d=>d.getClientRects().length>0),true,'native webview overlay selector sees the dialog');
   await page.keyboard.press('Tab');
   assert.ok(await page.getByRole('dialog').evaluate(d=>d.contains(document.activeElement)),'modal traps focus');
   await page.keyboard.press('Escape');
   assert.equal(await task.evaluate(b=>b===document.activeElement),true,'focus returns');
   await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.command==='browser_visible'&&c.visible===true));
   await page.evaluate(()=>window.disposeFixture());
   await page.evaluate(()=>document.getElementById('fake-top-strip')?.remove());
   await page.getByRole('tab',{name:'Tasks',exact:true}).focus(); await page.keyboard.press('ArrowRight');
   assert.equal(await page.getByRole('tab',{name:'Momentum',exact:true}).getAttribute('aria-selected'),'true');
   await page.getByRole('tab',{name:'Overview',exact:true}).click();
   for (const state of ['calm','offline','unreadable','empty','stale','client','industry']) {
    await page.getByLabel('Synthetic state').selectOption(state);
    const body=await page.locator('[data-testid=project-page]').innerText();
    assert.ok(body.includes(({calm:'0 working',offline:'Owner offline',unreadable:'Task source unreadable',empty:'No tasks recorded',stale:'Task refresh failed',client:'What we built',industry:'Clients in it'})[state]),state);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${state} overflow`);
   }
   await page.getByLabel('Synthetic state').selectOption('busy');
  }
  await page.screenshot({path:path.join(root,`ui-hub/dashboard/project-page-${before?'before':'after'}-20261008-${width}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
  assert.deepEqual(errors,[]);
  if (!before) for (const id of ['halo','agent-base','estate','kikas','fahmy','industry:ofm']) {
   await page.goto(`http://127.0.0.1:${port}/preview/project-page.html?route=${encodeURIComponent(id)}`);
   // t-0567: Agent Base's page is its task board, with AGENT-BASE's sprint line in place of the working brief.
   await (id==='agent-base' ? page.locator('[data-testid=entity-page] [data-testid=sprint-line]') : page.getByRole('heading',{name:'Synthetic route commitment'})).waitFor();
   assert.equal(await page.locator('[data-testid=entity-page]').count(),1,`${id} uses one EntityPage`);
   assert.equal(await page.locator('h1').count(),1,`${id} has one project heading`);
   await page.getByRole('tab',{name:'Tasks',exact:true}).click();
   await (id==='agent-base' ? page.getByTestId('task-board') : page.getByText('No tasks recorded for this project yet.',{exact:true})).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${id} route overflow`);
  }
  console.log(`PASS project page ${before?'before':'after'} ${width}: rendered, no overflow, no errors`);
  await page.close();
 }
} finally { await browser?.close(); await server.close(); }
