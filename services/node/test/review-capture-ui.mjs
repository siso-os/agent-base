import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer as portProbe} from 'node:net';
const root=process.cwd(),out=path.join(root,'.agents/scratchpads/landing-20261006');
const {createServer}=await import(pathToFileURL(path.join(root,'apps/web/node_modules/vite/dist/node/index.js')).href);
const {webkit}=createRequire(path.join(root,'services/node/package.json'))('playwright');
const probe=portProbe();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const server=await createServer({root:path.join(root,'apps/web'),cacheDir:path.join(out,'review-capture-vite-cache'),optimizeDeps:{entries:['preview/reviews-releases.html']},server:{host:'127.0.0.1',port,strictPort:true},build:{outDir:path.join(out,'review-capture-unused-dist')}});
let browser;const errors=[],checks=[],shots=[];
try {
 await server.listen();browser=await webkit.launch({headless:true});
 const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/preview/reviews-releases.html`;
 const at=new Date().toISOString(),provenance={adapter:'native',agentId:'agent-fixture',sessionId:'session-'+ 's'.repeat(180),messageId:'message-'+ 'm'.repeat(180),deliveredAt:at,messageAt:at};
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  let opened=false,failed=false,posts=0;
  await page.route('**/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/api/reviews/chat-fixture/opened'){posts++;opened=true;return route.fulfill({json:{ok:true}});}
   if(p==='/api/reviews')return route.fulfill({json:{availability:failed?'unavailable':'available',coverage:'chat-deliveries',...(failed?{error:'Captured source unavailable'}:{}),reviews:[{id:'chat-fixture',title:'review.example.test/recorded-assistant-link',url:'https://review.example.test/render-fixture',by:'A0',at,opened,verdict:'none',feedback:null,provenance,history:[{kind:'posted',at}]}]}});
   if(p==='/api/releases')return route.fulfill({json:{releases:[],pending:{ref:null,commits:[]}}});
   if(p==='/api/not-landed')return route.fulfill({json:{branches:[],live:{sha:'a'.repeat(40),main:'a'.repeat(40),behind:0},fetchedAt:null}});
   return route.fulfill({status:404,json:{error:'Unconfigured fixture route'}});
  });
  await page.goto(url);await page.locator('[data-review="chat-fixture"]').waitFor();
  assert.match(await page.locator('.ab-review-history__source').innerText(),/Recorded assistant links/);
  assert.equal(await page.locator('[data-review] .is-approved').count(),0);assert.equal(posts,0);
  await page.locator('[data-review] summary').click();assert.match(await page.locator('[data-review] details').innerText(),/Delivered through native chat/);
  await page.locator('[data-review] .ab-review-history__open').click();await page.waitForFunction(()=>document.querySelector('[data-review] .ab-review-history__meta')?.textContent.includes('Opened'));assert.equal(posts,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const shot=path.join(out,`review-capture-${width}.png`);await page.screenshot({path:shot,fullPage:true});shots.push(shot);
  await page.reload();await page.locator('[data-review]').waitFor();assert.match(await page.locator('[data-review] .ab-review-history__meta').first().innerText(),/Opened/);
  failed=true;await page.reload();await page.getByText(/Some review sources are unavailable/).waitFor();assert.equal(await page.locator('[data-review]').count(),1);
  checks.push({width,provenance:true,openedOnlyAfterClick:true,noInferredApproval:true,openedPersists:true,partialFailureRetainsRows:true,noOverflow:true});await page.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await server.close();await writeFile(path.join(out,'review-capture-ui.json'),JSON.stringify({checks,shots,errors,scope:'Synthetic HTTP interception, actual ReviewsHistory component; isolated Vite cache; browser and server closed'},null,2)+'\n');}
console.log(`PASS review-capture UI: ${checks.length} viewports; no overflow/errors, provenance and opened-history behavior`);
