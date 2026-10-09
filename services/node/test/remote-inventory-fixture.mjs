import { parseRemoteAgents, parseRemoteCoverage } from '../src/remote-inventory.ts';
// Mirrors the seven-source live collector shape and counts with synthetic identities only.
// No live rows, names, PIDs, task IDs, command lines or messages are read here.
export function remoteInventoryFixture(scenario='live-shape',now=Date.now()) {
 const vps={machineKey:'vps-siso',alias:'siso-vps',user:'siso'};
 const mini={machineKey:'mini',alias:'mac-mini-herdr'};
 const herdr=(target,session,rows)=>{const t={...target,session};return {machineKey:t.machineKey,session,machineUser:t.user,source:'herdr',state:'fresh',observedAt:now,attemptedAt:now,agents:parseRemoteAgents({agents:rows},t,now)};};
 const coverage=(target,kind,rows,diagnostics={})=>{const t={...target,session:kind==='managed-hosts'?'ab-managed-hosts':'codex-processes',source:kind};return {machineKey:t.machineKey,machineUser:t.user,session:t.session,source:kind,state:'fresh',observedAt:now,attemptedAt:now,diagnostics,agents:parseRemoteCoverage({schema:1,source:kind,rows},t,now)};};
 const h=(id,name,state='idle',parent)=>({terminal_id:id,name,agent:'codex',agent_status:state,...(parent?{parent_terminal_id:parent}:{})});
 const receipt=(session,extra={})=>({session,parentSession:null,harness:'codex',reportedState:'working',fresh:true,processState:'observed',runtimeId:'200:1791248000000',reconciles:[],...extra});
 const sources=[
  herdr(vps,'agent-home',[h('fixture-done','Synthetic completed record','done')]),
  herdr(vps,'halo',Array.from({length:6},(_,i)=>h('fixture-idle-'+i,'Synthetic idle record '+(i+1)))),
  herdr(mini,'jarvis',[]),
  coverage(vps,'managed-hosts',[],{directoryAbsent:1,scannedReceipts:0,rejectedReceipts:0}),
  coverage(vps,'codex-processes',[],{eligibleProcesses:0}),
  coverage(mini,'managed-hosts',[],{directoryAbsent:1,scannedReceipts:0,rejectedReceipts:0}),
  coverage(mini,'codex-processes',[{runtimeId:'900001:1791248400000',parentRuntimeId:null}],{eligibleProcesses:1}),
 ];
 if(['contracts','cycle'].includes(scenario)) {
  sources[0]=herdr(vps,'agent-home',[h('fixture-owner','Synthetic owner','working'),h('fixture-child','Synthetic explicit child','working','fixture-owner'),h('fixture-unresolved','Synthetic unresolved parent','unknown','missing')]);
  sources[1]={...herdr(vps,'halo',[h('fixture-stale','Synthetic last-known record','working')]),state:'stale',observedAt:Math.max(0,now-90000)};
  sources[3]=coverage(vps,'managed-hosts',[receipt('synthetic-parent'),receipt('synthetic-child',{parentSession:'synthetic-parent',runtimeId:'201:1791248000000'}),receipt('synthetic-expired',{runtimeId:null,processState:'not-observed',fresh:false})],{scannedReceipts:4,rejectedReceipts:1});
  sources[4]={...coverage(vps,'codex-processes',[]),state:'unavailable',observedAt:null};
  sources[6]=coverage(mini,'codex-processes',[{runtimeId:'900001:1791248400000',parentRuntimeId:null},{runtimeId:'900002:1791248401000',parentRuntimeId:'900001:1791248400000'}],{eligibleProcesses:2});
 }
 if(scenario==='cycle')sources[0]=herdr(vps,'agent-home',[h('cycle-a','Cycle A','working','cycle-b'),h('cycle-b','Cycle B','working','cycle-a')]);
 if(scenario==='empty')for(const source of sources)source.agents=[];
 if(scenario==='malformed')return {enabled:true,sources:'bad'};
 return {enabled:scenario!=='disabled',configured:scenario!=='invalid',readOnly:true,coverage:'configured-herdr-and-allowlisted-host-processes',coverageComplete:false,at:now,sources:['disabled','invalid','unconfigured'].includes(scenario)?[]:sources};
}
