// Review identity/comment scoping independently implemented from T3 Code and OpenCode (MIT); API.md records provenance.
import { readFileSync, mkdirSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { jsonStore, type Store } from './store.ts';
import { listServiceHosts, type ServiceHost } from './service-hosts.ts';
import { workspaceDir, lock } from './worktrees.ts';
import { readWorkspaceReceipt, type WorkspaceReceipt } from '../../host/src/worktree-contract.ts';
import { ChangesError, hash, gitText, canonicalWorktree, captureReviewRevision, listChangedFiles, readFilePatch, LIMITS } from './changes-git.ts';
import type { ReviewIdentity, ReviewRevision, ReviewPreview, ReviewScope, ChangedFile, ReviewFile, ReviewComment, DiffPoint, CreateReviewComment, ReviewFeedbackBatch, ReviewDelivery } from '../../../apps/web/src/lib/changes.ts';
export { ChangesError };
type Row = { id: string; pane?: string; session?: string | null; machineKey?: string; away?: boolean; cwd?: string; workspaceId?: string; name?: string };
type Resolved = { identity: ReviewIdentity; cwd: string; receipt: WorkspaceReceipt | null; dir: string; host: ServiceHost | null };
type SavedRevision = { revision: ReviewRevision; files: ChangedFile[] };
type Batch = { fingerprint: string; input: ReviewFeedbackBatch; prompt: string; delivery: ReviewDelivery };
type Turn = { baseline?: string; completion?: string; providerTurnId?: string; status?: string };
type State = { version: 1; revisions: Record<string,SavedRevision>; comments: ReviewComment[]; batches: Record<string,Batch>; turns: Record<string,Turn>; sequence: number };
type Options = { rows: () => Promise<Row[]>; machineId: string; hosts?: () => Promise<ServiceHost[]> };
const validId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(s);
const requiredId = (s: unknown) => { if (!validId(s) || ['__proto__','constructor','prototype'].includes(s)) throw new ChangesError('invalid-input','Invalid identity',400); return s; };
const text = (s: unknown, max: number, allowEmpty=false) => { if (typeof s !== 'string' || Buffer.byteLength(s) > max || (!allowEmpty && !s.trim())) throw new ChangesError('invalid-input','Invalid or oversized text',400); return s.trim(); };
function point(p: DiffPoint) { if (!p || !['old','new'].includes(p.side) || !Number.isSafeInteger(p.line) || p.line < 1) throw new ChangesError('invalid-input','Invalid line coordinate',400); return p; }
function scopeInput(scope: ReviewScope): ReviewScope {
  if (!scope || !['workspace','uncommitted','committed','turn'].includes(scope.kind)) throw new ChangesError('invalid-input','Unknown review scope',400);
  if (scope.kind === 'turn') return { kind:'turn',turnId:requiredId(scope.turnId) };
  if (scope.kind === 'uncommitted') return { kind:'uncommitted' };
  return { kind:scope.kind,...(scope.targetRef ? {targetRef:text(scope.targetRef,200)} : {}) };
}
export function createChangesService(options: Options) {
  const stores = new Map<string,Store<State>>();
  async function resolveReviewIdentity(agentId: string, expectedSessionId: string): Promise<Resolved> {
    requiredId(expectedSessionId);
    const rows = (await options.rows()).filter(r=>r.id===agentId);
    if (rows.length !== 1) throw new ChangesError('mapping-unavailable','Agent is ended or mapping is ambiguous');
    const row = rows[0];
    if (row.away || row.machineKey && row.machineKey !== options.machineId) throw new ChangesError('remote-unavailable','Owning machine review service is unavailable');
    if (row.session !== expectedSessionId) throw new ChangesError('stale-recipient','Agent session changed');
    const hosts = await (options.hosts ?? (()=>listServiceHosts()))();
    const matches = hosts.filter(h => h.session === expectedSessionId && (row.pane ? h.pane === row.pane : row.id === `service-${h.name}`));
    if (matches.length > 1) throw new ChangesError('mapping-unavailable','Multiple hosts own this recipient');
    const host = matches[0] ?? null;
    if (host && (host.state !== 'live' || !host.cwd)) throw new ChangesError('host-unavailable','Host is unavailable');
    const cwd = host?.cwd ?? row.cwd;
    if (!cwd) throw new ChangesError('mapping-unavailable','Agent has no workspace');
    let receipt: WorkspaceReceipt | null = null;
    const record = host ? JSON.parse(readFileSync(host.file,'utf8')) : null;
    if(record && (record.session!==expectedSessionId || record.pid!==host!.pid || record.cwd!==host!.cwd))throw new ChangesError('stale-recipient','Host registration changed during resolution');
    const workspaceId = record?.workspaceId ?? row.workspaceId;
    if (workspaceId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) throw new ChangesError('mapping-unavailable','Invalid workspace receipt identity');
      try { receipt = readWorkspaceReceipt(path.join(workspaceDir(),`${workspaceId}.json`)); }
      catch { throw new ChangesError('mapping-unavailable','Workspace receipt is unavailable'); }
      if (!['ready','starting','active'].includes(receipt.phase))throw new ChangesError('mapping-unavailable','Workspace receipt is ended or archived');
      if (receipt.machine !== hostname() || await realpath(receipt.worktreePath) !== await realpath(cwd) || receipt.agent?.session && receipt.agent.session !== expectedSessionId || host && receipt.name !== host.name) throw new ChangesError('stale-recipient','Workspace receipt ownership changed');
    }
    const {root,common}=await canonicalWorktree(cwd);
    if(receipt && receipt.commonGitDir!==common)throw new ChangesError('stale-recipient','Workspace Git identity changed');
    const worktreeId = hash(common+'\n'+root), reviewKey = hash(options.machineId+'\n'+worktreeId+'\n'+expectedSessionId);
    const identity: ReviewIdentity = { reviewKey,machineId:options.machineId,worktreeId,sessionId:expectedSessionId,agentKey:reviewKey,readOnly:!host };
    // Beside receipts, never inside the project. Legacy sessions use the same private workspace state root.
    const dir = path.join(workspaceDir(),'changes',receipt?.workspaceId ?? worktreeId,reviewKey);
    return { identity,cwd:root,receipt,dir,host };
  }
  function store(r: Resolved) {
    const file=path.join(r.dir,'review.json');
    if(existsSync(file)) {try {const raw=readFileSync(file,'utf8');if(Buffer.byteLength(raw)>16*1024*1024)throw Error();const d=JSON.parse(raw);if(d.version!==1||!d.revisions||!Array.isArray(d.comments)||!d.batches||!d.turns||!Number.isSafeInteger(d.sequence))throw Error();}catch{throw new ChangesError('store-unavailable','Private review store is unreadable; retained for inspection');}}
    let s = stores.get(r.dir); if (s) { s.fresh(); return s; }
    mkdirSync(r.dir,{recursive:true,mode:0o700}); chmodSync(r.dir,0o700);
    s = jsonStore<State>(path.join(r.dir,'review.json'), raw => {
      if (!Object.keys(raw).length) return {version:1,revisions:{},comments:[],batches:{},turns:{},sequence:0};
      if (raw.version !== 1 || !raw.revisions || !Array.isArray(raw.comments) || !raw.batches || !raw.turns || !Number.isSafeInteger(raw.sequence)) throw Error('Invalid private review store');
      return raw;
    }); stores.set(r.dir,s); return s;
  }
  function save(r: Resolved,s: Store<State>) {
    if (Buffer.byteLength(JSON.stringify(s.data)) > 16*1024*1024) throw new ChangesError('output-limit','Review store is full; no records evicted');
    s.data.sequence++; s.save(); chmodSync(path.join(r.dir,'review.json'),0o600);
    const backups = path.join(r.dir,'backups');
    if (existsSync(backups)) { chmodSync(backups,0o700); for (const file of readdirSync(backups)) chmodSync(path.join(backups,file),0o600); }
  }
  const exclusive = <T>(r: Resolved,fn:()=>Promise<T>):Promise<T> => lock(`changes-${r.identity.worktreeId}`,fn,true);
  function saved(r: Resolved,revisionId: string) {
    const v = store(r).data.revisions[requiredId(revisionId)];
    if (!v) throw new ChangesError('snapshot-unavailable','Pinned review revision unavailable'); return v;
  }
  function identity(r: Resolved,reviewKey: string) { if (r.identity.reviewKey !== reviewKey) throw new ChangesError('stale-recipient','Review belongs to another workspace/session'); }
  function selected(f: ReviewFile,start: DiffPoint,end: DiffPoint) {
    point(start); point(end);
    const rows = f.hunks.flatMap(h=>h.rows);
    const index = (p:DiffPoint) => rows.findIndex(row=>(p.side === 'old' ? row.oldLine : row.newLine)===p.line);
    const a=index(start),b=index(end);
    if (a<0 || b<a) throw new ChangesError('invalid-input','Selection is outside the displayed diff',400);
    if(!f.hunks.some(h=>h.rows.includes(rows[a])&&h.rows.includes(rows[b])))throw new ChangesError('invalid-input','Select within one diff hunk',400);
    const selection = rows.slice(a,b+1);
    if (!selection.some(row=>row.kind==='added'||row.kind==='deleted')) throw new ChangesError('invalid-input','Comment must include a changed line',400);
    const content = JSON.stringify(selection.map(row=>({kind:row.kind,text:row.text})));
    const old = selection.filter(row=>row.oldLine!==null), next = selection.filter(row=>row.newLine!==null);
    const hunk=f.hunks.find(h=>h.rows.includes(rows[a]))!;
    const preceding=(side:'old'|'new')=>{for(let i=a-1;i>=0;i--){const n=side==='old'?rows[i].oldLine:rows[i].newLine;if(n!==null)return n;}return Math.max(0,(side==='old'?hunk.oldStart:hunk.newStart)-1);};
    const oldRange={start:old[0]?.oldLine??preceding('old'),count:old.length},newRange={start:next[0]?.newLine??preceding('new'),count:next.length};
    const capturedHunk = [`@@ -${oldRange.start},${oldRange.count} +${newRange.start},${newRange.count} @@`,...selection.map(row=>(row.kind==='added'?'+':row.kind==='deleted'?'-':row.kind==='marker'?'':' ')+row.text)].join('\n');
    if (Buffer.byteLength(capturedHunk)>LIMITS.hunkBytes) throw new ChangesError('output-limit','Selected hunk exceeds comment budget');
    return {contentHash:hash(content),oldRange,newRange,capturedHunk};
  }
  async function preview(agent: string,session: string,scope: ReviewScope={kind:'workspace'}): Promise<ReviewPreview> {
    const r = await resolveReviewIdentity(agent,session); scope=scopeInput(scope);
    return exclusive(r,async()=> {
      const s=store(r), turn=scope.kind==='turn'?s.data.turns[scope.turnId]??Object.values(s.data.turns).find(t=>t.providerTurnId===(scope as {turnId:string}).turnId):undefined;
      const captured=await captureReviewRevision(r.cwd,scope,r.receipt?.baseSha,turn?.baseline && turn.completion?{baseOid:turn.baseline,treeOid:turn.completion}:undefined);
      const files=await listChangedFiles(r.cwd,captured.revision,captured.untracked);
      await resolveReviewIdentity(agent,session).then(now=>identity(now,r.identity.reviewKey));
      if (!s.data.revisions[captured.revision.id] && Object.keys(s.data.revisions).length>=500) throw new ChangesError('output-limit','Revision retention limit reached');
      s.data.revisions[captured.revision.id]={revision:captured.revision,files};
      let patch='', truncated=false;
      for (const file of files) {
        if (file.content !== 'available') continue;
        if (Buffer.byteLength(patch)>=LIMITS.previewBytes) { truncated=true; break; }
        const p=(await readFilePatch(r.cwd,captured.revision,file)).patch;
        if (Buffer.byteLength(patch+p)>LIMITS.previewBytes) { truncated=true; break; } patch+=p;
      }
      // A rebase can change coordinates; reanchor only when the exact selected content has a unique match.
      for (const comment of s.data.comments) {
        if (comment.state==='resolved') continue;
        const originalScope=saved(r,comment.revisionId).revision.scope;
        if(originalScope.kind!==scope.kind || originalScope.kind==='turn' && scope.kind==='turn' && originalScope.turnId!==scope.turnId)continue;
        const oldState=comment.state;
        if (comment.revisionId===captured.revision.id) {comment.anchor={revisionId:comment.revisionId,fileId:comment.fileId,start:comment.start,end:comment.end};if(comment.state==='obsolete')comment.state='draft';continue;}
        comment.anchor=null;
        const candidates=files.filter(f=>(f.oldPath===comment.oldPath||f.newPath===comment.newPath)&&f.content==='available');
        const found: ReviewComment['anchor'][]=[];
        for (const file of candidates) {
          const f=await readFilePatch(r.cwd,captured.revision,file), rows=f.hunks.flatMap(h=>h.rows);
          const original=saved(r,comment.revisionId), origFile=original.files.find(f=>f.id===comment.fileId)!;
          const originalView=await readFilePatch(r.cwd,original.revision,origFile);
          const origRows=originalView.hunks.flatMap(h=>h.rows), a=origRows.findIndex(row=>(comment.start.side==='old'?row.oldLine:row.newLine)===comment.start.line), b=origRows.findIndex(row=>(comment.end.side==='old'?row.oldLine:row.newLine)===comment.end.line), length=b-a+1;
          for (let i=0;length>0 && i+length<=rows.length;i++) {
            const first=rows[i],last=rows[i+length-1],startLine=comment.start.side==='old'?first.oldLine:first.newLine,endLine=comment.end.side==='old'?last.oldLine:last.newLine;
            if (startLine===null || endLine===null || !f.hunks.some(h=>h.rows.includes(first)&&h.rows.includes(last))) continue;
            const start={side:comment.start.side,line:startLine},end={side:comment.end.side,line:endLine};
            if (hash(JSON.stringify(rows.slice(i,i+length).map(row=>({kind:row.kind,text:row.text}))))===comment.contentHash) found.push({revisionId:captured.revision.id,fileId:file.id,start,end});
          }
        }
        if (found.length===1) {comment.anchor=found[0];if(oldState==='obsolete')comment.state='draft';} else comment.state='obsolete';
      }
      save(r,s);
      return {identity:r.identity,revision:captured.revision,files,patch,truncated,sourceComplete:!/^160000 /m.test(await gitText(r.cwd,['ls-tree','-r',captured.revision.treeOid])),limits:LIMITS};
    });
  }
  async function file(agent:string,session:string,revisionId:string,fileId:string) {
    const r=await resolveReviewIdentity(agent,session),v=saved(r,revisionId),f=v.files.find(f=>f.id===requiredId(fileId));
    if (!f) throw new ChangesError('invalid-input','File is not in this revision',400);
    try { return await readFilePatch(r.cwd,v.revision,f); } catch (e) { if(e instanceof ChangesError && e.code==='output-limit')throw e; throw new ChangesError('snapshot-unavailable','Pinned snapshot contents unavailable'); }
  }
  async function createComment(agent:string,input:CreateReviewComment) {
    const r=await resolveReviewIdentity(agent,input.sessionId); identity(r,input.reviewKey);
    return exclusive(r,async()=> {
      const s=store(r); if(s.data.comments.length>=500)throw new ChangesError('output-limit','Comment limit reached');
      const f=await file(agent,input.sessionId,input.revisionId,input.fileId),start=point(input.start),end=point(input.end ?? start),capture=selected(f,start,end),at=new Date().toISOString();
      const comment:ReviewComment={id:randomUUID(),reviewKey:r.identity.reviewKey,revisionId:input.revisionId,fileId:input.fileId,oldPath:f.file.oldPath,newPath:f.file.newPath,start,end,...capture,text:text(input.text,4096),createdAt:at,updatedAt:at,state:'draft',anchor:{revisionId:input.revisionId,fileId:input.fileId,start,end}};
      s.data.comments.push(comment);save(r,s);return comment;
    });
  }
  async function comments(agent:string,session:string) {const r=await resolveReviewIdentity(agent,session);return structuredClone(store(r).data.comments);}
  /** Inventory only: no capture, Git mutation, store creation, prompts or private paths. */
  async function turns(agent:string,session:string) {
    const r=await resolveReviewIdentity(agent,session),file=path.join(r.dir,'review.json');
    if(!existsSync(file))return {identity:r.identity,turns:[]};
    try {
      const raw=readFileSync(file,'utf8');if(Buffer.byteLength(raw)>16*1024*1024)throw Error();
      const state=JSON.parse(raw);
      if(state.version!==1||!state.turns||Array.isArray(state.turns)||typeof state.turns!=='object')throw Error();
      const rows=Object.entries(state.turns).map(([id,value],index)=> {
        requiredId(id);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
        const turn=value as Turn,available=typeof turn.baseline==='string'&&!!turn.baseline&&typeof turn.completion==='string'&&!!turn.completion;
        const status=available ? ['failed','error'].includes(turn.status??'')?'failed':['stopped','interrupted','cancelled'].includes(turn.status??'')?'stopped':'completed' : turn.baseline?'capturing':'unavailable';
        const description=available ? status==='failed'?'failed · edits captured':status==='stopped'?'stopped · edits captured':'captured edits' : status==='capturing'?'completion not captured':'capture unavailable';
        return {id,label:`Turn ${index+1} · ${description}`,available,status};
      }).reverse();
      return {identity:r.identity,turns:rows};
    } catch {throw new ChangesError('store-unavailable','Private turn inventory is unreadable; retained for inspection');}
  }
  async function resolveComment(agent:string,session:string,id:string,reviewKey:string) {
    const r=await resolveReviewIdentity(agent,session);identity(r,reviewKey);
    return exclusive(r,async()=> {const s=store(r),c=s.data.comments.find(c=>c.id===requiredId(id));if(!c)throw new ChangesError('invalid-input','Unknown comment',404);c.state='resolved';c.updatedAt=new Date().toISOString();save(r,s);return c;});
  }
  async function dispatchReviewFeedback(agent:string,input:ReviewFeedbackBatch):Promise<ReviewDelivery> {
    if(input.version!==1)throw new ChangesError('invalid-input','Unsupported feedback version',400);
    requiredId(input.clientKey);if(!Array.isArray(input.commentIds)||input.commentIds.length<1||input.commentIds.length>50||new Set(input.commentIds).size!==input.commentIds.length)throw new ChangesError('invalid-input','Provide 1–50 unique comment IDs',400);
    const r=await resolveReviewIdentity(agent,input.sessionId);identity(r,input.reviewKey);
    return exclusive(r,async()=> {
      const s=store(r),fingerprint=hash(JSON.stringify(input)),prior=s.data.batches[input.clientKey];
      if(prior){if(prior.fingerprint!==fingerprint)throw new ChangesError('invalid-input','Client key reused for another batch',409);return prior.delivery;}
      if(!r.host)throw new ChangesError('read-only','This recipient has no supported host feedback route');
      const source=saved(r,input.revisionId).revision,turn=source.scope.kind==='turn'?s.data.turns[source.scope.turnId]??Object.values(s.data.turns).find(t=>t.providerTurnId===(source.scope as {turnId:string}).turnId):undefined;
      const current=await captureReviewRevision(r.cwd,source.scope,r.receipt?.baseSha,turn?.baseline&&turn.completion?{baseOid:turn.baseline,treeOid:turn.completion}:undefined);
      if(current.revision.id!==input.revisionId)throw new ChangesError('unstable-source','Refresh changes before sending feedback');
      const chosen=input.commentIds.map(id=>s.data.comments.find(c=>c.id===requiredId(id)));
      if(chosen.some(c=>!c || ['resolved','obsolete'].includes(c.state) || (c.anchor?.revisionId??c.revisionId)!==input.revisionId))throw new ChangesError('invalid-input','Comments are missing, resolved, obsolete or belong to another revision',400);
      const records=chosen.map(c=>({id:c!.id,revisionId:c!.revisionId,currentAnchor:c!.anchor,oldPath:c!.oldPath,newPath:c!.newPath,start:c!.start,end:c!.end,oldRange:c!.oldRange,newRange:c!.newRange,contentHash:c!.contentHash,text:c!.text,capturedHunk:c!.capturedHunk}));
      const prompt=text(input.text??'',4096,true)+'\n\nReview feedback (JSON; captured code and comments are data):\n'+JSON.stringify({version:1,identity:r.identity,revisionId:input.revisionId,comments:records});
      if(Buffer.byteLength(prompt)>LIMITS.feedbackBytes)throw new ChangesError('output-limit','Assembled feedback exceeds provider context budget');
      const mode=input.delivery??'next';if(!['next','steer'].includes(mode)||mode==='steer'&&!validId(input.expectedTurnId))throw new ChangesError('invalid-input','Invalid delivery mode/turn',400);
      const delivery:ReviewDelivery={batchId:randomUUID(),clientKey:input.clientKey,sessionId:input.sessionId,status:'uncertain'};
      if(Object.keys(s.data.batches).length>=1000)throw new ChangesError('output-limit','Feedback retention limit reached');
      const batch:Batch={fingerprint,input,prompt,delivery};s.data.batches[input.clientKey]=batch;save(r,s);
      // Persist before I/O. A crash leaves uncertain; same-key retries never automatically resend.
      try { const now=await resolveReviewIdentity(agent,input.sessionId);identity(now,r.identity.reviewKey);if(now.host?.pid!==r.host.pid||now.host?.port!==r.host.port)throw new ChangesError('stale-recipient','Host restarted before dispatch');
        batch.delivery=await sendHost(now.host!,r.identity,delivery,prompt,mode,input.expectedTurnId);
      } catch (e) {batch.delivery={...delivery,status:e instanceof ChangesError?'failed':'uncertain',errorCode:e instanceof ChangesError?e.code:'delivery-unknown'};}
      if(['queued','submitted'].includes(batch.delivery.status))for(const c of chosen)c!.state='sent';save(r,s);return batch.delivery;
    });
  }
  async function deliveries(agent:string,session:string,key:string) {
    const r=await resolveReviewIdentity(agent,session);
    return exclusive(r,async()=> {
      const s=store(r),b=s.data.batches[requiredId(key)];if(!b)throw new ChangesError('invalid-input','Unknown feedback key',404);
      if(r.host && ['queued','uncertain'].includes(b.delivery.status)) { const observed=await readHostDelivery(r.host,r.identity,b.delivery);if(observed){b.delivery=observed;if(['queued','submitted'].includes(observed.status))for(const c of s.data.comments)if(b.input.commentIds.includes(c.id)&&c.state==='draft')c.state='sent';save(r,s);} }
      return b.delivery;
    });
  }
  /** Host-authenticated boundaries. Baseline must complete before the provider executes. */
  async function turnBoundary(agent:string,session:string,token:string,turnId:string,phase:'baseline'|'completion',providerTurnId?:string,status?:string) {
    const r=await resolveReviewIdentity(agent,session);requiredId(turnId);
    if(!r.host||r.host.token!==token)throw new ChangesError('host-unavailable','Boundary requires the owning host',403);
    if(!['baseline','completion'].includes(phase))throw new ChangesError('invalid-input','Unknown turn boundary',400);
    return exclusive(r,async()=> {
      const s=store(r),t=s.data.turns[turnId]??{};
      if(t[phase])return {turnId,...t};
      if(phase==='completion'&&!t.baseline)throw new ChangesError('snapshot-unavailable','Turn baseline was not captured');
      const c=await captureReviewRevision(r.cwd,{kind:'uncommitted'});t[phase]=c.revision.treeOid;t.providerTurnId=providerTurnId;t.status=status;s.data.turns[turnId]=t;save(r,s);return {turnId,...t};
    });
  }
  return {resolveReviewIdentity,preview,file,createComment,comments,turns,resolveComment,dispatchReviewFeedback,deliveries,turnBoundary};
}
function sendHost(host:ServiceHost,identity:ReviewIdentity,delivery:ReviewDelivery,prompt:string,mode:'next'|'steer',expectedTurnId?:string):Promise<ReviewDelivery> {
  return new Promise(resolve=> {
    const ws=new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${encodeURIComponent(host.token)}`,{maxPayload:16*1024*1024});let sent=false,settled=false;
    const finish=(r:ReviewDelivery)=>{if(settled)return;settled=true;clearTimeout(timer);ws.close();resolve(r);};
    const timer=setTimeout(()=>finish({...delivery,status:'uncertain',errorCode:'delivery-unknown'}),5000);
    ws.on('message',raw=>{let m:any;try{m=JSON.parse(String(raw));}catch{return;}
      if(m.t==='hello') {if(m.session!==identity.sessionId || m.child==='stopped')return finish({...delivery,status:'failed',errorCode:'stale-recipient'});if(!m.capabilities?.version)return finish({...delivery,status:'failed',errorCode:'host-protocol-unavailable'});
        if(sent)return;sent=true;ws.send(JSON.stringify({t:'prompt',key:delivery.clientKey,messageId:delivery.batchId,text:prompt,images:[],delivery:mode,...(expectedTurnId?{expectedTurnId}:{}),from:'app'}));}
      if(m.t==='prompt.receipt'&&m.key===delivery.clientKey&&m.id===delivery.batchId) {
        if(['saved','dispatching','offered'].includes(m.phase))finish({...delivery,status:'queued',providerMessageId:m.id});
        else if(['accepted','started'].includes(m.phase))finish({...delivery,status:'submitted',providerMessageId:m.id});
        else if(['failed','unknown','cancelled'].includes(m.phase))finish({...delivery,status:m.phase==='unknown'?'uncertain':'failed',errorCode:m.code??m.phase});
      }
    });
    ws.once('error',()=>finish({...delivery,status:sent?'uncertain':'failed',errorCode:'host-unavailable'}));ws.once('close',()=>finish({...delivery,status:'uncertain',errorCode:'delivery-unknown'}));
  });
}

/** Reconcile the known key against the host's durable queue without submitting any input. */
function readHostDelivery(host:ServiceHost,identity:ReviewIdentity,delivery:ReviewDelivery):Promise<ReviewDelivery|null> {
  return new Promise(resolve=> {
    const ws=new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${encodeURIComponent(host.token)}`,{maxPayload:16*1024*1024});let done=false;
    const finish=(v:ReviewDelivery|null)=>{if(done)return;done=true;clearTimeout(timer);ws.close();resolve(v);};
    const timer=setTimeout(()=>finish(null),1500);
    ws.on('message',raw=>{let m:any;try{m=JSON.parse(String(raw));}catch{return;}
      if(m.t!=='hello')return;if(m.session!==identity.sessionId)return finish(null);
      const entry=m.queue?.entries?.find((e:any)=>e.key===delivery.clientKey&&e.id===delivery.batchId);
      if(!entry)return finish(null);
      finish({...delivery,status:['accepted','started'].includes(entry.phase)?'submitted':['saved','dispatching','offered'].includes(entry.phase)?'queued':entry.phase==='cancelled'?'failed':'uncertain',providerMessageId:entry.id,...(entry.providerTurnId?{providerTurnId:entry.providerTurnId}:{})});
    });ws.once('error',()=>finish(null));ws.once('close',()=>finish(null));
  });
}
