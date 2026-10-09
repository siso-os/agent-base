import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {webkit} from '../../services/node/test/suite-runtime.mjs';
const origin='http://127.0.0.1:5401';
const {agents}=await (await fetch(origin+'/api/agents')).json();
const zero=agents.find(a=>a.zero);
assert.ok(zero,'Live Agent Zero row must exist');
const browser=await webkit.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.routeWebSocket(/\/term\//,ws=>ws.close());
  let posts=0;
  await page.route(/\/api\/agents\/[^/]+\/move$/,route=>{
    if(route.request().method()==='POST'){posts++;return route.abort();}
    return route.continue();
  });
  await page.addInitScript(id=>{
    localStorage.setItem('agent-base:active',JSON.stringify(id));
    localStorage.setItem('agent-base:open',JSON.stringify([id]));
    localStorage.setItem('agent-base:view','chat');
  },zero.id);
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.getByTestId('model-chip').first().click({timeout:60000});
  const option=page.getByRole('menuitem',{name:'Codex Sol',exact:false});
  assert.equal(await option.isEnabled(),true);
  const confirmation=new Promise(resolve=>page.once('dialog',async dialog=>{
    const message=dialog.message();await dialog.dismiss();resolve(message);
  }));
  await option.click();
  const message=await confirmation;
  assert.equal(message,'Move Agent Zero to Codex Sol? It reads its handover first; this chat stays on disk');
  assert.equal(posts,0);
  await page.screenshot({path:new URL('live.png',import.meta.url).pathname});
  writeFileSync(new URL('live-confirm.json',import.meta.url),JSON.stringify({enabled:true,confirmation:message,dismissed:true,movePosts:posts,terminalAttachments:0},null,2));
  console.log('PASS live Agent Zero: Sol enabled; exact confirmation dismissed; 0 move POSTs; terminal sockets blocked');
} finally {await browser.close();}
