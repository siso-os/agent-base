import { memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@siso/shell";
import { SideNav, SideSection } from "@siso/side-nav";
import { Archive, BookUser, Briefcase, Cake, CalendarClock, ChevronDown, Handshake, Heart, Inbox, Link2, ListChecks, Network, RotateCw, Search, Sparkles, Users, type LucideIcon } from "lucide-react";
import { LivingIcon } from "../../../../packages/halo-face/LivingIcon";
import { ago, daysToBirthday, initials, isQuiet, LEVEL_LINE, LEVEL_PLURAL, LEVEL_WORD, LEVELS, lastMs, QUIET_DAYS, rank, searchIndex, type BookView, type Level, type Person, type useRolodexBook } from "./rolodex/book";
import { PersonPage } from "./rolodex/PersonPage";
import { GapsDeck, SortDeck } from "./rolodex/SortDeck";
import "./RolodexSpace.css";

export { useRolodexBook } from "./rolodex/book";
export type RolodexBook = ReturnType<typeof useRolodexBook>;
/** What the side nav selects: a deck, a level, everyone, the archive, or what's coming up. */
export type RolodexSelection = "sort" | "gaps" | "all" | "coming" | Level;
export type RolodexProject = { name: string };

const ICON: Record<Level, LucideIcon> = { client: Briefcase, partner: Handshake, friend: Heart, family: Users, network: Network, want: Sparkles, off: Archive };

/** Birthdays in the next 30 days and next steps due within a week (or overdue), soonest first. */
export function comingUp(people: Person[], now: number) {
  const out: { person: Person; kind: "birthday" | "step"; days: number; text: string }[] = [];
  for (const p of people) {
    if (p.level === "off") continue;
    const b = daysToBirthday(p.birthday, now);
    if (b !== undefined && b <= 30) out.push({ person: p, kind: "birthday", days: b, text: b === 0 ? "Birthday today" : b === 1 ? "Birthday tomorrow" : `Birthday in ${b} d` });
    if (p.nextStep && p.nextStepAt) {
      const d = Math.round((Date.parse(p.nextStepAt) - now) / 86_400_000);
      if (d <= 7) out.push({ person: p, kind: "step", days: d, text: d < 0 ? `${p.nextStep} · ${-d} d late` : d === 0 ? `${p.nextStep} · today` : `${p.nextStep} · in ${d} d` });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
export { isQuiet };

/** The Rolodex's side nav, in the same SideNav as Voice and Life: the two decks, the six levels, then what's coming up. */
export function RolodexSidebar({ book, selected, onSelect, onOpen }: { book: RolodexBook; selected: RolodexSelection; onSelect: (s: RolodexSelection) => void; onOpen: (id: string) => void }) {
  const d = book.data;
  // One clock per book: a fresh Date.now() each render made the memo below recompute on every App render.
  const now = useMemo(() => Date.now(), [d]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, gaps: 0 };
    for (const p of d?.people ?? []) { c[p.level] = (c[p.level] ?? 0) + 1; if (p.level !== "off") { c.all++; if (p.gaps.length) c.gaps++; } }
    return c;
  }, [d]);
  const soon = useMemo(() => comingUp(d?.people ?? [], now).slice(0, 5), [d, now]);
  const link = (id: RolodexSelection, label: string, Icon: LucideIcon, count?: number, tone?: string) => (
    <button key={id} type="button" aria-current={selected === id ? "page" : undefined} onClick={() => onSelect(id)} data-nav={id}
      className={cn("siso-sidebar__nav-link w-full text-left", selected === id && "is-active")}>
      <Icon aria-hidden="true" style={tone ? { color: `var(--rx-${tone})` } : undefined} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11.5px] font-normal tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );
  return (
    <SideNav label="Rolodex" storeKey="rolodex-sidebar-width" rootProps={{ "data-rolodex-nav": "true" }}
      footer={<div className="rolodex-navfoot" role="status">{d ? d.whatsapp.state === "live" ? `WhatsApp live · ${d.whatsapp.chats} chats` : "WhatsApp not reachable: placed people only" : book.error ? "Not read" : "Reading…"}</div>}>
      <SideSection title="Rolodex" note={d ? `${counts.all} people` : undefined}>
        <nav aria-label="Rolodex pages" className="flex flex-col gap-0.5 px-1">
          {link("sort", "Sort WhatsApp", Inbox, d?.inbox.length)}
          {link("gaps", "Fill the gaps", ListChecks, counts.gaps)}
          {link("all", "Everyone", BookUser, counts.all)}
        </nav>
      </SideSection>
      <SideSection title="Levels">
        <nav aria-label="Levels" className="flex flex-col gap-0.5 px-1">
          {LEVELS.map((l) => link(l, LEVEL_PLURAL[l], ICON[l], counts[l] ?? 0, l))}
          {!!(counts.off || d?.offCount) && link("off", "Off the Rolodex", Archive, d?.offCount ?? counts.off)}
        </nav>
      </SideSection>
      {soon.length > 0 && <SideSection title="Coming up" note={<button type="button" className="rolodex-navmore" onClick={() => onSelect("coming")}>All</button>}>
        <div className="flex flex-col gap-0.5 px-1">
          {soon.map((s) => <button key={s.person.id + s.kind} type="button" className="siso-sidebar__nav-link w-full text-left" onClick={() => onOpen(s.person.id)}>
            {s.kind === "birthday" ? <Cake aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{s.person.name}<span className="rolodex-navsub"> · {s.text}</span></span>
          </button>)}
        </div>
      </SideSection>}
    </SideNav>
  );
}

export type RolodexMainProps = {
  book: RolodexBook; selected: RolodexSelection; onSelect: (s: RolodexSelection) => void;
  person: string | null; onPerson: (id: string | null) => void;
  projectHref: (p: RolodexProject) => string; onAsk?: (words: string) => void; onOpenChat?: (key: string) => void;
};

/** The main pane: a deck, or a clean list with the person page beside it. */
export function RolodexMain({ book, selected, onSelect, person, onPerson, projectHref, onAsk, onOpenChat }: RolodexMainProps) {
  const [iconActive, setIconActive] = useState(false);
  // "Search everyone" from a level keeps the words typed (PeopleView remounts per page).
  const [carry, setCarry] = useState("");
  useEffect(() => { if (carry) setCarry(""); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = book.data;
  const pages: [RolodexSelection, string][] = [["all", "Everyone"], ["sort", "Sort WhatsApp"], ["gaps", "Fill the gaps"], ...LEVELS.map((l): [RolodexSelection, string] => [l, LEVEL_PLURAL[l]]), ["off", "Off the Rolodex"], ["coming", "Coming up"]];
  return <section className="rolodex-space" aria-label="Rolodex">
    <label className="rolodex-mobile-nav">Rolodex
      <select aria-label="Rolodex page" value={selected} onChange={(e) => { onPerson(null); onSelect(e.target.value as RolodexSelection); }}>
        {pages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
    {!d ? <>
    <Head title="Rolodex" sub={book.error ? "" : "Reading your people…"} icon={iconActive} setIcon={setIconActive} />
    {book.error ? <div className="rolodex-error" role="alert"><span>{book.error}</span><button type="button" className="rolodex-btn" onClick={() => void book.reload()}><RotateCw size={14} aria-hidden="true" />Try again</button></div>
      : <div className="rolodex-skel" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <div key={i}><span /><i /></div>)}</div>}
    </> : selected === "sort" ? <SortDeck book={book} data={d} onOpen={(id) => { onSelect("all"); onPerson(id); }} onGo={(s) => { onPerson(null); onSelect(s); }} />
      : selected === "gaps" ? <GapsDeck book={book} data={d} onOpen={(id) => { onSelect("all"); onPerson(id); }} />
      : <PeopleView key={selected} book={book} data={d} selected={selected} person={person} onPerson={onPerson} onSelect={onSelect} initialQuery={carry} onCarry={(q) => { setCarry(q); onPerson(null); onSelect("all"); }}
        projectHref={projectHref} onAsk={onAsk} onOpenChat={onOpenChat} icon={iconActive} setIcon={setIconActive} />}
  </section>;
}

function Head({ title, sub, icon, setIcon, children }: { title: string; sub: string; icon: boolean; setIcon: (b: boolean) => void; children?: React.ReactNode }) {
  return <header className="rolodex-header">
    <div className="rolodex-heading" onPointerEnter={() => setIcon(true)} onPointerLeave={() => setIcon(false)}>
      <LivingIcon name="rolodex" size={32} active={icon} />
      <div><h1>{title}</h1>{sub && <p role="status">{sub}</p>}</div>
    </div>
    {children}
  </header>;
}

type Sort = "level" | "az" | "recent";
/** Rows painted on the keystroke; the rest follow a frame later as an interruptible update. */
const FIRST_ROWS = 60;
type Item = { kind: "head"; key: string; label: string; count: number; level?: Level } | { kind: "person"; p: Person };
const firstLetter = (p: Person) => { const c = (p.name.replace(/^[@+]/, "")[0] ?? "#").toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };

function PeopleView({ book, data, selected, person, onPerson, onSelect, projectHref, onAsk, onOpenChat, icon, setIcon, initialQuery, onCarry }: Omit<RolodexMainProps, "selected"> & { data: BookView; selected: Exclude<RolodexSelection, "sort" | "gaps">; icon: boolean; setIcon: (b: boolean) => void; initialQuery: string; onCarry: (q: string) => void }) {
  const now = useMemo(() => Date.now(), [data]);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<Sort>(selected === "all" ? "level" : "az");
  const search = useRef<HTMLInputElement>(null);
  // The box echoes every keystroke at once; the 500-row list follows a beat behind and never blocks typing.
  const deferred = useDeferredValue(query);
  const q = deferred.trim().toLowerCase();
  const index = useMemo(() => searchIndex(data.people), [data.people]);
  const soon = useMemo(() => comingUp(data.people, now), [data, now]);
  const scope = useMemo(() => selected === "coming" ? [...new Map(soon.map((s) => [s.person.id, s.person])).values()]
    : data.people.filter((p) => (selected === "all" ? p.level !== "off" : p.level === selected)), [data.people, selected, soon]);
  const rows = useMemo(() => {
    if (q) {
      const hits: [Person, number][] = [];
      for (const p of scope) { const r = rank(index.get(p.id), q); if (r >= 0) hits.push([p, r]); }
      return hits.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name)).map(([p]) => p);
    }
    if (selected === "coming") return scope;
    const az = (a: Person, b: Person) => a.name.localeCompare(b.name);
    return [...scope].sort(sort === "recent" ? (a, b) => (lastMs(b.talk) ?? 0) - (lastMs(a.talk) ?? 0) || az(a, b)
      : sort === "level" ? (a, b) => LEVELS.indexOf(a.level as never) - LEVELS.indexOf(b.level as never) || az(a, b) : az);
  }, [scope, q, index, selected, sort]);
  /** Rows with their headers: his six levels in his order, or A–Z letters. Searching drops the headers: best match first. */
  const items = useMemo<Item[]>(() => {
    if (q || selected === "coming" || sort === "recent") return rows.map((p) => ({ kind: "person", p }));
    const out: Item[] = [];
    let last = "";
    const counts = sort === "level" ? rows.reduce<Record<string, number>>((c, p) => ((c[p.level] = (c[p.level] ?? 0) + 1), c), {}) : {};
    for (const p of rows) {
      const g = sort === "level" ? p.level : firstLetter(p);
      if (g !== last) { out.push(sort === "level" ? { kind: "head", key: g, label: LEVEL_PLURAL[p.level], count: counts[g], level: p.level } : { kind: "head", key: g, label: g, count: 0 }); last = g; }
      out.push({ kind: "person", p });
    }
    return out;
  }, [rows, q, selected, sort]);
  // A new search, grouping or page paints its first rows at once and the rest a frame later. A reload of the same view
  // (after a save) keeps every row, so the scroll position holds.
  const viewKey = `${selected}|${sort}|${q}`;
  const [grownKey, setGrownKey] = useState("");
  const visible = grownKey === viewKey || items.length <= FIRST_ROWS ? items : items.slice(0, FIRST_ROWS);
  useEffect(() => {
    if (grownKey === viewKey) return;
    let t = 0;
    const r = requestAnimationFrame(() => { t = window.setTimeout(() => startTransition(() => setGrownKey(viewKey)), 0); });
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [viewKey, grownKey]);
  const elsewhere = useMemo(() => {
    if (!q || rows.length || selected === "all") return 0;
    let n = 0; for (const p of data.people) if (p.level !== "off" && rank(index.get(p.id), q) >= 0) n++;
    return n;
  }, [q, rows.length, selected, data.people, index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Kept mounted while hidden (t-0497): only an on-screen Rolodex takes "/".
      if (!search.current?.getClientRects().length) return;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) { e.preventDefault(); search.current?.focus(); search.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const current = person ? data.people.find((p) => p.id === person) ?? null : null;
  const title = selected === "all" ? "Everyone" : selected === "coming" ? "Coming up" : LEVEL_PLURAL[selected];
  const total = scope.length, people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const sub = q ? `${rows.length} of ${people(total)} match` : selected === "all" ? `${people(total)} across six levels` : selected === "coming" ? "Birthdays in the next 30 days and next steps due this week" : `${total} · ${LEVEL_LINE[selected]}`;
  const move = (by: number) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.id === person);
    const next = rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? -1 : i) + by))];
    onPerson(next.id);
    requestAnimationFrame(() => document.querySelector(`.rolodex-list [data-person="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  };
  return <>
    <Head title={title} sub={sub} icon={icon} setIcon={setIcon}>
      {selected === "want" && <WantBar book={book} onAdded={(id) => onPerson(id)} />}
    </Head>
    <div className={cn("rolodex-body", current && "has-person")}>
      <div className="rolodex-col" onKeyDown={(e) => {
        const inSearch = e.target === search.current;
        if (!inSearch && (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); } else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter" && inSearch && rows.length) { e.preventDefault(); onPerson((rows.find((r) => r.id === person) ?? rows[0]).id); }
        else if (e.key === "Escape") { if (query) setQuery(""); else onPerson(null); }
      }}>
        <div className="rolodex-tools">
          <label className="rolodex-search"><Search size={15} aria-hidden="true" /><span className="rolodex-sr-only">Search people</span>
            <input ref={search} type="search" placeholder="Search name, place, company, notes" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!query && <kbd aria-hidden="true">/</kbd>}</label>
          {selected !== "coming" && <span className="rolodex-sort" role="group" aria-label="Group by">
            {selected === "all" && <button type="button" aria-pressed={sort === "level"} onClick={() => setSort("level")}>Levels</button>}
            <button type="button" aria-pressed={sort === "az"} onClick={() => setSort("az")}>A–Z</button>
            <button type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>Recent</button>
          </span>}
        </div>
        {rows.length ? <div className={cn("rolodex-list", query.trim().toLowerCase() !== q && "is-stale")} role="listbox" aria-label="People" data-rolodex-results="" data-query={q} data-count={rows.length}>
          <Rows items={visible} q={q} now={now} person={person} grouped={sort === "level" && !q} showLevel={(selected === "all" && (sort !== "level" || !!q)) || selected === "coming"}
            soon={selected === "coming" ? soon : undefined} onOpen={onPerson} />
        </div> : <Empty selected={selected} query={q} data={data} elsewhere={elsewhere} onSelect={onSelect} onCarry={() => onCarry(query)} />}
      </div>
      {current && <PersonPage key={current.id} person={current} people={data.people} now={now} act={book.act} onClose={() => onPerson(null)} onOpen={onPerson}
        projectHref={projectHref} onAsk={onAsk} onOpenChat={onOpenChat} />}
    </div>
  </>;
}

/** The rows, memoised apart from the page: a keystroke's first render (just the box) skips all 500 of them. */
const Rows = memo(function Rows({ items, q, now, person, grouped, showLevel, soon, onOpen }: { items: Item[]; q: string; now: number; person: string | null; grouped: boolean; showLevel: boolean; soon?: ReturnType<typeof comingUp>; onOpen: (id: string) => void }) {
  return <>{items.map((it) => it.kind === "head"
    ? <div key={"h:" + it.key} className="rolodex-divider" role="presentation" data-group={grouped ? it.key : undefined} data-level={it.level}>
      {it.level && <i aria-hidden="true" />}{it.label}{grouped && <span>· {it.count}</span>}</div>
    : <PersonRow key={it.p.id} p={it.p} now={now} q={q && it.p.name.toLowerCase().includes(q) ? q : ""} selected={it.p.id === person} showLevel={showLevel}
      note={soon ? soon.filter((s) => s.person.id === it.p.id).map((s) => s.text).join(" · ") : undefined} onOpen={onOpen} />)}</>;
});

/** The matched letters of a name, marked. */
function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/** One row. Memoised: a keystroke re-renders only the rows whose match changed, not all 500. */
export const PersonRow = memo(function PersonRow({ p, now, q = "", selected, showLevel, note, onOpen }: { p: Person; now: number; q?: string; selected: boolean; showLevel: boolean; note?: string; onOpen: (id: string) => void }) {
  const last = lastMs(p.talk);
  const line = note ?? [p.fullName && p.fullName !== p.name ? p.fullName : "", p.company, p.from ?? p.lives, p.level === "want" ? p.why : p.work?.note].filter(Boolean).join(" · ");
  return <div className="rolodex-row" role="option" aria-selected={selected} tabIndex={0} data-person={p.id} onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(p.id); }}>
    <span className={cn("rolodex-tile", p.proposed && "is-proposed")} data-level={p.level} aria-hidden="true">{initials(p.name)}</span>
    <span className="rolodex-row__text">
      <span className="rolodex-row__name"><span className="rolodex-row__nm" title={p.name}><Marked text={p.name} q={q} /></span>{showLevel && <span className="rolodex-row__level" data-level={p.level}>{LEVEL_WORD[p.level]}</span>}</span>
      <span className="rolodex-row__line">{line || (p.gaps.length ? `${p.gaps.length} to fill in` : " ")}</span>
    </span>
    <span className="rolodex-row__right">
      {isQuiet(p, now) && <span className="rolodex-quietdot" title={`Quiet: past ${QUIET_DAYS[p.level]} d`} />}
      {last ? <span className="rolodex-row__age" title={`Last WhatsApp ${ago(last, now)}`}>{ago(last, now)}</span> : p.links && Object.values(p.links).some(Boolean) ? <Link2 size={13} aria-label="Has a profile link" /> : null}
    </span>
  </div>;
});

function Empty({ selected, query, data, elsewhere, onSelect, onCarry }: { selected: RolodexSelection; query: string; data: BookView; elsewhere: number; onSelect: (s: RolodexSelection) => void; onCarry: () => void }) {
  const sortBtn = data.inbox.length > 0 && <button type="button" className="rolodex-btn is-primary" onClick={() => onSelect("sort")}><Inbox size={14} aria-hidden="true" />Sort {data.inbox.length} WhatsApp chats</button>;
  if (query) return <div className="rolodex-empty"><Search size={22} aria-hidden="true" /><p>No one matches “{query}”{selected === "all" ? "." : ` in ${selected === "coming" ? "Coming up" : LEVEL_PLURAL[selected as Level]}.`}</p>
    {elsewhere > 0 && <button type="button" className="rolodex-btn" onClick={onCarry}><Users size={14} aria-hidden="true" />{elsewhere} in other levels: search everyone</button>}</div>;
  if (!data.people.some((p) => p.level !== "off")) return <div className="rolodex-empty is-book"><BookUser size={26} aria-hidden="true" />
    <h2>Your Rolodex is empty</h2>
    <p>Six levels: clients, partners, friends, family, network, and people you want to know.{data.inbox.length ? " Start with the WhatsApp chats you talk to most." : data.whatsapp.state === "live" ? " New WhatsApp chats show up to sort." : " WhatsApp isn't answering, so there's nothing to sort yet."}</p>
    <div className="rolodex-empty__btns">{sortBtn}<button type="button" className="rolodex-btn" onClick={() => onSelect("want")}><Sparkles size={14} aria-hidden="true" />Add someone to know</button></div>
  </div>;
  return <div className="rolodex-empty"><Users size={22} aria-hidden="true" />
    <p>{selected === "want" ? "No one yet. Paste a LinkedIn, X or Instagram link above." : selected === "coming" ? "Nothing coming up. Add birthdays and next steps and they show here." : "No one on this level yet."}</p>
    {selected !== "want" && selected !== "coming" && sortBtn}
  </div>;
}

/** Want to know: paste a profile link → a card. Parsed on the node; nothing is fetched and no one is messaged. */
function WantBar({ book, onAdded }: { book: RolodexBook; onAdded: (id: string) => void }) {
  const [url, setUrl] = useState(""), [why, setWhy] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const add = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setError("");
    try { const r = await book.act({ op: "want", url: url.trim(), ...(why.trim() ? { why: why.trim() } : {}) }); setUrl(""); setWhy(""); if (r.id) onAdded(r.id); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <form className="rolodex-want" onSubmit={(e) => { e.preventDefault(); void add(); }}>
    <Link2 size={15} aria-hidden="true" />
    <input aria-label="Profile link" placeholder="Paste a LinkedIn, X or Instagram link" value={url} onChange={(e) => setUrl(e.target.value)} />
    <input aria-label="Why you want to know them" placeholder="Why? (optional)" value={why} onChange={(e) => setWhy(e.target.value)} className="is-why" />
    <button type="submit" className="rolodex-btn is-primary" disabled={busy || !url.trim()}>{busy ? "Adding…" : "Add"}</button>
    {error && <span className="rolodex-want__error" role="alert">{error}</span>}
  </form>;
}
