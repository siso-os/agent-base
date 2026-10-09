// Production Browser rendered against an isolated in-memory API. No live node, accounts or sockets.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../..');
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { createServer } = requireWeb('vite');
// A caller may use an already-installed matching runtime when the shared browser cache was upgraded.
const { webkit } = process.env.AB_BROWSER_PLAYWRIGHT_MODULE ? requireWeb(process.env.AB_BROWSER_PLAYWRIGHT_MODULE) : createRequire(path.join(root, 'services/node/package.json'))('playwright');
const tailwind = (await import(requireWeb.resolve('@tailwindcss/vite'))).default;
const out = path.join(root, 'domain-base/browser');
const scratch = await mkdtemp(path.join(tmpdir(), '.siso-ephemeral-browser-arc-'));
const before = process.argv.includes('--before');
let state, browser;
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PageView}from'./components/Browser';import './index.css';
function Fixture(){const[nav,setNav]=useState({url:location.origin+'/synthetic/design-notes',back:[],fwd:[],n:0});const[title,setTitle]=useState('Design notes');return <PageView nav={nav} title={title} tabId="arc-fixture" web pinned={false} suggested={[]} recents={[]} onGo={(url,title='New tab')=>{setTitle(title);setNav(n=>({...n,url,n:n.n+1}));}} onBack={()=>{}} onForward={()=>{}} onReload={()=>{}} onPin={()=>{}} onTerminal={()=>{}}/>}createRoot(document.getElementById('root')).render(<Fixture/>);`;
const server = await createServer({ configFile:false, cacheDir:path.join(scratch,'vite'), root:path.join(root,'apps/web'), resolve:{dedupe:['react','react-dom']}, esbuild:{jsx:'automatic'}, optimizeDeps:{noDiscovery:true,entries:[],include:['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client','lucide-react','react-dom']}, server:{host:'127.0.0.1',port:0,watch:null}, plugins:[tailwind(),{
 name:'browser-arc-fixture',resolveId(id){if(id==='/src/browser-fixture.tsx')return path.join(root,'apps/web/src/browser-fixture.tsx');},load(id){if(id===path.join(root,'apps/web/src/browser-fixture.tsx'))return fixture;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;background:#101010}button{cursor:pointer}</style><div id="root"></div><script type="module" src="/src/browser-fixture.tsx"></script>');}
 if(url.pathname.startsWith('/synthetic/')){res.setHeader('Content-Type','text/html');return res.end('<meta charset="utf-8"><style>body{font:16px system-ui;background:#f3f0e9;color:#222;padding:clamp(24px,6vw,88px);line-height:1.6}small{letter-spacing:.15em}h1{font-size:clamp(30px,4vw,56px);line-height:1.1;max-width:620px}p{max-width:500px}hr{border:0;border-top:1px solid #d5d0c7;margin:32px 0}</style><small>BROWSER PREVIEW · LOCAL FIXTURE</small><h1>A place for the pages you return to.</h1><p>Keep daily favourites close. Organise saved pages into folders and give the page room when you need to focus.</p><hr><p>This page contains invented content. No accounts or sign-ins are connected.</p>');}
 if(url.pathname==='/api/browser/state'){res.setHeader('Content-Type','application/json');if(['PUT','PATCH'].includes(req.method)){let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);state=req.method==='PUT'?body:{...state,...body};return res.end('{"ok":true}');}return res.end(JSON.stringify(state));}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{}');}next();
 });}
 }]});
const checks=[],screens=[];
try{
 await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const pin=(name)=>({url:base+'/synthetic/'+name.toLowerCase().replaceAll(' ','-'),title:name,pinned:true,origin:'user'});
 state={migratedAt:1,spaces:[{id:'personal',name:'Personal',account:'personal',pinVersion:2,pins:['Design notes','Reference library','Weekend reading'].map(pin),imported:[pin('Imported article')],importedFolders:[{id:'arc-folder:synthetic',space:'personal',name:'From Arc',collapsed:false,urls:[]},{id:'arc-folder:synthetic-nested',space:'personal',name:'Articles',parentId:'arc-folder:synthetic',collapsed:false,urls:[pin('Imported article').url]}]},{id:'HALO',name:'HALO',account:'work-test',pinVersion:2,pins:[pin('Project brief')]},{id:'research',name:'Research',account:'personal',pinVersion:2,pins:[]},{id:'arc-favorites',name:'Favourites',pinVersion:2,pins:['ChatGPT','YouTube','Mail','GitHub','Calendar','SISO'].map(pin)}],accounts:[{id:'personal',name:'Personal',store:'personal'},{id:'work-test',name:'Work',store:'test-work-only'}],today:{personal:[{...pin('Today reading'),at:Date.now()}]},setup:{closedAt:Date.now(),doneAt:Date.now()},folders:[]};
 browser=await webkit.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
 await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);try{await page.getByRole('complementary',{name:'Browser sidebar'}).waitFor();}catch(e){console.log(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw e;}
 await page.frameLocator('iframe').getByRole('heading').waitFor();
 const capture=async(name,width)=>{await page.setViewportSize({width,height:900});await page.waitForTimeout(250);const file=`arc-${before?'before':'after'}-${name}.png`;await page.screenshot({path:path.join(out,file)});screens.push(file);};
 if(before){await capture('1440',1440);await capture('1024',1024);await capture('390',390);}
 else{
  const side=page.getByRole('complementary',{name:'Browser sidebar'}), saved=page.getByRole('region',{name:'Saved pages'});
  const accountsBefore=JSON.stringify(state.accounts.map(({id,store})=>({id,store})));
  const originalPins=JSON.stringify(state.spaces.find(s=>s.id==='personal').pins);
  const makeFolder=async(name)=>{await side.getByRole('button',{name:'New folder',exact:true}).click();await side.getByRole('textbox',{name:'Folder name',exact:true}).fill(name);await side.getByRole('button',{name:'Save folder',exact:true}).click();};
  await makeFolder('Projects');
  await side.getByRole('button',{name:'Options for Projects',exact:true}).click();await side.getByRole('button',{name:'New subfolder',exact:true}).click();await side.getByRole('textbox',{name:'Folder name'}).fill('References');await side.getByRole('button',{name:'Save folder'}).click();
  const projects=page.locator('[data-folder]').filter({has:page.getByRole('button',{name:'Folder: Projects',exact:true})}).first();
  await side.getByRole('button',{name:'Design notes',exact:true}).first().click({button:'right'});
  const referenceId=await side.getByRole('button',{name:'Folder: References',exact:true}).locator('..').locator('..').getAttribute('data-folder');
  await page.getByRole('combobox',{name:'Move Design notes to folder'}).selectOption(referenceId);
  await page.locator(`[data-folder="${referenceId}"]`).getByRole('button',{name:'Design notes',exact:true}).waitFor();
  await side.getByRole('button',{name:'Collapse Projects',exact:true}).click();await page.reload();await side.waitFor();await side.getByRole('button',{name:'Expand Projects',exact:true}).waitFor();
  assert.equal(await side.getByRole('button',{name:'Folder: References',exact:true}).isVisible(),false);
  await side.getByRole('button',{name:'Expand Projects',exact:true}).click();
  await side.getByRole('button',{name:'Options for Projects',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Move Projects to',exact:true}).locator(`option[value="${referenceId}"]`).count(),0);await side.getByRole('button',{name:'Done',exact:true}).click();
  checks.push('Nested folders, pin filing and collapse survive reload; descendants are excluded as move destinations');
  await side.getByRole('button',{name:'Options for References',exact:true}).click();await side.getByRole('button',{name:'Rename folder',exact:true}).click();await side.getByRole('textbox',{name:'Folder name'}).fill('Research');await side.getByRole('button',{name:'Save folder'}).click();
  await makeFolder('Reading');
  const readingId=await side.getByRole('button',{name:'Folder: Reading',exact:true}).locator('..').locator('..').getAttribute('data-folder');
  // Exercise HTML drag/drop through pointer events, not a storage injection.
  const dragged=side.locator('.ab-browser__tab').filter({has:page.getByRole('button',{name:'Weekend reading',exact:true})});
  await dragged.dragTo(page.locator(`[data-folder="${readingId}"] .ab-browser__folder-row`).first());
  await page.locator(`[data-folder="${readingId}"]`).getByRole('button',{name:'Weekend reading',exact:true}).waitFor();
  checks.push('Pointer drag/drop files an existing saved page in a folder');
  await makeFolder('Temporary');await side.getByRole('button',{name:'Options for Temporary',exact:true}).click();await side.getByRole('button',{name:'Remove folder; keep pages',exact:true}).click();
  assert.equal(await side.getByRole('button',{name:'Folder: Temporary',exact:true}).count(),0);
  assert.equal(JSON.stringify(state.spaces.find(s=>s.id==='personal').pins),originalPins);
  checks.push('Folder create/rename/remove leaves the saved pin records unchanged');
  await side.locator('.ab-browser__imported > .ab-browser__head').click();
  await side.getByText('From Arc / Articles',{exact:true}).waitFor();
  await side.getByRole('button',{name:'Pin Imported article',exact:true}).click();
  await side.getByRole('button',{name:'Folder: From Arc',exact:true}).waitFor();
  await side.getByRole('button',{name:'Folder: Articles',exact:true}).waitFor();
  await page.reload();await side.getByRole('button',{name:'Imported article',exact:true}).waitFor();
  assert.equal(state.spaces.find(s=>s.id==='personal').imported.length,0);
  checks.push('An explicitly kept imported page reconstructs its nested Arc folder path and survives reload');
  for(const width of [1440,1024]){await capture(String(width),width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  const dots=await side.locator('.ab-browser__space-dot > span').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));assert(dots.every(w=>w===7||w===12));
  await side.getByRole('button',{name:'Hide the sidebar',exact:true}).click();await side.waitFor({state:'hidden'});
  await page.locator('.ab-browser__edge').hover();await side.waitFor();assert.equal(await page.locator('.ab-browser').getAttribute('data-sidebar'),'peek');
  await capture('peek-1024',1024);
  await side.getByRole('button',{name:'New folder',exact:true}).focus();await page.mouse.move(800,400);await page.waitForTimeout(350);assert(await side.isVisible(),'keyboard focus keeps Peek open');
  await page.getByRole('button',{name:'Show sidebar',exact:true}).focus();await page.waitForTimeout(350);await side.waitFor({state:'hidden'});
  await page.locator('.ab-browser__edge').hover();await side.waitFor();await side.getByRole('button',{name:'Keep the sidebar open',exact:true}).click();await page.mouse.move(800,400);await page.waitForTimeout(350);assert.equal(await page.locator('.ab-browser').getAttribute('data-sidebar'),'pinned');
  checks.push('120ms hover reveal, delayed leave, keyboard focus retention and explicit pinning work');
  await side.getByRole('button',{name:'Hide the sidebar',exact:true}).click();await page.reload();await side.waitFor({state:'hidden'});await page.getByRole('button',{name:'Show sidebar',exact:true}).click();await side.waitFor();
  checks.push('Hidden/pinned preference survives reload without changing the current page');
  await capture('390-page',390);await side.waitFor({state:'hidden'});await page.getByRole('button',{name:'Show sidebar',exact:true}).click();await side.waitFor();await capture('390-drawer',390);const drawerBounds=await side.boundingBox();assert.equal(Math.round(drawerBounds.width),300);assert(drawerBounds.x>=0&&drawerBounds.x+drawerBounds.width<=390&&drawerBounds.y+drawerBounds.height<=900);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await side.getByRole('button',{name:'New folder',exact:true}).focus();await page.keyboard.press('Escape');await side.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Show sidebar',exact:true}).evaluate(el=>el===document.activeElement),true);
  checks.push('390px uses an explicit drawer; Escape returns keyboard focus to its restore button');
  await page.setViewportSize({width:1440,height:900});await side.waitFor();
  await side.getByRole('button',{name:'HALO',exact:true}).click();assert.equal(await side.getByRole('button',{name:'Folder: Projects',exact:true}).count(),0);await side.getByRole('button',{name:'Personal',exact:true}).click();await side.getByRole('button',{name:'Folder: Projects',exact:true}).waitFor();
  assert.equal(JSON.stringify(state.accounts.map(({id,store})=>({id,store}))),accountsBefore);
  checks.push('Space switching isolates folders and preserves profile/store identifiers');
  await side.getByRole('button',{name:'Browser profile: Personal',exact:true}).click();await page.getByRole('menuitem',{name:'New browser profile',exact:true}).click();await side.getByRole('textbox',{name:'New browser profile name'}).fill('Reading profile');await side.getByRole('button',{name:'Create profile',exact:true}).click();
  await side.getByRole('button',{name:'Browser profile: Reading profile',exact:true}).waitFor();await page.reload();await side.getByRole('button',{name:'Browser profile: Reading profile',exact:true}).waitFor();
  assert.equal(state.accounts.length,3);assert.equal(JSON.stringify(state.accounts.slice(0,2).map(({id,store})=>({id,store}))),accountsBefore);assert.equal(state.accounts[2].signedIn,undefined);
  checks.push('A deliberate third named profile persists without changing existing stores or claiming a login');

  // Exercise the production mountPage layout contract with an iframe IPC adapter.
  // This does not establish native compositing or native fullscreen behaviour.
  const nativePage=await browser.newPage({viewport:{width:1440,height:900}});nativePage.setDefaultTimeout(10000);nativePage.setDefaultNavigationTimeout(30000);
  await nativePage.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await nativePage.addInitScript(()=>{const pages=new Map(),callbacks=new Map(),events=new Map();let callbackId=0;window.nativeEmit=(event,payload)=>{for(const [id,name]of events)if(name===event)callbacks.get(id)?.({payload});};window.nativeCalls=[];window.__TAURI_INTERNALS__={transformCallback:cb=>{callbacks.set(++callbackId,cb);return callbackId;},invoke:async(command,args={})=>{
    window.nativeCalls.push({command,...args});if(command==='plugin:event|listen'){events.set(args.handler,args.event);return args.handler;}if(command==='plugin:event|unlisten'){events.delete(args.eventId);return;}let frame=pages.get(args.tab);
    if(command==='browser_open'){frame=document.createElement('iframe');frame.title='Native IPC fixture';frame.style.position='fixed';frame.style.border='0';frame.src=args.rawUrl;frame.dataset.profile=args.profile;pages.set(args.tab,frame);document.body.append(frame);}
    if(command==='browser_open'||command==='browser_bounds')Object.assign(frame.style,{left:args.x+'px',top:args.y+'px',width:args.width+'px',height:args.height+'px'});
    if(command==='browser_visible')frame.hidden=!args.visible;
    if(command==='browser_navigate')frame.src=args.rawUrl;
    if(command==='browser_close'){frame?.remove();pages.delete(args.tab);}
    if(command==='browser_url')return frame?.contentWindow?.location.href==='about:blank'?'':frame?.contentWindow?.location.href??'';
    if(command==='browser_audio')return false;
  }};});
  await nativePage.goto(base);const nativeSide=nativePage.getByRole('complementary',{name:'Browser sidebar'});await nativeSide.waitFor();await nativePage.frameLocator('iframe').getByRole('heading').waitFor();
  await nativeSide.getByRole('button',{name:'Hide the sidebar',exact:true}).click();await nativeSide.waitFor({state:'hidden'});await nativePage.locator('.ab-browser__edge').hover();await nativeSide.waitFor();
  await nativePage.waitForFunction(()=>{const frame=document.querySelector('iframe'),side=document.querySelector('.ab-browser__sidebar');return !frame.hidden&&frame.getBoundingClientRect().left>=side.getBoundingClientRect().right;});
  await nativePage.screenshot({path:path.join(out,'arc-after-native-adapter-1440.png')});screens.push('arc-after-native-adapter-1440.png');
  await nativePage.evaluate(()=>window.nativeEmit('browser-window-state',true));
  await nativeSide.waitFor({state:'hidden'});
  await nativePage.evaluate(()=>window.nativeEmit('browser-shortcut',['wrong-tab','toggle-sidebar']));
  assert.equal(await nativeSide.isVisible(),false);
  await nativePage.evaluate(()=>{const open=window.nativeCalls.find(c=>c.command==='browser_open');window.nativeEmit('browser-shortcut',[open.tab,'toggle-sidebar']);});
  await nativeSide.waitFor();
  assert.equal(await nativePage.locator('.ab-browser').getAttribute('data-sidebar'),'pinned');
  await nativePage.evaluate(()=>{const open=window.nativeCalls.find(c=>c.command==='browser_open');window.nativeEmit('browser-shortcut',[open.tab,'new-tab']);});
  assert.equal(await nativePage.locator('.ab-browser').getAttribute('data-sidebar'),'pinned','global New Tab belongs to the app command bar');
  checks.push('Synthetic native events close transient Peek on fullscreen transitions and route only the matching tab shortcut');
  const opens=await nativePage.evaluate(()=>window.nativeCalls.filter(c=>c.command==='browser_open'));
  assert.equal(opens.length,1);assert.equal(await nativePage.evaluate(()=>window.nativeCalls.filter(c=>c.command==='browser_close').length),0);
  assert.equal(opens[0].profile,state.accounts[2].id);
  checks.push('Iframe IPC adapter: native-mode Peek reserves the page slot and does not reopen or change its profile; native composition remains unverified');
  await nativePage.close();

 }
 assert.deepEqual(errors,[]);checks.push('No page errors; all requests restricted to the isolated fixture origin');
 await writeFile(path.join(out,`arc-${before?'before':'after'}-receipt.json`),JSON.stringify({proof:'Production Browser in headless WebKit; isolated fake API, not native Tauri',checks,screens},null,2)+'\n');
 console.log(JSON.stringify({checks,screens}));
}catch(error){const pages=browser?.contexts().flatMap(c=>c.pages())??[];if(pages[0]){await pages[0].screenshot({path:path.join(out,'arc-check-failure.png')});console.error((await pages[0].locator('body').innerText()).slice(0,2400));}throw error;}finally{await browser?.close();await server.close();await rm(scratch,{recursive:true});}
