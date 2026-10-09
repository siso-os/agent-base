import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, SquarePenIcon } from "lucide-react";
import type { HubAgent, HubZero } from "../lib/hub-types";
import { AgentFace, projectHue, type AgentStatus } from "../../../../packages/halo-face";
import "./ZeroTabs.css";

const FIXED_HUES: Record<string, number> = { halo: 325, "fahmy's agency": 215, "fahmy's": 215, "agent zero": 75, "agent base": 190, efficiency: 268, health: 145, "laptop health": 145 };
const faceStatus = (status: HubAgent["state"] | HubZero["state"]): AgentStatus => status === "working" ? "working" : status === "off" ? "offline" : "waiting";

export function ZeroTabs({ zeros, current, onOpen, onRename, onSpawn, onOpenManager }: {
  zeros: HubZero[]; current: string; onOpen: (agent: HubAgent) => void; onRename: (id: string, label: string) => void; onSpawn: () => void; onOpenManager?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = zeros.find((zero) => zero.id === open) ?? zeros.find((zero) => zero.id === current);
  const faceHues = useMemo(() => {
    const projects = [...new Set(["Agent Zero", ...(active?.controls.map(({ owner }) => owner.project) ?? [])])];
    const used = new Set<number>();
    return Object.fromEntries(projects.map((project) => {
      let hue = FIXED_HUES[project.toLowerCase()] ?? projectHue(project);
      while (used.has(hue)) hue = (hue + 19) % 360;
      used.add(hue);
      return [project, hue];
    }));
  }, [active]);
  const hueFor = (project: string) => faceHues[project] ?? FIXED_HUES[project.toLowerCase()] ?? projectHue(project);
  const groups = useMemo(() => {
    const result = new Map<string, HubZero["controls"]>();
    for (const control of active?.controls ?? []) {
      const group = /halo|fahmy/i.test(`${control.owner.project} ${control.owner.name}`) ? "SISO Agency" : "SISO Labs";
      result.set(group, [...(result.get(group) ?? []), control]);
    }
    return [...result.entries()];
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(null); setExpanded(null); } };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { setOpen(null); setExpanded(null); } };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const count = zeros.length + 1;
    const next = (index + direction + count) % count;
    tabRefs.current[next]?.focus();
    if (next < zeros.length) setOpen(zeros[next].id); else setOpen(null);
  };
  const beginRename = (zero: HubZero) => { setEditing(zero.id); setDraft(zero.label); };
  const finishRename = (id: string) => { if (draft.trim()) onRename(id, draft.trim()); setEditing(null); };
  const openOwner = (owner: HubAgent) => { setOpen(null); onOpen(owner); };
  const openWorker = (worker: HubZero["controls"][number]["subAgents"][number], owner: HubAgent) => openOwner({ ...owner, name: worker.name, kind: "worker", role: worker.title || undefined, harness: worker.harness.toLowerCase() as HubAgent["harness"], state: worker.state, spunUp: worker.state !== "off" });
  const menuKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const owner = (event.target as HTMLElement).closest<HTMLElement>("[data-owner]")?.dataset.owner;
      if (owner) { event.preventDefault(); setExpanded(event.key === "ArrowRight" ? owner : expanded === owner ? null : expanded); }
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return <div className="zero-tabs" ref={root} aria-label="Agent Zero tabs">
    {zeros.map((zero, index) => <div className="zero-tab-wrap" key={zero.id}>
      <button ref={(node) => { tabRefs.current[index] = node; }} className={`zero-tab ${zero.state === "off" ? "is-off" : ""} ${zero.id === current ? "is-current" : ""}`} type="button" onClick={() => { setOpen(open === zero.id ? null : zero.id); setExpanded(null); }} onKeyDown={(event) => moveTab(event, index)} aria-expanded={open === zero.id}>
        <AgentFace name={zero.label} project="Agent Zero" hue={FIXED_HUES["agent zero"]} status={faceStatus(zero.state)} size={18}/>
        {editing === zero.id ? <input autoFocus value={draft} aria-label="Agent Zero label" onChange={(event) => setDraft(event.target.value)} onBlur={() => finishRename(zero.id)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") finishRename(zero.id); if (event.key === "Escape") setEditing(null); }} /> : <span>{zero.label}</span>}
        {zero.label !== "Agent Zero" && <span className="zero-tab-id">· {zero.id}</span>}
        <i className={`zero-state state-${zero.state}`} title={zero.state}/><span className="zero-harness">{zero.harness === "siso" ? "SDK" : "CLI"}</span><ChevronDownIcon size={13}/>
      </button>
      {open === zero.id && active?.id === zero.id && <section className="zero-menu" aria-label={`${zero.label} controls`} onKeyDown={menuKey}>
        <header className="zero-menu-head"><AgentFace className="zero-face" name={zero.label} project="Agent Zero" hue={FIXED_HUES["agent zero"]} status={faceStatus(zero.state)} size={40}/><div className="zero-head-copy"><strong>{zero.label}</strong><span>{zero.harness === "siso" ? "SDK" : "CLI"} · {zero.model} · {zero.cwd.split("/").filter(Boolean).slice(-2).join("/") || "Agent Zero"}</span></div><button type="button" title="Rename" onClick={() => beginRename(zero)}><SquarePenIcon size={14}/></button></header>
        <div className="zero-menu-summary">Controls {zero.controls.length} owners · {zero.controls.reduce((n, c) => n + c.subAgents.filter((a) => a.state === "working").length, 0)} sub-agents working</div>
        <div className="zero-menu-scroll">{groups.map(([group, controls]) => <div className="zero-group" key={group}><div className="zero-group-title">{group}</div>{controls.map(({ owner, activity, subAgents }) => {
          const workingCount = subAgents.filter((agent) => agent.state === "working").length;
          const doingNow = owner.holding ? `${owner.holding.id} · ${owner.holding.title}` : owner.lastReport?.text ?? activity ?? "No current task reported";
          return <div className="zero-owner" key={owner.name} data-owner={owner.name}>
          <div className={`zero-owner-row ${owner.state === "working" ? "is-working" : ""}`} style={{ "--owner-hue": `${hueFor(owner.project)} 75% 55%` } as CSSProperties}><button type="button" className="zero-expand" aria-label={`${expanded === owner.name ? "Collapse" : "Expand"} ${owner.name}`} onClick={() => setExpanded(expanded === owner.name ? null : owner.name)}><ChevronRightIcon size={13} className={expanded === owner.name ? "is-expanded" : ""}/></button><AgentFace className="zero-owner-face" name={owner.name} project={owner.project} hue={hueFor(owner.project)} status={faceStatus(owner.state)} size={30}/><button type="button" className="zero-owner-open" onClick={() => openOwner(owner)}><span className="zero-owner-main"><strong className="zero-owner-role">{owner.role ?? owner.project}</strong><strong className="zero-owner-name">{owner.name}</strong></span><small title={doingNow}>{owner.holding ? <><span className="zero-owner-plan">{owner.holding.id}</span><span className="zero-owner-plan-title">{owner.holding.title}</span></> : doingNow}</small></button><span className="zero-owner-count"><span>› {subAgents.length}</span>{workingCount > 0 && <span className="zero-owner-working"> · {workingCount} working</span>}</span><span className={`zero-owner-status state-${owner.state}`}>{owner.state === "off" ? "Offline" : owner.state === "done" ? "Turn done" : owner.state === "idle" ? "Idle" : "Working"}</span></div>
          {expanded === owner.name && <div className="zero-workers">{[...subAgents].sort((a, b) => ({ working: 0, idle: 1, done: 2, off: 3 }[a.state] - { working: 0, idle: 1, done: 2, off: 3 }[b.state])).slice(0, 7).map((worker) => <button className="zero-worker" type="button" key={worker.name} onClick={() => openWorker(worker, owner)}><AgentFace name={worker.name} project={owner.project} hue={hueFor(owner.project)} status={faceStatus(worker.state)} size={20}/><span><b>{worker.name}</b><small>{worker.title || worker.state}</small></span><em>{worker.harness.toUpperCase()} · {worker.state}</em></button>)}{subAgents.length > 7 && <button className="zero-more" type="button" onClick={() => openOwner(owner)}>+{subAgents.length - 7} more · open {owner.name}'s page</button>}</div>}
        </div>})}</div>)}</div>
        <footer><button type="button" onClick={() => { setOpen(null); }}><span className="zero-state state-working"/>Org chart</button></footer>
      </section>}
    </div>)}
    {zeros.length > 0 && <button className={`zero-tab zero-manager-tab ${current === "A0-DESK" ? "is-current" : ""}`} type="button" onClick={() => onOpenManager?.()} aria-label="Manager">
      <AgentFace name="A0-DESK" project="Agent Zero" hue={FIXED_HUES["agent zero"]} status="waiting" size={18}/><span>Manager</span>
    </button>}
    <button ref={(node) => { tabRefs.current[zeros.length] = node; }} className="zero-spawn" type="button" onClick={onSpawn} onKeyDown={(event) => moveTab(event, zeros.length)}><PlusIcon size={14}/> Agent Zero</button>
  </div>;
}
