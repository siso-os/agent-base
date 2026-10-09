import { createRoot } from 'react-dom/client';
import { ChatView } from '../src/components/ChatView';
import { AgentFace } from '../src/lib/face';
import '../src/index.css';
import './chat-outline.css';
const at = Date.now() - 400_000;
const log: any[] = [];
for (let i = 0; i < 300; i++) {
  log.push({ t: 'user', text: `Review step ${i + 1}`, from: 'app', at: at + i * 1000 });
  if (i === 255) log.push({ t: 'tool', id: 'tool-255', name: 'Bash', summary: 'Inspect the saved check', at: at + i * 1000 + 50 }, { t: 'tool_done', id: 'tool-255', ok: true, out: 'folded tool needle: the isolated check passed', at: at + i * 1000 + 100 });
  const body = i === 270 ? '\n```text\n' + Array.from({ length: 400 }, (_, n) => n === 350 ? 'deep code needle: line 351' : `line ${n + 1}: sample output`).join('\n') + '\n```' : '\nThe preview is ready for review. The work and its checks are recorded beside this answer.';
  log.push({ t: 'text', id: `answer-${i}`, text: `## ${i === 12 ? 'Older archive needle' : `Answer ${i + 1}`}\n${i % 20 === 0 ? 'ship queue · ' : ''}${body}`, at: at + i * 1000 + 200 }, { t: 'result', ms: 250, cost: null, at: at + i * 1000 + 250 });
}
const pageSize = 180;
let mode = 'idle', heldKey = '', delayedOlder = false;
const sent: any[] = [];
const partialText = '## Delivery check\nThe first part has arrived. I am checking the remaining evidence';
const liveUser = { t: 'user', text: 'Check the final delivery.', from: 'app', at: Date.now() };
class FakeSocket {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  readyState=0; onopen: (() => void) | null=null; onclose: ((e:{code:number}) => void) | null=null; onmessage: ((m:{data:string}) => void) | null=null;
  constructor() { sockets.push(this); setTimeout(() => { if (this.readyState === 3) return; this.readyState=1; this.onopen?.(); this.hello(); }, 30); }
  emit(e: unknown) { if (this.readyState === 1) this.onmessage?.({data:JSON.stringify(e)}); }
  hello() {
    if (mode === 'changed') {
      const now=Date.now();
      this.emit({t:'hello',name:'STUDIO',session:'fixture-new',state:'idle',log:[{t:'user',text:'Start the next session.',from:'app',at:now},{t:'text',id:'new-answer',text:'## New session answer\nEarlier work remains available as history.',at:now+1},{t:'result',ms:1,cost:null,at:now+2}],partial:{},tasks:[],bg:[],more:false,before:0,capabilities:{version:1,auto:true,steer:false,images:false,activeTurnId:null,compacting:false}});
      return;
    }
    const base = log.slice(-pageSize);
    const recovering = mode !== 'idle';
    const continued = mode === 'continued';
    this.emit({t:'hello',name:'STUDIO',session:mode==='changed'?'fixture-new':'fixture-thread',state:recovering && !continued ? 'working':'idle',log:[...base,...(recovering ? [liveUser] : []),...(continued ? [{t:'text',id:'live-answer',text:partialText+' and the completed check.',at:Date.now()}, {t:'result',ms:200,cost:null,at:Date.now()}] : [])],partial:recovering && !continued ? {'live-answer':partialText}: {},tasks:[],bg:[],more:true,before:log.length-pageSize,capabilities:{version:1,auto:true,steer:false,images:false,activeTurnId:null,compacting:false}});
  }
  send(raw: string) {
    const message=JSON.parse(raw); sent.push(message);
    if(message.t==='older' && !delayedOlder) {
      const end=message.before, before=Math.max(0,end-pageSize);
      setTimeout(()=>this.emit({t:'older',events:log.slice(before,end),before,more:before>0}),35);
    }
    if(message.t==='prompt') { heldKey=message.key; this.emit({t:'prompt.receipt',key:heldKey,phase:'unknown',queueRevision:1,text:'Delivery not known'}); }
  }
  close() { this.readyState=3; }
  drop() { this.readyState=3; this.onclose?.({code:1006}); }
}
const sockets: FakeSocket[]=[];
(window as unknown as {WebSocket: unknown}).WebSocket=FakeSocket;
const current=()=>sockets.at(-1)!;
const fixture = {
  sent, sockets, setMode: (value:string)=>{mode=value;}, delayOlder:(value:boolean)=>{delayedOlder=value;},
  start:()=>{mode='stopped';current().emit(liveUser);current().emit({t:'state',state:'working'});current().emit({t:'delta',id:'live-answer',text:partialText,at:Date.now()});},
  drop:()=>current().drop(),
  receipt:(phase:string)=>current().emit({t:'prompt.receipt',key:heldKey,phase,queueRevision:2,text:phase==='failed'?'Host confirmed this attempt was not delivered':phase}),
  complete:()=>{current().emit({t:'text',id:'live-answer',text:partialText+' and the completed check.',at:Date.now()});current().emit({t:'result',ms:200,cost:null,at:Date.now()});current().emit({t:'state',state:'idle'});},
};
(window as unknown as {fixture:typeof fixture}).fixture=fixture;
function Preview() { return <div className="outline-preview"><header><AgentFace name="STUDIO" project="Agent Base" size={28}/><div><strong>STUDIO</strong><small>Agent Base · synthetic conversation</small></div><button onClick={()=>{fixture.start();setTimeout(fixture.drop,300);}}>Show connection recovery</button></header><main><ChatView agentId="fixture-chat-outline" agentName="STUDIO" active people={{}}/></main></div>; }
createRoot(document.getElementById('root')!).render(<Preview/>);
