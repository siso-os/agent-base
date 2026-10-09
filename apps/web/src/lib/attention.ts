import { useCallback, useEffect, useRef, useState } from 'react';
import { every } from './poll';
import { changedReader } from './fetch-changed';
import { attentionIdentity } from './bell';
import { reconcileAttentionCommands } from './attention-command-state';
import type { Attention } from '../../../../services/node/src/activity';
export type { Attention };
export type Settings = { desktop: boolean; phone: boolean; phoneConfigured: boolean; appUrl: string; snoozeUntil: number };
export function attentionId(hash: string) { const m=/^#attention\/([^/]{1,400})$/.exec(hash);try {const id=m?decodeURIComponent(m[1]):null;return id?.startsWith('activity:')&&/^[-A-Za-z0-9_:]+$/.test(id)?id:null;}catch{return null;} }
// Linked OS click adapted from OpenCode entry.tsx (MIT, opencode, 2025): focus, open the existing chat, close.
export function presentAttention(item: Attention,onOpen:(id:string)=>void) {
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const n=new Notification(item.agentName,{body:item.headline,tag:item.id});
  n.onclick=()=>{window.focus();onOpen(item.id);n.close();};
}
const claimed = new Set<string>();
function claim(id:string) {
  if(claimed.has(id))return false;
  let ids:string[]=[];try{ids=JSON.parse(localStorage.getItem('ab-attention-presented')??'[]');if(ids.includes(id)){claimed.add(id);return false;}}catch{}
  claimed.add(id);try{localStorage.setItem('ab-attention-presented',JSON.stringify([...ids,id].slice(-1000)));}catch{}return true;
}
export async function attentionPost(path:string,body:unknown) {
  const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();
  if(!r.ok)throw Error(d.status==='uncertain'?'Delivery uncertain; refresh before trying again':d.status==='stale'?'Request changed; refresh this notification':d.error??d.status??'Notifications unavailable');return d;
}
export function useAttention(onOpen:(id:string)=>void) {
  const [items,setItems]=useState<Attention[]>([]),[settings,setSettings]=useState<Settings|null>(null),[healthy,setHealthy]=useState(true);
  const open=useRef(onOpen);open.current=onOpen;
  const read=useRef(changedReader()).current;
  const load=useCallback(async()=>{
    try{const r=await read('/api/attention');if(r===null)return;if(!r.ok)throw Error();const d=await r.json().catch(e=>{read.reset();throw e;});setItems(d.items);setSettings(d.settings);setHealthy(d.healthy);
      if(d.healthy)reconcileAttentionCommands((d.items as Attention[]).map(attentionIdentity));
      for(const i of d.items as Attention[])if(i.buzz&&Date.now()-Date.parse(i.at)<120000&&i.phase!=='resolved'&&claim(i.id)&&d.settings.desktop&&d.settings.snoozeUntil<Date.now())presentAttention(i,id=>open.current(id));
    }catch{read.reset();setHealthy(false);}
  },[]);
  useEffect(()=>every(()=>void load(),5000),[load]);
  return { items,settings,healthy,load };
}
