import {createWidgetReader,widgetId,type WidgetAction} from '../widgets.ts';
import {replyText,type NotificationDelivery} from '../notifications.ts';
import type {Route} from './registry.ts';
/** Existing console /answer transport; never infer a chat recipient from a widget filename. */
async function deliver(delivery:NotificationDelivery){
  if(delivery.target.kind!=='console')throw Error('This widget needs its owner chat delivery callback');
  const response=await fetch(delivery.target.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(delivery.target.body),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('The inbox did not accept this action');
}
export function widgetActionsRoute(reader=createWidgetReader(),send=deliver):Route{return {method:'POST',path:/^\/api\/widgets\/([^/]+)\/([^/]+)\/actions$/,async handle(req,res,match){
  const json=(code:number,value:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const [agent,id]=match.slice(1);if(!widgetId(agent)||!widgetId(id))return json(400,{error:'Invalid widget identity'});
  // The central server applies its app-origin gate before dispatch; retain that gate in standalone mounting too.
  const origin=String(req.headers.origin??''),allowed=new Set([`http://${req.headers.host}`,...(process.env.AB_ALLOWED_ORIGINS??'').split(',')]);
  if(origin&&!allowed.has(origin))return json(403,{error:'not this app'});
  let body:any;try{let size=0;const parts:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>10000)return json(413,{error:'Action too large'});parts.push(Buffer.from(chunk));}body=JSON.parse(Buffer.concat(parts).toString());}catch{return json(400,{error:'Invalid JSON'});}
  const widget=await reader.read(agent,id);if(!widget)return json(404,{error:'Widget unavailable'});
  if(body?.revision!==widget.revision)return json(409,{error:'Widget changed; read it again'});
  const kind=body.kind as WidgetAction;if(!widget.actions.some(a=>a.kind===kind))return json(422,{error:'Action unavailable'});
  if(kind!=='seen'&&(typeof body.text!=='string'||!body.text.trim()||body.text.length>8000||body.text.includes('\0')))return json(400,{error:'Use 1–8000 characters'});
  const itemId=body.itemId;
  if(widget.shape==='announcements' ? !widgetId(itemId)||!widget.data.items.some((item:any)=>item.id===itemId) : itemId!==undefined)return json(422,{error:'Announcement item unavailable'});
  const delivery=replyText(agent,`widget:${id}`,kind==='seen'?`Seen: ${widget.title}`:`${kind==='voice'?'Voice: ':''}${body.text.trim()}`);
  if(widget.shape==='announcements'){
    delivery.text=`announcement ${itemId}: ${kind==='seen'?'seen':body.text.trim()}`;
    if(delivery.target.kind==='console')delivery.target.body.text=delivery.text;
  }
  try{await send(delivery);return json(200,{ok:true,sent:'inbox'});}catch{return json(503,{error:'Action not delivered; keep your reply and retry'});}
}};}
export const route=widgetActionsRoute();
