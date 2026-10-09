// HTTP-served timing artifacts only; no live app and no UI screenshots.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'services/node/package.json'));
const {webkit}=require('playwright');
const base=path.join(root,'ui-hub/right-panel/rounds/reconnect');
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1)||'index.html';if(!/^[\w.-]+$/.test(name))return res.writeHead(404).end();try{res.setHeader('content-type',name.endsWith('.png')?'image/png':name.endsWith('.json')?'application/json':name.endsWith('.html')?'text/html':'text/plain');res.end(readFileSync(path.join(base,name)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const result={url,serverPid:process.pid,cases:[],errors:[]};let browser;
try{
 browser=await webkit.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:900});const response=await page.goto(url,{waitUntil:'load'});assert.equal(response.status(),200);
  assert.equal(await page.locator('tbody tr').count(),5);
  const images=await page.locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0));assert.ok(images);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  result.cases.push({width,http:200,timingRows:5,chartsLoaded:true,noHorizontalOverflow:true});
 }
 assert.deepEqual(result.errors,[]);
}finally{await browser?.close();await new Promise(r=>server.close(r));result.browserClosed=true;result.serverClosed=!server.listening;writeFileSync(path.join(base,'receipt-gallery.json'),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result));
