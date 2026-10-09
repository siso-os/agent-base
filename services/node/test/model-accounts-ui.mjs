/** Fixture-only preview, headless WebKit. Run with heavy -- node services/node/test/model-accounts-ui.mjs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { webkit, suitePort } from './suite-runtime.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = await suitePort();
const server = spawn(process.execPath, [`${root}/apps/web/node_modules/vite/bin/vite.js`,'--host','127.0.0.1','--port',String(port)], {cwd:`${root}/apps/web`,env:{...process.env,AB_NODE:'1'},stdio:'ignore'});
let browser;
const results=[];
const check=(name,condition)=>{assert.ok(condition,name);results.push(name);console.log(`PASS ${name}`);};
const until=async(fn)=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Fixture condition did not become true');};
try {
 for(let n=0;n<120;n++){if(await fetch(`http://127.0.0.1:${port}/preview/model-accounts.html`).then(r=>r.ok).catch(()=>false))break;if(server.exitCode!==null)throw new Error('Preview server exited');await new Promise(r=>setTimeout(r,250));}
 browser=await webkit.launch({headless:true});
 for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000},locale:'en-GB',timezoneId:'UTC'});
   await page.addInitScript(()=>{Date.now=()=>Date.parse('2026-10-08T05:00:00Z');});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const requests=[];await page.route('**/api/**',r=>{requests.push(r.request().url());return r.abort();});
   await page.goto(`http://127.0.0.1:${port}/preview/model-accounts.html`);
   // A click on the meter opens the Tokens page; hover opens the card (pre-t-0570 behaviour this test had missed).
   await page.getByTestId('provider-usage').hover();
   const usage=page.getByRole('dialog',{name:'Usage accounts',exact:true});
   check(`${width}: usage selector shares named accounts, renewal and credits`,(await usage.innerText()).includes('fuzeheritage')&&(await usage.innerText()).includes('Fahmy’s')&&/renews /.test(await usage.innerText())&&/\$[\d,.]+ credit/.test(await usage.innerText())&&await usage.locator('[data-window=five-hour]').count()>=2);
   await page.screenshot({path:`${root}/ui-hub/input-bar/usage-accounts-after-${width}.png`,fullPage:true});
   await page.keyboard.press('Escape');
   const chip=page.getByTestId('model-chip').first(), menu=page.getByTestId('model-menu');
   await chip.focus();await page.keyboard.press('Enter');
   await page.getByRole('textbox',{name:'Search models'}).waitFor();
   check(`${width}: Enter opens picker with search focus`,await page.getByRole('textbox',{name:'Search models'}).evaluate(el=>el===document.activeElement));
   check(`${width}: current chat names its account`,(await chip.textContent()).includes('fuzeheritage'));
   check(`${width}: all three named accounts visible in one selector`,await menu.getByText('lordsisodia',{exact:true}).count()===1&&await menu.getByText('fuzeheritage',{exact:true}).count()===1&&await menu.getByText('Fahmy’s',{exact:true}).count()===1);
   check(`${width}: protected account is read-only and not read`,(await menu.locator('.ab-account-line').last().innerText()).includes('read-only')&&await menu.locator('.ab-account-line').last().locator('button').count()===0);
   check(`${width}: picker overlays top strip and fixture webview`,await menu.evaluate(el=>{const r=el.getBoundingClientRect();return Number(getComputedStyle(el).zIndex)>Number(getComputedStyle(document.querySelector('[data-testid=top-strip]')).zIndex)&&el.contains(document.elementFromPoint(r.left+20,r.top+20));}));
   await page.screenshot({path:`${root}/ui-hub/input-bar/model-accounts-after-${width}.png`,fullPage:true});
   check(`${width}: changed attachment marker is present`,await page.locator('.cs-changed').count()===1);
   check(`${width}: model and context controls fit inside the rim`,await page.locator('.ab-hud').evaluate(hud=>{const r=hud.getBoundingClientRect();return [...hud.children].every(el=>el.getBoundingClientRect().right<=r.right+1);}));
   const before=await chip.textContent();
   await page.getByRole('textbox',{name:'Search models'}).fill('everyday');
   check(`${width}: search matches descriptions`,await menu.getByRole('menuitemradio').count()===1);
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
   await until(async()=>await menu.count()===0);
   check(`${width}: selection returns focus and waits for host`,await chip.evaluate(el=>el===document.activeElement)&&(await chip.textContent()).includes('Opus')&&(await chip.textContent()).includes('pending'));
   await page.getByRole('button',{name:'Confirm from fixture host'}).click();
   await until(async()=>(await chip.textContent()).includes('Sonnet'));
   check(`${width}: only host confirmation changes model label`,before.includes('Opus')&&(await chip.textContent()).includes('Sonnet')&&!(await chip.textContent()).includes('pending'));
   await chip.click();
   const low=menu.getByRole('radio',{name:'low',exact:true});await low.click();
   check(`${width}: effort remains observed until confirmation`,await low.getAttribute('aria-checked')==='false');
   await page.keyboard.press('Escape');await page.getByRole('button',{name:'Confirm from fixture host'}).click();await chip.click();
   check(`${width}: confirmed effort updates inline`,await menu.getByRole('radio',{name:'low',exact:true}).getAttribute('aria-checked')==='true');
   await page.getByRole('textbox',{name:'Search models'}).focus();await page.keyboard.press('Shift+Tab');
   check(`${width}: Tab keeps focus inside picker`,await menu.evaluate(el=>el.contains(document.activeElement)));
   await page.keyboard.press('Escape');check(`${width}: Escape returns focus to model chip`,await chip.evaluate(el=>el===document.activeElement));
   await page.getByTestId('effort-chip').first().click();
   check(`${width}: inline reasoning opens the current effort`,await menu.getByRole('radio',{name:'low',exact:true}).evaluate(el=>el===document.activeElement));
   await page.keyboard.press('ArrowRight');check(`${width}: reasoning arrows stay inside effort controls`,await menu.getByRole('radio',{name:'med',exact:true}).evaluate(el=>el===document.activeElement));
   await page.keyboard.press('Escape');check(`${width}: reasoning Escape returns to effort chip`,await page.getByTestId('effort-chip').first().evaluate(el=>el===document.activeElement));
   await page.getByRole('button',{name:'Context and usage',exact:true}).click();
   const context=page.getByRole('dialog',{name:'Context breakdown',exact:true});
   check(`${width}: context opens estimated breakdown with changed file`,(await context.innerText()).includes('Estimated source mix')&&(await context.innerText()).includes('Changed since read'));
   check(`${width}: ring has source-coloured segments`,await page.getByRole('meter',{name:'Context used'}).locator('i.ab-hud__ring').evaluate(el=>getComputedStyle(el).backgroundImage.includes('conic-gradient')));
   check(`${width}: context overlay uses native-cover dialog contract`,await context.evaluate(el=>el.matches('[role="dialog"]')&&Number(getComputedStyle(el).zIndex)>500));
   await page.screenshot({path:`${root}/ui-hub/input-bar/model-context-after-${width}.png`,fullPage:true});
   await page.keyboard.press('Escape');check(`${width}: context Escape restores ring focus`,await page.getByRole('button',{name:'Context and usage',exact:true}).evaluate(el=>el===document.activeElement));
   for(const state of ['Working / steer','Near full','Codex','No catalog','Terminal','Two accounts','Failed upload','Move mid-turn','Stale readings']){
     await page.getByRole('button',{name:state,exact:true}).click();
     check(`${width}: ${state} has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     if(state==='Near full')check(`${width}: near-full context has warning`,await page.locator('.ab-hud__ctx.is-hot').count()===1);
     if(state==='No catalog'||state==='Terminal'){
       await chip.click();check(`${width}: ${state} invents no models or effort controls`,await menu.getByRole('menuitemradio').count()===0&&await menu.getByRole('radio').count()===0);await page.keyboard.press('Escape');
     }
     if(state==='Two accounts')check(`${width}: same model distinguishes both accounts`,(await page.getByTestId('model-chip').nth(0).innerText()).includes('lordsisodia')&&(await page.getByTestId('model-chip').nth(1).innerText()).includes('fuzeheritage'));
     if(state==='Failed upload'){
       check(`${width}: failed attachment is preserved`,await page.getByRole('alert').count()===1);
       await page.getByRole('button',{name:'Retry upload',exact:true}).click();check(`${width}: upload retry preserves draft`,await page.getByRole('alert').count()===0&&(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue()).includes('halo rim'));
     }
     if(state==='Move mid-turn'){
       const observed=await chip.textContent();await chip.click();await menu.getByText('Move to another harness',{exact:true}).click();await menu.getByRole('menuitem').filter({hasText:'Sol'}).click();
       check(`${width}: harness move mid-turn retains observed model`,(await chip.textContent()).includes('Opus')&&observed.includes('Opus'));
       await chip.click();check(`${width}: pending move blocks duplicate model changes`,await menu.getByRole('menuitemradio').evaluateAll(rows=>rows.every(el=>el.disabled)));await page.keyboard.press('Escape');
     }
     if(state==='Stale readings'){
       await chip.click();check(`${width}: stale source ages remain explicit`,(await menu.innerText()).includes('Usage stale')&&(await menu.innerText()).includes('Billing stale'));await page.keyboard.press('Escape');
     }
   }
   check(`${width}: fixture never reaches an API or live agent`,requests.length===0);
   check(`${width}: no page errors`,errors.length===0);
   await page.close();
 }
 const hosted=await browser.newPage({viewport:{width:1440,height:1000}});
 const hostedRequests=[];
 await hosted.route('**/api/**',r=>{hostedRequests.push(new URL(r.request().url()).pathname);return r.request().url().endsWith('/api/claude-accounts')?r.fulfill({json:{accounts:[{id:'claude-siso',name:'fuzeheritage',readOnly:false,week:null,usageAt:null,usageStale:true,renewsAt:null,renewalStatus:null,credits:null,billingAt:null,billingStale:true}],refreshing:false}}):r.abort();});
 await hosted.goto(`http://127.0.0.1:${port}/preview/model-accounts.html?hosted=1`);
 await hosted.evaluate(()=>{window.fixtureControls=[];window.addEventListener('siso-chat-model',e=>window.fixtureControls.push(e.detail));});
 const hostedChip=hosted.getByTestId('model-chip');await hostedChip.click();
 check('real hosted ModelChip labels siso seats with their Claude account',(await hostedChip.textContent()).includes('fuzeheritage'));
 await hosted.getByRole('menuitemradio',{name:'Claude Sonnet 5.5',exact:true}).click();
 check('real hosted ModelChip routes model requests to the exact seat and session',await hosted.evaluate(()=>window.fixtureControls.length===1&&window.fixtureControls[0].agentId==='fixture-seat'&&window.fixtureControls[0].session==='fixture-session'&&window.fixtureControls[0].model==='claude-sonnet-5-5'));
 check('real hosted ModelChip retains its observed model while a request is pending',(await hostedChip.textContent()).includes('Opus'));
 // t-0577: the account rows beside the readings also read this seat's switch status.
 check('hosted fixture uses only the intercepted account endpoints',hostedRequests.every(p=>p==='/api/claude-accounts'||/^\/api\/agents\/[^/]+\/claude-account$/.test(p)));
 await hosted.close();
 writeFileSync(`${root}/ui-hub/input-bar/model-accounts-checks.json`,JSON.stringify({at:new Date().toISOString(),browser:'headless WebKit',widths:[1440,390],checks:results,passed:results.length},null,2)+'\n');
 console.log(`PASS model accounts browser: ${results.length}/${results.length}`);
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
