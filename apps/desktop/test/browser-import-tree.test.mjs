import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArcSidebar, applyBrowserImport, keepImportedPage, loadArcProfiles, saveArcProfiles, saveAccounts, loadAccounts } from '../../web/src/lib/webview.ts';
import { loadBrowserFolders, saveBrowserFolders } from '../../web/src/lib/browser-tabs.ts';
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; };
const tab = (id, url = `https://${id}.example.invalid/`) => ({ id, data: { tab: { savedURL: url, savedTitle: id } } });
function fixture() {
  return { sidebar: { containers: [{ spaces: ['s', { id: 's', title: 'HALO', newContainerIDs: [{ pinned: {} }, 'root', { unpinned: {} }, 'today'] }], items: [
    tab('b'), { id: 'root', childrenIds: ['folder', 'top'] }, { id: 'folder', title: 'Research', childrenIds: ['a','nested','b'] },
    { id: 'nested', title: 'References', childrenIds: ['c','folder','missing'] }, tab('a'), tab('c'), tab('top'),
    { ...tab('recovered'), parentID: 'folder' }, { id:'today', childrenIds: ['old'] }, tab('old'),
    { ...tab('duplicate','https://a.example.invalid/'), parentID: 'folder' },
    { ...tab('unsafe','https://app.example.invalid/callback?token=never-store'), parentID: 'folder' },
  ] }] } };
}
const data = raw => ({ arc: { found: true, spaces: parseArcSidebar(JSON.stringify(raw)) }, chrome: { found: false, accounts: [] } });
test('Arc tree preserves source space, folder and page order while guarding cycles, missing ids, duplicates and unsafe URLs', () => {
  const [space] = data(fixture()).arc.spaces;
  assert.deepEqual(space.pins.map(p=>p.title), ['a','c','b','recovered','top']);
  assert.deepEqual(space.importedFolders.map(f=>[f.name, f.urls.map(u=>new URL(u).hostname.split('.')[0])]), [['Research',['a','b','recovered']],['References',['c']]]);
  assert.equal(space.importedFolders[1].parentId, space.importedFolders[0].id);
  assert.deepEqual(space.today.map(p=>p.title), ['old']);
});
test('import stays staged, merges aliases, and keeping one page materialises only its path with stable sessions', () => {
  const store = memory(); saveAccounts([{id:'personal',name:'Primary',store:'store:unchanged'}],store);
  const originalAccounts = loadAccounts(store);
  const first = applyBrowserImport(data(fixture()),store);
  assert.equal(first.profiles[0].id,'HALO'); assert.deepEqual(first.profiles[0].pins,[]);
  assert.deepEqual(loadBrowserFolders(store),[]); assert.equal(first.profiles[0].today,undefined);
  assert.deepEqual(applyBrowserImport(data(fixture()),store).profiles,first.profiles);
  const saved = keepImportedPage(store,'arc:s','https://c.example.invalid/');
  assert.equal(saved.folders.length,2); assert.deepEqual(saved.folders.map(f=>f.space),['HALO','HALO']);
  assert.deepEqual(saved.folders.map(f=>f.urls),[[],['https://c.example.invalid/']]);
  assert.deepEqual(saved.profiles[0].pins.map(p=>p.title),['c']);
  assert.equal(keepImportedPage(store,'arc:s','https://c.example.invalid/'),null,'stale click cannot duplicate');
  assert.deepEqual(loadAccounts(store),originalAccounts);
});
test('reimport extends staged folder URLs and retains saved folder edits and existing placements', () => {
  const store=memory(); applyBrowserImport(data(fixture()),store); keepImportedPage(store,'HALO','https://a.example.invalid/');
  const old=loadBrowserFolders(store); old[0].name='My chosen name'; old[0].collapsed=true; saveBrowserFolders(old,store);
  const next=fixture(); next.sidebar.containers[0].items.push({...tab('new'),parentID:'folder'});
  applyBrowserImport(data(next),store); keepImportedPage(store,'HALO','https://new.example.invalid/');
  const folders=loadBrowserFolders(store); assert.equal(folders.length,1); assert.equal(folders[0].name,'My chosen name'); assert.equal(folders[0].collapsed,true);
  assert.deepEqual(folders[0].urls,['https://a.example.invalid/','https://new.example.invalid/']);
  assert.deepEqual(loadArcProfiles(store)[0].pins.map(p=>p.title),['a','new']);
});
test('folder collisions and vanished targets preserve owned records; favourites never create folder paths', () => {
  const store=memory(); const imported=applyBrowserImport(data(fixture()),store).profiles[0];
  const collision={...imported.importedFolders[0],space:'elsewhere',name:'Owned',urls:['https://owned.example.invalid/']}; saveBrowserFolders([collision],store);
  assert.equal(keepImportedPage(store,'gone','https://a.example.invalid/'),null);
  keepImportedPage(store,'HALO','https://a.example.invalid/'); assert.deepEqual(loadBrowserFolders(store),[collision]);
  keepImportedPage(store,'HALO','https://c.example.invalid/',true); assert.deepEqual(loadBrowserFolders(store),[collision]);
  assert.equal(loadArcProfiles(store).find(s=>s.id==='arc-favorites').pins[0].title,'c');
  saveArcProfiles([],store); assert.equal(keepImportedPage(store,'HALO','https://b.example.invalid/'),null);
});

test('native events are bounded, targetable and stop delivering after disposal', async () => {
  const { onBrowserShortcut, onBrowserWindowChange } = await import('../../web/src/lib/webview.ts');
  const callbacks = new Map(), calls=[]; let next=0;
  globalThis.window={__TAURI_INTERNALS__:{transformCallback:cb=>{callbacks.set(++next,cb);return next;},invoke:async(cmd,args)=>{calls.push({cmd,args});return args.handler;}}};
  try {
    const shortcuts=[],states=[]; const stop=onBrowserShortcut(s=>shortcuts.push(s)),stopState=onBrowserWindowChange(s=>states.push(s));
    const deliver=(id,payload)=>callbacks.get(id)({payload});
    deliver(1,['synthetic#profile','toggle-sidebar']); deliver(1,['synthetic#profile','space-2']);deliver(1,['synthetic#profile','new-tab']);
    for(const payload of [null,{},['synthetic','reload'],['synthetic','space-10'],['x'.repeat(601),'toggle-sidebar']])deliver(1,payload);
    deliver(2,true);deliver(2,false);deliver(2,'true');
    assert.deepEqual(shortcuts,[{tab:'synthetic#profile',action:'toggle-sidebar'},{tab:'synthetic#profile',action:'space-2'},{tab:'synthetic#profile',action:'new-tab'}]); assert.deepEqual(states,[true,false]);
    stop();stopState();deliver(1,['synthetic#profile','toggle-sidebar']);deliver(2,true);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(shortcuts.length,3);assert.equal(states.length,2);assert.equal(calls.filter(c=>c.cmd==='plugin:event|unlisten').length,2);
  }finally{delete globalThis.window;}
});
