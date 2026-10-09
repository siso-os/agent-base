import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { webkit, suitePort } from './suite-runtime.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(root,'apps/web/package.json'));
const {createServer}=require('vite'),port=await suitePort();
const server=await createServer({root:path.join(root,'apps/web'),configFile:false,plugins:[require('@vitejs/plugin-react').default(),require('@tailwindcss/vite').default()],resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:['preview/compact-dial.html']},server:{host:'127.0.0.1',port,strictPort:true}});
let browser;
try {
 await server.listen();browser=await webkit.launch({headless:true});
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${port}/preview/compact-dial.html`,{waitUntil:'networkidle'});
  const trigger=page.getByRole('button',{name:'Context and usage'});
  await trigger.hover();const slider=page.getByRole('slider',{name:'Compaction threshold'});await slider.waitFor();
  assert.equal(await slider.inputValue(),'30');
  await page.screenshot({path:path.join(root,`ui-hub/input-bar/compact-dial-before-20261008-${width}.png`)});
  const box=await slider.boundingBox();
  await page.mouse.move(box.x+box.width*.25,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height/2,{steps:5});
  assert.equal(await slider.inputValue(),'50');
  assert.equal(await page.getByRole('button',{name:'Finish idle relaunch'}).isDisabled(),true,'not sent during drag');
  await page.mouse.up();await page.getByRole('status').filter({hasText:'Pending 50%'}).waitFor();
  assert.equal(await page.getByTestId('saved').innerText(),'30%','ring remains at saved threshold while pending');
  await page.screenshot({path:path.join(root,`ui-hub/input-bar/compact-dial-pending-20261008-${width}.png`)});
  await page.keyboard.press('Escape');await trigger.hover();await page.getByRole('status').filter({hasText:'Pending 50%'}).waitFor();
  await page.getByRole('button',{name:'Finish idle relaunch'}).click();await trigger.hover();await slider.waitFor();
  assert.equal(await page.getByTestId('saved').innerText(),'50%');
  assert.match(await page.locator('.ab-hud__compact-mark').getAttribute('style'),/rotate\(180deg\)/);
  await page.screenshot({path:path.join(root,`ui-hub/input-bar/compact-dial-after-20261008-${width}.png`)});
  await slider.focus();await slider.press('ArrowRight');assert.equal(await slider.inputValue(),'51');
  await page.getByRole('status').filter({hasText:'Pending 51%'}).waitFor();
  await page.keyboard.press('Escape');await page.getByLabel('Runtime').selectOption('codex');await trigger.focus();
  await page.getByText('Codex manages its own compaction. This mark is read-only.').waitFor();assert.equal(await page.getByRole('slider').count(),0);
  await page.keyboard.press('Escape');await page.getByLabel('Runtime').selectOption('failed');await trigger.focus();await slider.waitFor();await slider.focus();await slider.press('ArrowRight');
  await page.getByRole('alert').waitFor();assert.equal(await slider.inputValue(),'50');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}: hover/focus, release-only 30→50, pending survives closing, saved ring, arrows by 1, Codex read-only, launch error, no overflow`);
 }
} finally {await browser?.close();await server.close();}
