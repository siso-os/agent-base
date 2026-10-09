import { constants, watch, type FSWatcher } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const widgetId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s);
export type WidgetAction = 'seen' | 'reply' | 'voice';
export type WidgetDocument = { id:string; agent:string; title:string; shape:string; updated:string; data:any; actions:{kind:WidgetAction}[]; revision:string };
export type WidgetIndex = { widgets: Omit<WidgetDocument,'data'>[]; excluded:number; error:string|null };
const MAX_BYTES = 256 * 1024, MAX_FILES = 128;
const object = (v:any) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v:any, max=4000) => typeof v === 'string' && v.length <= max && !v.includes('\0');
const rows = (v:any, valid:(r:any)=>boolean) => Array.isArray(v) && v.length<=128 && v.every(r=>object(r)&&valid(r));
const strings = (v:any) => Array.isArray(v) && v.length<=32 && v.every(s=>text(s));
const number = (v:any) => typeof v==='number' && Number.isFinite(v) && v>=0;
/** Validate known shapes before they reach existing renderers; unknown shapes remain inert JSON text. */
export function validateWidget(value:any, agent:string, id:string): WidgetDocument | null {
  if (id==='events' || !object(value) || value.agent!==agent || value.id!==id || !text(value.title,200) || !value.title.trim() || !widgetId(value.shape) || !text(value.updated,64) || !Number.isFinite(Date.parse(value.updated)) || !object(value.data)) return null;
  const d=value.data;
  const valid = value.shape==='needs' ? rows(d.items,r=>widgetId(r.id)&&text(r.title)&&[r.detail,r.link].every(s=>s===undefined||text(s))&&(r.minutes===undefined||number(r.minutes)))
    : value.shape==='list' ? rows(d.rows,r=>text(r.meta)&&text(r.title)&&(r.quote===undefined||text(r.quote)))
    : value.shape==='progress' ? number(d.checked)&&number(d.total)&&object(d.counts)&&Object.keys(d.counts).length<=32&&Object.values(d.counts).every(number)&&rows(d.items,r=>text(r.title)&&text(r.status,64)&&(r.owner===undefined||text(r.owner,200)))
    : value.shape==='team' ? rows(d.members,r=>text(r.name,200)&&['working','done','idle','off'].includes(r.state)&&text(r.model,200)&&text(r.task)&&(r.project===undefined||text(r.project,200))&&(!r.lastReport||(object(r.lastReport)&&text(r.lastReport.at,64)&&text(r.lastReport.text))))
    : value.shape==='systems' ? d.source==='servers'||rows(d.servers,r=>text(r.name,200)&&text(r.role,200)&&['ok','warn','bad'].includes(r.level)&&['cpus','memTotalGb','memAvailGb','diskFreeGb'].every(k=>r[k]===null||number(r[k]))&&(r.load===null||(Array.isArray(r.load)&&r.load.length<=3&&r.load.every(number)))&&strings(r.why))&&text(d.heavy)
    : value.shape==='announcements' ? rows(d.items,r=>widgetId(r.id)&&text(r.title,200)&&text(r.body)&&[r.project,r.at,r.needs].every(v=>v===undefined||text(v))&&(r.seen===undefined||typeof r.seen==='boolean'))&&new Set(d.items.map((r:any)=>r.id)).size===d.items.length : true;
  if(!valid || (value.actions!==undefined && (!Array.isArray(value.actions)||value.actions.length>3||!value.actions.every((a:any)=>object(a)&&['seen','reply','voice'].includes(a.kind))))) return null;
  // File data never supplies a navigation URL or HTML. Needs opens this widget through its parent selection.
  const data=value.shape==='needs'?{...d,items:d.items.map(({link,...item}:any)=>item)}:d;
  const clean={id,agent,title:value.title,shape:value.shape,updated:value.updated,data,actions:value.actions??[]};
  return {...clean,revision:createHash('sha256').update(JSON.stringify(clean)).digest('hex')};
}

export function createWidgetReader(root=process.env.AB_WIDGETS_ROOT??path.join(homedir(),'.local/state/agent-base/widgets')) {
  const base=path.resolve(root),uid=process.getuid?.();
  async function directory(agent:string) {
    if(!widgetId(agent))throw Error('Invalid agent');
    const folder=path.join(base,agent);
    for(const p of [base,folder]){const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink()||(uid!==undefined&&st.uid!==uid)||await realpath(p)!==p)throw Error('Unowned widget directory');}
    return folder;
  }
  async function read(agent:string,id:string):Promise<WidgetDocument|null> {
    if(!widgetId(id))return null;
    let file;
    try {
      file=await open(path.join(await directory(agent),id+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
      const st=await file.stat();if(!st.isFile()||st.nlink!==1||st.size>MAX_BYTES||(uid!==undefined&&st.uid!==uid))return null;
      const buffer=Buffer.alloc(MAX_BYTES+1),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>MAX_BYTES)return null;
      return validateWidget(JSON.parse(buffer.toString('utf8',0,bytesRead)),agent,id);
    }catch{return null;}finally{await file?.close();}
  }
  async function index(agent:string):Promise<WidgetIndex>{
    try {
      const folder=await directory(agent),entries=await opendir(folder),names:string[]=[];let excluded=0,scanned=0;
      for await(const entry of entries){if(++scanned>512){excluded++;break;}if(!entry.isFile()||!entry.name.endsWith('.json')){excluded++;continue;}const id=entry.name.slice(0,-5);if(!widgetId(id)||names.length>=MAX_FILES){excluded++;continue;}names.push(id);}
      const widgets:WidgetIndex['widgets']=[];
      for(const id of names.sort()){const item=await read(agent,id);if(item){const {data,...summary}=item;widgets.push(summary);}else excluded++;}
      return {widgets,excluded,error:null};
    }catch{return {widgets:[],excluded:0,error:'Widget source unavailable'};}
  }
  async function subscribe(agent:string, changed:()=>void){
    let closed=false,timer:ReturnType<typeof setTimeout>|undefined,folderWatch:FSWatcher|undefined,baseWatch:FSWatcher|undefined,parentWatch:FSWatcher|undefined;
    let folderGeneration=0,baseGeneration=0;
    const trigger=()=>{if(closed)return;clearTimeout(timer);timer=setTimeout(()=>{if(!closed)changed();},50);};
    const owned=async(p:string)=>{const st=await lstat(p);if(!st.isDirectory()||await realpath(p)!==p||(uid!==undefined&&st.uid!==uid))throw Error('Unowned widget directory');};
    const bind=async()=>{const generation=++folderGeneration;folderWatch?.close();folderWatch=undefined;try{const folder=await directory(agent);if(closed||generation!==folderGeneration)return;folderWatch=watch(folder,trigger);folderWatch.on('error',trigger);}catch{trigger();}};
    const bindBase=async()=>{const generation=++baseGeneration;baseWatch?.close();baseWatch=undefined;try{await owned(base);if(closed||generation!==baseGeneration)return;baseWatch=watch(base,(_event,name)=>{if(!name||String(name)===agent){void bind();trigger();}});baseWatch.on('error',trigger);}catch{}await bind();};
    // Watch only the owning parent entry too, so first publication can create the root after a panel opens.
    try{const parent=path.dirname(base);await owned(parent);parentWatch=watch(parent,(_event,name)=>{if(!name||String(name)===path.basename(base)){void bindBase();trigger();}});parentWatch.on('error',trigger);}catch{}
    await bindBase();
    return ()=>{closed=true;clearTimeout(timer);parentWatch?.close();baseWatch?.close();folderWatch?.close();};
  }
  return {read,index,subscribe};
}
