import { useEffect, useRef, useState } from "react";
import { cn } from "@siso/shell";
import { ArrowUpRight, Cake, CalendarClock, Check, Copy, Folder, MapPin, MessageCircle, Pencil, Plus, Quote, Sparkles, TriangleAlert, UserRound, X } from "lucide-react";
import { ago, birthdayText, initials, isQuiet, lastContact, lastMs, LEVEL_WORD, LEVELS, parseBirthday, QUIET_DAYS, talkLine, type Fields, type Gap, type Level, type Op, type Person } from "./book";

type Props = {
  person: Person; people: Person[]; now: number; act: (op: Op) => Promise<{ id?: string }>;
  onClose: () => void; onOpen: (id: string) => void; projectHref: (p: { name: string }) => string;
  onAsk?: (words: string) => void; onOpenChat?: (key: string) => void;
};
const firstName = (p: Person) => (p.fullName ?? p.name).replace(/^[@+]/, "").split(/\s+/)[0];
/** Where each level may go next (the design's moves); every level can also go Off the Rolodex and back. */
const NEXT: Record<Level, Level[]> = {
  want: ["network"], network: ["friend", "partner", "client"], friend: ["family", "partner", "client", "network"], family: ["friend"],
  partner: ["client", "friend", "network"], client: ["partner", "friend", "network"], off: ["network", "friend", "family", "client", "partner", "want"],
};
export function whoLine(p: Person, now: number) {
  const parts = [`${p.fullName ?? p.name} — ${LEVEL_WORD[p.level].toLowerCase()}`];
  if (p.company || p.role) parts.push([p.role, p.company].filter(Boolean).join(" at "));
  if (p.from) parts.push(`from ${p.from}`);
  if (p.work?.projects.length) parts.push(`projects ${p.work.projects.map((x) => x.name).join(", ")}`);
  const last = lastMs(p.talk);
  parts.push(last ? `WhatsApp ${ago(last, now)}` : "no WhatsApp yet");
  return parts.join(" · ");
}

const DAY = 86_400_000;
const monthYear = (at: string) => new Date(at).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
/** When a next step is due, in words: "2 d late", "today", "in 3 d". */
export function dueText(at: string | undefined, now: number) {
  if (!at) return "";
  const t = new Date(now), today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const d = Math.round((Date.parse(at.slice(0, 10)) - today) / DAY);
  return d < 0 ? `${-d} d late` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} d`;
}

/**
 * What matters first, in three cells: who they are to you, when you last spoke, and what is open. Every cell has an
 * honest empty ("No contact yet", "Nothing open") so a card with no details still reads as a card, not a blank.
 */
function Glance({ p, now, onNext }: { p: Person; now: number; onNext: () => void }) {
  const since = [...(p.history ?? [])].reverse().find((h) => h.to === p.level);
  const who = [p.role && p.company ? `${p.role} at ${p.company}` : p.role ?? p.company, p.level === "want" ? p.why : p.howMet && `met ${p.howMet.replace(/^met\s+/i, "")}`].filter(Boolean).join(" · ");
  const last = lastContact(p), quiet = isQuiet(p, now);
  const due = dueText(p.nextStepAt, now), late = /late/.test(due);
  return <div className="rolodex-glance" data-glance="">
    <div className="rolodex-glance__cell" data-glance-cell="who">
      <span className="rolodex-glance__label"><UserRound size={12} aria-hidden="true" />To you</span>
      <strong data-level={p.level}>{LEVEL_WORD[p.level]}{since ? <span> since {monthYear(since.at)}</span> : <span> · added {monthYear(p.added)}</span>}</strong>
      <span className="rolodex-glance__sub">{who || (p.level === "want" ? "Not met yet" : "How you know them isn't written down")}</span>
    </div>
    <div className={cn("rolodex-glance__cell", quiet && "is-quiet")} data-glance-cell="last">
      <span className="rolodex-glance__label"><MessageCircle size={12} aria-hidden="true" />Last contact</span>
      {last ? <><strong>{ago(last.at, now)}</strong><span className="rolodex-glance__sub">{quiet ? `Quiet: past ${QUIET_DAYS[p.level]} d for a ${LEVEL_WORD[p.level].toLowerCase()} · ` : ""}{last.how === "WhatsApp" ? talkLine(p.talk, now) : last.how}</span></>
        : <><strong className="is-none">No contact yet</strong><span className="rolodex-glance__sub">{p.level === "want" ? "Say hello somewhere they post" : "Log a call or a coffee below"}</span></>}
    </div>
    <div className={cn("rolodex-glance__cell", late && "is-late")} data-glance-cell="open">
      <span className="rolodex-glance__label"><CalendarClock size={12} aria-hidden="true" />Open</span>
      {p.nextStep ? <><strong className="rolodex-glance__step">{p.nextStep}</strong><span className="rolodex-glance__sub">{due ? (late ? `Due ${due.replace(" late", "")} ago · late` : `Due ${due}`) : "No date"}</span></>
        : <><strong className="is-none">Nothing open</strong><button type="button" className="rolodex-linkish rolodex-glance__sub" onClick={onNext}><Plus size={11} aria-hidden="true" />Add a next step</button></>}
    </div>
  </div>;
}

/** One person, Attio-style: who they are up top, everything you know on the left, what's next and what happened on the right. */
export function PersonPage({ person: p, people, now, act, onClose, onOpen, projectHref, onAsk, onOpenChat }: Props) {
  const [error, setError] = useState("");
  // The "N to fill in" chip opens the first empty field; the Glance's "Add a next step" focuses the step box.
  const [openGap, setOpenGap] = useState<Gap | null>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const save = async (fields: Fields) => { setError(""); try { await act({ op: "update", id: p.id, fields }); } catch (e) { setError((e as Error).message); throw e; } };
  const last = lastMs(p.talk);
  const field = (key: keyof Fields, label: string, hint: string, opts: { parse?: (v: string) => string | null; show?: (v: string) => string } = {}) =>
    <Field key={key} label={label} hint={hint} value={(p as Record<string, unknown>)[key] as string | undefined} gap={p.gaps.includes(key as never)} open={openGap === key} onClosed={() => setOpenGap(null)}
      show={opts.show} onSave={async (v) => {
        const parsed = v && opts.parse ? opts.parse(v) : v;
        if (v && opts.parse && !parsed) throw new Error(`Couldn't read “${v}” as a date — try “3 March” or “3 March 1994”`);
        await save({ [key]: parsed || null });
      }} />;
  const via = p.work?.via ? people.find((x) => x.name === p.work!.via) : undefined;
  const timeline = [
    ...(p.touches ?? []).map((t) => ({ at: t.at, text: t.note, kind: "touch" as const })),
    ...(p.history ?? []).map((h) => ({ at: h.at, text: h.from === "inbox" ? `Placed in ${LEVEL_WORD[h.to]} from WhatsApp` : h.from ? `${LEVEL_WORD[h.from]} → ${LEVEL_WORD[h.to]}` : `Added to ${LEVEL_WORD[h.to]}`, kind: "move" as const })),
    ...(last ? [{ at: new Date(last).toISOString(), text: `Last WhatsApp · ${talkLine(p.talk, now)}`, kind: "wa" as const }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return <article className="rolodex-person" data-level={p.level} aria-label={`${p.name}'s page`}>
    <button type="button" className="rolodex-person__close" aria-label="Close" onClick={onClose}><X size={16} /></button>
    <header className="rolodex-person__hero">
      <span className={cn("rolodex-tile is-hero", p.proposed && "is-proposed")} data-level={p.level} aria-hidden="true">{initials(p.fullName ?? p.name)}</span>
      <div className="rolodex-person__title">
        <EditableTitle value={p.name} onSave={(name) => save({ name })} />
        {p.fullName && p.fullName !== p.name && <p className="rolodex-person__full">{p.fullName}</p>}
        <div className="rolodex-person__chips">
          <LevelPicker level={p.level} proposed={p.proposed} onPick={(level) => save({ level })} onConfirm={() => save({ confirm: true })} />
          {(p.from || p.lives) && <span className="rolodex-chip is-static" title={p.from ?? p.lives}><MapPin size={12} aria-hidden="true" /><span>{p.from ?? p.lives}</span></span>}
          {p.birthday && <span className="rolodex-chip is-static"><Cake size={12} aria-hidden="true" />{birthdayText(p.birthday, now)}</span>}
          {p.gaps.length > 0 && <button type="button" className="rolodex-chip is-gap" onClick={() => {
            const g = p.gaps[0];
            if (g === "links") document.querySelector<HTMLInputElement>(".rolodex-person input[aria-label='Add a link']")?.focus();
            else setOpenGap(g);
          }}><Plus size={11} aria-hidden="true" />{p.gaps.length} to fill in</button>}
        </div>
      </div>
    </header>
    <Glance p={p} now={now} onNext={() => nextRef.current?.focus()} />
    <div className="rolodex-person__actions">
      {p.level === "want" && <button type="button" className="rolodex-btn is-primary" onClick={() => void save({ level: "network" })}><Check size={14} aria-hidden="true" />We've met → Network</button>}
      <button type="button" className={cn("rolodex-btn", p.level !== "want" && "is-primary")} disabled={!onAsk} title={onAsk ? undefined : "A0 is not available here"}
        onClick={() => onAsk?.(`about ${p.fullName ?? p.name} (${LEVEL_WORD[p.level].toLowerCase()}, from my Rolodex): `)}>Ask A0 about {firstName(p)}</button>
      {p.keys[0] && onOpenChat ? <button type="button" className="rolodex-btn" onClick={() => onOpenChat(p.keys[0])}><MessageCircle size={14} aria-hidden="true" />Open chat</button>
        : p.phone && /^\d{7,15}$/.test(p.phone) ? <a className="rolodex-btn" href={`https://wa.me/${p.phone}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden="true" />WhatsApp<ArrowUpRight size={13} aria-hidden="true" /></a> : null}
      {Object.entries(p.links ?? {}).filter(([, u]) => u).map(([k, u]) => <a key={k} className="rolodex-btn" href={u} target="_blank" rel="noopener noreferrer">{k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)}<ArrowUpRight size={13} aria-hidden="true" /></a>)}
      <button type="button" className="rolodex-btn" onClick={() => void navigator.clipboard?.writeText(whoLine(p, now)).catch(() => {})}><Copy size={14} aria-hidden="true" />Copy who-line</button>
    </div>
    {error && <p className="rolodex-person__error" role="alert">{error}</p>}
    <div className="rolodex-person__cols">
      <section className="rolodex-panel" aria-label="About">
        <h3>About</h3>
        {field("fullName", "Full name", "Add their full name")}
        {p.level === "want" && field("why", "Why", "Why you want to know them")}
        {field("from", "From", "Where they're from")}
        {field("lives", "Lives in", "Where they live now")}
        {p.level !== "want" && field("birthday", "Birthday", "e.g. 3 March 1994", { parse: parseBirthday, show: (v) => birthdayText(v, now) })}
        {field("company", "Company", "Where they work")}
        {field("role", "Role", "What they do")}
        {p.level !== "want" && field("howMet", "How you met", "Where or through whom")}
        <div className="rolodex-field is-static"><span>Phone</span><strong>{p.phone ? "+" + p.phone : <em>Not linked to WhatsApp</em>}</strong></div>
        <LinksField links={p.links} onSave={(links) => save({ links })} />
        {(via || p.work?.via) && <div className="rolodex-field is-static"><span>Introduced by</span>{via ? <button type="button" className="rolodex-chip" onClick={() => onOpen(via.id)}>{via.name}</button> : <strong>{p.work!.via}</strong>}</div>}
      </section>
      <div className="rolodex-person__right">
        <NextStep p={p} inputRef={nextRef} onSave={save} onDone={async () => { await act({ op: "touch", id: p.id, note: `Done: ${p.nextStep}` }); await save({ nextStep: null, nextStepAt: null }); }} />
        <Notes value={p.notes ?? ""} onSave={(notes) => save({ notes: notes || null })} />
        <section className="rolodex-panel" aria-label="Timeline">
          <h3>Timeline</h3>
          <TouchForm onAdd={(note, at) => act({ op: "touch", id: p.id, note, ...(at ? { at } : {}) }).then(() => undefined)} />
          {timeline.length ? <ol className="rolodex-timeline">{timeline.slice(0, 12).map((t, i) => <li key={i} data-kind={t.kind}><time>{new Date(t.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time><span>{t.text}</span></li>)}</ol>
            : <p className="rolodex-faint">Nothing yet. Log a call, a coffee, an intro.</p>}
        </section>
        {p.work && (p.work.projects.length > 0 || p.work.words?.length || p.work.careful) && <section className="rolodex-panel" aria-label="Work">
          <h3>Work</h3>
          {p.work.note && <p className="rolodex-faint">{p.work.note}</p>}
          {p.work.projects.map((x) => <a key={x.id} className="rolodex-proj" href={projectHref(x)}><Folder size={14} aria-hidden="true" /><span>{x.name}</span><em>{x.stage ?? x.kind.replace(/-/g, " ")}</em>{x.available && <ArrowUpRight size={13} aria-hidden="true" />}</a>)}
          {p.work.words?.map((w, i) => <blockquote key={i} className="rolodex-quote"><Quote size={13} aria-hidden="true" /><p>{w.text}</p></blockquote>)}
          {p.work.careful && <p className="rolodex-careful"><TriangleAlert size={13} aria-hidden="true" />{p.work.careful}</p>}
        </section>}
      </div>
    </div>
  </article>;
}

function EditableTitle({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [edit, setEdit] = useState(false), [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!edit) return <h2 className="rolodex-person__name"><button type="button" onClick={() => setEdit(true)} title="Rename">{value}<Pencil size={13} aria-hidden="true" /></button></h2>;
  const done = async () => { setEdit(false); if (v.trim() && v.trim() !== value) await onSave(v.trim()).catch(() => setV(value)); };
  return <input className="rolodex-person__nameinput" aria-label="Name" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void done()}
    onKeyDown={(e) => { if (e.key === "Enter") void done(); if (e.key === "Escape") { setV(value); setEdit(false); } }} />;
}

function LevelPicker({ level, proposed, onPick, onConfirm }: { level: Level; proposed?: boolean; onPick: (l: Level) => void; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const next = NEXT[level];
  return <div className="rolodex-level" ref={ref}>
    <button type="button" className={cn("rolodex-levelpill", proposed && "is-proposed")} data-level={level} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      {LEVEL_WORD[level]}{proposed && <span className="rolodex-levelpill__q">?</span>}
    </button>
    {proposed && <button type="button" className="rolodex-chip" onClick={onConfirm}><Check size={12} aria-hidden="true" />Yes, {LEVEL_WORD[level].toLowerCase()}</button>}
    {open && <div className="rolodex-menu" role="menu">
      <p>Move to</p>
      {next.map((l) => <button key={l} type="button" role="menuitem" data-level={l} onClick={() => { setOpen(false); onPick(l); }}><i aria-hidden="true" />{LEVEL_WORD[l]}<span>suggested</span></button>)}
      {[...LEVELS, "off" as const].filter((l) => l !== level && !next.includes(l)).map((l) => <button key={l} type="button" role="menuitem" data-level={l} onClick={() => { setOpen(false); onPick(l); }}><i aria-hidden="true" />{LEVEL_WORD[l]}</button>)}
    </div>}
  </div>;
}

/** A label and a value; click (or the Add hint) to edit inline. Enter saves, Escape cancels. */
function Field({ label, hint, value, gap, show, open, onClosed, onSave }: { label: string; hint: string; value?: string; gap?: boolean; show?: (v: string) => string; open?: boolean; onClosed?: () => void; onSave: (v: string) => Promise<void> }) {
  const [edit, setEditRaw] = useState(false), [v, setV] = useState(value ?? ""), [err, setErr] = useState("");
  const setEdit = (b: boolean) => { setEditRaw(b); if (!b) onClosed?.(); };
  useEffect(() => setV(value ?? ""), [value]);
  useEffect(() => { if (open) setEditRaw(true); }, [open]);
  const done = async () => {
    if (v.trim() === (value ?? "")) { setEdit(false); return; }
    try { await onSave(v.trim()); setEdit(false); setErr(""); } catch (e) { setErr((e as Error).message); }
  };
  return <div className={cn("rolodex-field", gap && !value && "is-gap")}>
    <span>{label}</span>
    {edit ? <span className="rolodex-field__edit"><input autoFocus aria-label={label} value={v} placeholder={hint} onChange={(e) => setV(e.target.value)} onBlur={() => void done()}
      onKeyDown={(e) => { if (e.key === "Enter") void done(); if (e.key === "Escape") { setV(value ?? ""); setEdit(false); setErr(""); } }} />{err && <small role="alert">{err}</small>}</span>
      : <button type="button" onClick={() => setEdit(true)}>{value ? (show ? show(value) : value) : <em>{gap ? "+ " : ""}{hint}</em>}</button>}
  </div>;
}

function LinksField({ links, onSave }: { links?: Person["links"]; onSave: (l: NonNullable<Person["links"]>) => Promise<void> }) {
  const [v, setV] = useState(""), [err, setErr] = useState("");
  const add = async () => {
    const u = v.trim(); if (!u) return;
    const url = /^https?:\/\//.test(u) ? u : "https://" + u;
    const key = /linkedin\.com/.test(url) ? "linkedin" : /(x|twitter)\.com/.test(url) ? "x" : /instagram\.com/.test(url) ? "instagram" : "site";
    try { await onSave({ ...(links ?? {}), [key]: url }); setV(""); setErr(""); } catch (e) { setErr((e as Error).message); }
  };
  const list = Object.entries(links ?? {}).filter(([, u]) => u);
  return <div className="rolodex-field">
    <span>Links</span>
    <span className="rolodex-field__links">
      {list.map(([k, u]) => <span key={k} className="rolodex-chip is-static"><a href={u} target="_blank" rel="noopener noreferrer">{k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)}</a>
        <button type="button" aria-label={`Remove ${k} link`} onClick={() => void onSave({ ...(links ?? {}), [k]: "" })}><X size={11} /></button></span>)}
      <input aria-label="Add a link" placeholder="+ Paste a LinkedIn, X, Instagram or site link" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} onBlur={() => void add()} />
      {err && <small role="alert">{err}</small>}
    </span>
  </div>;
}

function NextStep({ p, inputRef, onSave, onDone }: { p: Person; inputRef: React.RefObject<HTMLInputElement | null>; onSave: (f: Fields) => Promise<void>; onDone: () => Promise<void> }) {
  const [text, setText] = useState(p.nextStep ?? ""), [at, setAt] = useState(p.nextStepAt?.slice(0, 10) ?? "");
  useEffect(() => { setText(p.nextStep ?? ""); setAt(p.nextStepAt?.slice(0, 10) ?? ""); }, [p.nextStep, p.nextStepAt]);
  const dirty = text.trim() !== (p.nextStep ?? "") || at !== (p.nextStepAt?.slice(0, 10) ?? "");
  return <section className="rolodex-panel is-next" aria-label="Next step">
    <h3><Sparkles size={13} aria-hidden="true" />Next step</h3>
    <div className="rolodex-next">
      <input ref={inputRef} aria-label="Next step" placeholder={p.level === "want" ? "e.g. comment on their next post" : "e.g. send the proposal"} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) void onSave({ nextStep: text.trim() || null, nextStepAt: at || null }); }} />
      <input aria-label="When" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
      {dirty ? <button type="button" className="rolodex-btn is-primary" onClick={() => void onSave({ nextStep: text.trim() || null, nextStepAt: at || null })}>Save</button>
        : p.nextStep ? <button type="button" className="rolodex-btn" onClick={() => void onDone()}><Check size={14} aria-hidden="true" />Done</button> : null}
    </div>
    <p className="rolodex-faint">The Rolodex reminds you; it never messages anyone.</p>
  </section>;
}

function Notes({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value), [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const draft = useRef(value), saved = useRef(value), pending = useRef<Promise<void> | null>(null);
  const edited = useRef(0), confirmed = useRef(0);
  useEffect(() => {
    if (edited.current === confirmed.current) { draft.current = value; setV(value); }
    saved.current = value;
  }, [value]);
  const save = async () => {
    // Serialize blur saves, but keep typing responsive while the previous request/reload finishes.
    const request = (pending.current ?? Promise.resolve()).then(async () => {
      const submitted = draft.current.trim();
      const revision = edited.current;
      if (submitted === saved.current) { confirmed.current = revision; setState("saved"); return; }
      setState("saving");
      try {
        await onSave(submitted); saved.current = submitted;
        if (edited.current === revision) { confirmed.current = revision; draft.current = submitted; setV(submitted); setState("saved"); }
        else setState("");
      } catch { setState("error"); }
    });
    pending.current = request;
    await request;
    if (pending.current === request) pending.current = null;
  };
  return <section className="rolodex-panel" aria-label="Notes">
    <h3>Notes<span className="rolodex-faint" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved — try again" : ""}</span></h3>
    <textarea className="rolodex-notes" aria-label="Notes" placeholder="Anything worth remembering: kids' names, what they're into, what they asked for…" value={v} onChange={(e) => { edited.current++; draft.current = e.target.value; setV(e.target.value); setState(""); }} onBlur={() => void save()} rows={4} />
    {state === "error" && <button type="button" className="rolodex-btn" onClick={() => void save()}>Retry notes save</button>}
  </section>;
}

function TouchForm({ onAdd }: { onAdd: (note: string, at?: string) => Promise<void> }) {
  const [v, setV] = useState(""), [busy, setBusy] = useState(false);
  const add = async () => { if (!v.trim() || busy) return; setBusy(true); try { await onAdd(v.trim()); setV(""); } finally { setBusy(false); } };
  return <form className="rolodex-touch" onSubmit={(e) => { e.preventDefault(); void add(); }}>
    <input aria-label="Log a touch" placeholder="Log a touch: “called about the launch”" value={v} onChange={(e) => setV(e.target.value)} />
    <button type="submit" className="rolodex-btn" disabled={!v.trim() || busy}>Log</button>
  </form>;
}
