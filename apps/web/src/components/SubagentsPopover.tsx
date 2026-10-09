import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clock, every } from "../lib/poll";
import { AgentFace } from "../lib/face";
import type { Agent } from "../lib/agents";
import { openSubagent, talkToSubagent, rowTone, duration, rememberSubagents, fmtTokens as fmt, type SubagentRowData as Row, type SubagentsResult as Result } from "./SubagentRow";
import { FLIGHT_EVENT, pop, reducedMotion, shake, type FlightNote } from "../lib/flight";
import { ActivityPill, ActivityPopover, type ActivityItem } from "../../../../packages/siso-composer/src/ActivityPopover";
import { measuredWorkerRate, workerRateSummary } from "../lib/subagent-rate";
import "./SubagentsPopover.css";

/** "gpt-6.1-sol" → "Sol 6.1", "claude-sonnet-5-5" → "Sonnet 5.5", as the org chart labels a harness. */
const modelShort = (m?: string) => !m ? "codex" : m.replace(/^gpt-([\d.]+)-(\w+)$/, (_, v, n) => `${n[0].toUpperCase()}${n.slice(1)} ${v}`).replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);

export function SubagentsPopover({ agent, total, running, crew, onOpenCrew, shells = [] }: { agent: Agent; total: number; running: number; crew: Agent[]; onOpenCrew: (agent: Agent) => void; shells?: { id: string; kind: string; description?: string }[] }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<Result | null>(null), [now, setNow] = useState(Date.now());
  // R1.20b: the HUD strip clips its children (overflow hidden), so the panel renders on <body>, fixed above the trigger.
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const [at, setAt] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => { const r = trigger.current?.getBoundingClientRect(); if (!r) return;
      const half = Math.min(680, window.innerWidth - 24) / 2;
      setAt({ left: Math.min(Math.max(r.right - half, half + 12), window.innerWidth - half - 12), bottom: Math.min(window.innerHeight - 160, Math.max(12, window.innerHeight - r.top + 12)), maxHeight: Math.max(148, r.top - 24) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  // The faces pill shows who is running, so the list is read while closed too (every 15 s; every 5 s while open).
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/agents/${encodeURIComponent(agent.id)}/subagents`, { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(d => { if (alive) { setError(null); setNow(Date.now()); setData(d); rememberSubagents(d.rows ?? []); } }).catch(() => { if (alive) setError("Could not refresh agents. Last known activity is shown; rates are unavailable."); });
    const stopPoll = every(() => void load(), open || running > 0 ? 3000 : 5000);
    return () => { alive = false; stopPoll(); };
  }, [open, agent.id, running]);
  useEffect(() => { setData(null); setError(null); }, [agent.id]);
  useEffect(() => open || running > 0 || (data?.running ?? 0) > 0 ? clock(() => setNow(Date.now())) : undefined, [open, running, data?.running]);
  useEffect(() => {
    if (!open) return;

    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      // ⌫ on a running sub-agent stops it (SPEC-CHAT-HUD §4): the chat asks the agent to stop that task.
      const at = document.activeElement as HTMLElement | null;
      if ((e.key === "Backspace" || e.key === "Delete") && at?.dataset.running === "1" && at.dataset.tool && panel.current?.contains(at)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("siso-chat-stop", { detail: { agentId: agent.id, toolUseId: at.dataset.tool } }));
        at.dataset.stopping = "1";
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!panel.current?.contains(document.activeElement) && document.activeElement !== trigger.current) return;
      const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>(".ab-subagents__node,.ab-subagents__done,.ab-subagents__who") ?? [])];
      if (!rows.length) return;
      e.preventDefault();
      const i = rows.indexOf(document.activeElement as HTMLButtonElement);
      rows[i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length].focus();
    };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); };
  }, [open]);
  const rows: Row[] = [...(data?.rows ?? []), ...shells.map(shell => ({ id: `shell:${shell.id}`, toolUseId: shell.id, kind: "shell" as const, type: "shell", name: shell.description || shell.kind, what: "Background shell", spec: "", start: null, end: null, tools: null, tokens: 0, running: true, background: true }))];
  // SPEC-DELIGHT §3: faces the chat's fan-out lines sent here (lib/flight.ts). `out` is on its way (its slot waits,
  // hidden), `in` landed, `ok` / `bad` finished (a green or red ring), then it flies home and leaves. A face that went
  // home stays gone even while the 15 s poll still lists it running.
  const [flown, setFlown] = useState<Map<string, FlightNote>>(new Map());
  const gone = useRef(new Set<string>());
  useEffect(() => {
    const el = trigger.current;
    if (!el) return;
    const on = (e: Event) => {
      const n = (e as CustomEvent<FlightNote>).detail;
      if (n.at === "home") gone.current.add(n.id);
      setFlown((m) => {
        const next = new Map(m);
        if (n.at === "home") next.delete(n.id);
        else next.set(n.id, n);
        return next;
      });
      if (n.at === "in") requestAnimationFrame(() => pop(el.querySelector(`[data-flight-id="${CSS.escape(n.id)}"]`) ?? el.querySelector("[data-flight-more]"), 1.6));
      if (n.at === "bad") requestAnimationFrame(() => shake(el.querySelector(`[data-flight-id="${CSS.escape(n.id)}"]`) ?? el));
    };
    el.addEventListener(FLIGHT_EVENT, on);
    return () => el.removeEventListener(FLIGHT_EVENT, on);
  }, []);
  // A worker that finishes pops out of the pill with its name for a few seconds; a tap opens it
  // (ideas round 1, pick 2: "face pops up when an agent finishes ... that's quite cool").
  const [popped, setPopped] = useState<Row[]>([]);
  const wasRunning = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const before = wasRunning.current;
    wasRunning.current = new Set(data.rows.filter((r) => r.running).map((r) => r.id));
    if (!before) return;
    const finished = data.rows.filter((r) => !r.running && !r.quiet && r.status !== "stopped" && before.has(r.id));
    if (!finished.length) return;
    setPopped((p) => [...p.filter((x) => !finished.some((f) => f.id === x.id)), ...finished].slice(-3));
    const t = window.setTimeout(() => setPopped((p) => p.filter((x) => !finished.some((f) => f.id === x.id))), 5000);
    return () => window.clearTimeout(t);
  }, [data]);
  // Rise above the whole composer, including question cards, so no answer or saved-history control is covered.
  const [popAt, setPopAt] = useState<{ right: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    if (!popped.length) return setPopAt(null);
    const anchor = trigger.current?.closest(".siso-chat__composer") ?? trigger.current?.closest(".siso-rim") ?? trigger.current;
    if (!anchor) return;
    const place = () => { const box = anchor.getBoundingClientRect(); setPopAt(box.width && box.height ? { right: Math.max(8, window.innerWidth - box.right + 12), bottom: window.innerHeight - box.top + 10 } : null); };
    place();
    const observer = new ResizeObserver(place); observer.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [popped]);
  const [raiseAt, setRaiseAt] = useState<{ right: number; bottom: number } | null>(null);
  const needsCount = crew.filter((c) => c.status === "needs").length;
  useLayoutEffect(() => {
    if (!needsCount) return setRaiseAt(null);
    const anchor = trigger.current?.closest(".siso-chat__composer") ?? trigger.current?.closest(".siso-rim") ?? trigger.current;
    if (!anchor) return;
    const place = () => { const box = anchor.getBoundingClientRect(); setRaiseAt(box.width && box.height ? { right: Math.max(8, window.innerWidth - box.right + 12), bottom: window.innerHeight - box.top + 10 + (popped.length ? popped.length * 34 : 0) } : null); };
    place();
    const observer = new ResizeObserver(place); observer.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [needsCount, popped.length]);
  const flying = [...flown.values()];
  const polled = rows.filter((r) => r.running && !gone.current.has(r.toolUseId ?? r.id) && !flown.has(r.toolUseId ?? ""));
  // Faces show health (ideas r2 #3): a worker with no output for two minutes dozes; one that needs him raises its hand
  // (ideas r2 #4): its face leads the stack, lifted, and the pill says so.
  const quiet = (r: Row) => r.running && r.kind === "claude" && (measuredWorkerRate(r, now) ?? Infinity) < 0.5 && !!r.start && Date.now() - Date.parse(r.start) > 120_000;
  const needing = crew.filter((c) => c.status === "needs");
  const stack = [
    ...needing.map((c) => ({ id: `needs:${c.id}`, name: c.name, at: "in" as FlightNote["at"], needs: true, row: undefined as Row | undefined })),
    ...polled.filter((r) => !needing.some((c) => c.id === r.agentId)).map((r) => ({ id: r.toolUseId ?? r.id, name: r.name ?? r.type, at: "in" as FlightNote["at"], needs: false, row: r as Row | undefined })),
    ...flying.map((f) => ({ ...f, needs: false, row: undefined as Row | undefined })),
  ];
  // Running: what the poll says minus the faces that already flew home, plus the ones that landed since; the count
  // ticks when a face lands.
  const landed = flying.filter((f) => f.at === "in").length;
  const nRunning = data ? polled.filter(r => !["blocked", "failed", "stopped"].includes(r.status ?? "")).length + landed : Math.max(running, landed);
  const nTotal = Math.max(rows.length, total);
  const faces = stack.slice(0, 3), more = stack.length - faces.length;
  const rateSummary = workerRateSummary(error ? [] : rows, now);
  const liveRate = rateSummary.value;
  // The popup's groups: a Codex batch is a card; anything else running is a tile on its own (a group of one).
  const [note, setNote] = useState<string | null>(null);
  const shellRows = rows.filter((r) => r.kind === "shell");
  const live = rows.filter((r) => r.running && r.kind !== "shell");
  const done = rows.filter((r) => !r.running && r.kind !== "shell" && !r.batchId);
  const groups = [...new Set(rows.filter((r) => r.kind !== "shell" && (r.running || r.batchId)).map((r) => r.batchId ?? `solo:${r.id}`))].map((id) => {
    const all = rows.filter((r) => (r.batchId ?? `solo:${r.id}`) === id);
    const byName = [...all].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }));
    return { id, batch: !!all[0].batchId, title: all[0].batch ?? "", all, rows: [...byName.filter((r) => r.running), ...byName.filter((r) => !r.running)], hue: [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0), rate: workerRateSummary(error ? [] : all, now) };
  }).sort((a, b) => Number(b.all.some((r) => r.running)) - Number(a.all.some((r) => r.running)));
  const talk = (row: Row) => {
    if (row.kind === "shell") return;
    if (row.agentId) { setOpen(false); return openSubagent(row, crew, onOpenCrew); }
    setNote(`Opening ${row.name ?? "it"}…`);
    void talkToSubagent(agent.id, row).then((why) => { if (why) setNote(why); else { setNote(null); setOpen(false); } });
  };
  // Runtime rows become display values and callbacks; the shared popup owns no row readers or commands.
  const item = (row: Row): ActivityItem => {
    const rate = error ? undefined : measuredWorkerRate(row, now);
    const quiet = row.running && (rate ?? Infinity) < 0.5 && !!row.start && now - Date.parse(row.start) > 120_000 && row.kind !== "codex";
    return {
      id: row.id, title: row.name || row.type.split(" · ")[0], testId: "subagent-row", tone: row.quiet ? "waiting" : rowTone(row), quiet,
      stateLabel: row.status === "blocked" ? "Blocked" : row.status === "failed" ? "Failed" : row.quiet ? "Quiet" : row.running ? "Working" : row.status === "stopped" ? "Stopped" : "Finished",
      metric: row.running ? `${(row.rateEstimated ?? row.estimated) && rate !== undefined ? "~" : ""}${rate === undefined ? "—" : rate.toLocaleString("en-GB", { maximumFractionDigits: 1 })}` : fmt(row.tokens),
      metricLabel: row.running ? "output tok/s" : "tokens",
      expandedDetail: <><p>{row.about || row.what || row.spec || "No task description reported."}</p><dl><div><dt>Elapsed</dt><dd>{duration(row.start, row.running ? null : row.end, now)}</dd></div><div><dt>Total tokens</dt><dd>{fmt(row.tokens)}</dd></div><div><dt>Rate source</dt><dd>{rate === undefined ? "Unavailable" : `${(row.rateEstimated ?? row.estimated) ? "Generated text estimate" : "Output-token counters"} · ${(row.rateWindowMs ?? 0) / 1000}s window`}</dd></div></dl></>,
      actionKey: row.toolUseId, keyboardStoppable: row.running && !row.agentId,
      tooltip: [row.about, row.what, row.spec, `${fmt(row.tokens)} tokens`, "Tap to talk to it"].filter(Boolean).join("\n"),
      onSelect: () => talk(row),
      identity: <AgentFace name={row.name ?? row.type} project={row.name ?? row.type} status={row.quiet || quiet ? "offline" : row.status === "failed" || row.status === "blocked" ? "blocked" : row.running ? "working" : row.status === "stopped" ? "waiting" : "done"} size={34}/>,
      compactIdentity: <AgentFace name={row.name ?? row.type} project={row.name ?? row.type} status="done" size={16}/>,
      modelLabel: modelShort(row.model ?? (row.kind === "claude" ? row.type : undefined)),
      description: row.about || row.what || row.spec || "—",
      detail: <>{row.running ? duration(row.start, null, now) : duration(row.start, row.end, now)}</>,
    };
  };
  return <span className="ab-subagents">
    <ActivityPill open={open} onOpenChange={setOpen} triggerRef={trigger} active={!!error || nRunning > 0 || flying.length > 0 || needing.length > 0} running={error && !data ? 0 : nRunning} needsAttention={needing.length > 0} paused={typeof document !== "undefined" && reducedMotion()}
      faces={faces.map(face => ({ id: face.id, phase: face.at, needsAttention: face.needs, identity: <AgentFace name={face.name} project={face.name} status={face.needs ? "needs-shaan" : face.row && quiet(face.row) ? "offline" : face.at === "ok" ? "done" : face.at === "bad" ? "blocked" : "working"} size={18}/> }))} more={more}
      status={error && !data ? "Unavailable" : needing.length ? `${needing.length} need${needing.length === 1 ? "s" : ""} you` : `${nRunning} working`}
      rate={liveRate} rateLabel={<>{rateSummary.label} tok/s</>} rateTitle={rateSummary.title}
      /* Finished agents are not counted in the bar (6 Oct 21:00: "everything still says the sub-agent's done"); the list keeps them. */
      idleLabel="Agents"
      title="Agents this pane runs" label={error && !data ? "Sub-agents: activity unavailable" : `Sub-agents: ${nRunning} running of ${nTotal}`}/>
    {needing.length > 0 && !open && raiseAt && createPortal(<span className="ab-subagents__popped is-hands" style={raiseAt} data-testid="raised-hand">{needing.slice(0, 2).map((c) => (
      <button type="button" key={c.id} className="is-needs" title="Open its chat to answer" onClick={() => window.dispatchEvent(new CustomEvent("siso-open-split", { detail: { id: c.id, name: c.name } }))}>
        <AgentFace name={c.name} project={c.project ?? c.name} status="needs-shaan" size={18} /><b>{c.name}</b><span>needs you · answer</span>
      </button>))}</span>, document.body)}
    {popped.length > 0 && !open && popAt && createPortal(<span className="ab-subagents__popped" style={popAt} data-testid="finish-pop">{popped.map((r) => {
      const bad = r.status === "failed" || r.status === "blocked";
      return <button type="button" key={r.id} className={bad ? "is-bad" : "is-ok"} onClick={() => { setPopped((p) => p.filter((x) => x.id !== r.id)); talk(r); }}>
        <AgentFace name={r.name ?? r.type} project={r.name ?? r.type} status={bad ? "blocked" : "done"} size={18} /><b>{r.name || r.type}</b><span>{bad ? (r.status ?? "failed") : "done ✓"}</span><small>{[r.start && r.end ? duration(r.start, r.end, now) : null, r.tokens ? `${fmt(r.tokens)} tok` : null].filter(Boolean).join(" · ")}</small>
      </button>;
    })}</span>, document.body)}
    <ActivityPopover open={open} position={at} panelRef={panel} onClose={close} label={`Sub-agents for ${agent.name}`}
      heading={{ label: agent.name, identity: <AgentFace name={agent.name} project={agent.project ?? agent.name} status={agent.status === "working" ? "working" : "waiting"} size={22}/>, title: "Back to the main chat", onSelect: () => { setOpen(false); window.dispatchEvent(new CustomEvent("siso-open-subagent", { detail: { id: null } })); } }}
      summary="Running & recent"
      metrics={[{ label: "Working", value: data ? String(live.filter(row => !["blocked", "failed", "stopped"].includes(row.status ?? "")).length) : "—" }, { label: "Output tok/s", value: rateSummary.label, title: rateSummary.title }, { label: "Total tokens", value: data ? fmt(data.tokens) : "—", title: "Reported token usage across these agents; separate from output rate." }]}
      note={error ? data ? error : "Could not load agents. Activity is unavailable." : note} loading={!data && !error}
      groups={groups.map(group => ({ id: group.id, ...(group.batch ? { title: group.title, color: `hsl(${group.hue} 65% 65%)`, testId: "codex-batch", initiallyCollapsed: group.all.every(row => !row.running && !row.quiet && !["failed", "blocked", "stopped"].includes(row.status ?? "")), summary: <>{group.all.filter(row => !row.running).length} of {group.all.length} finished{group.rate.measured > 0 && ` · ${group.rate.label} tok/s`}</>, progress: group.all.map(row => ({ id: row.id, tone: rowTone(row) })) } : {}), items: group.rows.map(item) }))}
      idle={!data && !error ? false : !live.length && !shellRows.length && !groups.length} emptyLabel={error ? "Activity unavailable" : "No agents working right now"}
      utilities={shellRows.map(row => ({ id: row.id, label: row.name ?? row.type, title: row.what, onStop: () => window.dispatchEvent(new CustomEvent("siso-chat-stop", { detail: { agentId: agent.id, toolUseId: row.toolUseId } })) }))}
      finished={done.map(item)} finishedLabel={`${done.length} earlier agents`}/>

  </span>;
}
