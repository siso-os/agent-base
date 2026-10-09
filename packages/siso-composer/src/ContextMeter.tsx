import { contextGradient, type ContextSegment } from "./context-segments";
import { useEffect, useRef, useState } from "react";
import "./hud.css";
import { compactDialValue } from "./compact-dial";

/** One measured value drives both the ring and its number. A newer reading interrupts from the painted value. */
export function ContextMeter({ value, label = "Context used", compactAt = 75, segments }: { segments?: ContextSegment[]; value: number | null; label?: string; compactAt?: number }) {
  const target = value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  const [painted, setPainted] = useState(target);
  const current = useRef(target);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    let visible = true;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const paint = (next: number | null) => { current.current = next; setPainted(next); };
    const run = () => {
      cancelAnimationFrame(frame);
      if (document.hidden || !visible || motion.matches || target === null || current.current === null) {
        paint(target);
        return;
      }
      const from = current.current, start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 650);
        paint(from + (target - from) * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; run(); });
    if (root.current) observer.observe(root.current);
    document.addEventListener("visibilitychange", run);
    motion.addEventListener("change", run);
    run();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", run);
      motion.removeEventListener("change", run);
    };
  }, [target]);
  const shown = target === null ? null : painted;
  const tone = shown === null ? "is-none" : shown > 80 ? "is-bad" : shown >= 50 ? "is-warn" : "is-ok";
  return <span ref={root} className={`ab-hud__ctx${target !== null && target >= compactAt ? " is-hot" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={target ?? undefined} aria-valuetext={target === null ? "Not reported" : `${target}%`}>
    <span className="ab-hud__context-ring" aria-hidden><i className={`ab-hud__ring ${tone}`} style={{ ["--p" as string]: shown ?? 0, background: contextGradient(shown, segments) }} /><i className="ab-hud__compact-mark" style={{ transform: `rotate(${compactAt * 3.6}deg)` }}/></span>
    <b aria-hidden>{shown === null ? "—" : `${Number(shown.toFixed(1))}%`}</b> <span aria-hidden className="ab-hud__k">ctx</span>
  </span>;
}

/** Shared control for the context popover; transport and provider wording belong to its caller. */
export function CompactDial({ value, onCommit, readOnlyReason, pending, onPending }: { pending: number | null; onPending: (pct: number | null) => void; value: number; onCommit?: (pct: number) => void | Promise<void>; readOnlyReason?: string }) {
  const [draft, setDraft] = useState(pending ?? value);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const pointer = useRef(false), sent = useRef(pending ?? value);
  useEffect(() => { setDraft(pending ?? value); sent.current = pending ?? value; }, [value, pending]);
  const commit = async (pct: number) => {
    if (pct === sent.current || sending) return;
    sent.current = pct; setSending(true); setError('');
    try { await onCommit?.(pct); onPending(pct); }
    catch (e) { sent.current = value; setDraft(value); setError(e instanceof Error ? e.message : 'Could not change compaction.'); }
    finally { setSending(false); }
  };
  return <div className="ab-compact-dial">
    <label><span>Compacts at <strong>{draft}%</strong></span>{onCommit && <input aria-label="Compaction threshold" type="range" min={10} max={90} step={1} value={draft} disabled={sending}
      onPointerDown={() => { pointer.current = true; }}
      onChange={e => setDraft(compactDialValue(Number(e.currentTarget.value), pointer.current ? 5 : 1))}
      onPointerUp={() => { pointer.current = false; void commit(draft); }}
      onPointerCancel={() => { pointer.current = false; setDraft(value); }}
      onKeyUp={e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)) void commit(draft); }}
      onBlur={() => { pointer.current = false; void commit(draft); }}/>}</label>
    {onCommit ? <><div className="ab-compact-dial__ends"><span>10%</span><span>90%</span></div><small role="status">{sending ? 'Requesting change…' : pending !== null ? `Pending ${pending}% — applies when the chat is next idle (it relaunches, keeping the conversation).` : 'Changes apply when the chat is next idle.'}</small></> : <small>{readOnlyReason ?? 'Compaction is managed by this runtime.'}</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
