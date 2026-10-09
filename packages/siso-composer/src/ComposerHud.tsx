import { createPortal } from "react-dom";
import type { ContextSegment } from "./context-segments";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CompactDial, ContextMeter } from "./ContextMeter";
import "./hud.css";
import "./usage-ring.css";

export function ComposerHud({ variant = "rim", identity, context, usage, metrics, rate, activity, items, trailing }: {
  variant?: "rim" | "strip"; identity?: ReactNode; context?: ReactNode; usage?: ReactNode; metrics?: ReactNode; rate?: ReactNode; activity?: ReactNode; items?: ReactNode; trailing?: ReactNode;
}) {
  return <div className={`ab-hud is-${variant}`} data-testid="hud">{variant === "rim" ? <>{identity}{context}{usage}{metrics}{rate}{activity}</> : <><span className="ab-hud__left">{items}</span><span className="ab-hud__right">{trailing}</span></>}</div>;
}

export function ContextPopover({ value, onOpenChange, children, title, label = "Context and usage", compactAt = 75, segments, onCompactAt, compactReadOnlyReason, open: controlledOpen }: {
  value: number | null; onOpenChange?: (open: boolean) => void; children?: ReactNode; title?: ReactNode; label?: string; compactAt?: number; segments?: ContextSegment[]; open?: boolean; onCompactAt?: (pct: number) => void | Promise<void>; compactReadOnlyReason?: string;
}) {
  const [pendingCompact, setPendingCompact] = useState<number | null>(null);
  useEffect(() => { if (pendingCompact === compactAt) setPendingCompact(null); }, [compactAt, pendingCompact]);
  const [internalOpen,setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => { setInternalOpen(value); onOpenChange?.(value); };
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepOpen = () => { clearTimeout(leaveTimer.current); setOpen(true); };
  const leave = () => { leaveTimer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement) && document.activeElement !== trigger.current) setOpen(false); }, 180); };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [at,setAt] = useState({left:8,bottom:8,maxHeight:400});
  const close = () => {setOpen(false); trigger.current?.focus();};
  useLayoutEffect(() => {
    if(!open)return;
    const place = () => { const r=trigger.current?.getBoundingClientRect(); if(!r)return; const bottom=Math.max(8,Math.min(innerHeight-160,innerHeight-r.top+8)); setAt({left:Math.max(8,Math.min(r.left,innerWidth-Math.min(350,innerWidth-16)-8)),bottom,maxHeight:innerHeight-bottom-8}); };
    place(); window.addEventListener('resize',place); window.addEventListener('scroll',place,true);
    return () => {window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(() => {
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
    window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape,true);
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape,true);};
  },[open]);
  return <>
    <button ref={trigger} type="button" className="ab-context-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onPointerEnter={e=>{if(e.pointerType==='mouse')keepOpen();}} onPointerLeave={leave} onFocus={e=>{if(!panel.current?.contains(e.relatedTarget as Node))keepOpen();}} onClick={()=>{keepOpen();requestAnimationFrame(()=>panel.current?.focus());}}><ContextMeter value={value} compactAt={compactAt} segments={segments}/></button>
    {open && createPortal(<div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Context breakdown" className="ab-hud__card ab-context-panel" style={at} onPointerEnter={keepOpen} onPointerLeave={leave} onKeyDown={e=>{
      if(e.key!=='Tab')return;
      const controls=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [href]')].filter(el=>el.getClientRects().length);
      if(!controls.length){e.preventDefault();return;}
      e.preventDefault(); const index=controls.indexOf(document.activeElement as HTMLElement);
      controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length]?.focus();
    }}><div className="ab-context-panel__heading"><b className="ab-hud__title">{title ?? `${value ?? "—"}% context`}</b><button type="button" aria-label="Close context breakdown" onClick={close}>×</button></div><CompactDial pending={pendingCompact} onPending={setPendingCompact} value={compactAt} onCommit={onCompactAt} readOnlyReason={compactReadOnlyReason}/>{children}</div>,document.body)}
  </>;
}

export type UsageWindow = { id: string; label: string; shortLabel: string; pct: number | null; resetDescription?: ReactNode };
const tone = (pct: number | null) => pct === null ? "is-none" : pct > 80 ? "is-bad" : pct >= 50 ? "is-warn" : "is-ok";
const textTone = (pct: number | null) => pct === null ? undefined : pct >= 80 ? "text-failed" : pct >= 60 ? "text-needs" : "text-done";

/** Unknown readings remain unknown; percentages and timestamps are provided by the caller. */
export function UsagePopover({ windows, freshness, children, label = "Usage limits" }: {
  windows: UsageWindow[]; freshness?: { label: string; detail: string } | null; children?: ReactNode; label?: string;
}) {
  const reported = windows.flatMap(w => w.pct === null ? [] : [w.pct]);
  const tightest = reported.length ? Math.max(...reported) : null;
  return <details onPointerEnter={e => { if (e.pointerType === "mouse") e.currentTarget.open = true; }} onPointerLeave={e => { if (e.pointerType === "mouse") e.currentTarget.open = false; }} className="ab-hud__detail ab-hud__usage">
    <summary aria-label={label}><i aria-hidden className={`ab-hud__ring ${tone(tightest)}`} style={{ ["--p" as string]: tightest ?? 0 }}/>{windows.map((window, i) => <Fragment key={window.id}>{i > 0 && <span aria-hidden>·</span>}<span className={textTone(window.pct)}>{window.shortLabel} {window.pct === null ? "—" : `${window.pct}%`}</span></Fragment>)}{freshness && <span className="ab-hud__stale" title={freshness.detail}>{freshness.label}</span>}</summary>
    <div className="ab-hud__card">{children}</div>
  </details>;
}

/** The existing token-page ring material, now available to composer consumers without importing an app page. */
export function UsageRing({ pct, size = 44, label, sub }: { pct: number | null; size?: number; label: string; sub?: ReactNode }) {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const r = (size - 6) / 2, circumference = 2 * Math.PI * r;
  const tone = pct === null ? "none" : p >= 90 ? "bad" : p >= 70 ? "warn" : "ok";
  return <span className="ab-ring" data-tone={tone} data-testid="ring" title={typeof sub === "string" ? `${label} · ${sub}` : label}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden><circle cx={size/2} cy={size/2} r={r} className="ab-ring__track"/><circle cx={size/2} cy={size/2} r={r} className="ab-ring__fill" strokeDasharray={`${p/100*circumference} ${circumference}`} transform={`rotate(-90 ${size/2} ${size/2})`}/><text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{pct === null ? "—" : `${Math.round(p)}%`}</text></svg>
    <span className="ab-ring__text"><b>{label}</b>{sub && <small>{sub}</small>}</span>
  </span>;
}

export function UsageRingCard({ windows, note, children }: { windows: UsageWindow[]; note?: ReactNode; children?: ReactNode }) {
  return <><div className="ab-hud__rings">{windows.map(window => <UsageRing key={window.id} pct={window.pct} label={window.label} sub={window.resetDescription}/>)}</div>{note && <p className="ab-hud__pace">{note}</p>}{children}</>;
}
