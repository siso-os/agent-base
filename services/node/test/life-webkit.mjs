// Synthetic Life behavior in headless WebKit (the desktop app's rendering engine).
// Camofox is preferred; this engine-specific fallback also checks Tauri rendering.
import { webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const base='http://127.0.0.1:5497';
const out=process.argv[2];mkdirSync(out,{recursive:true});
const results=[];let browser;
const fixture=async mode=>{await fetch(`${base}/__fixture?mode=${mode}`,{method:'POST'});};
function check(name,ok) { results.push({check:name,ok:!!ok});console.log(JSON.stringify(results.at(-1)));if(!ok)throw new Error(name); }
try {
  browser=await webkit.launch({headless:true,timeout:60000});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/preview/life.html');
  const nav=page.getByRole('navigation',{name:'Life views'});
  const go=async name=>{await nav.getByRole('button',{name,exact:true}).click();};
  const shot=async name=>{await page.getByTestId('life-main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,name)});};
  const drained=()=>page.waitForFunction(()=>JSON.parse(localStorage.getItem('life-queue-v1')||'[]').length===0);
  const water=page.getByTestId('life-counter-water');
  await water.waitFor();check('Eight views render',await nav.getByRole('button').count()===8);
  await water.getByRole('button',{name:'plus 250',exact:true}).click();await drained();
  await page.reload();await water.waitFor();check('Water persists after reload',(await water.innerText()).includes('250'));await shot('today-1440.png');
  await go('Morning');await page.getByTestId('life-morning').waitFor();await shot('morning-1440.png');
  await page.getByTestId('life-wake-now').click();await drained();
  await go('Nightly');await page.getByLabel('What went well',{exact:true}).fill('Synthetic reflection for the preview');
  await page.getByTestId('life-close-day').click();await page.getByRole('button',{name:'Day closed · reopen',exact:true}).waitFor();await drained();
  check('Nightly reflection and checkout work',await page.getByLabel('What went well',{exact:true}).inputValue()==='Synthetic reflection for the preview');await shot('nightly-1440.png');
  await go('Food');await page.getByLabel('Meal name',{exact:true}).fill('Synthetic lunch');await page.getByLabel('Calories (kcal)',{exact:true}).fill('650');await page.getByLabel('Protein (g)',{exact:true}).fill('40');await page.getByRole('button',{name:'Add meal',exact:true}).click();await drained();await page.getByText('Synthetic lunch',{exact:true}).waitFor();
  check('Meal totals update',(await page.getByTestId('life-food').innerText()).includes('650 kcal'));await shot('food-1440.png');
  for(const name of ['Week','Month','Year','XP']) {await go(name);await page.getByTestId(name==='XP'?'life-xp-page':'life-review').waitFor();await page.waitForTimeout(150);check(name+' renders',!(await page.getByTestId('life-main').innerText()).includes('History is unavailable'));await shot(name.toLowerCase()+'-1440.png');}
  await go('Today');await water.waitFor();
  await fixture('slow');
  await page.getByLabel('Go to day',{exact:true}).fill('2026-09-01');
  check('Date switch hides the previous day before loading',await page.getByTestId('life-health').count()===0);
  await water.waitFor();check('Selected empty day does not inherit water',(await water.innerText()).includes('0'));
  await fixture('ok');await page.reload();await water.waitFor();
  await fixture('reject');await water.getByRole('button',{name:'plus 250',exact:true}).click();await page.getByText(/nothing was discarded/).waitFor();
  check('Rejected save remains queued',await page.evaluate(()=>JSON.parse(localStorage.getItem('life-queue-v1')).length===1));
  await fixture('ok');await page.evaluate(()=>window.dispatchEvent(new Event('online')));await drained();
  await page.waitForFunction(()=>document.querySelector('[data-testid=life-counter-water]').textContent.includes('500'));
  await fixture('lost-response');await water.getByRole('button',{name:'plus 250',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('life-queue-v1')||'[]').length===1);
  check('Lost response does not double display',(await water.innerText()).includes('750'));
  await fixture('ok');await page.evaluate(()=>window.dispatchEvent(new Event('online')));await drained();await page.reload();await water.waitFor();
  check('Lost response persists exactly once',(await water.innerText()).includes('750'));
  // A failed range request is never presented as an empty successful history.
  await fixture('range-fail');await go('Month');await page.getByText(/Life could not load this view/).waitFor();check('Range failure is explicit',true);await fixture('ok');
  await page.reload();await water.waitFor();
  await page.setViewportSize({width:390,height:844});
  for(const name of ['Today','Morning','Nightly','Food','Week','Month','Year','XP']) {
    await go(name);await page.waitForTimeout(150);
    check(name+' fits 390px',await page.evaluate(()=>document.documentElement.scrollWidth<=390&&document.querySelector('[data-testid=life-main]').scrollWidth<=390));await shot(name.toLowerCase()+'-390.png');
  }
  check('No browser runtime errors',errors.length===0);
} finally {
  await fixture('ok');await browser?.close();writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify(results,null,2)+'\n');
}
