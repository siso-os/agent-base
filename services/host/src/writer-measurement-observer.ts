/** Opt-in Codex host observer for the two server-authorized t-0391 jobs. */
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {watch,type FSWatcher} from 'node:fs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import type {WorkspaceReceipt} from './worktree-contract.ts';
import {createWriterMeasurementOwner,type RunStart} from '../../node/src/writer-measurements.ts';

const exec=promisify(execFile),HASH=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40,64}$/;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const safeRelative=(s:unknown):s is string=>typeof s==='string'&&s.length<=500&&!path.isAbsolute(s)&&!s.includes('\\')&&s.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&/^[\w .()-]+$/.test(p));
type Receipt=Omit<RunStart,'sessionId'|'resumedFrom'|'sourceFiles'>&{version:1;issuer:'agent-base-node';workspaceId:string;hostName:string;expectedResumeSession:string|null;files:{path:string;sha256:string}[]};
export async function readWriterMeasurementReceipt(file:string,workspace:WorkspaceReceipt,cwd:string):Promise<Receipt>{
 if(!path.isAbsolute(file))throw Error('Writer measurement receipt path must be absolute');
 const parent=path.dirname(file),rp=await realpath(parent),ps=await lstat(parent),st=await lstat(file);
 if(rp!==parent||ps.isSymbolicLink()||ps.uid!==process.getuid?.()||ps.mode&0o077||st.isSymbolicLink()||!st.isFile()||st.uid!==process.getuid?.()||st.mode&0o077||st.size>128*1024)throw Error('Writer measurement receipt is not a private owner file');
 const r=JSON.parse(await readFile(file,'utf8')) as Receipt;
 const writer=workspace.input.writer,expectedResume=r.mode==='saved'?r.expectedResumeSession:null;
 if(r.version!==1||r.issuer!=='agent-base-node'||!['saved','fresh'].includes(r.mode)||!writer||workspace.input.workspace.type==='shared'||r.workspaceId!==workspace.workspaceId||r.hostName!==workspace.name||r.sourcePath!==workspace.worktreePath||r.sourceRevision!==writer.sourceRevision||r.dossierDigest!==writer.dossierDigest||r.baseRevision!==workspace.baseSha||r.taskId!==workspace.input.taskId||!HASH.test(r.jobDigest)||!REV.test(r.sourceRevision)||!REV.test(r.baseRevision)||!(/^[A-Za-z0-9_-]{1,128}$/).test(r.runId)||!(r.expectedResumeSession===null||/^[A-Za-z0-9_-]{1,128}$/.test(r.expectedResumeSession))||(r.mode==='saved'&&!r.expectedResumeSession)||(r.mode==='fresh'&&r.expectedResumeSession!==null)||!Array.isArray(r.files)||!r.files.length||r.files.length>80||!r.files.every(f=>safeRelative(f.path)&&HASH.test(f.sha256))||new Set(r.files.map(f=>f.path)).size!==r.files.length)throw Error('Writer measurement receipt does not match the owned job');
 if(r.sourceRevision!==workspace.baseSha||expectedResume!==(r.mode==='saved'?r.expectedResumeSession:null))throw Error('Writer measurement source or resume binding mismatch');
 const actualCwd=await realpath(cwd);if(actualCwd!==workspace.worktreePath)throw Error('Writer measurement workspace path changed');
 for(const f of r.files){let current=actualCwd;for(const part of f.path.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Writer dossier inventory contains a symlink');}const item=await lstat(current);if(!item.isFile()||item.size>1024*1024)throw Error('Writer dossier file is unavailable or too large');const bytes=await readFile(current);if(sha(bytes)!==f.sha256)throw Error('Writer dossier inventory changed before measurement start');const committed=await exec('git',['-C',actualCwd,'show',`${r.sourceRevision}:${f.path}`],{encoding:'buffer',maxBuffer:1024*1024});if(sha(committed.stdout)!==f.sha256)throw Error('Writer receipt inventory does not match its pinned revision');}
 return r;
}

export function createWriterMeasurementObserver(owner=createWriterMeasurementOwner()){
 return async function arm(receipt:Receipt,session:string,resume:string|null){
  if(!session||session!==((receipt.mode==='saved')?receipt.expectedResumeSession:session)||resume!==receipt.expectedResumeSession)throw Error('Returned native session or resume origin does not match measurement receipt');
  const start:RunStart={runId:receipt.runId,mode:receipt.mode,sessionId:session,resumedFrom:resume,taskId:receipt.taskId,jobDigest:receipt.jobDigest,baseRevision:receipt.baseRevision,dossierDigest:receipt.dossierDigest,sourceRevision:receipt.sourceRevision,sourcePath:receipt.sourcePath,sourceFiles:receipt.files};
  await owner.begin(start);
  const dirs=new Map<string,Map<string,string>>();
  for(const f of receipt.files){const absolute=path.join(receipt.sourcePath,f.path),base=path.dirname(absolute),name=path.basename(absolute);let names=dirs.get(base);if(!names){names=new Map();dirs.set(base,names);}if(names.has(name))throw Error('Ambiguous dossier watch inventory');names.set(name,f.path);}
  let invalid:string|null=null,closed=false,firstEdit=false,queue=Promise.resolve(),invalidWrite:Promise<void>|null=null;const watchers:FSWatcher[]=[],pending=new Map<string,string>();
  const invalidate=(why:string)=>{if(!invalid){invalid=why;const after=queue;invalidWrite=after.then(()=>owner.invalidate(receipt.runId,why)).catch(()=>{});}};
  const serial=(fn:()=>Promise<void>)=>{if(closed)return;const prev=queue;queue=prev.then(fn).catch(e=>invalidate(e instanceof Error?e.message:'Observer event failed'));};
  try{for(const [dir,names] of dirs){const w=watch(dir,{persistent:false},(kind,filename)=>{if(closed)return;if(filename===null){invalidate('Filesystem observer lost the changed path');return;}const p=String(filename);if(!names.has(p))return;serial(async()=>{if(invalid)return;const rel=names.get(p)!,absolute=path.join(dir,p),s=await lstat(absolute);if(!s.isFile()||s.isSymbolicLink())throw Error('Dossier file became unavailable or a symlink');const digest=sha(await readFile(absolute));const expected=receipt.files.find(f=>f.path===rel)!.sha256;if(digest===expected)throw Error(`Ambiguous duplicate filesystem event for ${rel}`);if(firstEdit)throw Error(`Repeated dossier file event makes ordering ambiguous: ${rel}`);firstEdit=true;await owner.nativeEdit(receipt.runId,rel);});});watchers.push(w);w.on('error',e=>invalidate(`Filesystem observer failed: ${e.message}`));}for(const f of receipt.files){const actual=sha(await readFile(path.join(receipt.sourcePath,f.path)));if(actual!==f.sha256)throw Error('Dossier inventory changed while filesystem watches were being established');}}catch(e){invalidate('Dossier inventory filesystem watches could not be established');for(const w of watchers)w.close();throw e;}
  return {runId:receipt.runId,mode:receipt.mode,observe(method:string,item:any){if(closed)return;if(item?.type!=='commandExecution')return;const id=String(item.id??''),command=item.command;if(!id||typeof command!=='string'||!command){invalidate('Native command event identity is incomplete');return;}if(method==='item/started'){if(pending.has(id)){invalidate('Duplicate native command start');return;}pending.set(id,command);serial(()=>owner.nativeCommand(receipt.runId,command));}else if(method==='item/completed'){if(!pending.has(id)||pending.get(id)!==command){invalidate('Native command completion is missing, duplicate or out of order');return;}pending.delete(id);}else invalidate('Unexpected native command lifecycle event');},
   turnCompleted(){if(pending.size)invalidate('Turn ended before native command completion');},
   async flush(){await queue;},
   async close(){closed=true;for(const w of watchers)w.close();await queue;if(pending.size)invalidate('Observer closed with incomplete native commands');await invalidWrite;},
   get invalidReason(){return invalid;},
  };
 };
}
