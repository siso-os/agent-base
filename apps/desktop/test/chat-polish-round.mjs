// Real React components, synthetic transport, headless browser. Run through heavy --.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../../..');
const require=createRequire(path.join(root,'services/node/package.json'));
const {chromium}=require('playwright');
const {createServer}=await import(path.join(root,'apps/web/node_modules/vite/dist/node/index.js'));
const out=path.join(root,'.agents/scratchpads/landing-20261006');
const owned=['Composer.tsx','Composer.css','Hud.tsx','Hud.css','ModelMenu.tsx'];
const evidence={checks:[],shots:[],errors:[]};
const check=(name,ok)=>{assert.ok(ok,name);evidence.checks.push(name)};
let browser,server;
try {
 browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const phase of process.env.CHAT_POLISH_AFTER_ONLY ? ['after'] : ['before','after']){
  server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),cacheDir:path.join(out,'chat-polish-vite'),optimizeDeps:{entries:['preview/chat-polish.html']},server:{port:0,strictPort:false,host:'127.0.0.1'},plugins:phase==='before'?[{name:'chat-polish-baseline',enforce:'pre',load(id){const name=owned.find(n=>id===path.join(root,'apps/web/src/components',n));if(name)return execFileSync('git',['show',`24b88a79:apps/web/src/components/${name}`],{cwd:root,encoding:'utf8'});}}]:[]});
  await server.listen();const port=server.httpServer.address().port;
  const page=await browser.newPage({reducedMotion:'reduce'});
  await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
  page.on('pageerror',e=>evidence.errors.push(`${phase}: ${e.message}`));
  for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${port}/preview/chat-polish.html`);
   await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
   await page.getByRole('textbox',{name:'Message',exact:true}).fill('Review the current component and preserve its existing controls.\n'.repeat(12));
   for(const nav of ['closed','open']){
    if(nav==='open')await page.getByRole('button',{name:'Toggle nav width'}).click();
    const shot=`chat-polish-${phase}-${width}-${nav}.png`;await page.screenshot({path:path.join(out,shot)});evidence.shots.push(shot);
    if(phase==='after'){
     const g=await page.getByRole('textbox',{name:'Message',exact:true}).evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
     check(`compact draft ${width}/${nav}`,g.height<=54&&g.scroll>g.height&&g.overflow==='auto');
     check(`no horizontal overflow ${width}/${nav}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     check(`HUD stays inside rim ${width}/${nav}`,await page.getByTestId('halo-rim').evaluate(el=>{const right=el.getBoundingClientRect().right;return [...el.querySelectorAll('.ab-hud.is-rim> *')].filter(child=>child.getBoundingClientRect().width>0).every(child=>child.getBoundingClientRect().right<=right);}));
     check(`usage remains visible ${width}/${nav}`,await page.getByLabel('Usage limits',{exact:true}).isVisible());
    }
   }
  }
  if(phase==='after'){
   await page.setViewportSize({width:1440,height:900});await page.goto(`http://127.0.0.1:${port}/preview/chat-polish.html`);
   await page.getByTestId('model-chip').click();
   await page.screenshot({path:path.join(out,'chat-polish-model-1440.png')});evidence.shots.push('chat-polish-model-1440.png');
   check('provider model IDs visible',await page.locator('.ab-cast__id').textContent()==='gpt-6-astra');
   await page.getByRole('menuitemradio',{name:'GPT 6.1-sol',exact:true}).click();
   check('local click does not confirm model',await page.getByTestId('model-chip').getAttribute('data-confirmed')===null);
   check('local click retains reported model',(await page.getByTestId('model-chip').innerText()).includes('GPT 6-astra'));
   await page.getByRole('button',{name:'Acknowledge model',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[data-testid="model-chip"]')?.hasAttribute('data-confirmed'));
   check('reported acknowledgement confirms model',(await page.getByTestId('model-chip').innerText()).includes('GPT 6.1-sol'));
   await page.getByTestId('model-chip').click();await page.getByRole('menuitemradio',{name:'GPT 6-astra',exact:true}).focus();await page.keyboard.press('ArrowDown');
   check('model keyboard navigation',await page.getByRole('menuitemradio',{name:'GPT 6.1-sol',exact:true}).evaluate(el=>el===document.activeElement));
   await page.keyboard.press('Escape');check('Escape restores model trigger focus',await page.getByTestId('model-chip').evaluate(el=>el===document.activeElement));
   await page.getByRole('button',{name:'Context 92',exact:true}).click();
   check('reduced motion immediately uses measurement',Number.parseFloat(await page.getByRole('meter').locator('b').innerText())===92);
   await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'Context 48',exact:true}).click();await page.waitForTimeout(120);
   let values=await page.getByRole('meter').evaluate(el=>({number:parseFloat(el.querySelector('b').textContent),ring:parseFloat(el.querySelector('i').style.getPropertyValue('--p'))}));
   check('number and ring animate from same value',Math.abs(values.number-values.ring)<.06&&values.number>48&&values.number<92);
   await page.getByRole('button',{name:'Context 92',exact:true}).click();await page.waitForTimeout(750);
   check('interrupted context lands at new measurement',Number.parseFloat(await page.getByRole('meter').locator('b').innerText())===92);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   await page.getByRole('button',{name:'Context 48',exact:true}).click();check('hidden page snaps without motion',Number.parseFloat(await page.getByRole('meter').locator('b').innerText())===48);
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
   await page.getByRole('button',{name:'Context unknown',exact:true}).click();check('missing telemetry stays unknown',(await page.getByRole('meter').innerText()).includes('—'));
   await page.getByRole('textbox',{name:'Message',exact:true}).fill('/');
   await page.getByRole('listbox',{name:'Commands',exact:true}).waitFor();
   evidence.slashInsideRim=await page.getByRole('listbox',{name:'Commands',exact:true}).evaluate(el=>!!el.closest('[data-testid="halo-rim"]'));
   await page.goto(`http://127.0.0.1:${port}/preview/chat-polish.html?receipt`);
   check('no receipt before acceptance',!(await page.locator('.siso-chat__receipt').innerText()));
   await page.getByRole('button',{name:'Accept fixture',exact:true}).click();await page.locator('.siso-chat__receipt>span').waitFor();
   await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'chat-polish-receipt.png')});evidence.shots.push('chat-polish-receipt.png');
   check('real receipt prop produces receipt',true);await page.waitForTimeout(2600);check('receipt returns to rest',!(await page.locator('.siso-chat__receipt').innerText()));
  }
  await page.close();await server.close();server=null;
 }
 check('no browser errors',evidence.errors.length===0);
 evidence.status='passed';
} catch(e){evidence.status='failed';evidence.error=String(e);process.exitCode=1;}
finally{evidence.sourceHashes=Object.fromEntries([...owned,'ContextMeter.tsx','ModelMenu.css','ChatView.tsx'].map(name=>[name,createHash('sha256').update(readFileSync(path.join(root,'apps/web/src/components',name))).digest('hex')]));await browser?.close();await server?.close();writeFileSync(path.join(out,'chat-polish-checks.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
