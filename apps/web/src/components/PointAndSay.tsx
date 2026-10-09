import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { feedbackCrop, feedbackTarget, type FeedbackTarget } from "../lib/feedback";
import { MicButton } from "./MicButton";
import "./PointAndSay.css";

type Note = { target: FeedbackTarget; crop: Promise<string | undefined>; focus: HTMLElement | null };
const noHotkey = () => false;

export function PointAndSay() {
  const [held, setHeld] = useState(false), [toggled, setToggled] = useState(false);
  const [hover, setHover] = useState<FeedbackTarget | null>(null), [note, setNote] = useState<Note | null>(null);
  const [words, setWords] = useState(""), [saving, setSaving] = useState(false), [saved, setSaved] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: innerWidth, height: innerHeight });
  const field = useRef<HTMLInputElement>(null), popup = useRef<HTMLFormElement>(null);
  const state = useRef({ held, toggled, hover, note, saving }); state.current = { held, toggled, hover, note, saving };
  const timers = useRef<{ alt?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});
  const abort = useRef<AbortController | null>(null), mounted = useRef(false);
  const cancel = () => {
    if (state.current.saving) return;
    const focus = state.current.note?.focus;
    setNote(null); setHover(null); setWords(""); setSaved(null); setError(null);
    focus?.focus({ preventScroll: true });
  };
  const actions = useRef({ cancel, send: () => {} }); actions.current.cancel = cancel;

  useEffect(() => {
    mounted.current = true;
    let altDown = false, otherKey = false, point = { x: 0, y: 0 };
    const selecting = () => (state.current.held || state.current.toggled) && !state.current.note;
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const clearAlt = () => { clearTimeout(timers.current.alt); timers.current.alt = undefined; setHeld(false); };
    const pick = () => setHover(feedbackTarget(document.elementFromPoint(point.x, point.y)));
    const down = (e: KeyboardEvent) => {
      if ((e.code === "Period" || e.key === "." || e.key === ">") && e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey) { stop(e); clearAlt(); setToggled(v => !v); pick(); return; }
      if (e.key === "Alt" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        altDown = true; otherKey = false;
        const el = document.activeElement;
        const selected = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.selectionStart !== el.selectionEnd;
        if (selected || (el instanceof HTMLElement && el.isContentEditable && !window.getSelection()?.isCollapsed)) return;
        timers.current.alt = setTimeout(() => { if (altDown && !otherKey) { setHeld(true); pick(); } }, 250);
        return;
      }
      if (e.key !== "Alt" && altDown && !state.current.note) { otherKey = true; clearAlt(); }
      if (state.current.note) {
        if (e.key === "Escape") { stop(e); actions.current.cancel(); }
        else if (e.key === "Enter" && e.target === field.current && !e.isComposing) { stop(e); actions.current.send(); }
        else if (e.key === "Tab") {
          const items = [...(popup.current?.querySelectorAll<HTMLElement>('input,button:not([disabled]),[tabindex="0"]') ?? [])];
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { stop(e); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { stop(e); first?.focus(); }
        }
        // App shortcuts must not navigate away while a note is being written.
        else if (e.metaKey || e.ctrlKey || e.altKey) e.stopImmediatePropagation();
      } else if (selecting() && e.key === "Escape") { stop(e); clearAlt(); setToggled(false); setHover(null); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === "Alt") { altDown = false; clearAlt(); } };
    const move = (e: PointerEvent) => { point = { x: e.clientX, y: e.clientY }; if (selecting()) { pick(); stop(e); } };
    const pointer = (e: PointerEvent) => {
      if (popup.current?.contains(e.target as Node)) return;
      if (selecting()) {
        stop(e);
        const target = feedbackTarget(document.elementFromPoint(e.clientX, e.clientY));
        if (target) { setHover(target); setWords(""); setError(null); setSaved(null); setNote({ target, crop: feedbackCrop(target), focus: document.activeElement as HTMLElement | null }); }
      } else if (state.current.note) stop(e);
    };
    const block = (e: Event) => { if ((state.current.held || state.current.toggled || state.current.note) && !popup.current?.contains(e.target as Node)) stop(e); };
    const blur = () => { altDown = false; clearAlt(); setToggled(false); setHover(null); };
    const resize = () => {
      const v = window.visualViewport;
      setViewport({ left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? innerWidth, height: v?.height ?? innerHeight });
      if (selecting()) pick();
    };
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true);
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerdown", pointer, true);
    for (const name of ["click", "dblclick", "contextmenu", "pointerup", "wheel", "touchstart", "touchmove"]) window.addEventListener(name, block, { capture: true, passive: false });
    window.addEventListener("blur", blur); window.addEventListener("resize", resize); window.addEventListener("scroll", resize, true);
    window.visualViewport?.addEventListener("resize", resize); window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      mounted.current = false; abort.current?.abort(); clearTimeout(timers.current.alt); clearTimeout(timers.current.close);
      window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerdown", pointer, true);
      for (const name of ["click", "dblclick", "contextmenu", "pointerup", "wheel", "touchstart", "touchmove"]) window.removeEventListener(name, block, true);
      window.removeEventListener("blur", blur); window.removeEventListener("resize", resize); window.removeEventListener("scroll", resize, true);
      window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, []);
  useEffect(() => { if (note) field.current?.focus({ preventScroll: true }); }, [note]);
  // t-0571: the crosshair keys off a body attribute. A `body:has(...) *` rule made WebKit re-run :has() for every element
  // it restyled, every frame, while the app sat idle.
  const pointing = (held || toggled) && !note;
  useEffect(() => {
    document.body.toggleAttribute("data-ab-pointing", pointing);
    return () => document.body.removeAttribute("data-ab-pointing");
  }, [pointing]);

  const send = async () => {
    if (!note || !words.trim() || saving || saved) return;
    setSaving(true); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const png = await Promise.race([note.crop, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1200); })]);
    clearTimeout(timer);
    const controller = new AbortController(); abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ comp: note.target.comp, part: note.target.part, words, ...(png ? { png } : {}), url: location.href, viewport: { width: innerWidth, height: innerHeight } }) });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error || "Couldn't save. Press Enter to retry.");
      if (!mounted.current) return;
      setSaved(body.task);
      timers.current.close = setTimeout(() => { const focus = note.focus; setNote(null); setHover(null); setWords(""); setSaved(null); focus?.focus({ preventScroll: true }); }, 1500);
    } catch (e) { if (mounted.current) { setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Couldn't save. Press Enter to retry."); field.current?.focus({ preventScroll: true }); } }
    finally { clearTimeout(timeout); if (mounted.current) setSaving(false); }
  };
  actions.current.send = () => { void send(); };

  const target = note?.target ?? hover;
  if (!held && !toggled && !note) return null;
  const r = target?.rect;
  const width = Math.min(320, viewport.width - 24);
  const left = r ? Math.max(viewport.left + 12, Math.min(r.left, viewport.left + viewport.width - width - 12)) : 12;
  const height = error ? 170 : 112;
  const top = r ? Math.max(viewport.top + 12, Math.min(r.top + r.height + 12 + height <= viewport.top + viewport.height - 12 ? r.top + r.height + 12 : r.top - height - 12, viewport.top + viewport.height - height - 12)) : 12;
  const tagWidth = Math.min(360, viewport.width - 24, (target?.label.length ?? 0) * 6.7 + 16);
  const tagLeft = r ? Math.max(viewport.left + 12, Math.min(r.left, viewport.left + viewport.width - tagWidth - 12)) : 12;
  const tagTop = r ? Math.max(viewport.top + 8, Math.min(r.top >= viewport.top + 32 ? r.top - 30 : r.top + r.height + 10, viewport.top + viewport.height - 32)) : 8;
  return createPortal(<div className="ab-feedback" data-ab-feedback data-testid="point-and-say" data-writing={!!note}>
    {r && <><div className="ab-feedback__outline" style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />
      {!note && <span className="ab-feedback__tag" data-testid="feedback-tag" title={target?.label} style={{ left: tagLeft, top: tagTop, maxWidth: tagWidth }}>{target?.label}</span>}</>}
    {note && <form ref={popup} className="ab-feedback__note" role="dialog" aria-label={note.target.label} aria-modal="true" style={{ left, top, width }} onSubmit={e => { e.preventDefault(); void send(); }} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); cancel(); } }}>
      <div className="ab-feedback__name" title={note.target.label}>{note.target.label}</div>
      {saved ? <p className="ab-feedback__saved" role="status" data-testid="feedback-saved">Saved · {saved}</p> : <>
        <div className="ab-feedback__input"><input ref={field} aria-label="What's off?" placeholder="What's off?" value={words} maxLength={8000} readOnly={saving} onChange={e => setWords(e.target.value)} />
          <MicButton label="Dictate feedback" hotkey={noHotkey} disabled={saving} onText={text => { setWords(v => v ? `${v} ${text}` : text); field.current?.focus(); }} />
        </div>
        <div className="ab-feedback__keys" role="status">{saving ? "Saving…" : <><span>Enter to save</span><span>Esc to cancel</span></>}</div>
        {error && <p className="ab-feedback__error" role="alert">{error}</p>}
      </>}
    </form>}
  </div>, document.body);
}
