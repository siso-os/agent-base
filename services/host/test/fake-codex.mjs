#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv[2] !== '-m' || !process.argv[3]) process.exit(2);
const model = process.argv[3];
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let thread = 'test-thread', turn = 0, active = null;
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line), p = m.params ?? {};
  const result = r => send({id:m.id,result:r});
  if (m.method === 'initialize') result({});
  else if (m.method === 'thread/resume' && p.threadId === 'never-used') send({id:m.id,error:{code:-32600,message:'no rollout found for thread id never-used'}});
  else if (['thread/start','thread/resume'].includes(m.method)) {
    if (p.model !== model) process.exit(3);
    thread = p.threadId ?? thread;
    result({thread:{id:thread,turns:[],createdAt:1}});
  } else if (m.method === 'turn/start') {
    if (p.model !== model) process.exit(3);
    const id = `turn-${++turn}`; active = id;
    send({method:'turn/started',params:{threadId:thread,turn:{id}}});
    if (process.env.FAKE_START_DELAY) setTimeout(()=>result({turn:{id}}),120);
    else result({turn:{id}});
    if (p.input[0].text === 'question') {
      send({id:'native-question-42',method:'item/tool/requestUserInput',params:{threadId:thread,turnId:id,itemId:'question-item',questions:[{id:'choice',header:'Direction',question:'Which direction?',isOther:true,isSecret:false,options:[{label:'Alpha',description:'First'},{label:'Beta',description:'Second'}]}]}});
      return;
    }
    send({id:100,method:'item/commandExecution/requestApproval',params:{threadId:thread,command:'echo approved'}});
  } else if (m.method === 'turn/steer') {
    if (p.input[0].text === 'reject steering') return send({id:m.id,error:{message:'fixture_steer_unavailable'}});
    if (p.expectedTurnId !== active || p.threadId !== thread) return send({id:m.id,error:{message:'stale_turn'}});
    result({turnId:active});
    send({method:'item/completed',params:{threadId:thread,item:{type:'agentMessage',id:'steer-proof',text:'Steered: '+p.input[0].text}}});
  } else if (m.id === 'native-question-42') {
    if (m.result?.answers?.choice?.answers?.[0] !== 'Beta') process.exit(4);
    send({method:'item/completed',params:{threadId:thread,item:{type:'agentMessage',id:'question-proof',text:'Answer received: Beta'}}});
    send({method:'turn/completed',params:{threadId:thread,turn:{id:active,status:'completed'}}}); active = null;
  } else if (m.id === 100) {
    send({method:'thread/tokenUsage/updated',params:{threadId:thread,tokenUsage:{last:{outputTokens:10,totalTokens:100},total:{inputTokens:90,outputTokens:10},modelContextWindow:1000}}});
    send({method:'item/completed',params:{threadId:thread,item:{type:'agentMessage',id:'a',text:'Approved reply'}}});
    send({method:'turn/completed',params:{threadId:thread,turn:{id:active,status:'completed'}}});
  }
});
