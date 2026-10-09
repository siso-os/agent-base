import { useEffect, useRef, useState } from "react";
import { NotebookPenIcon, XIcon, FlaskConicalIcon, CodeIcon, RocketIcon } from "lucide-react";
import type { A0Now } from "../../../../services/node/src/a0-now";
import type { Research } from "../../../../services/node/src/research";
import type { A0TaskIndex } from "../../../../services/node/src/a0-tasks";
import { refresh, useSharedState } from "../lib/poll";
import { A0LaneRow, fleetRunning, ModelChip, nowLanes } from "./A0Nav";
import "./ResearchPage.css";

/** The same header chip and outside-click/Escape tray as Today. Reads only while A0's header is visible. */
/** `hide`: chips the header leaves out (Shaan 4 Oct ~15:50: Codex and Research "supposed to be shown by the sub agent selector"). */
export function A0FleetChips({ onResearch, onLane, onCodexWork, hide = [] }: { onResearch: () => void; onLane: (id: string) => void; onCodexWork?: () => void; hide?: string[] }) {
  const now = useSharedState<A0Now>("/api/a0/now", 10_000);
  const research = useSharedState<Research>("/api/research", 10_000);
  const [open, setOpen] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const box = useRef<HTMLDivElement>(null);
  const lanes = nowLanes(now.data?.lanes.data).filter((lane) => lane.kind === "pair" ? lane.data.open > 0 || lane.data.blocked.length > 0 : !["done", "failed", "idle", "offline"].includes(lane.data.status ?? "idle"));
  const fleets = research.data?.fleets.data?.filter(fleetRunning) ?? [];
  const topics = research.data?.topics.data ?? [];
  const queued = now.data?.ship.data?.queued ?? [];
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const close = () => setOpen(null);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); window.removeEventListener("resize", close); };
  }, [open]);
  const chips = [
    { id: "codex", label: `Codex · ${lanes.length} working`, icon: CodeIcon, count: 1 }, // always shown: it is the way to Codex work (the side-nav row is gone, Shaan 3 Oct)
    { id: "research", label: `Research · ${fleets.length || topics.length}`, icon: FlaskConicalIcon, count: 1 },
    { id: "shipping", label: "Shipping", icon: RocketIcon, count: queued.length },
  ];
  return <div className="a0-header-chips" ref={box} aria-label="Agent Zero fleet controls">
    {chips.filter((chip) => chip.count > 0 && !hide.includes(chip.id)).map(({ id, label, icon: Icon }) => <div className="ab-pchip ab-pad" key={id}>
      <button type="button" className="ab-pchip__btn" data-testid={`${id}-chip`} aria-expanded={open === id} onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPosition({ top: rect.bottom + 6, left: Math.max(10, Math.min(rect.right - 360, window.innerWidth - Math.min(360, window.innerWidth - 20) - 10)) });
        setOpen(open === id ? null : id);
      }}><span className="ab-pchip__mark"><Icon aria-hidden="true" /></span><span className="ab-pchip__n">{label}</span></button>
      {open === id && <div className="ab-pchip__tray ab-pad__tray a0-header-tray" style={position} data-testid={`${id}-tray`}>
        <div className="ab-pad__head"><b>{id === "codex" ? "In flight" : id === "research" ? "Research" : "Shipping"}</b></div>
        <div className="ab-pad__list a0-nav">
          {id === "codex" && <>{(now.error || now.data?.lanes.error) && <p role="status">Lanes unavailable; retrying.</p>}{lanes.map((lane) => <A0LaneRow key={lane.id} lane={lane} onSelect={(selected) => { onLane(selected); setOpen(null); }} />)}{onCodexWork && <button type="button" className="a0-lane" data-testid="codex-work-open" onClick={() => { setOpen(null); onCodexWork(); }}>Open Codex work ›</button>}</>}
          {id === "research" && <>
            {(research.error || research.data?.fleets.error) && <p role="status">Fleets unavailable; retrying.</p>}
            {!research.data && !research.error && <p>Reading research…</p>}
            {fleets.map((fleet) => <div className="a0-research-summary" key={fleet.name}><b>{fleet.name}</b> <ModelChip model={fleet.model} /><div className="ab-research__jobs">{fleet.jobs.map((job) => <i key={job.id} className={`ab-research__dot is-${job.status}`} aria-label={`${job.id}: ${job.status}`} title={`${job.id}: ${job.status}`} />)}</div></div>)}
            {research.data?.topics.error && <p role="status">Topics unavailable; retrying.</p>}
            {topics.map((topic) => <p key={topic.id}>{topic.title}</p>)}
            {research.data && !fleets.length && !topics.length && !research.data.fleets.error && !research.data.topics.error && <p>No research findings yet.</p>}
            <button type="button" className="a0-lane" onClick={() => { setOpen(null); onResearch(); }}>Open Research ›</button>
          </>}
          {id === "shipping" && <>{(now.error || now.data?.ship.error) && <p role="status">Shipping unavailable; retrying.</p>}<div className="a0-ship"><span>live</span><b>{now.data?.ship.data?.liveSha?.slice(0, 7) ?? "Not reported"}</b></div>{queued.map((row) => <div className="a0-ship" key={row.id}><span>{row.state}</span><b>{row.why || row.branch || row.id}</b></div>)}</>}
        </div>
      </div>}
    </div>)}
  </div>;
}

/**
 * Agent Zero's scratch pad (Shaan, 3 Oct ~16:10): a chip in Agent Zero's header that pops a bullet list of today's
 * important to-dos, the date on top, a time on every line. He adds lines here; Agent Zero edits the same JSON file
 * (services/node/src/scratchpad.ts) and the list follows within a few seconds, no deploy. When Agent Zero bumps `pop`
 * the pad opens by itself once.
 */
type Item = { id: string; text: string; group?: string; at: number; done?: number | null };
type Pad = { date: string; updated: number; pop?: number; items: Item[] };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const POP_SEEN = "ab.scratchpad.popSeen";
const localDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("en-CA");
const CLOSED = new Set(["live", "dropped", "happy", "integrated"]);

export function ScratchpadChip() {
  const [pad, setPad] = useState<Pad | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [openOld, setOpenOld] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const source = useSharedState<Pad>("/api/scratchpad", 5000);

  useEffect(() => {
    const p = source.data;
    if (!p) return;
    setPad(p);
    if (p.pop && p.pop > Number(localStorage.getItem(POP_SEEN) || 0)) {
      localStorage.setItem(POP_SEEN, String(p.pop));
      setOpen(true);
    }
  }, [source.data]);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", off), document.removeEventListener("keydown", esc));
  }, [open]);

  const send = (op: Record<string, unknown>) =>
    fetch("/api/scratchpad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Pad | null) => { if (p) { setPad(p); void refresh("/api/scratchpad"); } })
      .catch(() => {});

  // A pad from another day is not today's list (Shaan, 6 Oct 21:00: "I've still got the Saturday 3rd of October tasks
  // on my task drop down"): today's date goes on top with today's open tasks from Agent Zero's index, and the old pad
  // folds below it. Nothing is written to the pad file; Agent Zero rolls it.
  const index = useSharedState<A0TaskIndex>("/api/a0/tasks", 30_000);
  const todayKey = localDay();
  const old = !!pad && pad.date !== todayKey;
  const todays = old ? (index.data?.tasks ?? []).filter((t) => !CLOSED.has(t.stage) && Number.isFinite(Date.parse(t.updated)) && localDay(Date.parse(t.updated)) === todayKey).sort((a, b) => a.id.localeCompare(b.id)) : [];
  const items = pad?.items ?? [];
  const left = old ? todays.length : items.filter((i) => !i.done).length;
  const groups: [string, Item[]][] = [];
  for (const i of items) {
    const g = i.group || "";
    const hit = groups.find(([k]) => k === g);
    if (hit) hit[1].push(i);
    else groups.push([g, [i]]);
  }

  return (
    <div className="ab-pchip ab-pad" ref={box}>
      <button type="button" className="ab-pchip__btn" data-testid="scratchpad-chip" aria-expanded={open} aria-label={`Today's scratch pad: ${left} to do`} title="Today's scratch pad" onClick={() => setOpen((v) => !v)}>
        <span className="ab-pchip__mark">
          <NotebookPenIcon aria-hidden="true" />
        </span>
        <span className="ab-pchip__n">Today{left ? ` · ${left}` : ""}</span>
      </button>
      {open && (
        <div className="ab-pchip__tray ab-pad__tray" data-testid="scratchpad-tray">
          <div className="ab-pad__head">
            <b>{pad ? day(old ? todayKey : pad.date) : "Today"}</b>
            {pad?.updated && !old ? <span>updated {hhmm(pad.updated)}</span> : null}
          </div>
          <div className="ab-pad__list">
            {old && <section data-testid="scratchpad-today-tasks">
              <h4>Today's tasks</h4>
              {index.error && !index.data && <p className="ab-pad__empty" role="status">Tasks unavailable; retrying.</p>}
              {index.data && !todays.length && <p className="ab-pad__empty">No open tasks touched today.</p>}
              <ul>{todays.map((t) => <li key={t.id}><span className="ab-pad__tick is-task" aria-hidden="true" /><span className="ab-pad__text"><b>{t.id}</b> {t.short ?? t.title}</span><time title={t.updated}>{hhmm(Date.parse(t.updated))}</time></li>)}</ul>
            </section>}
            {old && items.length > 0 && <button type="button" className="ab-pad__old" data-testid="scratchpad-old" aria-expanded={openOld} onClick={() => setOpenOld((v) => !v)}>{openOld ? "▾" : "▸"} Pad from {day(pad!.date)} · {items.filter((i) => !i.done).length ? `${items.filter((i) => !i.done).length} open` : "all done"}</button>}
            {!old && !items.length && <p className="ab-pad__empty">Nothing pinned for today yet.</p>}
            {(!old || openOld) && groups.map(([g, list]) => (
              <section key={g || "_"}>
                {g && <h4>{g}</h4>}
                <ul>
                  {list.map((i) => (
                    <li key={i.id} className={i.done ? "is-done" : ""}>
                      <button type="button" className="ab-pad__tick" aria-label={i.done ? "Mark not done" : "Mark done"} aria-pressed={!!i.done} onClick={() => send({ op: "toggle", id: i.id })} />
                      <span className="ab-pad__text">{i.text}</span>
                      <time title={new Date(i.at).toLocaleString()}>{hhmm(i.done || i.at)}</time>
                      <button type="button" className="ab-pad__x" aria-label="Remove" onClick={() => send({ op: "remove", id: i.id })}>
                        <XIcon aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <form
            className="ab-pad__add"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) send({ op: "add", text: draft }).then(() => setDraft(""));
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a line for today…" aria-label="Add a line" data-testid="scratchpad-add" />
          </form>
        </div>
      )}
    </div>
  );
}
