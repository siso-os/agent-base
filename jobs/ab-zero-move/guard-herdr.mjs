#!/usr/bin/env node
// Permit only the disposable workspace and its recorded panes/tabs. Never touches the live A0/Agent Base.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const dir=path.dirname(import.meta.filename), file=path.join(dir,'guard.json');
const state=JSON.parse(readFileSync(file,'utf8')), a=process.argv.slice(2);
const protectedPanes=new Set(['w7:p37','w7:p3Z']);
const call=(args)=>{const r=spawnSync(state.herdr,args,{encoding:'utf8'});if(r.status!==0)throw Error(`herdr failed ${args.slice(0,2).join(' ')}: ${r.stderr}`);if(args[0]==='pane'&&args[1]==='read')return {screen:r.stdout};return r.stdout.trim()?JSON.parse(r.stdout):{};};
let result;
if(a[0]==='agent'&&a[1]==='list'){
  result=call(a);result.result.agents=result.result.agents.filter(x=>state.panes.includes(x.pane_id)&&!protectedPanes.has(x.pane_id));
}else if(a[0]==='pane'&&a[1]==='list'){
  result=call(a);result.result.panes=result.result.panes.filter(x=>state.panes.includes(x.pane_id));
}else if(a[0]==='pane'&&a[1]==='read'){
  if(!state.panes.includes(a[2])||protectedPanes.has(a[2]))throw Error('unowned pane');
  result=call(a);
}else if(a[0]==='tab'&&a[1]==='create'){
  if(a[a.indexOf('--workspace')+1]!==state.workspace||!a.includes('--no-focus'))throw Error('unowned workspace');
  result=call(a);state.panes.push(result.result.root_pane.pane_id);state.tabs.push(result.result.tab.tab_id);writeFileSync(file,JSON.stringify(state));
}else if(a[0]==='tab'&&a[1]==='close'){
  if(!state.tabs.includes(a[2]))throw Error('unowned tab');
  const seat=JSON.parse(readFileSync(path.join(dir,'seat.json'),'utf8'));
  const rows=call(['agent','list']).result.agents;
  const holder=rows.find(x=>x.pane_id===seat.pane&&(x.agent_session||{}).value===seat.session);
  if(!holder||!['idle','done'].includes(holder.agent_status))throw Error('new seat has not answered and idled');
  appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),event:'close-after-answer',tab:a[2],seat,agent_status:holder.agent_status})+'\n');
  result=call(a);
}else if((a[0]==='pane'&&a[1]==='run')||(a[0]==='agent'&&a[1]==='rename')){
  if(!state.panes.includes(a[2])||protectedPanes.has(a[2]))throw Error('unowned pane');
  appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),event:a[1],pane:a[2],...(a[1]==='rename'?{name:a[3]}:{SISO_A0:a[3].includes('SISO_A0=1')})})+'\n');result=call(a);
}else throw Error('guard denied '+a.slice(0,2).join(' '));
console.log(JSON.stringify(result));
