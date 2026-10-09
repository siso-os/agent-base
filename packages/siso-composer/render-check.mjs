import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'.agents/scratchpads/landing-20261006');
const require=createRequire(path.join(root,'services/node/package.json'));
const {chromium}=require('playwright');
const {createServer}=await import(path.join(root,'apps/web/node_modules/vite/dist/node/index.js'));
const result={checks:[],screenshots:[],errors:[],requests:[]};let browser,server;
const check=(name,passed)=>{assert.ok(passed,name);result.checks.push(name);};
try{
 server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),cacheDir:path.join(out,'composer-package-vite'),optimizeDeps:{entries:['preview/composer-package.html','preview/chat-polish.html']},server:{host:'127.0.0.1',port:0,strictPort:false}});
 await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(60000);page.on('pageerror',error=>result.errors.push(error.message));
 await page.route('**/api/**',route=>{result.requests.push(route.request().url());return route.fulfill({status:200,body:'{}'});});
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:900});await page.goto(`${base}/preview/composer-package.html`);await page.getByTestId('shared-composer').waitFor();
  check(`second consumer fits ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const image=`composer-package-${width}.png`;await page.screenshot({path:path.join(out,image)});result.screenshots.push(image);
 }
 await page.setViewportSize({width:1440,height:900});await page.goto(`${base}/preview/composer-package.html`);await page.getByTestId('shared-composer').waitFor();
 await page.getByRole('button',{name:'Request synthetic task',exact:true}).click();check('local submit has no receipt',await page.locator('.siso-chat__receipt').innerText()==='');
 await page.getByRole('button',{name:'Accept synthetic task',exact:true}).click();await page.locator('.siso-chat__receipt>span').waitFor();check('accepted prop renders receipt',true);
 await page.getByTestId('model-chip').click();await page.getByRole('menuitemradio',{name:'GPT 6.1-sol',exact:true}).click();
 check('model callback preserves exact ID',await page.evaluate(()=>window.__composerEvents.includes('model:gpt-6.1-sol')));
 check('unacknowledged model stays current',(await page.getByTestId('model-chip').innerText()).includes('gpt-6-astra'));
 await page.getByRole('button',{name:'Acknowledge selected model',exact:true}).click();check('acknowledgement updates identity',(await page.getByTestId('model-chip').innerText()).includes('gpt-6.1-sol'));
 await page.getByTestId('model-chip').click();await page.getByRole('radio',{name:'low',exact:true}).click();check('effort callback forwarded',await page.evaluate(()=>window.__composerEvents.includes('effort:low')));await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Report unknown context',exact:true}).click();check('unknown context is not zero',(await page.getByRole('meter').innerText()).includes('—'));
 await page.getByRole('button',{name:'Report context 92',exact:true}).click();await page.waitForFunction(()=>parseFloat(document.querySelector('[role=meter] b')?.textContent)===92);check('context measurement shown',parseFloat(await page.getByRole('meter').locator('b').innerText())===92);
 await page.getByRole('button',{name:'Artifact 1',exact:false}).first().click();check('artifact open callback',await page.evaluate(()=>window.__composerEvents.includes('artifact:artifact-0')));
 await page.getByRole('button',{name:'+1',exact:true}).click();check('shelf expansion',await page.getByRole('button',{name:'Artifact 5',exact:false}).first().isVisible());
 await page.getByRole('button',{name:'Put away Artifact 1',exact:true}).click();check('shelf dismissal callback',await page.evaluate(()=>window.__composerEvents.includes('hide:artifact-0')));
 await page.getByRole('button',{name:'Fixture activities',exact:true}).click();await page.getByRole('dialog',{name:'Fixture activity popup',exact:true}).waitFor();
 check('grouped popup rendered',await page.getByTestId('activity-group').count()===1);
 await page.getByTestId('activity-row').first().click();check('activity callback retains ID',await page.evaluate(()=>window.__composerEvents.includes('open:review')));
 await page.getByRole('button',{name:'Stop Build output',exact:true}).click();check('utility stop is caller-owned',await page.evaluate(()=>window.__composerEvents.includes('stop:build')));
 await page.getByRole('button',{name:'✓ 1 finished',exact:false}).click();check('finished activities expand',await page.getByText('Finished review',{exact:true}).isVisible());
 await page.screenshot({path:path.join(out,'composer-package-activity.png')});result.screenshots.push('composer-package-activity.png');
 check('package initiated no HTTP requests',result.requests.length===0);
 check('no browser errors',result.errors.length===0);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();result.sourceHashes=Object.fromEntries(readdirSync(path.join(import.meta.dirname,'src')).map(name=>[name,createHash('sha256').update(readFileSync(path.join(import.meta.dirname,'src',name))).digest('hex')]));writeFileSync(path.join(out,'composer-package-checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}

process.exit(process.exitCode ?? 0);
