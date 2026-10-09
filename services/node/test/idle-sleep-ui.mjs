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
 resolve:{dedupe:['react','react-dom']}, optimizeDeps:{entries:[`preview/idle-sleep.html`]},
 server: { host:'127.0.0.1', port, strictPort:true } });
let browser;
try {
 await server.listen(); browser=await webkit.launch({headless:true});
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.fulfill({json:{agents:[],tasks:[],groups:[],projects:[],workspaces:[]}}));
  await page.goto(`http://127.0.0.1:${port}/preview/idle-sleep.html${before?'?before':''}`,{waitUntil:'networkidle'});
  await page.getByText('The preview is ready.',{exact:false}).waitFor();
  if(!before) {
   await page.getByTestId('asleep-line').first().waitFor();
   assert.ok(await page.getByLabel('Asleep',{exact:true}).count()>0,'moon in the real sidebar');
   const row=page.getByRole('button',{name:/STUDIO-BUILD, Asleep/});
   await row.hover(); await page.locator('.ab-hover-card').waitFor();
   assert.match(await page.locator('.ab-hover-card').innerText(),/Asleep since/);
   await page.mouse.move(width-10,70); await page.keyboard.press('Escape');
  }
  await page.screenshot({path:path.join(root,`ui-hub/fleet/idle-sleep-${before?'before':'after'}-20261008-${width}.png`),fullPage:true});
  if(!before) {
   const box=page.locator('textarea').first(); await box.fill('continue'); await box.press('Enter');
   await page.getByText('Waking…',{exact:true}).waitFor();
   await page.getByRole('button',{name:/STUDIO-BUILD, Waking/}).waitFor();
   await page.getByTestId('asleep-line').waitFor({state:'hidden'});
   await page.getByLabel('Synthetic state').selectOption('failed');
   await page.getByTestId('asleep-line').waitFor();
   const failedBox=page.locator('textarea').first(); await failedBox.fill('keep this draft'); await failedBox.press('Enter');
   await page.waitForFunction(()=>document.querySelector('textarea')?.value==='keep this draft');
   assert.match(await page.getByTestId('asleep-line').innerText(),/runner not responding/);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
  assert.deepEqual(errors,[]);
  await page.close(); console.log(`PASS ${width}: ${before?'idle baseline':'asleep moon and hover, wake on send, failed wake keeps draft'}`);
 }
} finally { await browser?.close(); await server.close(); }
