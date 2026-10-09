import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { ChevronUpIcon, LayersIcon, StopIcon } from "./icons";
import "./activity.css";

export type ActivityFace = { id: string; identity: ReactNode; phase?: string; needsAttention?: boolean };
export type ActivityPillProps = {
  open: boolean; onOpenChange: (open: boolean) => void; triggerRef?: Ref<HTMLButtonElement>;
  faces: ActivityFace[]; more?: number; active: boolean; running: number; needsAttention?: boolean;
  status: ReactNode; paused?: boolean; rate?: number; rateLabel?: ReactNode; rateTitle?: string; idleLabel?: ReactNode; label: string; title?: string;
};
/** Faces and rates are supplied measurements; this component owns only hover/click and the existing ring motion. */
export function ActivityPill({ open, onOpenChange, triggerRef, faces, more = 0, active, running, needsAttention, status, paused = false, rate = 0, rateLabel, rateTitle, idleLabel = "idle", label, title }: ActivityPillProps) {
  const ringEl = useRef<HTMLElement>(null), ring = useRef<Animation | null>(null);
  const spinning = running > 0;
  useEffect(() => {
    const el = ringEl.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || !spinning || !el) return;
    const animation = ring.current = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 2400, iterations: Infinity });
    let input = performance.now();
    const sync = () => { if (document.hidden || motion.matches || performance.now() - input > 20_000) animation.pause(); else if (animation.playState === "paused") animation.play(); };
    const wake = () => { input = performance.now(); sync(); };
    document.addEventListener("visibilitychange", sync); motion.addEventListener("change", sync); sync();
    const idle = window.setInterval(() => { if (performance.now() - input > 20_000 && animation.playState === "running") animation.pause(); }, 2000);
    for (const event of ["pointermove", "pointerdown", "keydown", "wheel"]) window.addEventListener(event, wake, { passive: true });
    return () => { animation.cancel(); ring.current = null; clearInterval(idle); document.removeEventListener("visibilitychange", sync); motion.removeEventListener("change", sync); for (const event of ["pointermove", "pointerdown", "keydown", "wheel"]) window.removeEventListener(event, wake); };
  }, [spinning, paused]);
  useEffect(() => ring.current?.updatePlaybackRate(Math.max(0.25, Math.min(4, rate / 60))), [rate, spinning]);
  return <button ref={triggerRef} type="button" className={`ab-subagents__trigger${open ? " is-open" : ""}${spinning ? " is-run" : ""}${needsAttention ? " is-needs" : ""}`} aria-expanded={open} aria-haspopup="dialog" onPointerEnter={e => { if (e.pointerType === "mouse" && window.matchMedia("(hover:hover)").matches) onOpenChange(true); }} onClick={e => onOpenChange(e.detail > 0 && window.matchMedia("(hover:hover)").matches ? true : !open)} title={title} aria-label={label} data-testid="faces-pill" data-running={running}>
    <span className="ab-subagents__ring" aria-hidden><i ref={ringEl}/></span>
    {active ? <><span className="ab-subagents__stack">{faces.map(face => <span key={face.id} className={`ab-subagents__pin is-${face.phase ?? "in"}${face.needsAttention ? " is-needs" : ""}`} data-flight-id={face.id} data-testid="pill-face">{face.identity}</span>)}{more > 0 && <span className="ab-subagents__more" data-flight-more>+{more}</span>}</span><span className={needsAttention ? "ab-subagents__needs" : "ab-subagents__run"}>{status}</span>{spinning && rateLabel != null && <span className="ab-subagents__rate" data-testid="pill-rate" title={rateTitle}>{rateLabel}</span>}</> : <span className="ab-subagents__idle">{idleLabel}</span>}
    <ChevronUpIcon size={12}/>
  </button>;
}

export type ActivityItem = {
  id: string; title: string; identity?: ReactNode; compactIdentity?: ReactNode; modelLabel?: string; description?: ReactNode;
  detail?: ReactNode; expandedDetail?: ReactNode; stateLabel?: string; metric?: ReactNode; metricLabel?: string; tone?: string; quiet?: boolean; tooltip?: string; actionKey?: string; keyboardStoppable?: boolean;
  testId?: string; onSelect: () => void;
};
export type ActivityGroup = { id: string; title?: string; color?: string; summary?: ReactNode; progress?: { id: string; tone: string }[]; items: ActivityItem[]; testId?: string; initiallyCollapsed?: boolean };
export type ActivityUtility = { id: string; label: string; title?: string; onStop: () => void };
export type ActivityPopoverProps = {
  open: boolean; position: { left: number; bottom: number; maxHeight?: number } | null; panelRef?: Ref<HTMLElement>; label: string;
  heading: { label: string; identity?: ReactNode; title?: string; onSelect: () => void }; summary?: ReactNode; note?: ReactNode;
  loading?: boolean; groups: ActivityGroup[]; idle?: boolean; emptyLabel?: ReactNode; utilities?: ActivityUtility[];
  finished?: ActivityItem[]; finishedLabel?: ReactNode; onClose?: () => void;
  metrics?: { label: string; value: ReactNode; title?: string }[];
};
function Item({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="ab-subagents__branch" data-tone={item.tone}>
    <div className="ab-subagents__row-wrap">
      <button type="button" className={`ab-subagents__node${item.quiet ? " is-stuck" : ""}`} data-testid={item.testId ?? "activity-row"} data-tone={item.tone} data-tool={item.actionKey} data-running={item.keyboardStoppable ? "1" : undefined} onClick={item.onSelect} title={item.tooltip}>
        <span className="ab-subagents__identity">{item.identity}</span>
        <span className="ab-subagents__node-main"><span className="ab-subagents__node-top"><b>{item.title}</b><span>{item.modelLabel}</span></span><small className="ab-subagents__description">{item.description}</small><span className="ab-subagents__node-state"><i aria-hidden/>{item.stateLabel ?? item.tone ?? "Activity"}<small>{item.detail}</small></span></span>
        {item.metric != null && <span className="ab-subagents__metric"><strong>{item.metric}</strong><small>{item.metricLabel}</small></span>}
      </button>
      {item.expandedDetail && <button type="button" className="ab-subagents__inspect" aria-label={`Details for ${item.title}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronUpIcon size={12}/></button>}
    </div>
    {expanded && <div className="ab-subagents__detail">{item.expandedDetail}<button type="button" onClick={item.onSelect}>Open conversation <span aria-hidden>↗</span></button></div>}
  </div>;
}
function Group({ group }: { group: ActivityGroup }) {
  const [expanded, setExpanded] = useState(!group.initiallyCollapsed);
  const id = useId();
  return <article className="ab-subagents__batch" style={{ "--batch": group.color } as CSSProperties} data-testid={group.testId ?? "activity-group"}>
    <button type="button" className="ab-subagents__batch-head" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}><LayersIcon size={14} aria-hidden/><b>{group.title}</b><span>{group.summary}</span><ChevronUpIcon size={11}/></button>
    <span className="ab-subagents__batch-bar" aria-hidden>{group.progress?.map(item => <i key={item.id} data-tone={item.tone}/>)}</span>
    <div id={id} hidden={!expanded} className="ab-subagents__batch-grid is-connected">{group.items.map(item => <Item key={item.id} item={item}/>)}</div>
    {!expanded && <span className="ab-subagents__batch-faces" aria-hidden>{group.items.slice(0,6).map(item => <span key={item.id}>{item.compactIdentity ?? item.identity}</span>)}</span>}
  </article>;
}
/** Groups, finish state and utilities are already projected by the application. No runtime or account reader lives here. */
export function ActivityPopover({ open, position, panelRef, label, heading, summary, note, loading, groups, idle, emptyLabel = "Nothing running.", utilities = [], finished = [], finishedLabel = `${finished.length} finished`, onClose, metrics }: ActivityPopoverProps) {
  const [showFinished, setShowFinished] = useState(false);
  useEffect(() => { if (!open) setShowFinished(false); }, [open]);
  if (!open || !position) return null;
  return createPortal(<section ref={panelRef} className="ab-subagents__panel is-portal" style={position} role="dialog" aria-label={label} data-testid="subagents-panel">
    <header className="ab-subagents__head"><button type="button" className="ab-subagents__who" data-testid="picker-main" title={heading.title} onClick={heading.onSelect}>{heading.identity}<span><small>AGENT ACTIVITY</small><strong>{heading.label}</strong></span></button><span className="ab-subagents__head-caption">{summary}</span>{onClose && <button type="button" className="ab-subagents__close" aria-label="Close agent activity" onClick={onClose}>×</button>}</header>
    {metrics && <div className="ab-subagents__metrics">{metrics.map(metric => <div key={metric.label} title={metric.title}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>}
    {note && <p className="ab-subagents__note" role="status">{note}</p>}
    {loading ? <p className="ab-subagents__empty">Loading…</p> : <div className="ab-subagents__body">
      {groups.map(group => group.title !== undefined ? <Group key={group.id} group={group}/> : <div key={group.id} className="ab-subagents__solo">{group.items.map(item => <Item key={item.id} item={item}/>)}</div>)}
      {idle && <p className="ab-subagents__empty">{emptyLabel}</p>}
      {utilities.length > 0 && <div className="ab-subagents__shells">{utilities.map(item => <span key={item.id} className="ab-subagents__shell" title={item.title}><i aria-hidden>▸</i>{item.label}<button type="button" aria-label={`Stop ${item.label}`} title="Stop" onClick={item.onStop}><StopIcon size={9}/></button></span>)}</div>}
      {finished.length > 0 && (showFinished ? <div className="ab-subagents__done-grid"><button type="button" className="ab-subagents__done" onClick={() => setShowFinished(false)}>✓ {finishedLabel} <ChevronUpIcon size={11}/></button><div className="ab-subagents__batch-grid">{finished.map(item => <Item key={item.id} item={item}/>)}</div></div> : <button type="button" className="ab-subagents__done" onClick={() => setShowFinished(true)}>✓ {finishedLabel}<span className="ab-subagents__stack">{finished.slice(0,6).map(item => <span key={item.id}>{item.compactIdentity ?? item.identity}</span>)}</span></button>)}
    </div>}
  </section>, document.body);
}
