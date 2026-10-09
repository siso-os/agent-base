import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../../../apps/web/node_modules/vite/dist/node/index.js';
import react from '../../../apps/web/node_modules/@vitejs/plugin-react/dist/index.js';
import tailwindcss from '../../../apps/web/node_modules/@tailwindcss/vite/dist/index.mjs';
import { createA0BoardReader } from '../src/a0-board.ts';
import { writeBoardNote } from '../src/a0-board-notes.ts';
import { a0BoardRoute } from '../src/routes/a0-board.route.ts';

const repo=path.resolve(import.meta.dirname,'../../..'),web=path.join(repo,'apps/web');
const receiptRoot=path.join(repo,'.agents/scratchpads/landing-20261006');
const temp=await mkdtemp(path.join(os.tmpdir(),'ab-board-notes-ui-')),notesRoot=path.join(temp,'notes'),zeroRoot=path.join(temp,'zero');
const files=['services/node/src/a0-board-notes.ts','services/node/src/a0-board.ts','services/node/src/routes/a0-board.route.ts','apps/web/src/components/panel/A0Board.tsx'];
async function hashes(){return Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(path.join(repo,f))).digest('hex')])));}
const before=await hashes(),checks=[],errors=[],unexpected=[];let browser,server,currentPage,devSockets=0,mode='ready';
const record=(id,ok)=>{assert.ok(ok,id);checks.push({id,ok:true});};
const command=(action,requestId,extra)=>({action,requestId,by:'Fixture Zero',source:'fixture:board-notes-render',...extra});
try{
 await mkdir(path.join(zeroRoot,'ideas'),{recursive:true});await writeFile(path.join(zeroRoot,'ideas/ideas.jsonl'),'');
 const active=await writeBoardNote(command('create','ui-active',{text:'Check the synthetic release before making a decision',why:'Keep the exact question and its provenance available'}),{root:notesRoot});
 const retired=await writeBoardNote(command('create','ui-retired',{text:'An earlier synthetic reminder',why:'Preserve completed context'}),{root:notesRoot});
 await writeBoardNote(command('retire','ui-retire',{id:retired.id,expectedRevision:1}),{root:notesRoot});
 const read=createA0BoardReader({root:zeroRoot,notesRoot,ttlMs:0}),empty=createA0BoardReader({root:zeroRoot,notesRoot:path.join(temp,'never-created'),ttlMs:0});
 const route=a0BoardRoute(()=>mode==='empty'?empty():read());
 const portProbe=net.createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const fixturePort=portProbe.address().port;await new Promise(r=>portProbe.close(r));
 server=await createServer({configFile:false,root:web,plugins:[react(),tailwindcss(),{name:'sealed-board-notes',configureServer(s){s.middlewares.use(async(req,res,next)=>{
   const pathname=new URL(req.url,'http://fixture').pathname;
   if(!pathname.startsWith('/api/'))return next();
   if(req.method!=='GET'){unexpected.push(`${req.method} ${pathname}`);res.writeHead(405);res.end();return;}
   if(pathname==='/api/a0/board'){if(mode==='down'){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"fixture unavailable"}');return;}await route.handle(req,res,[]);return;}
   if(pathname==='/api/a0/now'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({lanes:{data:{runs:[]},error:null}}));return;}
   res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Unknown synthetic source"}');
 });}}],cacheDir:path.join(temp,'vite-cache'),resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:['preview/a0-board-notes.html']},server:{host:'127.0.0.1',port:fixturePort,strictPort:true,hmr:{host:'127.0.0.1',clientPort:fixturePort},fs:{allow:[repo]}}});
 await server.listen();const address=server.httpServer.address(),origin=`http://127.0.0.1:${address.port}`;
 const socketPolicy=ws=>{const target=new URL(ws.url());if(target.host===new URL(origin).host&&target.pathname==='/'){devSockets++;ws.connectToServer();}else{unexpected.push('unexpected-socket:'+target.host+target.pathname);ws.close();}};
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});currentPage=page;page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async r=>{const url=new URL(r.request().url());if(url.origin!==origin){unexpected.push(url.origin);await r.abort();}else await r.continue();});await page.routeWebSocket('**/*',socketPolicy);
   async function notes(){await page.goto(origin+'/preview/a0-board-notes.html');await page.getByRole('button',{name:'Notes',exact:true}).click();}
   mode='ready';await notes();await page.locator('.ab-board__item > summary').filter({hasText:'Check the synthetic release before making a decision'}).waitFor();
   record(`four-existing-lanes-${width}`,await page.locator('.ab-board__lanes button').count()===4);
   record(`no-note-forms-${width}`,await page.locator('.ab-board input,.ab-board textarea,.ab-board select').count()===0);
   const folded=page.getByTestId('retired-notes');record(`retired-folded-${width}`,await folded.getAttribute('open')===null);
   await page.locator('.ab-board__item > summary').filter({hasText:'Check the synthetic release before making a decision'}).click();
   record(`raw-revision-provenance-${width}`,(await page.getByLabel('Notes record JSON').first().innerText()).includes('fixture:board-notes-render'));
   await folded.locator('summary').first().focus();await page.keyboard.press('Enter');await page.locator('.ab-board__item > summary').filter({hasText:'An earlier synthetic reminder'}).waitFor();record(`keyboard-retired-${width}`,await folded.getAttribute('open')!==null);
   await page.locator('.ab-board__item > summary').filter({hasText:'An earlier synthetic reminder'}).click();record(`retired-json-${width}`,(await folded.getByLabel('Notes record JSON').innerText()).includes('"status": "retired"'));
   record(`viewport-${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(receiptRoot,`board-notes-${width}.png`),fullPage:true});
   mode='empty';await notes();await page.getByText('No open notes.',{exact:true}).waitFor();record(`empty-${width}`,await page.getByTestId('retired-notes').count()===0);
   mode='down';await notes();await page.getByRole('status').filter({hasText:'Notes unavailable.'}).waitFor();record(`unavailable-${width}`,await page.getByText('No open notes.',{exact:true}).count()===0);
   mode='ready';const good=await readFile(path.join(notesRoot,'notes.jsonl'),'utf8');await writeFile(path.join(notesRoot,'notes.jsonl'),good+'{"torn":');await notes();await page.getByRole('status').filter({hasText:'Showing the last successful read.'}).waitFor();record(`persistent-last-good-${width}`,await page.locator('.ab-board__item > summary').filter({hasText:'Check the synthetic release before making a decision'}).count()===1);
   await page.screenshot({path:path.join(receiptRoot,`board-notes-stale-${width}.png`),fullPage:true});await writeFile(path.join(notesRoot,'notes.jsonl'),good);await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:900}});currentPage=page;page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**/*',socketPolicy);
 await page.goto(origin+'/preview/a0-board-notes.html');await page.getByRole('button',{name:'Notes',exact:true}).click();await page.locator('.ab-board__item > summary').filter({hasText:'Check the synthetic release before making a decision'}).waitFor();
 await writeBoardNote(command('update','ui-update',{id:active.id,expectedRevision:1,text:'The synthetic note changed through its writer'}),{root:notesRoot});await page.locator('.ab-board__item > summary').filter({hasText:'The synthetic note changed through its writer'}).waitFor({timeout:16000});record('writer-to-live-read-refresh',true);
 await writeBoardNote(command('retire','ui-retire-active',{id:active.id,expectedRevision:2}),{root:notesRoot});await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByText('No open notes.',{exact:true}).waitFor();record('retirement-after-reload',await page.getByTestId('retired-notes').innerText().then(t=>t.includes('2')));
 await writeBoardNote(command('restore','ui-restore-active',{id:active.id,expectedRevision:3}),{root:notesRoot});await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await page.locator('.ab-board__item > summary').filter({hasText:'The synthetic note changed through its writer'}).waitFor();record('restore-after-reload',true);await page.close();
 record('no-browser-errors',errors.length===0);record('no-agent-sockets-external-or-mutation-requests',unexpected.length===0);record('source-unchanged-during-acceptance',JSON.stringify(before)===JSON.stringify(await hashes()));
 await writeFile(path.join(receiptRoot,'board-notes-ui-checks.json'),JSON.stringify({at:new Date().toISOString(),passed:checks.length,checks,errors,unexpected,devSockets,sourceHashes:before,proof:'Actual board UI and GET route with temporary canonical note store; headless Chrome, no live agent or account data.',browserClosed:true,serverClosed:true},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,errors,unexpected,devSockets}));
}catch(error){console.error(JSON.stringify({error:String(error),browserErrors:errors,unexpected,body:currentPage&&!currentPage.isClosed()?await currentPage.locator('body').innerText():null}));throw error;}finally{await browser?.close();await server?.close();await rm(temp,{recursive:true,force:true});}
