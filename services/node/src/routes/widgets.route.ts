import {createWidgetReader,widgetId} from '../widgets.ts';
import type {Route} from './registry.ts';
export function widgetsRoute(reader=createWidgetReader()):Route {
  let streams=0;
  return {method:'GET',path:/^\/api\/widgets\/([^/]+)(?:\/([^/]+))?$/,async handle(req,res,match){
    const agent=match[1],id=match[2],json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(!widgetId(agent)||(id&&!widgetId(id)))return json(400,{error:'Invalid widget identity'});
    if(id!=='events'){if(id){const widget=await reader.read(agent,id);return json(widget?200:404,widget??{error:'Widget unavailable'});}return json(200,await reader.index(agent));}
    if(streams>=64)return json(503,{error:'Too many widget subscriptions'});
    streams++;let closed=false,busy=false,again=false;let stop=()=>{};
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.flushHeaders();
    const send=async()=>{if(closed)return;if(busy){again=true;return;}busy=true;try{const data=await reader.index(agent);if(!closed&&!res.write(`data: ${JSON.stringify(data)}\n\n`))res.destroy();}finally{busy=false;if(again){again=false;void send();}}};
    const heartbeat=setInterval(()=>{if(!closed&&!res.write(': keepalive\n\n'))res.destroy();},20000);heartbeat.unref();
    res.on('close',()=>{closed=true;streams--;clearInterval(heartbeat);stop();});
    stop=await reader.subscribe(agent,()=>void send());if(closed)stop();else await send();
  }};
}
export const route=widgetsRoute();
