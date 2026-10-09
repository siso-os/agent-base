import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, SquareIcon } from "lucide-react";
import { fmtDuration, type Call, type Item, type Task } from "../lib/chat";
import { AgentFace } from "../lib/face";
import { useSubagentMeta } from "./SubagentRow";
import { fly, onScreen, pillOf, pop, reducedMotion, shake, tellPill } from "../lib/flight";
import "./FanOut.css";
import type { FlightLedger } from "../lib/delight";

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));
// R1.20c: a terminal agent's background sub-agent (its result is "Async agent launched" at once) runs until its
// task-notification; the task (siso-host) says so for an app chat.
const isRunning = (call: Call, task?: Task) => (task ? ["running", "pending", "starting", "stop_requested"].includes(task.status) : call.bg ? !call.end : call.done === undefined);
const isFailed = (call: Call, task?: Task) => (task ? /fail|kill|stop|block|error|cancel|interrupt/.test(task.status) : call.end ? !call.end.ok : call.done?.ok === false);

/** The run of sub-agent launches around item n: where it starts and ends, so the rows draw ├ / └ and one header. */
export function agentGroup(items: Item[], n: number) {
  let a = n, b = n;
  while (a > 0 && items[a - 1].k === "agent") a--;
  while (b < items.length - 1 && items[b + 1].k === "agent") b++;
  return { first: n === a, last: n === b, calls: items.slice(a, b + 1).flatMap((it) => (it.k === "agent" ? [it.call] : [])) };
}

/**
 * A sub-agent launch as a line of a live fan-out (R1.19, SPEC-CHAT-HUD §3 option A; 20:45: "it could be sent off like we
 * have agent emojis ... So it's not just like a box"): ├ · its halo face · NAME (from .meta.json) · what it was asked ·
 * ▸ its current step · model · time, tools, tokens · ›. The first row of a run carries "Launched N agents" and a bar
 * that fills as they return. While running a light sweeps under the row; on finishing it flashes green once.
 */
export function FanOutRow({ call, task, steps, now, onOpen, onStop, group, lifecycle }: { lifecycle?: FlightLedger; call: Call; task?: Task; steps: number; now: number; onOpen: () => void; onStop?: () => void; group: ReturnType<typeof agentGroup>; taskOf: (id: string) => Task | undefined }) {
  const meta = useSubagentMeta(call.id);
  const [stopping, setStopping] = useState(false);
  const running = isRunning(call, task), failed = !running && isFailed(call, task);
  const status = task?.status ?? call.end?.status ?? "";
  const name = meta?.name ?? (task?.hostName ? task.description : undefined) ?? (task?.kind && task.kind !== "task" ? task.kind : call.name);
  // SPEC-DELIGHT §3. Launched while the chat is live (not on history load): the face pops, then a twin flies to the HUD's
  // faces pill and this face dims while it is away. Finished live: the pill's face turns green (or red and shakes) and
  // flies home, this face comes back, and the row flashes green (red and shakes on a failure). Reduced motion: no
  // flights, the states change in place.
  const faceEl = useRef<HTMLSpanElement>(null), rowEl = useRef<HTMLButtonElement>(null);
  const [away, setAway] = useState(false);
  const [flash, setFlash] = useState<"" | "ok" | "bad">("");
  const nameRef = useRef(name);
  nameRef.current = name;
  useEffect(() => {
    const phase = running ? 'spawn' : 'return';
    if (!lifecycle?.claim(call.id, phase)) return;
    const p = pillOf(rowEl.current), from = faceEl.current;
    if (!p || !from || !onScreen(rowEl.current) || !onScreen(p)) return;
    const controller = new AbortController();
    let alive = true;
    const note = { id: call.id, name: nameRef.current };
    const land = () => { if (alive) { setAway(false); if (!onScreen(rowEl.current)) return; setFlash(failed ? "bad" : "ok"); if (failed) shake(rowEl.current); } };
    if (running) {
      pop(faceEl.current, 1.5);
      tellPill(p, {...note, at:'out'});
      setAway(!reducedMotion());
    } else tellPill(p, {...note, at:failed ? 'bad' : 'ok'});
    const frame = requestAnimationFrame(() => {
      if (!alive) return;
      const slot = p.querySelector(`[data-flight-id="${CSS.escape(call.id)}"]`) ?? p.querySelector('[data-flight-more]') ?? p;
      if (running) void fly(from, slot, {name:note.name,status:'working',glow:'#22D3EE',signal:controller.signal}).then(() => { if (alive) { const visible = onScreen(rowEl.current) && onScreen(p); tellPill(p,{...note,at:visible ? 'in' : 'home'}); if (!visible) setAway(false); } });
      else {
        const rect = slot.getBoundingClientRect();
        tellPill(p,{...note,at:'home'});
        void fly(rect, faceEl.current ?? rowEl.current!, {name:note.name,status:failed ? 'blocked' : 'done', outcome:failed ? 'Blocked' : 'Done',arc:-40,signal:controller.signal}).then(land);
      }
    });
    const timer = window.setTimeout(() => setFlash(''), 2500);
    return () => { alive = false; controller.abort(); cancelAnimationFrame(frame); clearTimeout(timer); tellPill(p,{...note,at:'home'}); setAway(false); };
  }, [running, failed, call.id, lifecycle]);
  const model = (meta?.model ?? task?.model)?.replace(/^claude-/, "").split("-")[0];
  // Times: the task's (siso-host), else the launch and its notification (R1.20c), else the sub-agent's own file.
  const start = task?.startedAt ?? (call.bg ? call.at : meta?.start ? Date.parse(meta.start) : call.at) ?? null;
  const end = running ? null : task ? task.endedAt : (call.end?.at ?? (meta?.end ? Date.parse(meta.end) : (call.done?.at ?? null)));
  const time = start && (end ?? now) ? fmtDuration(Math.max(0, (end ?? now) - start)) : null;
  const tools = task?.tools ?? meta?.tools ?? null, tokens = task?.tokens ?? meta?.tokens ?? null;
  const stats = [time, tools ? `${tools} tools` : steps ? `${steps} steps` : null, tokens ? k(tokens) : null].filter(Boolean);
  // Shaan, 6 Oct 21:10: "I don't like ... the launched agents ... we already have a agent drop down in the side nav". A
  // finished sub-agent leaves the reply (the side nav's dropdown keeps them); only running ones stay, with no
  // "Launched N agents" header.
  if (!running) return null;
  return (
    <>
      <div className="ab-fan__wrap" data-testid="agent-card" data-running={running ? "1" : "0"}>
      <button ref={rowEl} type="button" className={`ab-fan__row${running ? " is-run" : failed ? " is-bad" : " is-done"}${flash === "ok" ? " is-flash" : flash === "bad" ? " is-badflash" : ""}`} data-testid="fanout-row" onClick={onOpen}>
        <span className="ab-fan__br" aria-hidden>{group.last ? "└" : "├"}</span>
        <span ref={faceEl} className={`ab-fan__face${away ? " is-away" : ""}`} data-testid="fanout-face">
          <AgentFace name={name} project={name} status={running ? "working" : failed ? "blocked" : "done"} size={22} />
        </span>
        <b className="ab-fan__name">{name}</b>
        <span className="ab-fan__what">
          {call.summary}
          {running && <i>▸ {stopping ? "Stopping…" : task?.last ?? "Working…"}</i>}
        </span>
        {model && <span className={`ab-fan__model is-${model}`}>{model}</span>}
        <span className="ab-fan__stats">
          {!running && <span className="ab-fan__mark">{failed ? "Blocked" : "Done"}</span>}
          {/* The CLI's words for an agent that did not finish: "Stopped (2m 10s · 4 tools)". */}
          {failed ? `${/kill|stop/.test(status) ? "Stopped" : "Failed"}${stats.length ? ` (${stats.join(" · ")})` : ""}` : stats.join(" · ")}
        </span>
        <ChevronRightIcon size={14} className="ab-fan__chev" />
      </button>
      {running && onStop && (
        <button type="button" className="ab-fan__stop" data-testid="agent-stop" disabled={stopping} aria-label={`Stop ${call.summary || "this sub-agent"}`} title="Stop this sub-agent" onClick={() => (setStopping(true), onStop())}>
          <SquareIcon size={9} aria-hidden /> {stopping ? "Stopping…" : "Stop"}
        </button>
      )}
      </div>
    </>
  );
}
