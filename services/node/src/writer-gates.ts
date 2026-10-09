/** t-0391: checks on the existing component catalog, workspace receipt and .agents/ship.json. No launch/repair here. */
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {readComponentCatalog} from './component-catalog.ts';
import {validateWorkspaceReceipt,type WriterBinding} from '../../host/src/worktree-contract.ts';

const exec=promisify(execFile),SHA=/^[a-f0-9]{40,64}$/,HASH=/^[a-f0-9]{64}$/;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ordered=(v:any):any=>Array.isArray(v)?v.map(ordered):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
const bytesHash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const safePath=(v:unknown):v is string=>typeof v==='string'&&v.length<=500&&!v.includes('\\')&&v.split('/').every(s=>!!s&&s!=='.'&&s!=='..'&&/^[\w .()-]+$/.test(s)&&!/^(?:\.env(?:\.|$)|\.credentials$|personal$)/.test(s));
function fail(message:string):never{throw new Error(message);}
async function git(repo:string,args:string[],maxBuffer=512*1024){
  try{return (await exec('git',['-C',repo,...args],{timeout:10_000,maxBuffer,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
  catch{throw new Error('Writer Git evidence is unavailable or does not match');}
}
async function file(repo:string,relative:string,max=1024*1024):Promise<Buffer>{
  if(!safePath(relative))fail('Invalid writer evidence path');
  let current=await realpath(repo);
  for(const part of relative.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())fail('Writer evidence cannot use symbolic links');}
  const s=await lstat(current);if(!s.isFile()||s.size>max)fail('Writer evidence is missing or exceeds its bound');
  return readFile(current);
}
async function clean(repo:string,expected?:string){
  if(await git(repo,['status','--porcelain','--untracked-files=all']))fail('Writer source is dirty; preserve edits and return it to the author');
  const head=await git(repo,['rev-parse','HEAD']);if(!SHA.test(head)||(expected&&head!==expected))fail('Writer source revision changed');return head;
}

export type ComponentDossier = {
  version:1; sourceRevision:string;
  files:{path:string;sha256:string}[];
  context:{role:'files'|'traps'|'reasoning'|'feedback';path:string;sha256:string}[];
};
/** Source revision pins code; hashes also bind the component's context files without a self-referential commit hash. */
export async function readWriterDossier(repo:string,surface:unknown):Promise<WriterBinding>{
  if(typeof surface!=='string'||!/^[a-z_][a-z0-9_-]{0,79}$/.test(surface))fail('Component writer needs an explicit catalog surface');
  const head=await clean(repo);
  const catalog=readComponentCatalog(path.join(repo,'ui-hub'));
  const component=catalog.components.find(c=>c.id===surface);
  if(!component)fail('Writer component is absent from the catalog');
  const d:ComponentDossier=component.writerDossier;
  if(!d||d.version!==1||!SHA.test(d.sourceRevision)||!Array.isArray(d.files)||!d.files.length||d.files.length>80||!Array.isArray(d.context)||d.context.length!==4)fail('Component dossier is missing or incomplete');
  if(new Set(d.files.map(f=>f?.path)).size!==d.files.length||['files','traps','reasoning','feedback'].some(role=>d.context.filter(c=>c?.role===role).length!==1))fail('Component dossier roles or file inventory are invalid');
  await git(repo,['merge-base','--is-ancestor',d.sourceRevision,head]);
  for(const entry of [...d.files,...d.context]){
    if(!object(entry)||!safePath(entry.path)||!HASH.test(entry.sha256))fail('Component dossier has an invalid file binding');
    if('role' in entry&&(!entry.path.startsWith(`ui-hub/${surface}/`)||!entry.path.endsWith('.md')))fail('Component context must stay in its own dossier');
    await git(repo,['ls-files','--error-unmatch','--',entry.path]);
    const contents=await file(repo,entry.path,'role' in entry?64*1024:1024*1024);
    if(bytesHash(contents)!==entry.sha256)fail('Component dossier is stale: a bound file changed');
    if('role' in entry){
      const text=contents.toString('utf8').replace(/<!--[\s\S]*?-->/g,'').trim();
      if(text.length<24||/^(?:#.*\n\s*)?(?:todo|tbd|pending|placeholder)\b/i.test(text))fail('Component dossier context is incomplete');
    }else{
      const recorded=await exec('git',['-C',repo,'show',`${d.sourceRevision}:${entry.path}`],{timeout:10_000,maxBuffer:1024*1024,encoding:'buffer'}).catch(()=>fail('Dossier source revision does not contain its file inventory'));
      if(bytesHash(recorded.stdout)!==entry.sha256)fail('Dossier source revision and code hashes disagree');
    }
  }
  await clean(repo,head);
  return {version:1,surface,sourceRevision:head,dossierDigest:digest({surface,writerDossier:d})};
}

export type WriterShipDeclaration={version:1;workspaceId:string;surface:string;targetRevision:string;dossierBefore:string;dossierAfter:string};
/** Called afresh at queue admission and again immediately before landing checks. Checks still run in the existing queue. */
export async function checkLandingWriter(repo:string,sourceRef:string,sourceRevision:string,targetRevision:string,receiptFor:(id:string)=>string){
  if(!SHA.test(sourceRevision)||!SHA.test(targetRevision)||!/^refs\/(?:heads|remotes\/[A-Za-z0-9_.-]+)\/[A-Za-z0-9_./-]+$/.test(sourceRef)||sourceRef.includes('..'))fail('Invalid landing revision identity');
  if(await git(repo,['rev-parse',`${sourceRef}^{commit}`])!==sourceRevision)fail('Queued writer branch moved; return it to the author');
  try{await git(repo,['merge-base','--is-ancestor',targetRevision,sourceRevision]);}
  catch{fail('Source is not rebased onto the current landing target; return it to the author');}
  const localRef=sourceRef.replace(/^refs\/remotes\/[^/]+\//,'refs/heads/');
  const rows=(await git(repo,['worktree','list','--porcelain'])).split('\n\n').filter(b=>b.split('\n').includes(`branch ${localRef}`));
  if(rows.length!==1)fail('Writer source checkout cannot be uniquely observed');
  const source=rows[0].split('\n').find(l=>l.startsWith('worktree '))?.slice(9);if(!source)fail('Writer source checkout is missing');
  await clean(source,sourceRevision);
  let manifest:any;
  try{manifest=JSON.parse((await file(source,'.agents/ship.json',64*1024)).toString('utf8'));}
  catch(error:any){
    if(error.code!=='ENOENT')fail('Delivery manifest is unavailable');
    let result='';try{result=(await file(source,'RESULT.md',64*1024)).toString('utf8');}catch{}
    manifest={tests:result.match(/^\.agents\/tests:\s*(.+)$/m)?.[1]};
  }
  if(!object(manifest)||typeof manifest.tests!=='string'||!manifest.tests.trim()||manifest.tests.length>8000||/[\r\n]/.test(manifest.tests))fail('Delivery manifest must declare the checks');
  // General releases predate component writers. Read durable ownership independently of
  // the branch's declaration so removing `writer` cannot downgrade a component workspace.
  const receiptRoot=path.dirname(receiptFor('ws-probe'));
  let names:string[]=[];try{names=await readdir(receiptRoot);}catch(error:any){if(error.code!=='ENOENT')fail('Workspace ownership registry is unavailable');}
  if(names.length>20_000)fail('Workspace ownership registry exceeds its inspection bound');
  const common=await realpath(path.resolve(source,await git(source,['rev-parse','--git-common-dir'])));
  const owned:any[]=[];
  for(const name of names.filter(n=>/^ws-[A-Za-z0-9_-]+\.json$/.test(n))){
    let r:any;try{r=JSON.parse((await file(receiptRoot,name,256*1024)).toString('utf8'));}catch{fail('Workspace ownership registry contains unreadable evidence');}
    if(r.worktreePath===source||(r.commonGitDir===common&&r.branch===localRef.slice('refs/heads/'.length)))owned.push(r);
  }
  if(localRef.startsWith('refs/heads/job/')&&!owned.length)fail('Managed release workspace receipt is missing');
  const componentOwned=owned.some(r=>r.input&&Object.hasOwn(r.input,'writer'));
  if(!Object.hasOwn(manifest,'writer')&&!componentOwned){
    await clean(source,sourceRevision);
    if(await git(repo,['rev-parse',`${sourceRef}^{commit}`])!==sourceRevision)fail('Release branch changed during landing admission');
    return {phase:'ready-for-checks' as const,kind:'general' as const,sourceRevision,targetRevision,tests:manifest.tests};
  }
  const w:WriterShipDeclaration=manifest.writer;
  if(!w||w.version!==1||!/^ws-[A-Za-z0-9_-]{1,125}$/.test(w.workspaceId)||w.targetRevision!==targetRevision||!HASH.test(w.dossierBefore)||!HASH.test(w.dossierAfter))fail('Delivery manifest writer binding is missing or stale');
  const receipt=validateWorkspaceReceipt(receiptFor(w.workspaceId),source);
  const before=receipt.input.writer;
  if(receipt.workspaceId!==w.workspaceId||!before||before.surface!==w.surface||before.dossierDigest!==w.dossierBefore||receipt.input.workspace.type==='shared')fail('Delivery is not bound to its original owned writer workspace');
  await git(source,['merge-base','--is-ancestor',before.sourceRevision,sourceRevision]);
  const after=await readWriterDossier(source,w.surface);
  if(after.dossierDigest!==w.dossierAfter||after.dossierDigest===before.dossierDigest)fail('Writer must update the version-bound component dossier before landing');
  const component=readComponentCatalog(path.join(source,'ui-hub')).components.find(c=>c.id===w.surface)!;
  const d=component.writerDossier as ComponentDossier;
  const changed=(await git(source,['diff','--name-only',`${targetRevision}..${sourceRevision}`])).split('\n').filter(Boolean);
  const known=new Set(d.files.map(f=>f.path));
  if(changed.some(f=>!known.has(f)&&f!=='.agents/ship.json'&&!f.startsWith(`ui-hub/${w.surface}/`)))fail('Writer changed files outside its bound component inventory');
  if(!d.context.some(c=>changed.includes(c.path)))fail('Writer completion is missing an updated component context file');
  await clean(source,sourceRevision);
  if(await git(repo,['rev-parse',`${sourceRef}^{commit}`])!==sourceRevision)fail('Writer branch changed during landing admission');
  return {phase:'ready-for-checks' as const,kind:'component' as const,sourceRevision,targetRevision,workspaceId:w.workspaceId,dossierDigest:after.dossierDigest,tests:manifest.tests};
}

/** Supplied by the job instrumentation owner, never authored by a browser or inferred from a saved chat label. */
export type WriterJobMeasurement={
  runId:string;mode:'saved'|'fresh';sessionId:string;resumedFrom:string|null;taskId:string;jobDigest:string;
  baseRevision:string;dossierDigest:string;sourceRevision:string;
  commandsBeforeFirstEdit:number;totalCommands:number;
  checks:{sourceRevision:string;command:string;exitCode:number}[];
  shots:{sourceRevision:string;sha256:string;viewport:{width:number;height:number}}[];
  measurementDigest:string;
};
export async function compareWriterJobs(savedRunId:string,freshRunId:string,resolve:(id:string)=>Promise<WriterJobMeasurement|null>){
  if(savedRunId===freshRunId||![savedRunId,freshRunId].every(x=>/^[A-Za-z0-9_-]{1,128}$/.test(x)))fail('Comparison needs two distinct measured jobs');
  const [saved,fresh]=await Promise.all([resolve(savedRunId),resolve(freshRunId)]);
  for(const [m,id,mode] of [[saved,savedRunId,'saved'],[fresh,freshRunId,'fresh']] as const){
    if(!m||m.runId!==id||m.mode!==mode||!m.sessionId||!HASH.test(m.jobDigest)||!HASH.test(m.dossierDigest)||!HASH.test(m.measurementDigest)||!SHA.test(m.baseRevision)||!SHA.test(m.sourceRevision)||
       !Number.isSafeInteger(m.commandsBeforeFirstEdit)||!Number.isSafeInteger(m.totalCommands)||m.commandsBeforeFirstEdit<0||m.totalCommands<=0||m.commandsBeforeFirstEdit>m.totalCommands||
       !Array.isArray(m.checks)||!m.checks.length||m.checks.length>80||m.checks.some(c=>!c.command||c.sourceRevision!==m.sourceRevision||!Number.isInteger(c.exitCode))||
       !Array.isArray(m.shots)||!m.shots.length||m.shots.length>24||m.shots.some(s=>s.sourceRevision!==m.sourceRevision||!HASH.test(s.sha256)||!Number.isSafeInteger(s.viewport?.width)||!Number.isSafeInteger(s.viewport?.height)||s.viewport.width<=0||s.viewport.height<=0))fail('Saved/fresh comparison evidence is missing or stale');
  }
  if(!saved!.resumedFrom||fresh!.resumedFrom!==null||saved!.sessionId===fresh!.sessionId||saved!.taskId!==fresh!.taskId||saved!.jobDigest!==fresh!.jobDigest||saved!.baseRevision!==fresh!.baseRevision||saved!.dossierDigest!==fresh!.dossierDigest)fail('Comparison jobs do not share the same task, input, base and dossier');
  const suite=(m:WriterJobMeasurement)=>m.checks.map(c=>c.command).sort().join('\0');
  const viewports=(m:WriterJobMeasurement)=>m.shots.map(s=>`${s.viewport.width}x${s.viewport.height}`).sort().join('\0');
  if(suite(saved!)!==suite(fresh!)||viewports(saved!)!==viewports(fresh!))fail('Comparison checks or shot viewports do not match');
  return {status:'comparable' as const,saved:saved!,fresh:fresh!,commandsBeforeFirstEditDelta:fresh!.commandsBeforeFirstEdit-saved!.commandsBeforeFirstEdit,
    checks:{saved:saved!.checks.every(c=>c.exitCode===0),fresh:fresh!.checks.every(c=>c.exitCode===0)},visualVerdict:'unreviewed' as const};
}

async function main(){
  try{
    const [mode,repo,ref,source,target,...extra]=process.argv.slice(2);if(mode!=='--landing'||!repo||!ref||!source||!target||extra.length)fail('Expected --landing REPO SOURCE_REF SOURCE_REVISION TARGET_REVISION');
    const {receiptFile}=await import('./worktrees.ts');
    console.log(JSON.stringify(await checkLandingWriter(repo,ref,source,target,receiptFile)));
  }catch(error){console.error(error instanceof Error?error.message:'Writer landing gate unavailable');process.exitCode=1;}
}
// The workspace module consumes readWriterDossier. Finish evaluating this module before importing its CLI resolver.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main();
