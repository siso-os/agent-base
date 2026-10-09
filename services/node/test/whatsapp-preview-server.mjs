// Synthetic-only integration preview; never instantiate a real gateway configuration.
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { proxy } from '../src/whatsapp.ts';
import { previewWhatsAppImport, importWhatsAppContacts } from '../src/rolodex.ts';
import { accountKey, organise } from '../src/whatsapp-private.ts';
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));
const {createServer}=await import(require.resolve('vite'));
const {default:tailwindcss}=await import(require.resolve('@tailwindcss/vite'));
if(!process.env.AB_WHATSAPP_STATE?.includes('.siso-ephemeral-')) throw new Error('Isolated fixture state required');
const now=Math.floor(Date.now()/1000);
const chats=[{jid:'fixture-one@s.whatsapp.net',name:'Avery Fixture',isGroup:false,lastTs:now,unread:1,preview:'Synthetic launch notes are ready.'},{jid:'fixture-group@g.us',name:'Demo client group — '+ 'Long conversation heading '.repeat(12),isGroup:true,lastTs:now-60,unread:0,preview:'Synthetic group discussion.'}];
const counts={chats:2,groups:1,messages:2,unreadChats:1};
const messages=new Map(chats.map(c=>[c.jid,[{chat:c.jid,id:'fixture-message',senderName:c.isGroup?'Jordan Demo':c.name,fromMe:false,ts:now-120,kind:'text',text:'Synthetic message for the communications review. Save this reference or write a draft below.'}]]));
let sends=0, healthMode='ok', feedMode='ok';
const reviewFixture=process.env.COMMS_REVIEW_FIXTURE==='1';
let people=[{jid:chats[0].jid,name:chats[0].name,isGroup:false,lastTs:now,lastIn:now,lastOut:0,messages:2}];
if(reviewFixture) people.push(...Array.from({length:23},(_,i)=>({jid:`fixture-review-${i}@lid`,name:`Review Contact ${String(i+1).padStart(2,'0')}`,isGroup:false,lastTs:now,lastIn:now,messages:2})),{jid:'fixture-conflict@lid',name:'Jordan Updated',isGroup:false,lastTs:now,messages:1},{jid:'fixture-known@lid',name:'Casey Known',isGroup:false,lastTs:now,messages:1},{jid:'fixture-ambiguous-a@lid',name:'Same Name',isGroup:false},{jid:'fixture-ambiguous-b@lid',name:'Same Name',isGroup:false});
const gateway=http.createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 const u=new URL(req.url,'http://fixture');
 if(u.pathname==='/health'&&healthMode==='denied'){res.statusCode=401;return res.end('{}');}
 if(u.pathname==='/health'&&healthMode==='malformed')return res.end('{"sendEnabled":true,"appSendEnabled":true}');
 if(u.pathname==='/health')return res.end(JSON.stringify({link:{state:'connected',loggedIn:true,connected:true,since:now},counts,sendEnabled:true,readReceipts:false}));
 if(u.pathname==='/chats')return res.end(JSON.stringify({chats,counts}));
 if(u.pathname==='/rolodex'&&feedMode==='failed'){res.statusCode=503;return res.end('{}');}
 if(u.pathname==='/rolodex')return res.end(JSON.stringify({people:feedMode==='changed'?people.map(p=>p.jid===chats[0].jid?{...p,name:'Avery Changed During Review'}:p):people}));
 if(u.pathname==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});return res.end(': fixture\n\n');}
 const m=u.pathname.match(/^\/chats\/([^/]+)\/(messages|send|read)$/);
 if(m){const jid=decodeURIComponent(m[1]);if(m[2]==='messages')return res.end(JSON.stringify({chat:chats.find(c=>c.jid===jid),messages:u.searchParams.has('before')?(reviewFixture&&Number(u.searchParams.get('before'))>now-86400?[{chat:jid,id:'fixture-old',senderName:'Earlier Fixture',fromMe:false,ts:now-86400,kind:'text',text:'An earlier saved milestone, from synthetic history.'}]:[]):messages.get(jid)}));
 if(m[2]==='send'){sends++;let body='';for await(const c of req)body+=c;const {text}=JSON.parse(body);if(text==='FAIL'){res.statusCode=429;return res.end('{"error":"synthetic rejected"}');}if(text==='UNKNOWN'){res.destroy();return;}await new Promise(r=>setTimeout(r,120));const id='fixture-out-'+sends;messages.get(jid).push({chat:jid,id,fromMe:true,ts:now,kind:'text',text});return res.end(JSON.stringify({id}));}
 return res.end('{}');}
 res.statusCode=404;res.end('{}');
});
gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
const cfg={url:`http://127.0.0.1:${gateway.address().port}`,token:'synthetic-only'};
let o=organise(accountKey(cfg.url),{revision:0,type:'folder',name:'Clients'});
o=organise(accountKey(cfg.url),{revision:o.revision,type:'folder',name:'Demo launch',parent:o.folders[0].id});
o=organise(accountKey(cfg.url),{revision:o.revision,type:'membership',chat:chats[0].jid,folder:o.folders[1].id,member:true});
if(reviewFixture){
 o=organise(accountKey(cfg.url),{revision:o.revision,type:'save',chat:chats[0].jid,message:'fixture-old',saved:true});
 o=organise(accountKey(cfg.url),{revision:o.revision,type:'save',chat:chats[0].jid,message:'fixture-unavailable',saved:true});
 const seed=people.filter(p=>p.jid==='fixture-conflict@lid'||p.jid==='fixture-known@lid').map(p=>p.jid==='fixture-conflict@lid'?{...p,name:'Jordan Existing'}:p);
 importWhatsAppContacts(previewWhatsAppImport(seed,accountKey(cfg.url)));
}
const vite=await createServer({configFile:false,plugins:[tailwindcss()],root:process.cwd(),cacheDir:process.env.AB_WHATSAPP_STATE+'/vite',esbuild:{jsx:'automatic'},resolve:{alias:{react:require.resolve('react/package.json').replace('/package.json',''), 'react-dom':require.resolve('react-dom/package.json').replace('/package.json','')}},optimizeDeps:{entries:['ui-hub/whatsapp/preview.html']},server:{middlewareMode:true,fs:{allow:[process.cwd()]},hmr:false}});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/fixture/health'&&reviewFixture&&req.method==='POST'){healthMode=url.searchParams.get('mode')??'ok';return res.end('{}');}
 if(url.pathname==='/fixture/contacts'&&reviewFixture&&req.method==='POST'){feedMode=url.searchParams.get('mode')??'ok';return res.end('{}');}
 if(url.pathname==='/fixture/stats'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({sends}));}
 if(url.pathname.startsWith('/api/')){
  if(!url.pathname.startsWith('/api/whatsapp/')){res.statusCode=404;return res.end('{}');}
  let body='';for await(const c of req)body+=c;
  return proxy(req,res,url,cfg,req.headers.origin===`http://127.0.0.1:${server.address().port}`,body||undefined);
 }
 vite.middlewares(req,res);
});
server.listen(Number(process.env.COMMS_PREVIEW_PORT ?? 5498),'127.0.0.1');await once(server,'listening');
console.log(`Synthetic communications preview: http://127.0.0.1:${server.address().port}/ui-hub/whatsapp/preview.html`);
async function close(){await vite.close();server.closeAllConnections();gateway.closeAllConnections();server.close();gateway.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
