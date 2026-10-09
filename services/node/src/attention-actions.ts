import { WebSocket } from 'ws';
import type { ActivityCollector } from './activity.ts';
export async function executeAttentionCommand(collector: ActivityCollector, id: string, m: any) {
  const item=collector.get(id);
  const ack=(status:string)=>({commandId:m.commandId,status});
  if(!item||item.revision!==m.expectedRevision||!m.ref||Object.keys(item.ref).some(k=>item.ref[k as keyof typeof item.ref]!==m.ref[k]))return ack('stale');
  const target=collector.resolve(item);
  if(!target||!target.agentId||target.host.activityRunId!==item.ref.runId)return ack('stale');
  if(m.action?.kind!=='reply'&&(item.phase!=='needs'||m.action?.requestId!==item.requestId))return ack('stale');
  if(['answer','dismiss'].includes(m.action?.kind)&&item.requestKind!=='input')return ack('unsupported');
  if(['approve','deny'].includes(m.action?.kind)&&item.requestKind!=='approval')return ack('unsupported');
  const h=target.host;
  if(!Number.isInteger(h.port)||h.port<1||h.port>65535||typeof h.token!=='string')return ack('unavailable');
  try {process.kill(h.pid,0);}catch{return ack('unavailable');}
  return new Promise<{commandId:string;status:string}>(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${encodeURIComponent(h.token)}`);
    let sent=false,done=false;
    const finish=(status:string)=>{if(done)return;done=true;clearTimeout(timer);ws.close();resolve(ack(status));};
    const timer=setTimeout(()=>finish(sent?'uncertain':'unavailable'),6000);
    ws.on('message',raw=>{let e:any;try{e=JSON.parse(String(raw));}catch{return;}
      if(e.t==='hello'&&!sent){if(e.hostInstance!==item.ref.hostInstanceId||e.session!==item.ref.sessionId)return finish('stale');sent=true;ws.send(JSON.stringify({t:'attention_command',commandId:m.commandId,ref:item.ref,action:m.action}));}
      if(e.t==='attention_ack'&&e.commandId===m.commandId)finish(e.status);
    });ws.on('error',()=>finish(sent?'uncertain':'unavailable'));ws.on('close',()=>finish(sent?'uncertain':'unavailable'));
  });
}
export async function readAttentionRequest(collector: ActivityCollector,id:string) {
  const item=collector.get(id);if(!item||item.phase!=='needs')return null;
  const target=collector.resolve(item);if(!target||target.host.activityRunId!==item.ref.runId)return null;
  return new Promise<any>(resolve=>{
    const h=target.host,ws=new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${encodeURIComponent(h.token)}`);let done=false;
    const finish=(value:any)=>{if(done)return;done=true;clearTimeout(timer);ws.close();resolve(value);};
    const timer=setTimeout(()=>finish(null),3000);
    ws.on('message',raw=>{try{const e=JSON.parse(String(raw));if(e.t==='hello')finish(e.hostInstance===item.ref.hostInstanceId&&e.session===item.ref.sessionId?e.pendingQuestions?.find((q:any)=>q.id===item.requestId)??null:null);}catch{finish(null);}});ws.on('error',()=>finish(null));ws.on('close',()=>finish(null));
  });
}
