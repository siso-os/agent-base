import { useEffect, useRef, useState } from 'react';
import { useSharedState } from '../lib/poll';
import { FlightLedger } from '../lib/delight';
import { CodexTransitions } from '../lib/codex-transitions';
import { FanOutRow } from './FanOut';
import { openSubagent, type SubagentsResult, type SubagentRowData } from './SubagentRow';
import type { Call, Task } from '../lib/chat';

/** CLI runs have no Agent tool event. Observe the existing parent-scoped read model; managed children stay on the socket path. */
export function CodexWorkerFlights({agentId,session,active}: {agentId:string;session:string;active:boolean}) {
  const {data,error} = useSharedState<SubagentsResult & {session?:string|null}>(active ? `/api/agents/${encodeURIComponent(agentId)}/subagents` : null, 5000);
  const transitions = useRef(new CodexTransitions()), ledger = useRef(new FlightLedger());
  const [rows,setRows] = useState<SubagentRowData[]>([]);
  useEffect(() => {
    if (!active || error || data?.session !== session) { transitions.current.reset(); ledger.current.reset(); setRows([]); return; }
    if (!data) return;
    const next = data.rows.filter(r => r.kind === 'codex' && !r.toolUseId && Number.isFinite(Date.parse(r.start ?? '')));
    transitions.current.observe(next, ledger.current);
    setRows(next);
  }, [data,error,active,session]);
  const shown = rows.filter(r => r.running || ['done','failed','blocked','stopped','killed','error'].includes(r.status ?? '')).slice(0,8);
  if (active && (error || data && data.session !== session)) return <p className="ab-delivery__quiet" role="status">Codex worker lifecycle unavailable for this session.</p>;
  if (!shown.length) return rows.length ? <p className="ab-delivery__quiet" role="status">Codex worker outcome unavailable.</p> : null;
  const task = (r:SubagentRowData):Task => ({id:r.id,tool:r.id,kind:'codex',description:r.name ?? r.id,model:r.model,background:true,status:r.running ? 'running' : r.status === 'done' ? 'done' : 'blocked',startedAt:Date.parse(r.start!),endedAt:r.end ? Date.parse(r.end) : null,tokens:r.tokens,tools:r.tools,last:r.what,summary:r.spec});
  const calls:Call[] = shown.map(r => ({id:`${r.id}:${r.start}`,name:r.name ?? 'Codex',summary:r.about || r.spec || r.what || r.name || 'Codex worker',at:Date.parse(r.start!)}));
  return <section aria-label="Codex workers" data-testid="codex-worker-flights">{shown.map((r,i) => <FanOutRow key={calls[i].id} call={calls[i]} task={task(r)} steps={0} now={Date.now()} lifecycle={ledger.current} onOpen={() => openSubagent(r,[],()=>{})} group={{first:i===0,last:i===shown.length-1,calls}} taskOf={id => {const index=calls.findIndex(c=>c.id===id);return index>=0 ? task(shown[index]) : undefined;}} />)}</section>;
}
