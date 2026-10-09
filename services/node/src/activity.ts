import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { jsonStore } from './store.ts';
import type { ActivityEvent, ActivityRef } from '../../host/src/activity.ts';
export type Attention = { id: string; ref: ActivityRef; requestId?: string; requestKind?: 'approval'|'input'; phase: 'completed'|'failed'|'needs'|'resolved'; at: string; agentId: string|null; agentName: string; headline: string; read: boolean; revision: number; buzz: boolean; delivery: 'off'|'pending'|'sending'|'provider_accepted'|'failed'|'expired'|'uncertain' };
type Host = { name: string; pane?: string; session?: string; hostInstanceId?: string; activityJournal?: string; activityHealthy?: boolean; activityRunId?: string; lead?: string; role?: string; pid: number; port: number; token: string; child?: string };
type Settings = { desktop: boolean; phone: boolean; topic: string; appUrl: string; snoozeUntil: number };
type Data = { cursors: Record<string,number>; items: Attention[]; settings: Settings };
const defaults: Settings = { desktop: false, phone: false, topic: '', appUrl: '', snoozeUntil: 0 };
const infrastructure = /^(HEALTH|ESTATE|EFFICIENCY|STACK|HARNESS|KEEPALIVE|SHIP-RUNNER|AGENT-STACK|INFRASTRUCTURE)$/i;
export class ActivityCollector {
  private store;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lock: string;
  /** False while another live node collects (standby). */
  owned = false;
  private birth = Date.now();
  private busy = false;
  healthy = true;
  private hosts = new Map<string,Host>();
  private hostFiles = new Map<string, { stamp: string; host: Host }>();
  private journals = new Map<string, { identity: string; size: number; stamp: string; offset: number; cursor: number }>();
  private hostsDir: string;
  private address: (h: Host) => string|null;
  private phoneFetch: typeof fetch;
  private quiet: (h: Host) => boolean;
  constructor(hostsDir: string, root: string, address: (h: Host) => string|null, phoneFetch: typeof fetch = fetch, quiet: (h: Host) => boolean = () => false) {
    this.hostsDir=hostsDir;this.address=address;this.phoneFetch=phoneFetch;this.quiet=quiet;
    mkdirSync(root,{recursive:true,mode:0o700}); this.lock = path.join(root,'owner.json');
    this.store = jsonStore<Data>(path.join(root,'state.json'), raw => {
      if(raw.items !== undefined && (!Array.isArray(raw.items)||!raw.cursors||typeof raw.cursors!=='object'||raw.items.some((i:any)=>!i?.ref?.hostInstanceId||typeof i.id!=='string'))) throw Error('invalid activity state');
      return { cursors: raw.cursors ?? {}, items: raw.items ?? [], settings: {...defaults,...raw.settings} };
    });
    // A deploy starts the new node beside the old one (t-0539): while a live node collects, this one stands by and takes
    // over within a second of the old one letting go, instead of refusing to start.
    if(this.claim())this.start();
    else{this.timer=setInterval(()=>{let mine=false;try{mine=this.claim();}catch{}if(mine){clearInterval(this.timer);this.start();}},1000);this.timer.unref();}
  }
  /** Takes the collector lock: true when this node now owns it, false while a live node does. */
  private claim(): boolean {
    try { writeFileSync(this.lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600}); return this.owned=true; }
    catch { let pid:number;try{pid=JSON.parse(readFileSync(this.lock,'utf8')).pid;if(!Number.isInteger(pid)||pid<=0)throw Error();}catch{throw Error('attention: collector_lock_unavailable');}
      let alive=true;try{process.kill(pid,0);}catch(e:any){if(e.code==='ESRCH')alive=false;}
      if(alive)return false;renameSync(this.lock,this.lock+'.previous-'+Date.now());writeFileSync(this.lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});return this.owned=true; }
  }
  private start() {
    this.store.fresh();
    // A crash after provider hand-off is uncertain; never replay it and create a duplicate phone buzz.
    for(const i of this.store.data.items)if(i.delivery==='sending')i.delivery='uncertain';
    this.poll();this.timer=setInterval(()=>this.poll(),500);this.timer.unref();
  }
  close() { clearInterval(this.timer);if(!this.owned)return;this.owned=false;try{if(JSON.parse(readFileSync(this.lock,'utf8')).pid===process.pid)unlinkSync(this.lock);}catch{} }
  settings() { const s=this.store.data.settings;return {...s,topic:undefined,phoneConfigured:!!s.topic}; }
  configure(patch: any) {
    const old = this.store.data.settings;
    if(!patch||typeof patch!=='object')throw Error('Invalid notification settings');
    for(const k of ['desktop','phone'])if(patch[k]!==undefined && typeof patch[k]!=='boolean')throw Error('Invalid notification settings');
    if(patch.topic!==undefined && (typeof patch.topic!=='string'||(patch.topic&&!/^[A-Za-z0-9_-]{24,160}$/.test(patch.topic))))throw Error('Use a private ntfy topic with at least 24 letters, digits or underscores');
    if(patch.appUrl!==undefined){const u=new URL(patch.appUrl);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)throw Error('Use your authenticated HTTPS Agent Base address');}
    if(patch.snoozeUntil!==undefined && (!Number.isFinite(patch.snoozeUntil)||patch.snoozeUntil<Date.now()||patch.snoozeUntil>Date.now()+86400000))throw Error('Invalid snooze');
    this.store.fresh(); const settings={...old,...Object.fromEntries(['desktop','phone','topic','appUrl','snoozeUntil'].filter(k=>patch[k]!==undefined).map(k=>[k,patch[k]]))};
    if(settings.phone && (!settings.topic||!settings.appUrl))throw Error('Set the phone topic and HTTPS Agent Base address first');
    this.store.data.settings=settings;this.store.save();return this.settings();
  }
  list() { return this.store.data.items.map(i=>({...i,agentId:this.resolve(i)?.agentId??null})).sort((a,b)=>b.at.localeCompare(a.at)); }
  get(id: string) { return this.list().find(i=>i.id===id); }
  mark(id: string, read = true) { this.store.fresh();const i=this.store.data.items.find(i=>i.id===id);if(!i)return false;i.read=read;this.store.save();return true; }
  resolve(i: Attention) { const h=this.hosts.get(i.ref.hostInstanceId);if(!h||h.session!==i.ref.sessionId)return null;return { host:h,agentId:this.address(h) }; }
  private poll() {
    if(this.busy)return;this.busy=true;
    try {
      const hadCursors=Object.keys(this.store.data.cursors).length;this.store.fresh();if(hadCursors&&!Object.keys(this.store.data.cursors).length){this.birth=Date.now();this.journals.clear();}this.healthy=true;const next = new Map<string,Host>();let changed=false;
      for(const file of readdirSync(this.hostsDir).filter(f=>f.endsWith('.json')).slice(0,1000)) {
        let h:Host;try {
          const full=path.join(this.hostsDir,file),s=statSync(full),stamp=`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
          let hit=this.hostFiles.get(file);
          if(!hit||hit.stamp!==stamp){hit={stamp,host:JSON.parse(readFileSync(full,'utf8'))};this.hostFiles.set(file,hit);}
          h=hit.host;
        } catch {this.hostFiles.delete(file);continue;}
        if(!h.hostInstanceId||!h.activityJournal||typeof h.name!=='string')continue;
        next.set(h.hostInstanceId,h);if(h.activityHealthy===false)this.healthy=false;
        // Only per-instance journals in the host's state plane; bound reads and preserve incomplete tails.
        const allowed=path.resolve(process.env.AB_ACTIVITY_DIR??path.join(path.dirname(this.hostsDir),'activity'));
        if(path.dirname(path.resolve(h.activityJournal))!==allowed||path.basename(h.activityJournal)!==h.hostInstanceId+'.jsonl')continue;
        try {
          let cursor=this.store.data.cursors[h.hostInstanceId]??0;
          const s=statSync(h.activityJournal),identity=`${s.dev}:${s.ino}`,stamp=`${s.mtimeMs}:${s.ctimeMs}`;
          if(s.size>2*1024*1024){this.healthy=false;continue;}
          const previous=this.journals.get(h.activityJournal);
          if(previous&&previous.cursor===cursor&&previous.identity===identity&&previous.size===s.size&&previous.stamp===stamp)continue;
          // Replay a replacement, truncation or same-size rewrite through the durable sequence cursor.
          const offset=previous&&previous.cursor===cursor&&previous.identity===identity&&s.size>previous.size?previous.offset:0;
          const buffer=Buffer.alloc(s.size-offset);let fd:number|undefined,bytes=0;
          try{fd=openSync(h.activityJournal,'r');bytes=readSync(fd,buffer,0,buffer.length,offset);}finally{if(fd!==undefined)closeSync(fd);}
          const end=buffer.subarray(0,bytes).lastIndexOf(10);
          // Keep the incomplete tail in bytes; a split UTF-8 character is decoded only once complete.
          const lines=end<0?[]:buffer.toString('utf8',0,end).split('\n');
          for(const line of lines){if(line.length>4096)continue;let e:ActivityEvent;try{e=JSON.parse(line);}catch{continue;}
            if(!e||typeof e!=='object')continue;
            if((typeof e.kind!=='string')||(e.kind.startsWith('request.')&&(!e.request||!['approval','input'].includes(e.request.kind)||typeof e.request.id!=='string'||e.request.id.length>180))||e.v!==1||e.ref?.hostInstanceId!==h.hostInstanceId||e.id!==`${h.hostInstanceId}:${e.seq}`||!Number.isInteger(e.seq)||e.seq<=cursor||!Number.isFinite(Date.parse(e.at))||typeof e.ref.sessionId!=='string'||typeof e.ref.runId!=='string')continue;
            this.project(e,h,Date.parse(e.at)<=this.birth);cursor=e.seq;changed=true;
          }
          this.store.data.cursors[h.hostInstanceId]=cursor;
          this.journals.set(h.activityJournal,{identity,size:s.size,stamp,offset:offset+end+1,cursor});
        }catch{this.healthy=false;}
      }
      this.hosts=next;
      const liveJournals=new Set([...next.values()].map(h=>h.activityJournal));
      for(const file of this.journals.keys())if(!liveJournals.has(file))this.journals.delete(file);
      for(const item of this.store.data.items)if(item.phase==='needs'&&!this.resolve(item)){item.phase='resolved';item.revision++;if(item.delivery==='pending')item.delivery='expired';changed=true;}
      this.store.data.items=this.store.data.items.slice(-500);
      if(changed)this.store.save();
      void this.deliver().catch(() => { this.healthy=false; });
    }catch{this.healthy=false;}finally{this.busy=false;}
  }
  private project(e: ActivityEvent,h:Host,historical:boolean) {
    const items=this.store.data.items;
    const run = (i:Attention)=>i.ref.hostInstanceId===e.ref.hostInstanceId&&i.ref.runId===e.ref.runId;
    if(e.kind==='request.resolved'||e.kind==='run.cancelled'||['run.completed','run.failed','runtime.failed'].includes(e.kind)) {
      for(const i of items.filter(i=>run(i)&&i.phase==='needs'&&(e.kind!=='request.resolved'||i.requestId===e.request?.id))){i.phase='resolved';i.revision++;if(i.delivery==='pending')i.delivery='expired';}
    }
    const needs=e.kind==='request.opened';
    const failed=e.kind==='run.failed'||e.kind==='runtime.failed';
    const completed=e.kind==='run.completed'&&!e.pendingWakeWork;
    if(!needs&&!failed&&!completed)return;
    // T3 Code agentActivityAlerts.ts (MIT, T3 Tools Inc., 2026): silent historical baseline, stable transition identity.
    const id='activity:'+e.ref.hostInstanceId+':'+e.ref.runId+':'+(needs?'request:'+e.request?.id:'terminal');
    if(items.some(i=>i.id===id))return;
    const quiet=!needs&&(h.lead==='Agent Zero'||infrastructure.test(h.name)||h.role==='infrastructure'||this.quiet(h));
    if(quiet)return;
    const buzz=!historical&&Date.parse(e.at)<=Date.now()+30000&&Date.now()-Date.parse(e.at)<120000;
    const headline=needs?(e.request?.kind==='input'?'Needs your answer':'Needs your approval'):failed?'Turn failed — open the chat':'Finished its turn — ready for review';
    items.push({id,ref:e.ref,...(needs?{requestId:e.request?.id,requestKind:e.request?.kind}:{}),phase:needs?'needs':failed?'failed':'completed',at:e.at,agentId:null,agentName:h.name,headline,read:false,revision:1,buzz,delivery:buzz&&this.store.data.settings.phone?'pending':'off'});
  }
  private delivering = false;
  private async deliver() {
    if(this.delivering)return;this.delivering=true;
    try { for(const item of this.store.data.items.filter(i=>i.delivery==='pending')){
      const s=this.store.data.settings;
      if(!s.phone||s.snoozeUntil>Date.now()||Date.now()-Date.parse(item.at)>300000||item.phase==='resolved'){item.delivery='expired';this.store.save();continue;}
      item.delivery='sending';this.store.save();
      try {
        // Authenticated user opt-in only. Phone payload deliberately contains no chat text, project or tool arguments.
        const response=await this.phoneFetch('https://ntfy.sh/'+s.topic,{method:'POST',headers:{'Content-Type':'text/plain; charset=utf-8','Title':'Agent Base','Click':s.appUrl.replace(/\/$/,'')+'/#attention/'+encodeURIComponent(item.id)},body:item.agentName+' — '+item.headline,signal:AbortSignal.timeout(8000),redirect:'error'});
        item.delivery=response.ok?'provider_accepted':'failed';
      }catch{item.delivery='uncertain';}this.store.save();
    } }finally{this.delivering=false;}
  }
}
