// uihub: arc:command-palette; reuses the composer faces and HUD material.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronUpIcon } from "./icons";
import "./hud.css";
import "./model.css";

export type ModelOption = { id: string; label: string; description?: string; identity?: ReactNode; ratings?: { label: string; value: number }[] };
export type ModelSelection = {
  /** Observed value: selecting a button never mutates this value optimistically. */
  model: string | null; selectedId?: string; options: ModelOption[];
  effort?: string | null; efforts?: { id: string; label: string }[];
  disabledReason?: string | null; wrap?: boolean;
  onSelect: (id: string) => void | boolean; onEffort?: (id: string) => void;
};
export type ModelPickerProps = {
  label: string; compactLabel?: string; identity?: ReactNode; className?: string; selection?: ModelSelection;
  busy?: boolean; disabled?: boolean; title?: string; status?: ReactNode; note?: ReactNode; emptyLabel?: ReactNode;
  confirmationLabel?: string; menuClassName?: string; renderActions?: (close: () => void) => ReactNode; footer?: ReactNode;
  accountLabel?: string; accountDetails?: ReactNode; onOpenChange?: (open: boolean) => void;
};

export function ModelPicker({ label, compactLabel = label, identity, className = "ab-model", selection, busy = false, disabled = false, title, status, note, emptyLabel = "No models reported yet.", confirmationLabel = "Model updated", menuClassName = "ab-hud__menu", renderActions, footer, accountLabel, accountDetails, onOpenChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [query, setQuery] = useState("");
  const observedModel = useRef(selection?.model);
  const effortTrigger = useRef<HTMLButtonElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  const [focusEffort, setFocusEffort] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const close = () => { setOpen(false); (returnFocus.current ?? trigger.current)?.focus(); };
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    const previous = observedModel.current; observedModel.current = selection?.model;
    setConfirmed(!!previous && !!selection?.model && previous !== selection.model && !document.hidden);
    const timer = window.setTimeout(() => setConfirmed(false), 900);
    return () => window.clearTimeout(timer);
  }, [selection?.model]);
  useLayoutEffect(() => {
    if (!open) { setQuery(""); return; }
    const place = () => {
      const r = (returnFocus.current ?? trigger.current)?.getBoundingClientRect(); if (!r) return;
      const width = Math.min(380, window.innerWidth - 16);
      const bottom = Math.max(8, Math.min(window.innerHeight - 160, window.innerHeight - r.top + 8));
      setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), bottom, maxHeight: window.innerHeight - bottom - 8 });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open || !at) return;
    (focusEffort ? panel.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true]:not(:disabled)') ?? panel.current?.querySelector<HTMLElement>('[role=radio]:not(:disabled)') : panel.current?.querySelector<HTMLElement>('input') ?? panel.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
  }, [open, !!at, focusEffort]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !trigger.current?.contains(t) && !effortTrigger.current?.contains(t)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", away); window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", escape, true); };
  }, [open]);
  const selected = selection?.selectedId ?? selection?.model;
  const options = selection?.options.filter(model => `${model.label} ${model.id} ${model.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return <>
    <button ref={trigger} type="button" className={`${className}${open ? " is-open" : ""}`} data-testid="model-chip" data-confirmed={confirmed || undefined} aria-label={`${label}${accountLabel ? ` · ${accountLabel}` : ""}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} title={title ?? label} onClick={() => { returnFocus.current = trigger.current; setFocusEffort(false); setOpen(value => !value); }}>
      <span className="ab-model__identity" key={selection?.model ?? label}>{identity}</span>
      <span className="ab-model__full">{label}</span><span className="ab-model__short">{compactLabel}</span>
      {accountLabel && <span className="ab-model__account">{accountLabel}</span>}
      {status && <span className="ab-model__pending" role="status">{status}</span>}
      {confirmed && <CheckIcon className="ab-model__confirmed" size={12} aria-label={confirmationLabel}/>}
      {!disabled && <ChevronUpIcon size={11} aria-hidden/>}
    </button>
    {!!selection?.efforts?.length && selection.onEffort && !selection.disabledReason && <button ref={effortTrigger} type="button" className="ab-effort-trigger" data-testid="effort-chip" aria-haspopup="dialog" aria-expanded={open && focusEffort} aria-label={`Reasoning effort: ${selection.effort ?? 'not reported'}`} title="Reasoning effort · observed by host" disabled={disabled} onClick={() => {returnFocus.current=effortTrigger.current;setFocusEffort(true);setOpen(true);}}>{selection.effort ?? 'effort'}</button>}
    {open && at && createPortal(<div ref={panel} className={`${menuClassName} ab-model-panel`} role="dialog" aria-modal="true" aria-label="Model and accounts" data-testid="model-menu" style={at} onKeyDown={e => {
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled), summary, [href]')].filter(el => el.getClientRects().length);
      if (e.key === 'Tab') {
        e.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
        return;
      }
      const inEffort = (document.activeElement as HTMLElement)?.closest('[role="radiogroup"]');
      if (inEffort && ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)) {
        const radios = [...inEffort.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
        e.preventDefault(); const index=radios.indexOf(document.activeElement as HTMLButtonElement);
        radios[(index+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)+radios.length)%radios.length]?.focus(); return;
      }
      if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
      const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')];
      if (!rows.length) return;
      e.preventDefault(); const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      rows[(index + (e.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length].focus();
    }}>
      <div className="ab-model-panel__heading"><b>This chat</b><button type="button" aria-label="Close model picker" onClick={close}>×</button></div>
      {selection && <>
        <input className="ab-model-search" aria-label="Search models" placeholder="Search models…" value={query} onChange={e => setQuery(e.target.value)}/>
        <div className="ab-model-rows" role="menu" aria-label="Models in this harness">
          {options.map(model => { const current = selected === model.id; return <button key={model.id} type="button" role="menuitemradio" aria-checked={current} className={`ab-model-row${current ? " is-on" : ""}`} aria-label={model.label} disabled={!!selection.disabledReason || busy} title={selection.disabledReason ?? model.id} onClick={() => { if (current || busy) return; if (selection.onSelect(model.id) !== false) close(); }}>
            {model.identity}<span className="ab-model-row__text"><b>{model.label}</b><small>{model.description || model.id}</small></span>{current && <CheckIcon size={14} aria-label="Current model"/>}
          </button>; })}
        </div>
        {!options.length && <p className="ab-hud__note">{selection.options.length ? "No matching models." : emptyLabel}</p>}
        {!!selection.efforts?.length && <div className="ab-cast__effort" role="radiogroup" aria-label="Reasoning effort"><span>Reasoning</span><div>{selection.efforts.map((effort, index) => <button key={effort.id} type="button" role="radio" aria-checked={selection.effort === effort.id} className={selection.effort === effort.id ? "is-on" : undefined} style={{ ["--lvl" as string]: index }} disabled={busy || !!selection.disabledReason || !selection.onEffort} onClick={() => selection.onEffort?.(effort.id)}>{effort.label}</button>)}</div></div>}
        {note && <p className="ab-hud__note" role="status">{note}</p>}
      </>}
      {accountDetails}
      {renderActions && <details className="ab-model-move"><summary>Move to another harness</summary>{renderActions(close)}</details>}
      {footer}
    </div>, document.body)}
  </>;
}
