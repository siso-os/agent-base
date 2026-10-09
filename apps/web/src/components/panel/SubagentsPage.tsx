import { useEffect, useState } from "react";
import { usePersisted } from "@siso/shell";
import type { Agent } from "../../lib/agents";
import { clock, every, useSharedState } from "../../lib/poll";
import { duration, fmtTokens } from "../SubagentRow";
import { WORD, markOf } from "../Sidebar";
import { AgentFace, accentRgb, faceFor } from "../../lib/face";
import { AgentHoverCard } from "../AgentHoverCard";
import { MiniLanePage, type MiniLane } from "../MiniLanes";
import { SubFace, SubRow, subName, subTime, type SubRowData } from "./SubRow";
import "./panel.css";
import { OwnerBoard } from "../OwnerBoard";

type Machine = { load: number[]; cores: number };
type MiniList = { enabled: boolean; reachable: boolean; lanes: MiniLane[]; at: number };
const hm = (ms: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
const titleOf = (r: SubRowData) => r.title || r.what || r.type;

/** Shared nav card, placed over chat; optional facts stay explicitly unreported. */
function FleetHover({ r, a, now, machine, onOpen, children }: { r: SubRowData; a: Agent; now: number; machine: Machine | null; onOpen: () => void; children: React.ReactNode }) {
  const local = r.machine !== "mini";
  return <AgentHoverCard row side="left" agent={{ name: subName(r), kind: "worker", project: a.project ?? "Fleet", owner: local ? a.name : "Mini · all lanes", accent: `rgb(${accentRgb(a.project)})`, harness: r.kind === "claude" ? "claude" : "codex", model: [r.model, r.effort].filter(Boolean).join(" · "), machine: local ? "laptop" : "mini", state: r.running ? "working" : r.quiet ? "idle" : "done" }}
    details={<>
      <section className="ab-hover-section"><div className="ab-hover-label">Goal</div><p className="ab-fleet-hover__goal">{titleOf(r)}</p>{r.about && <p className="ab-fleet-hover__about">{r.about}</p>}</section>
      <section className="ab-hover-section"><div className="ab-hover-label">Why it exists</div><p className="ab-fleet-hover__about">{r.why || "Spawn reason not recorded."}</p>{r.tickets?.map(t => <p className="ab-fleet-hover__about" key={t.id}>for: {t.id} · {t.title}</p>)}</section>
      <dl className="ab-fleet-facts">
        <div><dt>Started</dt><dd>{r.start ? hm(Date.parse(r.start)) : "Unreported"}</dd></div>
        <div><dt>{r.running ? "Running for" : "Duration"}</dt><dd>{r.start ? duration(r.start, r.running ? null : r.end, now) : "Unreported"}</dd></div>
        <div><dt>Tokens in / out</dt><dd>{r.usage ? `${fmtTokens(r.usage.in)} / ${fmtTokens(r.usage.out)}` : r.tokens ? `${r.estimated ? "~" : ""}${fmtTokens(r.tokens)} total` : "Unreported"}</dd></div>
        <div><dt>CPU / RAM</dt><dd>{r.proc ? `${r.proc.cpu.toFixed(1)}% / ${r.proc.rssMb.toFixed(0)} MB` : "Unreported"}</dd></div>
        <div><dt>Machine load</dt><dd>{local && machine ? `${machine.load[0].toFixed(1)} · ${machine.cores} cores` : "Unreported"}</dd></div>
      </dl>
      {r.proc && <p className="ab-fleet-hover__about">Process sample {hm(r.proc.at)} · {Math.max(0, Math.floor((now-r.proc.at)/1000))}s ago</p>}
      {r.last && <section className="ab-hover-section"><div className="ab-hover-label">Last step</div><p className="ab-fleet-hover__about">{r.last}</p></section>}
    </>}
    extra={<div className="ab-hover-buttons"><button type="button" onClick={onOpen}>Open</button><button type="button" onClick={onOpen}>Log</button></div>}>
    {children}
  </AgentHoverCard>;
}

/** Fleet is the selected owner's work; Mini lanes are explicitly machine-wide. */
export function SubagentsPage({ a, agents, onOpen, onPeek }: { a: Agent; agents: Agent[]; onOpen: (r: SubRowData) => void; onPeek: (x: Agent) => void }) {
  const [snapshot, setSnapshot] = useState<{ owner: string; rows: SubRowData[]; machine: Machine | null } | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [more, setMore] = usePersisted(`panel.fleet.done.${a.id}`, false);
  const [miniName, setMiniName] = useState<string | null>(null);
  const { data: mini, error: miniError } = useSharedState<MiniList>("/api/mini/lanes", 30_000);
  useEffect(() => {
    let alive = true;
    setError(false); setMiniName(null);
    const load = () => fetch(`/api/agents/${encodeURIComponent(a.id)}/subagents`, { cache: "no-store" })
      .then(x => x.ok ? x.json() : Promise.reject(new Error(String(x.status))))
      .then(x => { if (alive) { setSnapshot({ owner: a.id, rows: x.rows ?? [], machine: x.machine ?? null }); setError(false); } })
      .catch(() => alive && setError(true));
    load(); const stop = every(load, 5000); const tick = clock(() => setNow(Date.now()));
    return () => { alive = false; stop(); tick(); };
  }, [a.id]);
  if (miniName) return <MiniLanePage name={miniName} onBack={() => setMiniName(null)} />;
  if (!snapshot || snapshot.owner !== a.id) return <div><OwnerBoard /><p className="ab-empty p-4">{error ? "Fleet could not be read. Retrying…" : "Reading Fleet…"}</p></div>;
  const { rows, machine } = snapshot;
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const mine = rows.filter(r => !r.agentId && (r.running || r.quiet || Date.parse(r.end ?? r.start ?? "") >= midnight.getTime()));
  const crew = rows.filter(r => r.agentId);
  const running = mine.filter(r => r.running).sort((x, y) => Date.parse(x.start ?? "") - Date.parse(y.start ?? ""));
  const quiet = mine.filter(r => r.quiet && !r.running);
  const done = mine.filter(r => !r.running && !r.quiet).sort((x, y) => Date.parse(y.end ?? "") - Date.parse(x.end ?? ""));
  const miniRunning: SubRowData[] = mini?.enabled && mini.reachable && !miniError ? mini.lanes.filter(l => l.running).map(l => ({ id: `mini:${l.name}`, miniName: l.name, name: l.name, machine: "mini", kind: "codex", type: "Mini lane", title: l.goal, what: l.goal, spec: "", model: l.model ?? undefined, start: null, end: null, tokens: 0, tools: null, running: true, background: true })) : [];
  const active = [...running, ...crew.filter(r => r.running), ...miniRunning];
  const tokens = mine.reduce((n, r) => n + r.tokens, 0);
  const first = Math.min(now-60_000, ...active.flatMap(r => r.start && Number.isFinite(Date.parse(r.start)) ? [Date.parse(r.start)] : []));
  const dayEnd = new Date(midnight); dayEnd.setDate(dayEnd.getDate()+1);
  const open = (r: SubRowData) => { if (r.miniName) setMiniName(r.miniName); else if (r.agentId) { const c = agents.find(c => c.id === r.agentId); if (c) onPeek(c); } else onOpen(r); };
  const row = (r: SubRowData) => <FleetHover key={r.id} r={r} a={a} now={now} machine={machine} onOpen={() => open(r)}><SubRow r={r} now={now} project={a.project} onOpen={open} detail /></FleetHover>;
  const miniStatus = miniError ? "mini read unavailable" : !mini ? "reading mini…" : !mini.enabled ? "mini not enabled" : !mini.reachable ? "mini unreachable" : `mini ${mini.lanes.filter(l=>l.running).length}/${mini.lanes.length} busy`;
  return <div className="ab-sap ab-fleet" data-testid="subagents-page">
    <OwnerBoard />
    {error && <p className="ab-empty" role="status">Fleet read unavailable · showing the last snapshot.</p>}
    <section className="ab-fold is-card ab-fleet-now" data-testid="fleet-now" aria-label="Running now, elapsed time">
      <h4>Now <span>elapsed · {active.length} running</span></h4>
      {active.slice(0,6).map(r => <FleetHover key={r.id} r={r} a={a} now={now} machine={machine} onOpen={() => open(r)}>
        <button type="button" className="ab-fleet-lane" onClick={() => open(r)}>
          <SubFace r={r} project={a.project} size={20} />
          <span className="ab-fleet-lane__job"><b>{subName(r)}</b><small>{titleOf(r)}</small></span>
          <em className="ab-fleet-machine">{r.machine ?? "laptop"}</em><time>{r.start ? subTime(r,now) : "running"}</time>
          {r.start && <span className="ab-fleet-lane__bar" aria-hidden><i style={{width:`${Math.max(2,Math.min(100,(now-Date.parse(r.start))/(now-first)*100))}%`}} /></span>}
        </button>
      </FleetHover>)}
      {!active.length && <p className="ab-empty">Nothing running in this fleet.</p>}
      {active.length>6 && <button type="button" className="ab-more" onClick={()=>document.getElementById("fleet-running")?.scrollIntoView({block:"start"})}>+{active.length-6} running below</button>}
      <div className="ab-fleet-day" aria-label={`${done.length} finished runs today, 24 hour axis`}>
        <div className="ab-fleet-day__track">{done.map(r => <button type="button" key={r.id} title={`${subName(r)} · finished ${hm(Date.parse(r.end ?? r.start!))}`} style={{left:`${Math.max(0,Math.min(99,(Date.parse(r.end ?? r.start!)-midnight.getTime())/(dayEnd.getTime()-midnight.getTime())*100))}%`}} onClick={()=>open(r)} />)}</div>
        <div><span>Today · 00</span><span>12</span><span>24</span></div>
      </div>
    </section>
    <div className="ab-kpis" id="fleet-running">
      <p><b>{active.length}</b><span>running</span></p>
      <p><b>{mine.length}</b><span>local today</span></p>
      <p><b>{mine.some(r=>r.estimated)?"~":""}{fmtTokens(tokens)}</b><span>tokens today</span></p>
      <p className="ab-fleet-kpi-machine"><b>{machine ? `${machine.load[0].toFixed(1)} load` : "—"}</b><span>machines</span><small>laptop · {machine?.cores ?? "?"} cores</small><small>{miniStatus}</small></p>
    </div>
    {running.length>0 && <section className="ab-sap__group"><h4>Running now · {running.length}</h4>{running.map(row)}</section>}
    {miniRunning.length>0 && <section className="ab-sap__group"><h4>Mini · all lanes</h4>{miniRunning.map(row)}</section>}
    {quiet.length>0 && <section className="ab-sap__group"><h4>Quiet · {quiet.length}</h4>{quiet.map(row)}</section>}
    {done.length>0 && <section className="ab-sap__group ab-fleet-done">
      <button type="button" className="ab-fleet-done__fold" data-testid="fleet-done" aria-expanded={more} onClick={()=>setMore(!more)}>
        <span>{done.length} done today {more?"⌄":"▸"}</span><span className="ab-fleet-done__faces" aria-hidden>{done.slice(0,5).map(r=><SubFace key={r.id} r={r} project={a.project} size={18} />)}</span>
      </button>{more && done.map(row)}
    </section>}
    {crew.length>0 && <section className="ab-sap__group"><h4>Crew in their own tabs · {crew.length}</h4>{crew.map(r=>{
      const c=agents.find(x=>x.id===r.agentId);
      return <FleetHover key={r.id} r={r} a={a} now={now} machine={machine} onOpen={()=>open(r)}><button type="button" className="ab-sa" data-testid="crew-row" onClick={()=>c&&onPeek(c)}>
        <span className="ab-sa__face">{c&&<AgentFace {...faceFor(c)} size={22} />}</span><span className="ab-sa__l1"><b className="is-name">{c?.name??subName(r)}</b><em className="ab-chip is-herdr">herdr</em><time className="ab-sa__time">{c?WORD[markOf(c)].toLowerCase():r.running?"working":"idle"}</time></span><span className="ab-sa__l2"><small>{r.what}</small></span>
      </button></FleetHover>;
    })}</section>}
  </div>;
}
