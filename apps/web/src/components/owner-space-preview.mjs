import { createServer } from '../../node_modules/vite/dist/node/index.js';
import react from '../../node_modules/@vitejs/plugin-react/dist/index.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const server=await createServer({configFile:false,root,plugins:[react()],optimizeDeps:{entries:['preview/owner-space.html']},server:{host:'127.0.0.1',port:5498,strictPort:true,fs:{allow:[path.resolve(root,'../..')]}},cacheDir:path.resolve(root,'../../.agents/scratchpads/landing-20261006/owner-space-vite')});
await server.listen();try{const child=spawn('python3',[path.join(import.meta.dirname,'owner-space-check.py')],{stdio:'inherit'});process.exitCode=Number(await new Promise(r=>child.on('exit',r))??1);}finally{await server.close();}
