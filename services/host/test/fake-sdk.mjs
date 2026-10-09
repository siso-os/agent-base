export async function getSessionMessages() { return []; }
export function query({prompt, options}) {
  if (process.env.FAKE_STEER_QUESTIONS) return interactiveFixture(prompt,options);
  const session = options.resume ?? options.sessionId ?? 'lab-session';
  return {
    close() {},
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({rate_limits_available:true,rate_limits:{five_hour:{utilization:7,resets_at:"2026-10-04T10:00:00Z"},seven_day:{utilization:88,resets_at:"2026-10-08T10:00:00Z"}}}),
    supportedCommands: async () => [],
    getContextUsage: async () => ({totalTokens: 321, maxTokens: 400000, rawMaxTokens: 400000}),
    async *[Symbol.asyncIterator]() {
      yield {type:'system', subtype:'init', session_id:session, model:'fake', apiKeySource:process.env.FAKE_SOURCE ?? 'oauth'};
      for await (const message of prompt) {
        yield {type:'assistant', uuid:'fake-msg', message:{content:[{type:'text',text:message.message.content}]}};
        yield {type:'result',duration_ms:1};
      }
    }
  };
}

function interactiveFixture(prompt,options) {
  const events=[], waiters=[]; let active=false,closed=false,sequence=0;
  const push=e=>{events.push(e);waiters.shift()?.();};
  const text=t=>push({type:'assistant',uuid:'fake-'+(++sequence),message:{content:[{type:'text',text:t}]}});
  return {
    close(){closed=true;waiters.shift()?.();}, interrupt:async()=>{}, supportedCommands:async()=>[], getContextUsage:async()=>({totalTokens:10}),
    async *[Symbol.asyncIterator](){
      const first=await prompt.next();
      yield {type:'system',subtype:'init',session_id:options.resume ?? options.sessionId ?? 'lab-session',model:'fake'};
      const messages=async function*(){if(!first.done)yield first.value;for await(const m of prompt)yield m;};
      void (async()=>{for await(const m of messages()){
        const body=m.message.content;
        if(active){push({type:'command_lifecycle',command_uuid:m.uuid,state:'started'});text('Steered: '+body);continue;}
        active=true;
        if(body==='bash'){
          // t-0583: a compound Bash command that Claude Code asks about even under bypass.
          const result=await options.canUseTool('Bash',{command:'cd /tmp && ls'},{signal:new AbortController().signal,toolUseID:'bash-tool'});
          text('Bash: '+result.behavior);
          active=false;push({type:'result',subtype:'success',duration_ms:1});
          continue;
        }
        if(body==='question'){
          const result=await options.canUseTool('AskUserQuestion',{questions:[{question:'Which direction?',header:'Direction',multiSelect:false,options:[{label:'Alpha',description:'First'},{label:'Beta',description:'Second'}]}],retained:'yes'},{signal:new AbortController().signal,toolUseID:'native-tool'});
          if(result.behavior!=='allow'||result.updatedInput.retained!=='yes'||result.updatedInput.answers['Which direction?']!=='Beta')throw Error('Wrong original SDK callback reply');
          text('Answer received: Beta');
          active=false;push({type:'result',subtype:'success',duration_ms:1});
        } else {
          text('Started: '+body);
          setTimeout(()=>{active=false;push({type:'result',subtype:'success',duration_ms:1});},body==='hold'?1800:30);
        }
      }})();
      while(!closed){if(events.length)yield events.shift();else await new Promise(r=>waiters.push(r));}
    }
  };
}
