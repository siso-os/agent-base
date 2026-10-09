/** Request identity guard adapted from Grok Build dashboard.rs (Apache-2.0, SpaceXAI, 2023–2026). */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ActivityJournal } from './activity.ts';
export class AttentionCommands {
  private receipts: Record<string,{ hash: string; status: string }> = {};
  private healthy = true;
  private writes: Promise<unknown> = Promise.resolve();
  private activity: ActivityJournal;
  constructor(activity: ActivityJournal) { this.activity = activity;try{const raw=JSON.parse(readFileSync(this.file(),'utf8'));if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.values(raw).some((v:any)=>typeof v?.hash!=='string'||typeof v?.status!=='string'))throw Error('invalid receipts');this.receipts=raw;}catch(e:any){if(e.code!=='ENOENT')this.healthy=false;} }
  private file() {return this.activity.journal+'.commands.json';}
  private save() {const file=this.file(),temp=file+'.tmp';writeFileSync(temp,JSON.stringify(this.receipts),{mode:0o600,flush:true});renameSync(temp,file);}
  handle(m: any, valid: () => boolean, execute: () => Promise<string>|string): Promise<{t:'attention_ack'; commandId:string; status:string}> {
    const run = this.writes.then(async()=>{
      const ack=(status:string)=>({t:'attention_ack' as const,commandId:m.commandId,status});
      if(!this.healthy)return ack('unavailable');
      if(typeof m.commandId!=='string'||!/^[-A-Za-z0-9_:]{1,180}$/.test(m.commandId))return ack('invalid');
      const hash=createHash('sha256').update(JSON.stringify(m)).digest('hex'),old=this.receipts[m.commandId];
      if(old)return ack(old.hash===hash?old.status:'invalid');
      if(!valid())return ack('stale');
      try { this.receipts[m.commandId]={hash,status:'uncertain'};this.save(); }
      catch {return ack('unavailable');}
      let status:string;try{status=await execute();}catch{status='unavailable';}
      this.receipts[m.commandId]={hash,status};
      const keys=Object.keys(this.receipts);for(const k of keys.slice(0,Math.max(0,keys.length-500)))delete this.receipts[k];
      try{this.save();}catch{return ack('uncertain');}return ack(status);
    });this.writes=run.catch(()=>{});return run;
  }
  matches(m:any,session:string|null) {const r=this.activity.ref;return !!r&&m.ref?.hostInstanceId===r.hostInstanceId&&m.ref?.hostKey===r.hostKey&&m.ref?.machineId===r.machineId&&m.ref?.sessionId===session&&m.ref?.runId===r.runId;}
}
