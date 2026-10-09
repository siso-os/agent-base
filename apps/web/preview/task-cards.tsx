import { createRoot } from 'react-dom/client';
import { TasksPage as OwnerTasks } from '../src/components/OwnerTasksPanel';
import { TasksPage } from '../src/components/TasksPage';
import '../src/index.css';
import '../src/components/AgentPanel.css';
import { TasksCard } from '../src/components/panel/PanelTabs';
import type { Agent } from '../src/lib/agents';
// This review URL may read the board but can never write to the live node.
if (!(window as Window & { __TASK_CARDS_TEST__?: boolean }).__TASK_CARDS_TEST__) {
  const read = window.fetch.bind(window);
  window.fetch = (input, init) => (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET'
    ? Promise.resolve(new Response(JSON.stringify({ok:false,error:'Development review is read-only'}),{status:405,headers:{'content-type':'application/json'}}))
    : read(input, init);
}
const board = new URLSearchParams(location.search).has('board');
const overview = new URLSearchParams(location.search).has('overview');
createRoot(document.getElementById('root')!).render(<div style={{background:'#191916',minHeight:'100vh',color:'#eee',padding:'clamp(12px,3vw,40px)',boxSizing:'border-box'}}><header style={{maxWidth:1000,margin:'0 auto 22px',fontFamily:'system-ui'}}><small style={{color:'#a6a69c'}}>AGENT BASE · TASKS</small><h1 style={{fontSize:25,fontWeight:550,letterSpacing:'-.035em',margin:'8px 0'}}>The plan, one task at a time.</h1><p style={{color:'#a6a69c',fontSize:12}}>Development review · live reads are isolated from controls</p></header><section style={{maxWidth:board?1000:overview?360:460,margin:'auto',border:'1px solid #ffffff14',borderRadius:18,background:'#20201d',overflow:'hidden'}}>{overview?<TasksCard a={{name:"AGENT-BASE",zero:false} as Agent} agents={[]} everyone={false} onOpen={()=>{}}/>:board?<TasksPage onBack={()=>{}}/>:<OwnerTasks owner="AGENT-BASE"/>}</section></div>);
