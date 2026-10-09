import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixturePlugin,pins} from '../ab-build-estate-fixture.mjs';
import {estateFixture,estateProposedFixture} from '../ab-qa-fixtures.mjs';
import {loadEstateCompanion,walk} from '../ab-qa-walk.mjs';

test('both private inputs are resolved to deterministic synthetic modules',()=>{
 const {plugin,seen}=fixturePlugin('/synthetic/source');
 const world=plugin.resolveId('../../world.json?gz','/synthetic/source/src/data.ts');
 const proposed=plugin.resolveId('./proposed.json','/synthetic/source/src/main.ts');
 const encoded=JSON.parse(plugin.load(world).slice('export default '.length));
 assert.deepEqual(JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64'))),estateFixture);
 assert.deepEqual(JSON.parse(plugin.load(proposed).slice('export default '.length)),estateProposedFixture);
 assert.deepEqual(seen,{world:1,proposed:1});plugin.buildEnd();
 assert.equal(estateFixture.buildings.length,2);assert.ok(estateFixture.tiles.length>0);
 assert.ok(estateFixture.buildings.every(b=>b.path.startsWith('synthetic/')));
});
test('unexpected paths cannot load private records or unapproved source/assets',()=>{
 const {plugin}=fixturePlugin('/synthetic/source');
 for(const file of ['/synthetic/world.json','/synthetic/source/src/proposed.json'])assert.throws(()=>plugin.load(file),/Private/);
 assert.throws(()=>plugin.resolveId('./proposed.json','/synthetic/source/src/other.ts'),/private/);
 assert.throws(()=>plugin.resolveId('../../world.json?gz','/synthetic/source/src/other.ts'),/private/);
 assert.throws(()=>plugin.resolveId('../../world.json','/synthetic/source/src/other.ts'),/private/);
 assert.throws(()=>plugin.resolveId('./secret.glb?gz','/synthetic/source/src/kit.ts'),/Unapproved/);
 assert.throws(()=>plugin.load('/synthetic/source/src/unapproved.ts'),/allowlist/);
 assert.throws(()=>plugin.buildEnd(),/Both synthetic inputs/);
 assert.equal(pins.files['src/proposed.json'],undefined);
 assert.equal(pins.files['../../world.json'],undefined);
});

test('companion hashes and rendered readiness are independent gates',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'.siso-ephemeral-estate-contract.'));
 const hash=data=>createHash('sha256').update(data).digest('hex');
 try{
  const html='<h1>Placeholder must never pass</h1><script>window.__world={ready:false,error:"synthetic renderer unavailable"}</script>';
  fs.writeFileSync(path.join(tmp,'world.html'),html);
  const manifest={schema:1,kind:'estate-synthetic-companion',inputMode:'synthetic-only',privateInputsRead:false,
   sourceRevision:pins.revision,sourceFiles:pins.files,dependencies:pins.dependencies,pinsSha256:hash(fs.readFileSync(new URL('../ab-estate-source.json',import.meta.url))),producerSha256:hash(fs.readFileSync(new URL('../ab-build-estate-fixture.mjs',import.meta.url))),
   inputHashes:{world:hash(JSON.stringify(estateFixture)),proposed:hash(JSON.stringify(estateProposedFixture))},substitutions:{world:1,proposed:1},
   expected:{buildings:estateFixture.buildings.length,regions:estateFixture.regions.length,roads:estateFixture.roads.length,buildingIds:estateFixture.buildings.map(b=>b.id),buildingNames:estateFixture.buildings.map(b=>b.name)},query:'gl=1&q=low&cam=mainland',artifact:{file:'world.html',sha256:hash(html),bytes:Buffer.byteLength(html)}};
  const file=path.join(tmp,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
  assert.equal(loadEstateCompanion(file).html.toString(),html);
  const build=path.join(tmp,'build');fs.mkdirSync(build);fs.writeFileSync(path.join(build,'DEPLOYED_SHA'),'a'.repeat(40));
  fs.writeFileSync(path.join(build,'index.html'),'<div id="root"><iframe title="Estate world" src="/estate-world/" style="width:100%;height:800px"></iframe></div>');
  const {webkit}=createRequire(path.resolve('services/node/package.json'))('playwright');
  const result=await walk({revision:'a'.repeat(40),out:path.join(tmp,'out'),build,companionManifest:file,browserType:webkit,inventory:[{id:'estate',space:'estate'}],widths:[390]});
  assert.equal(result.state,'failed');assert.match(result.routes[0].errors.join(' '),/renderer unavailable/);
  fs.writeFileSync(path.join(tmp,'world.html'),html+'tampered');assert.throws(()=>loadEstateCompanion(file),/artifact hash/);
  fs.writeFileSync(path.join(tmp,'world.html'),html);manifest.inputHashes.proposed='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(manifest));assert.throws(()=>loadEstateCompanion(file),/synthetic inputs/);
 }finally{fs.rmSync(tmp,{recursive:true});}
});
