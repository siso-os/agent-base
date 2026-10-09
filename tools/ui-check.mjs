// ui-check <url> <out.png>: headless WebKit full-page shot of a comps page, and a list of any image that failed to load.
import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(path.join(import.meta.dirname,'../services/node/package.json'));const {webkit}=require('playwright');
const [url,out]=process.argv.slice(2);const b=await webkit.launch({headless:true});
try{const p=await b.newPage({viewport:{width:1560,height:900}});await p.goto(url);await p.waitForLoadState('networkidle');
const broken=await p.$$eval('img',im=>im.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')));
await p.screenshot({path:out,fullPage:true});console.log(JSON.stringify({url,out,broken}));if(broken.length)process.exitCode=1;}finally{await b.close();}
