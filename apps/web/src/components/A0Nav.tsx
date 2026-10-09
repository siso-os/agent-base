import type { ResearchFleet } from "../../../../services/node/src/research";
import type { A0Now, NowLanes } from "../../../../services/node/src/a0-now";
import { useSharedState } from "../lib/poll";
import "./A0Nav.css";

export const fleetRunning = (f: ResearchFleet) => !f.finished && (f.jobs.some((j) => ['queued', 'running'].includes(j.status)) || !!f.then && ['waiting', 'running'].includes(f.then.status));
export type NowLane =
  | { id: string; kind: "pair"; data: NowLanes["pairs"][number] }
  | { id: string; kind: "tab"; data: NowLanes["tabs"][number] }
  | { id: string; kind: "run"; data: NowLanes["runs"][number] };
export function nowLanes(data: NowLanes | null | undefined): NowLane[] {
  if (!data) return [];
  return [
    ...data.pairs.map((p): NowLane => ({ id: `pair:${p.pair}`, kind: "pair", data: p })),
    ...data.tabs.map((t): NowLane => ({ id: `tab:${t.pane}`, kind: "tab", data: t })),
    ...[...data.runs].reverse().map((r, i): NowLane => ({ id: `run:${r.at}:${r.dir}:${i}`, kind: "run", data: r })),
  ];
}
export function ModelChip({ model }: { model?: string | null }) {
  if (!model) return null;
  const label = /luna/i.test(model) ? "Luna" : /sol/i.test(model) ? "Sol" : /astra/i.test(model) ? "Astra" : model;
  return <span className={`a0-model ${/luna/i.test(model) ? "is-luna" : "is-sol"}`} title={model}>{label}</span>;
}
export const laneName = (lane: NowLane) => lane.kind === "pair" ? `${lane.data.pair} pair` : lane.kind === "tab" ? lane.data.tab : lane.data.task || lane.data.dir;
export function A0Nav({ selected, onSelect, onNeeds }: { selected?: string | null; onSelect?: (id: string) => void; onNeeds?: () => void }) {
  const { data, error } = useSharedState<A0Now>("/api/a0/now", 10_000);
  const lanes = nowLanes(data?.lanes.data);
  const chosen = selected ?? lanes[0]?.id;
  return <div className="a0-nav" data-testid="a0-nav">
    {error && <p role="status">Now unavailable; retrying.</p>}
    {!data && !error && <p role="status">Reading Now…</p>}
    {!!data?.needs.data?.items.length && <section aria-label="Needs you">
      <h4>Needs you <span>{data.needs.data.total}</span></h4>
      {data.needs.data.items.slice(0, 3).map((need) => <button type="button" key={need.id} className="a0-need" onClick={onNeeds}><span>{need.title}</span>{need.note && <small>{need.note}</small>}</button>)}
    </section>}
    {data?.needs.error && <p className="a0-source-error">Needs you unavailable</p>}
    <section aria-label="In flight">
      <h4>In flight <span>Codex · {lanes.length}</span></h4>
      {data?.lanes.error && <p className="a0-source-error">Lanes unavailable</p>}
      {data?.lanes.data && !lanes.length && <p>No lanes reported.</p>}
      {lanes.map((lane) => <A0LaneRow key={lane.id} lane={lane} selected={chosen === lane.id} onSelect={onSelect} />)}
    </section>
    <section aria-label="Shipping"><h4>Shipping <span>Agent Base</span></h4>
      {data?.ship.error ? <p className="a0-source-error">Shipping unavailable</p> : <>
        <div className="a0-ship"><span>live</span><b>{data?.ship.data?.liveSha?.slice(0, 7) ?? "Not reported"}</b></div>
        {data?.ship.data?.queued.map((row) => <div className="a0-ship" key={row.id}><span>{row.state}</span><b>{row.why || row.branch || row.id}</b></div>)}
      </>}
    </section>
    <details className="a0-done"><summary>Done today <span>{data?.today.data?.length ?? 0} ›</span></summary>
      {data?.today.error && <p className="a0-source-error">Today unavailable</p>}
      {data?.today.data?.map((event) => <p key={event.id}>{event.text}</p>)}
    </details>
  </div>;
}

export function A0LaneRow({ lane, selected, onSelect }: { lane: NowLane; selected?: boolean; onSelect?: (id: string) => void }) {
  const d = lane.data;
  const state = lane.kind === "pair" ? (lane.data.blocked.length ? "blocked" : lane.data.open ? "working" : "done") : lane.data.status ?? "idle";
  const summary = lane.kind === "pair" ? `${lane.data.done} of ${lane.data.done + lane.data.open + lane.data.blocked.length} done${lane.data.next ? ` · next: ${lane.data.next}` : ""}` : lane.kind === "tab" ? lane.data.said.at(-1) || state : `${state} · ${lane.data.min} minutes`;
  const time = lane.kind === "tab" ? lane.data.worked.replace(/^Worked for /, "") : lane.kind === "run" ? lane.data.at : "now";
  return <button type="button" className={`a0-lane${selected ? " is-selected" : ""}`} data-testid="a0-lane" aria-pressed={selected} onClick={() => onSelect?.(lane.id)} title={summary}>
    <i className={`a0-dot is-${state}`} aria-label={state} />
    <span className="a0-lane__body"><span className="a0-lane__name">{laneName(lane)} <ModelChip model={d.model} /></span><span className="a0-lane__summary">{summary}</span></span>
    <small>{time}</small>
  </button>;
}
