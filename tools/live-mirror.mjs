// Read-only mirror of the live Agent Base (see .agents/ASTRA.md): node tools/live-mirror.mjs <web dist> [port]
// Read-only mirror of the live Agent Base: serves a web build, proxies GET /api/* to 5401, refuses every other method and all websockets.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dist=process.argv[2], port=+process.argv[3]||5490;
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
const s=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/')){
    if(req.method!=='GET'){res.writeHead(403);return res.end('{"error":"read-only mirror"}');}
    if(/\/(stream|events|term|attach|ws)\b/.test(req.url)&&!/^\/api\/(agents|a0|org|ship|releases|version|timeline|spaces|not-landed|stats)/.test(req.url)){res.writeHead(404);return res.end('{}');}
    const p=http.request({host:'127.0.0.1',port:5401,path:req.url,method:'GET',headers:{accept:req.headers.accept||'*/*'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    p.on('error',()=>{res.writeHead(502);res.end('{}');});p.end();res.on('close',()=>p.destroy());return;
  }
  let f=path.join(dist,decodeURIComponent(req.url.split('?')[0]));
  if(!f.startsWith(dist)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(dist,'index.html');
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
s.on('upgrade',(req,sock)=>sock.destroy());
s.listen(port,'127.0.0.1',()=>console.log('mirror',port));
