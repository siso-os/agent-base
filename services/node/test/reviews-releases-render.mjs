import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),{webkit}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const out=path.join(root,'.agents/scratchpads/landing-20261006'),sha='a'.repeat(40),errors=[],checks=[],screenshots=[];
const img=side=>readFileSync(path.join(root,`ui-hub/right-panel/rounds/verbs/task-cards-${side}-1440.png`));
const reviews=[{id:'first',title:'Task cards and a much longer review title that wraps safely on small screens',url:'https://example.test/review',by:'A0',at:'2026-10-05T12:00:00Z',opened:false,verdict:'none',feedback:null,history:[{kind:'posted',at:'2026-10-05T12:00:00Z'}]},{id:'approved',title:'Reviewed navigation',url:'https://example.test/nav',by:'DESIGN',at:'2026-10-04T12:00:00Z',opened:true,openedAt:'2026-10-05T13:00:00Z',verdict:'approved',feedback:'Approved',history:[{kind:'posted',at:'2026-10-04T12:00:00Z'},{kind:'approved',at:'2026-10-05T13:00:00Z',text:'Approved'},{kind:'opened',at:'2026-10-05T13:00:00Z'}]}];
const release={version:2,at:'2026-10-06T00:00:00Z',sha,kinds:['web'],commits:[{sha,line:'Review pages retain history',subject:'fix: review pages retain history',author:'Fixture',tag:null,at:'2026-10-06T00:00:00Z'}],note:{sha,title:'A reviewable release',what:['Recorded changes have before/after evidence.']},evidence:{state:'available',pairs:[{id:'task-cards',title:'Task cards · existing rendered evidence',before:`/api/releases/${sha}/evidence/task-cards/before`,after:`/api/releases/${sha}/evidence/task-cards/after`,beforeSha:'b'.repeat(40),afterSha:sha,viewport:{width:1440,height:1000}}]}};
const browser=await webkit.launch({headless:true});let postCount=0;
try{
 for(const width of [1440,1024,390]){
  const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});let unavailable=false;
  page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**/*',s=>s.close());
  await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
   if(p==='/api/reviews')return route.fulfill({json:unavailable?{reviews:[],availability:'unavailable',error:'Fixture unavailable'}:{reviews,availability:'available',coverage:'console-journal'}});
   if(p==='/api/reviews/first/opened'){assert.equal(route.request().method(),'POST');postCount++;return route.fulfill({json:{ok:true}});}
   assert.equal(route.request().method(),'GET');
   if(p==='/api/releases')return route.fulfill({json:{releases:[release,{...release,version:1,sha:'b'.repeat(40),note:undefined,evidence:{state:'unavailable',pairs:[]}}],pending:{ref:null,commits:[]}}});
   if(p.includes('/evidence/task-cards/'))return route.fulfill({contentType:'image/png',body:img(p.endsWith('/before')?'before':'after')});
   if(p==='/api/not-landed')return route.fulfill({json:{branches:[],live:{sha,main:sha,behind:0},fetchedAt:null}});
   return route.fulfill({status:404,json:{error:'Fixture route unavailable'}});
  });
  await page.goto('http://127.0.0.1:54531/preview/reviews-releases.html');
  await page.locator('[data-review="first"]').waitFor();await page.getByTestId('wn-release').first().waitFor();
  await page.getByRole('button',{name:'Approved',exact:true}).click();assert.equal(await page.locator('[data-review]').count(),1);
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.locator('[data-review="approved"] summary').click();assert.ok(await page.getByText('Approved',{exact:true}).count());
  await page.locator('[data-review="first"] .ab-review-history__open').click();await page.waitForFunction(()=>document.querySelector('[data-review="first"] .ab-review-history__meta')?.textContent.includes('Opened'));
  const button=page.getByRole('button',{name:'Before: Task cards · existing rendered evidence',exact:true});await button.click();
  await page.getByRole('dialog').waitFor();await page.keyboard.press('ArrowRight');assert.ok(await page.getByRole('dialog').getByText('After · 2 / 2 · Esc to close').count());await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const shot=`reviews-releases-${width}.png`;await page.screenshot({path:path.join(out,shot),fullPage:true});screenshots.push(shot);
  assert.equal(await page.getByTestId('wn-evidence-unavailable').count(),1);
  unavailable=true;await page.reload();await page.getByText('Some review sources are unavailable.',{exact:true}).waitFor();assert.equal(await page.getByText('No review pages recorded.',{exact:true}).count(),0);
  checks.push({width,filter:true,openedPersisted:true,history:true,lightboxArrowsEscape:true,noOverflow:true,unavailableNotEmpty:true});await page.close();
 }
}finally{await browser.close();writeFileSync(path.join(out,'reviews-releases-render.json'),JSON.stringify({checks,screenshots,errors,postCount,scope:'Synthetic APIs only; existing task-card images; browser closed'},null,2));}
assert.equal(errors.length,0,errors.join('\n'));assert.equal(postCount,3);console.log(JSON.stringify({checks:checks.length,errors:errors.length,postCount,screenshots}));
