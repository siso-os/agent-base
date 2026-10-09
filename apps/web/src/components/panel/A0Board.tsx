import { useState } from "react";
import type { A0Now } from "../../../../../services/node/src/a0-now";
import type { Agent } from "../../lib/agents";
import { useSharedState } from "../../lib/poll";
import { TasksPage } from "../OwnerTasksPanel";

/** Read-only board contract. Each file source reports its own failure; absence is not an empty board. */
export type BoardItem = { id: string; text: string; why?: string; at?: string; updated?: string; revision?: number; source?: string; status?: string; by?: string; score?: number; integrated?: boolean };
export type BoardSource = { items: BoardItem[]; retired?: BoardItem[]; error: string | null; state?: 'fresh' | 'stale' | 'unavailable'; observedAt?: number | null };
export type BoardData = { ideas: BoardSource; notes: BoardSource };
type Lane = "out" | "todo" | "ideas" | "notes";
const lanes: { id: Lane; label: string }[] = [{id:"out",label:"Out"},{id:"todo",label:"To-do"},{id:"ideas",label:"Ideas"},{id:"notes",label:"Notes"}];
export function SourceCards({ source, kind, error, loading }: { source?: BoardSource; kind: "Ideas" | "Notes"; error: string | null; loading: boolean }) {
  const valid = source && Array.isArray(source.items) && source.items.every(i => typeof i.id === "string" && typeof i.text === "string");
  const items = valid ? source.items.filter(i => !["retired", "rejected"].includes(i.status ?? "")).sort((a,b) => kind === "Ideas" ? Number(b.by === "Shaan") - Number(a.by === "Shaan") || (b.score ?? 0) - (a.score ?? 0) : (b.updated ?? b.at ?? "").localeCompare(a.updated ?? a.at ?? "")) : [];
  const retired = kind === "Notes" && Array.isArray(source?.retired) ? source.retired.filter(i => i && typeof i.id === "string" && typeof i.text === "string" && i.status === "retired") : [];
  const unavailable = error || source?.error || (!loading && !valid);
  const cards = (rows: BoardItem[]) => rows.map(item => <details key={item.id} className="ab-board__item"><summary title="Open details and raw JSON"><span>{item.text}<i aria-hidden="true">{"{ }"}</i></span><small>{[item.by, item.status, item.revision ? `Revision ${item.revision}` : null, item.integrated === true ? "Integrated" : null].filter(Boolean).join(" · ")}</small></summary><div>{item.why && <p>{item.why}</p>}<pre aria-label={`${kind} record JSON`}>{JSON.stringify(item,null,2)}</pre></div></details>);
  return <>
    {unavailable && <p className="ab-empty" role="status">{kind} unavailable.{items.length || retired.length ? " Showing the last successful read." : " Ask Agent Zero to check this board source."}</p>}
    {loading && !source && <p className="ab-empty" role="status">Reading {kind.toLowerCase()}…</p>}
    {!unavailable && valid && !items.length && <p className="ab-empty">No open {kind.toLowerCase()}.</p>}
    {cards(items)}
    {!!retired.length && <details className="ab-board__item" data-testid="retired-notes"><summary><span>Retired notes · {retired.length}</span></summary><div><p className="ab-board__hint">Tell Agent Zero to restore a note if you need it again.</p>{cards(retired)}</div></details>}
  </>;
}
export function A0Board({ a, agents, onBoard }: { a: Agent; agents: Agent[]; onBoard?: () => void }) {
  const [lane,setLane] = useState<Lane>("out");
  const runs = useSharedState<A0Now>(lane === "out" ? "/api/a0/now" : null, 10_000);
  const board = useSharedState<BoardData>(lane === "ideas" || lane === "notes" ? "/api/a0/board" : null, 10_000);
  const records = [...(runs.data?.lanes?.data?.runs ?? [])].sort((a,b)=>b.at.localeCompare(a.at));
  return <section className="ab-board" data-testid="a0-board" aria-label="Agent Zero's board">
    <div className="ab-board__lanes" aria-label="Board lanes">{lanes.map(x => <button type="button" aria-pressed={lane===x.id} key={x.id} onClick={()=>setLane(x.id)}>{x.label}</button>)}</div>
    <p className="ab-board__hint">Tell Agent Zero what to add, change or retire.</p>
    <div className="ab-board__body">
      {lane === "out" && <>
        {(runs.error || runs.data?.lanes?.error) && <p className="ab-empty" role="status">Run records unavailable.{records.length ? " Showing the last successful read." : ""}</p>}
        {!runs.data && !runs.error && <p className="ab-empty" role="status">Reading dispatched runs…</p>}
        {runs.data?.lanes?.data && !records.length && <p className="ab-empty">No dispatched runs in the current records.</p>}
        {records.map((run,index)=><details className="ab-board__item" key={`${run.at}-${run.dir}-${index}`}><summary title="Open details and raw JSON"><span>{run.task || "Dispatched run"}<i aria-hidden="true">{"{ }"}</i></span><small>{run.status || "Status not reported"} · {run.min} min recorded{run.model ? ` · ${run.model}` : ""}</small></summary><div><p>Started {new Date(run.at).toLocaleString()}. Expected return time is not reported.</p><pre aria-label="Run record JSON">{JSON.stringify(run,null,2)}</pre></div></details>)}
      </>}
      {lane === "todo" && <TasksPage owner={a.name} everyone={false} agents={agents} onBoard={onBoard} />}
      {lane === "ideas" && <SourceCards source={board.data?.ideas} kind="Ideas" error={board.error} loading={!board.data && !board.error} />}
      {lane === "notes" && <SourceCards source={board.data?.notes} kind="Notes" error={board.error} loading={!board.data && !board.error} />}
    </div>
  </section>;
}
