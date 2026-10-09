// Provider-free crash harness: private controller methods, actual fsynced stores, abrupt process exit.
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {CodexChildren,readChildren} from '../src/codex-children.ts';
import {PromptQueue} from '../src/prompt-queue.ts';
import {admitChildReturn} from '../src/child-return.ts';
const [mode,root]=process.argv.slice(2);process.env.AB_HOSTS_DIR=path.join(root,'hosts');process.env.AB_PROMPT_QUEUE_DIR=path.join(root,'queues');
const session='crash-parent',queue=new PromptQueue('PARENT',session),marker=path.join(root,'dispatches');
let admissions=0,reconciliations=0;
const owner={name:'PARENT',session:()=>session,task:()=>{},emit:e=>{if(mode==='after-ack'&&e.t==='tool_done')process.exit(73)},returned:async input=>{
  if(mode==='before-admission')process.exit(73);
  const x=admitChildReturn(queue,input);if(x.fresh)admissions++;else reconciliations++;
  if(mode==='after-admission')process.exit(73);
  if(mode==='during-provider') {queue.claim(input.messageId);appendFileSync(marker,'dispatch\n');process.exit(73);}
  if(mode==='restore'&&x.fresh)appendFileSync(marker,'dispatch\n');
  return x.receipt;
}};
const children=new CodexChildren(owner);children.connect=async()=>{throw Error('dead synthetic child')};
if(mode==='restore'){
  await children.restore();
  for(let n=0;n<50&&readChildren(session)[0]?.pendingReturns?.length;n++)await new Promise(r=>setTimeout(r,10));
  console.log(JSON.stringify({admissions,reconciliations,dispatches:existsSync(marker)?readFileSync(marker,'utf8').trim().split('\n').length:0,child:readChildren(session)[0],queue:queue.snapshot()}));
  await children.close();
}else{
  const c={id:'child-11111111-1111-1111-1111-111111111111',name:'CHILD',hostName:'CHILD-11111111',model:'gpt-6.1-sol',effort:'high',cwd:root,parentSession:session,controlToken:'fixture-only',session:'crash-child',status:'done',startedAt:1,endedAt:10,tokens:1,tools:0,rate:0,last:null,summary:'crash-safe result',resultAt:10,returnedAt:0};
  children.children.set(c.id,c);children.parentSession=session;children.observeResult(c,{turnId:'stable-turn',at:10,status:'completed'});
  if(mode==='before-ack') {const save=children.save.bind(children);children.save=()=>{if(c.returnReceipts&&Object.keys(c.returnReceipts).length)process.exit(73);save();};}
  await children.returnResult(c,{active:false,queue:{session:c.session,revision:0,held:false,entries:[]},requests:new Map()});
  throw Error('Expected injected crash');
}
