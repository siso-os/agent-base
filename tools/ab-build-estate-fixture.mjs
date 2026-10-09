#!/usr/bin/env node
// Read-only pinned Estate source -> an Agent Base-owned, entirely synthetic companion.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {estateFixture,estateProposedFixture} from './ab-qa-fixtures.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const hash=data=>createHash('sha256').update(data).digest('hex');
export const pins=JSON.parse(fs.readFileSync(path.join(here,'ab-estate-source.json'),'utf8'));
const defaultEstate=path.join(os.homedir(),'SISO_Workspace/SISO_Agents/siso-estate');
export function verifySource(estate){
 const app=path.join(estate,pins.prefix), git=(...args)=>execFileSync('git',['-C',estate,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
 git('cat-file','-e',pins.revision+'^{commit}');
 for(const [name,digest] of Object.entries(pins.files)){
  const file=path.join(app,name);
  if(fs.realpathSync(file)!==file || !fs.statSync(file).isFile() || hash(fs.readFileSync(file))!==digest)throw new Error('Pinned Estate source mismatch: '+name);
 }
 for(const [name,version] of Object.entries(pins.dependencies)){
  const actual=JSON.parse(fs.readFileSync(path.join(app,'node_modules',name,'package.json'),'utf8')).version;
  if(actual!==version)throw new Error('Existing dependency version mismatch: '+name);
 }
 return {app,sourceRevision:pins.revision,observedHead:git('rev-parse','HEAD'),sourceFiles:pins.files,dependencies:pins.dependencies};
}

export function fixturePlugin(app){
 const seen={world:0,proposed:0};
 const world=JSON.stringify(estateFixture),proposed=JSON.stringify(estateProposedFixture);
 const dataFile=path.join(app,'src/data.ts'),mainFile=path.join(app,'src/main.ts');
 const privateFiles=new Set([path.resolve(app,'../world.json'),path.join(app,'src/proposed.json')]);
 const clean=id=>id.split('?')[0];
 const plugin={name:'ab-estate-synthetic-inputs',enforce:'pre',
  transformIndexHtml:{order:'pre',handler(html){
   return html.replaceAll('./src/lion.webp','data:image/webp;base64,'+fs.readFileSync(path.join(app,'src/lion.webp')).toString('base64'));
  }},
  resolveId(id,importer){
   if(id==='../../world.json?gz' && importer && clean(importer)===dataFile){seen.world++;return '\0ab-estate-world';}
   if(id==='./proposed.json' && importer && clean(importer)===mainFile){seen.proposed++;return '\0ab-estate-proposed';}
   if(importer && (id.startsWith('.') || path.isAbsolute(id))){
    const resolved=path.resolve(path.dirname(clean(importer)),clean(id));
    if(privateFiles.has(resolved))throw new Error('Unexpected private Estate input refused');
    if(id.endsWith('?gz')){
     const name=path.relative(app,resolved);
     if(!Object.hasOwn(pins.files,name) || !name.startsWith('src/assets/') || !name.endsWith('.glb'))throw new Error('Unapproved gzip input');
     return '\0ab-estate-model:'+resolved;
    }
   }
   return null;
  },
  load(id){
   if(id==='\0ab-estate-world')return 'export default '+JSON.stringify(zlib.gzipSync(world,{level:9}).toString('base64'));
   if(id==='\0ab-estate-proposed')return 'export default '+proposed;
   if(id.startsWith('\0ab-estate-model:'))return 'export default '+JSON.stringify(zlib.gzipSync(fs.readFileSync(id.slice('\0ab-estate-model:'.length)),{level:9}).toString('base64'));
   const file=clean(id);
   if(privateFiles.has(file))throw new Error('Private Estate file load refused');
   if(file.startsWith(app+path.sep) && !file.startsWith(path.join(app,'node_modules')+path.sep)){
    if(!Object.hasOwn(pins.files,path.relative(app,file)))throw new Error('Source outside Estate allowlist: '+path.relative(app,file));
   }
   return null;
  },
  buildEnd(error){if(!error && (seen.world!==1 || seen.proposed!==1))throw new Error('Both synthetic inputs must replace exactly one import');},
 };
 return {plugin,seen,inputHashes:{world:hash(world),proposed:hash(proposed)}};
}

export async function buildFixture({estate=defaultEstate,out}){
 if(!out)throw new Error('owned output path required');
 estate=fs.realpathSync(estate);out=path.resolve(out);
 if(out===estate || out.startsWith(estate+path.sep) || fs.existsSync(out))throw new Error('Output must be a new owned directory outside Estate');
 const source=verifySource(estate), {app}=source, {plugin,seen,inputHashes}=fixturePlugin(app);
 const require=createRequire(path.join(app,'package.json'));
 const {build}=await import(pathToFileURL(require.resolve('vite')).href);
 const {viteSingleFile}=await import(pathToFileURL(require.resolve('vite-plugin-singlefile')).href);
 fs.mkdirSync(out,{recursive:true});
 await build({configFile:false,root:app,envDir:path.join(out,'env'),publicDir:false,cacheDir:path.join(out,'cache'),base:'./',
  plugins:[plugin,viteSingleFile({removeViteModuleLoader:true})],
  build:{outDir:out,emptyOutDir:false,copyPublicDir:false,target:'es2022',assetsInlineLimit:100_000_000,chunkSizeWarningLimit:20_000,rollupOptions:{input:path.join(app,'world.html')}},
 });
 // Recheck pins after build: concurrent source changes cannot produce accepted fixture evidence.
 verifySource(estate);
 const artifact=path.join(out,'world.html');
 if(fs.readdirSync(out).some(name=>!['world.html','cache'].includes(name)))throw new Error('Companion must be a single self-contained HTML file');
 const manifest={schema:1,kind:'estate-synthetic-companion',...source,inputHashes,substitutions:seen,
  producerSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),pinsSha256:hash(fs.readFileSync(path.join(here,'ab-estate-source.json'))),
  artifact:{file:'world.html',sha256:hash(fs.readFileSync(artifact)),bytes:fs.statSync(artifact).size},
  expected:{buildings:estateFixture.buildings.length,regions:estateFixture.regions.length,roads:estateFixture.roads.length,buildingIds:estateFixture.buildings.map(b=>b.id),buildingNames:estateFixture.buildings.map(b=>b.name)},
  query:'gl=1&q=low&cam=mainland',inputMode:'synthetic-only',privateInputsRead:false,
 };
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
 const manifest=await buildFixture({estate:arg('--estate-source'),out:arg('--out')});
 console.log(JSON.stringify({manifest:path.join(path.resolve(arg('--out')),'manifest.json'),artifact:manifest.artifact,sourceRevision:manifest.sourceRevision,substitutions:manifest.substitutions}));
}
