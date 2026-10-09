import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanBrowserFolders, canMoveBrowserFolder, moveBrowserFolder, removeBrowserFolder, fileBrowserPin, loadBrowserFolders, saveBrowserFolders } from '../../web/src/lib/browser-tabs.ts';
import { createBrowserStore } from '../../web/src/lib/browser-store.ts';
import { cleanState, readBrowserState, writeBrowserState, mergeBrowserState } from '../../../services/node/src/browser-state.ts';
const folder=(id,parentId,space='personal')=>({id,name:id,space,parentId,collapsed:false,urls:[]});
const url='https://docs.example.invalid/notes';
test('invalid folder data cannot create cycles, cross-space nesting, duplicate ids or persisted login URLs',()=>{
 assert.deepEqual(cleanBrowserFolders([{...folder('console'),urls:['http://127.0.0.1:8891/card/synthetic/html']}])[0].urls,['http://127.0.0.1:8891/card/synthetic/html']);
 const rows=cleanBrowserFolders([folder('a','b'),folder('b','a'),folder('other','a','work'),folder('lost','missing'),folder('a'),{...folder('page'),urls:[url,url,'https://accounts.google.com/login','https://site.invalid/?token=secret']}, {...folder('twice'),urls:[url]}]);
 assert.equal(rows.length,6);assert.equal(rows.find(r=>r.id==='a').parentId,undefined);assert.equal(rows.find(r=>r.id==='other').parentId,undefined);assert.equal(rows.find(r=>r.id==='lost').parentId,undefined);assert.deepEqual(rows.find(r=>r.id==='page').urls,[url]);assert.deepEqual(rows.find(r=>r.id==='twice').urls,[]);
 const deep=cleanBrowserFolders(Array.from({length:12},(_,i)=>folder(String(i),i?String(i-1):undefined)));
 for(const row of deep){let n=0,p=row;while(p){assert(++n<=8);p=deep.find(r=>r.id===p.parentId);}}
});
test('folder moves reject descendants and excessive subtree depth while keeping sibling order stable',()=>{
 const rows=[folder('a'),folder('b','a'),folder('c','b'),folder('other',undefined,'work')];
 assert.equal(canMoveBrowserFolder(rows,'a','c'),false);assert.equal(moveBrowserFolder(rows,'a','c'),rows);assert.equal(canMoveBrowserFolder(rows,'b','other'),false);
 assert.deepEqual(moveBrowserFolder(rows,'b').map(r=>r.id),['a','b','c','other']);assert.equal(moveBrowserFolder(rows,'b')[1].parentId,undefined);
 const deep=Array.from({length:8},(_,i)=>folder(String(i),i?String(i-1):undefined));assert.equal(canMoveBrowserFolder([...deep,folder('x'),folder('y','x')],'x','6'),false);
});
test('moving pins changes only folder references; removing folders promotes children and keeps pages',()=>{
 const rows=fileBrowserPin([folder('parent'),folder('child','parent'),folder('grand','child'),folder('work',undefined,'work')],'personal',url,'child');
 const moved=fileBrowserPin(rows,'personal',url,'parent');assert.deepEqual(moved[0].urls,[url]);assert.deepEqual(moved[1].urls,[]);
 const removed=removeBrowserFolder(rows,'child');assert.equal(removed.find(r=>r.id==='grand').parentId,'parent');assert.deepEqual(removed.find(r=>r.id==='parent').urls,[url]);
 const root=removeBrowserFolder(rows,'parent');assert.equal(root.find(r=>r.id==='child').parentId,undefined);assert.deepEqual(root.find(r=>r.id==='child').urls,[url]);assert.deepEqual(root.find(r=>r.id==='work'),rows[3]);
});
test('folders and collapse state persist through a private node file and a new store; legacy pins and profile ids stay byte-identical',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-browser-folders-'));try{
 const file=path.join(dir,'browser.json');const original={migratedAt:1,spaces:[{id:'personal',name:'Personal',pinVersion:2,pins:[{url,title:'Notes',origin:'user',custom:'preserve'}]}],accounts:[{id:'personal',store:'personal',name:'Personal'}],today:{personal:[{url,title:'Notes',at:Date.now()}]}};
 writeBrowserState(file,original);const io={get:async()=>readBrowserState(file),put:async(state,opts)=>mergeBrowserState(file,Object.fromEntries(opts.fields.map(k=>[k,state[k]])))};
 const store=createBrowserStore(io,null);await store.load();assert.deepEqual(loadBrowserFolders(store),[]);
 const folders=[{...folder('research'),collapsed:true,urls:[url]}];saveBrowserFolders(folders,store);await store.flush();
 const again=createBrowserStore(io,null);await again.load();assert.deepEqual(loadBrowserFolders(again),folders);const actual=readBrowserState(file);
 assert.deepEqual(actual.spaces,original.spaces);assert.deepEqual(actual.accounts,original.accounts);assert.deepEqual(actual.today,original.today);assert.equal(statSync(file).mode&0o777,0o600);
 mergeBrowserState(file,{last:'personal'});assert.deepEqual(readBrowserState(file).folders,folders);assert.deepEqual(cleanState({folders:'invalid'}),{});
 }finally{rmSync(dir,{recursive:true});}
});
test('deliberate named profiles survive reload with distinct stable stores and no sign-in claim',async()=>{
 const { createNamedBrowserProfile }=await import('../../web/src/lib/browser-setup.ts');
 const { loadAccounts, storeOf }=await import('../../web/src/lib/webview.ts');
 const map=new Map([['agent-base:browser-accounts',JSON.stringify([{id:'personal',name:'Personal',store:'personal'}])]]);
 const store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const a=createNamedBrowserProfile('Work',store),b=createNamedBrowserProfile('Research',store);
 assert.notEqual(storeOf(a),storeOf(b));assert.deepEqual(loadAccounts(store)[0],{id:'personal',name:'Personal',store:'personal'});
 assert.equal(storeOf(loadAccounts(store).find(x=>x.id===a.id)),a.id);assert.equal(a.signedIn,undefined);
 assert.throws(()=>createNamedBrowserProfile('work',store),/already/);assert.throws(()=>createNamedBrowserProfile(' ',store),/name/);
});
