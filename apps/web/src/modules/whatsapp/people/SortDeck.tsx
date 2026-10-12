import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@siso/shell";
import { Archive, ArrowRight, CornerDownLeft, ListChecks, Mic, PartyPopper, Undo2 } from "lucide-react";
import { birthdayText, GAP_ASK, initials, LEVEL_WORD, LEVELS, parseLine, postOp, talkLine, type BookView, type Fields, type Gap, type InboxRow, type Level, type Person, type useRolodexBook } from "./book";

type Book = ReturnType<typeof useRolodexBook>;
const FIELD_WORD: Record<string, string> = { fullName: "Full name", from: "From", lives: "Lives in", birthday: "Birthday", howMet: "Met", company: "Company", role: "Role", why: "Why", notes: "Note", name: "Name" };
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable); };

function ParsedChips({ level, fields, now }: { level?: Level; fields: Fields; now: number }) {
  const list = Object.entries(fields).filter(([k, v]) => typeof v === "string" && v && k in FIELD_WORD);
  if (!level && !list.length) return null;
  return <div className="rolodex-parsed" aria-live="polite">
    {level && <span className="rolodex-chip is-static" data-level={level}>{LEVEL_WORD[level]}</span>}
    {list.map(([k, v]) => <span key={k} className="rolodex-chip is-static"><b>{FIELD_WORD[k]}</b> {k === "birthday" ? birthdayText(v as string, now) : v as string}</span>)}
  </div>;
}

const CHOICES: Level[] = [...LEVELS, "off"];
type Placed = { key: string; row: InboxRow; level: Level; id?: string; ok?: boolean; done: Promise<string | undefined> };
type Ghost = { n: number; row: InboxRow; dir: "place" | "skip"; level?: Level };

/**
 * The ask-Shaan step: one WhatsApp chat at a time, most-talked-to first. Keys 1–6 place it, X puts it off the Rolodex,
 * ↑↓ move the choice and Enter takes it, → skips, ← takes the last one back. The line takes a dictated sentence
 * ("friend, Ahmed Khan, from Manchester, birthday 3 March").
 *
 * Triage never waits for the node: a key advances the card at once and the saves go out one after another behind it,
 * with one reload when they have all landed. (It used to lock the card until each save and reload came back, so keys
 * pressed faster than the node answered were dropped: 2 of 8 landed in the 9 Oct measure.)
 */
export function SortDeck({ book, data, onOpen, onGo }: { book: Book; data: BookView; onOpen: (id: string) => void; onGo?: (s: "gaps" | "all") => void }) {
  const now = useMemo(() => Date.now(), [data]);
  const [, setTick] = useState(0);
  const render = () => setTick((t) => t + 1);
  // Refs, not state, so two keys inside one frame still see each other's card.
  const gone = useRef(new Set<string>()), skipped = useRef<string[]>([]), back = useRef<InboxRow[]>([]), placed = useRef<Placed[]>([]);
  const chain = useRef<Promise<unknown>>(Promise.resolve()), pending = useRef(0);
  const [line, setLine] = useState(""), [error, setError] = useState("");
  const [choice, setChoice] = useState<{ key: string; i: number } | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null), [dir, setDir] = useState<"fwd" | "back">("fwd");
  const input = useRef<HTMLInputElement>(null);
  const queueNow = (): InboxRow[] => {
    const seen = new Set<string>(), s = new Set(skipped.current), list: InboxRow[] = [];
    for (const r of [...back.current, ...data.inbox]) if (!gone.current.has(r.key) && !seen.has(r.key)) { seen.add(r.key); list.push(r); }
    return [...list.filter((r) => !s.has(r.key)), ...skipped.current.flatMap((k) => list.filter((r) => r.key === k))];
  };
  const queue = queueNow();
  const row: InboxRow | undefined = queue[0];
  const chosen = row ? (choice?.key === row.key ? choice.i : Math.max(0, CHOICES.indexOf(row.proposal.level))) : 0;
  const parsed = parseLine(line);
  /** Queue one save behind the others; reload once the line is empty. */
  const send = <T,>(job: () => Promise<T>): Promise<T | undefined> => {
    pending.current++;
    const p = chain.current.then(job).catch((e: Error) => { setError(e.message); return undefined; }).finally(() => {
      if (--pending.current === 0) void book.reload();
    });
    chain.current = p;
    return p;
  };
  const place = (level: Level, extra: Fields = {}) => {
    const r = queueNow()[0];
    if (!r) return;
    const voiced = !!line.trim(), fields = { ...parsed.fields, ...extra };
    gone.current.add(r.key); skipped.current = skipped.current.filter((k) => k !== r.key);
    const entry: Placed = { key: r.key, row: r, level, done: Promise.resolve(undefined) };
    entry.done = send(async () => {
      try {
        if (level === "off" && !Object.keys(fields).length) { await postOp({ op: "dismiss", key: r.key }); entry.ok = true; return undefined; }
        const res = await postOp({ op: "place", key: r.key, level, fields });
        entry.id = res.id; entry.ok = true; render();
        return res.id;
      } catch (e) {
        // Not saved: the card comes back to the front with the node's words.
        gone.current.delete(r.key); back.current = [r, ...back.current.filter((x) => x.key !== r.key)];
        placed.current = placed.current.filter((x) => x !== entry); render();
        throw e;
      }
    });
    placed.current = [entry, ...placed.current];
    setGhost({ n: Date.now(), row: r, dir: "place", level }); setDir("fwd");
    setLine(""); setError(""); render();
    if (voiced) input.current?.focus();
  };
  const skip = () => {
    const r = queueNow()[0];
    if (!r) return;
    skipped.current = [...skipped.current.filter((k) => k !== r.key), r.key];
    setGhost({ n: Date.now(), row: r, dir: "skip" }); setDir("fwd");
    setLine(""); setError(""); render();
  };
  const undo = () => {
    const last = placed.current[0];
    if (!last) return;
    placed.current = placed.current.slice(1);
    gone.current.delete(last.key); back.current = [last.row, ...back.current.filter((x) => x.key !== last.key)];
    skipped.current = skipped.current.filter((k) => k !== last.key);
    setGhost(null); setDir("back"); setError(""); render();
    void send(async () => {
      const id = await last.done;
      if (!last.ok) return; // it never landed, so there is nothing to take back
      await postOp(id ? { op: "unplace", id } : { op: "undismiss", key: last.key });
    });
  };
  const submit = () => {
    if (parsed.skip) return skip();
    const level = parsed.level ?? (Object.keys(parsed.fields).length ? row?.proposal.level : undefined);
    if (level) place(level);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter" && (e.target as HTMLElement | null)?.closest("button, a")) return;
      const n = Number(e.key), r = queueNow()[0];
      const at = r ? (choice?.key === r.key ? choice.i : Math.max(0, CHOICES.indexOf(r.proposal.level))) : 0;
      if (n >= 1 && n <= 6) { e.preventDefault(); place(LEVELS[n - 1]); }
      else if (e.key === "x" || e.key === "X") { e.preventDefault(); place("off"); }
      else if (e.key === "s" || e.key === "S" || e.key === "ArrowRight") { e.preventDefault(); skip(); }
      else if (e.key === "u" || e.key === "U" || e.key === "ArrowLeft") { e.preventDefault(); undo(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && r) { e.preventDefault(); setChoice({ key: r.key, i: (at + (e.key === "ArrowDown" ? 1 : CHOICES.length - 1)) % CHOICES.length }); }
      else if (e.key === "Enter" && r) { e.preventDefault(); place(CHOICES[at]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const done = placed.current.length, total = queue.length + done;
  const tally = CHOICES.map((l) => [l, placed.current.filter((p) => p.level === l).length] as const).filter(([, n]) => n > 0);
  const gaps = data.people.filter((p) => p.level !== "off" && p.gaps.length).length;
  return <div className="rolodex-deck">
    <header className="rolodex-deck__head">
      <div><h1>Sort WhatsApp</h1><p role="status">{queue.length ? `${queue.length} to sort` : "All sorted"}{done ? ` · ${done} done this session` : ""}{skipped.current.length ? ` · ${skipped.current.length} skipped, coming round again` : ""} · most-talked-to first</p></div>
      <div className="rolodex-progress" aria-hidden="true"><i style={{ transform: `scaleX(${total ? done / total : 0})` }} /></div>
    </header>
    {data.whatsapp.state !== "live" && <p className="rolodex-error" role="alert">WhatsApp isn't answering, so there's nothing new to sort right now.</p>}
    {error && <p className="rolodex-person__error" role="alert">{error}</p>}
    {!row ? <div className="rolodex-done"><PartyPopper size={28} aria-hidden="true" /><h2>{data.whatsapp.state === "live" ? "Everyone's sorted" : "Waiting for WhatsApp"}</h2><p>{data.whatsapp.state === "live" ? "New WhatsApp chats will show up here." : "Try again when the connection is back."}</p>
      {tally.length > 0 && <p className="rolodex-done__tally">This session: {tally.map(([l, n]) => <span key={l} className="rolodex-chip is-static" data-level={l}><i />{n} {LEVEL_WORD[l]}</span>)}</p>}
      <div className="rolodex-done__btns">
        {done > 0 && <button type="button" className="rolodex-btn" onClick={undo}><Undo2 size={13} aria-hidden="true" />Undo last<kbd>←</kbd></button>}
        {onGo && gaps > 0 && <button type="button" className="rolodex-btn is-primary" onClick={() => onGo("gaps")}><ListChecks size={13} aria-hidden="true" />Fill the gaps · {gaps}</button>}
        {onGo && <button type="button" className="rolodex-btn" onClick={() => onGo("all")}>See everyone</button>}
      </div>
    </div> : <>
      <div className="rolodex-stage">
        {ghost && <article key={"g" + ghost.n} className="rolodex-sortcard is-leaving" data-dir={ghost.dir} aria-hidden="true" onAnimationEnd={() => setGhost((g) => (g?.n === ghost.n ? null : g))}>
          <div className="rolodex-sortcard__who">
            <span className="rolodex-tile is-hero" data-level={ghost.level ?? ghost.row.proposal.level}>{initials(ghost.row.name)}</span>
            <div><h2>{ghost.row.name}</h2></div>
          </div>
          <span className="rolodex-stamp" data-level={ghost.level}>{ghost.dir === "skip" ? "Skipped" : `→ ${LEVEL_WORD[ghost.level!]}`}</span>
        </article>}
        <article key={row.key} className="rolodex-sortcard" data-dir={dir} aria-label={`Sorting ${row.name}`}>
          <div className="rolodex-sortcard__who">
            <span className="rolodex-tile is-hero" data-level={row.proposal.level} aria-hidden="true">{initials(row.name)}</span>
            <div>
              <h2>{row.name}</h2>
              <p>{row.named && row.phone ? `+${row.phone} · ` : ""}{talkLine(row.talk, now)}</p>
              <p className="rolodex-sortcard__guess">Looks like <b data-level={row.proposal.level}>{LEVEL_WORD[row.proposal.level]}</b> · {row.proposal.reason}{row.proposal.confidence === "low" ? " (a guess)" : ""}</p>
            </div>
          </div>
          <div className="rolodex-levels" role="group" aria-label="Place on a level">
            {LEVELS.map((l, i) => <button key={l} type="button" data-level={l} data-chosen={chosen === i || undefined} className={cn(row.proposal.level === l && "is-guess")} onClick={() => place(l)}>
              <kbd>{i + 1}</kbd>{LEVEL_WORD[l]}</button>)}
            <button type="button" data-level="off" data-chosen={chosen === 6 || undefined} className={cn("is-off", row.proposal.level === "off" && "is-guess")} onClick={() => place("off")}><kbd>X</kbd><Archive size={13} aria-hidden="true" />Off the Rolodex</button>
          </div>
          <form className="rolodex-voice" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Mic size={15} aria-hidden="true" />
            <input ref={input} aria-label="Say who they are" placeholder="Say it: “friend, Ahmed Khan, from Manchester, birthday 3 March”" value={line} onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setLine(""); input.current?.blur(); } }} />
            <button type="submit" className="rolodex-btn" disabled={!line.trim()}><CornerDownLeft size={13} aria-hidden="true" />Place</button>
          </form>
          <ParsedChips level={parsed.level} fields={parsed.fields} now={now} />
          <footer className="rolodex-sortcard__foot">
            <span className="rolodex-keys"><kbd>1</kbd>–<kbd>6</kbd> place · <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> take it · <kbd>→</kbd> skip · <kbd>←</kbd> undo</span>
            <span className="rolodex-sortcard__btns">
              <button type="button" className="rolodex-btn" onClick={undo} disabled={!done}><Undo2 size={13} aria-hidden="true" />Undo</button>
              <button type="button" className="rolodex-btn" onClick={skip}>Skip<ArrowRight size={13} aria-hidden="true" /></button>
            </span>
          </footer>
        </article>
      </div>
      {queue.length > 1 && <p className="rolodex-deck__next">Next: {queue.slice(1, 4).map((r) => r.name).join(" · ")}{queue.length > 4 ? ` · ${queue.length - 4} more` : ""}</p>}
    </>}
    {done > 0 && <div className="rolodex-recent"><h3>Just placed</h3>{placed.current.slice(0, 6).map((p) => <button key={p.key} type="button" className="rolodex-chip" disabled={!p.id} onClick={() => p.id && onOpen(p.id)}>
      <i data-level={p.level} />{p.row.name} · {LEVEL_WORD[p.level]}</button>)}</div>}
  </div>;
}

const GAP_ORDER: Level[] = ["family", "friend", "client", "partner", "network", "want"];
/** Fill the gaps: the same one-card deck for people already placed, one question at a time, only what their level needs. */
export function GapsDeck({ book, data, onOpen }: { book: Book; data: BookView; onOpen: (id: string) => void }) {
  const now = Date.now();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [line, setLine] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const queue = useMemo(() => {
    const items = data.people.filter((p) => p.level !== "off" && p.gaps.length).flatMap((p) => p.gaps.map((g) => ({ p, g })));
    items.sort((a, b) => GAP_ORDER.indexOf(a.p.level) - GAP_ORDER.indexOf(b.p.level) || (b.p.talk?.messages ?? 0) - (a.p.talk?.messages ?? 0) || a.p.name.localeCompare(b.p.name));
    const s = new Set(skipped);
    const k = (x: { p: Person; g: Gap }) => `${x.p.id}:${x.g}`;
    return [...items.filter((x) => !s.has(k(x))), ...skipped.flatMap((key) => items.filter((x) => k(x) === key))];
  }, [data.people, skipped]);
  const cur = queue[0];
  const skip = () => { if (cur && !busy) { const key = `${cur.p.id}:${cur.g}`; setSkipped((s) => [...s.filter((k) => k !== key), key]); setLine(""); setError(""); } };
  useEffect(() => { input.current?.focus(); }, [cur?.p.id, cur?.g]);
  const parsed = cur ? parseLine(line, cur.g) : { fields: {} as Fields };
  const save = async () => {
    if (!cur || busy || !line.trim()) return;
    if (parsed.skip) { skip(); return; }
    const fields: Fields = { ...parsed.fields };
    if (cur.g === "links") {
      const u = line.trim(); const url = /^https?:\/\//.test(u) ? u : "https://" + u;
      const key = /linkedin\.com/.test(url) ? "linkedin" : /(x|twitter)\.com/.test(url) ? "x" : /instagram\.com/.test(url) ? "instagram" : "site";
      fields.links = { ...(cur.p.links ?? {}), [key]: url }; delete fields.notes; delete fields.fullName;
    }
    if (cur.g === "birthday" && fields.birthday && !/^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}$/.test(fields.birthday)) { setError(`Couldn't read “${line.trim()}” as a date — try “3 March” or “3 March 1994”`); return; }
    if (parsed.level) fields.level = parsed.level;
    setBusy(true); setError("");
    try { await book.act({ op: "update", id: cur.p.id, fields }); setLine(""); setDone((n) => n + 1); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="rolodex-deck">
    <header className="rolodex-deck__head">
      <div><h1>Fill the gaps</h1><p role="status">{queue.length} questions{done ? ` · ${done} answered this session` : ""} · family and friends first</p></div>
    </header>
    {!cur ? <div className="rolodex-done"><PartyPopper size={28} aria-hidden="true" /><h2>No gaps left</h2><p>Every card has what its level needs.</p></div> : <>
      <article key={`${cur.p.id}:${cur.g}`} className="rolodex-sortcard" data-dir="fwd" aria-label={`${cur.p.name}: ${GAP_ASK[cur.g]}`}>
        <div className="rolodex-sortcard__who">
          <span className="rolodex-tile is-hero" data-level={cur.p.level} aria-hidden="true">{initials(cur.p.fullName ?? cur.p.name)}</span>
          <div>
            <h2><button type="button" className="rolodex-linkish" onClick={() => onOpen(cur.p.id)}>{cur.p.name}</button></h2>
            <p>{LEVEL_WORD[cur.p.level]}{cur.p.fullName ? ` · ${cur.p.fullName}` : ""}{cur.p.from ? ` · ${cur.p.from}` : ""} · {talkLine(cur.p.talk, now)}</p>
          </div>
        </div>
        <p className="rolodex-ask">{GAP_ASK[cur.g]}</p>
        <form className="rolodex-voice" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Mic size={15} aria-hidden="true" />
          <input ref={input} aria-label={GAP_ASK[cur.g]} placeholder={cur.g === "birthday" ? "e.g. 3 March, or 3 March 1994" : cur.g === "links" ? "linkedin.com/in/…" : "Type or dictate; “skip” to skip"} value={line} onChange={(e) => setLine(e.target.value)} />
          <button type="submit" className="rolodex-btn is-primary" disabled={busy || !line.trim()}><CornerDownLeft size={13} aria-hidden="true" />Save</button>
        </form>
        <ParsedChips level={parsed.level} fields={parsed.fields} now={now} />
        {error && <p className="rolodex-person__error" role="alert">{error}</p>}
        <footer className="rolodex-sortcard__foot">
          <span>Say more than one thing at once: “from Leeds, birthday 3 March”</span>
          <span className="rolodex-sortcard__btns"><button type="button" className="rolodex-btn" disabled={busy} onClick={skip}>Skip<ArrowRight size={13} aria-hidden="true" /></button></span>
        </footer>
      </article>
      {queue.length > 1 && <p className="rolodex-deck__next">Next: {queue.slice(1, 4).map((x) => `${x.p.name} (${GAP_ASK[x.g].replace(/\?$/, "").toLowerCase()})`).join(" · ")}</p>}
    </>}
  </div>;
}
