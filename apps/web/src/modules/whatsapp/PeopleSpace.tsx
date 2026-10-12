import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Archive, Cake, CalendarClock, ChevronDown, Inbox, ListChecks, Loader2, MessageCircle, Moon, RotateCw, Search, UserPlus } from "lucide-react";
import { LivingIcon } from "../../../../../packages/halo-face/LivingIcon";
import { age, initials, isQuiet, lastContact, LEVEL_LINE, LEVEL_PLURAL, LEVEL_WORD, LEVELS, rank, searchIndex, type Level, type Person, type useRolodexBook } from "./people/book";
import { comingUp, WantBar } from "./people/RolodexSpace";
import { PersonPage } from "./people/PersonPage";
import { GapsDeck, SortDeck } from "./people/SortDeck";
import "./people/RolodexSpace.css";

// People, the Rolodex inside Communications (Shaan, 10 Oct: "Merge Rolodex and WhatsApp ... I like the WhatsApp UI quite a
// lot"): the same halo-rim list card, search, filter tabs, sections and rows as Chats, with the person page, the sort deck
// and the gaps deck in the main pane. The book, the person page and the decks are the Rolodex v3 parts, unchanged.

type Book = ReturnType<typeof useRolodexBook>;
type Filter = "all" | Level;
export type PeoplePane = { kind: "home" } | { kind: "person"; id: string } | { kind: "sort" } | { kind: "gaps" } | { kind: "coming" };

/** The level colours as rgb triples, so a person's avatar is tinted by their level the way a chat's is by its name. */
const LEVEL_TONE: Record<Level, string> = { client: "56 189 248", partner: "255 167 38", friend: "52 195 143", family: "244 114 182", network: "167 139 250", want: "240 176 63", off: "158 158 152" };
export const levelTone = (l: Level) => ({ "--wa-tone": LEVEL_TONE[l] }) as CSSProperties;
const SHOWN = 40;

export function PeopleSpace({ book, pane, onPane, onOpenChat, onAsk, active }: {
  book: Book; pane: PeoplePane; onPane: (p: PeoplePane) => void; onOpenChat: (key: string) => void; onAsk?: (words: string) => void; active: boolean;
}) {
  const d = book.data;
  const now = useMemo(() => Date.now(), [d]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState<Record<string, number>>({});
  const search = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query);
  const q = deferred.trim().toLowerCase();
  const people = d?.people ?? [];
  const index = useMemo(() => searchIndex(people), [people]);
  const placed = useMemo(() => people.filter((p) => p.level !== "off"), [people]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const p of people) c[p.level] = (c[p.level] ?? 0) + 1; return c; }, [people]);
  const soon = useMemo(() => comingUp(people, now), [people, now]);
  const gaps = useMemo(() => placed.filter((p) => p.gaps.length).length, [placed]);
  const recent = (a: Person, b: Person) => (lastContact(b)?.at ?? 0) - (lastContact(a)?.at ?? 0) || a.name.localeCompare(b.name);
  const scope = useMemo(() => people.filter((p) => (filter === "all" ? p.level !== "off" : p.level === filter)), [people, filter]);
  const hits = useMemo(() => {
    if (!q) return null;
    const out: [Person, number][] = [];
    for (const p of scope) { const r = rank(index.get(p.id), q); if (r >= 0) out.push([p, r]); }
    return out.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name)).map(([p]) => p);
  }, [scope, q, index]);
  // Without a search: one section per level in his order, most recently in touch first, like chats.
  const sections = useMemo(() => (filter === "all" ? LEVELS : [filter]).map((l) => ({ level: l, rows: scope.filter((p) => p.level === l).sort(recent) })).filter((s) => s.rows.length),
    [scope, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const openId = pane.kind === "person" ? pane.id : null;
  const current = openId ? people.find((p) => p.id === openId) ?? null : null;
  const flat = hits ?? sections.flatMap((s) => (folded[s.level] ? [] : s.rows.slice(0, more[s.level] ?? SHOWN)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!active || !search.current?.getClientRects().length) return;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) { e.preventDefault(); search.current?.focus(); search.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  const move = (by: number) => {
    if (!flat.length) return;
    const i = flat.findIndex((p) => p.id === openId);
    const next = flat[Math.max(0, Math.min(flat.length - 1, (i < 0 ? -1 : i) + by))];
    onPane({ kind: "person", id: next.id });
    requestAnimationFrame(() => document.querySelector(`.wa-people [data-person="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  const tabs: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, ...LEVELS.map((l) => ({ id: l, label: l === "want" ? "Want" : LEVEL_PLURAL[l] }))];
  const row = (p: Person) => <PersonRow key={p.id} p={p} now={now} q={q} active={p.id === openId} showLevel={!!hits && filter === "all"} onOpen={(id) => onPane({ kind: "person", id })} />;

  return <section className={`wa-space wa-people${pane.kind !== "home" ? " has-open" : ""}`} aria-label="People">
    <aside className="wa-side siso-rim is-idle" aria-label="People list">
      <div className="wa-side-top">
        <div className="wa-brand"><LivingIcon name="rolodex" size={24} /><h1>People</h1>
          <span className={`wa-pill is-${d?.whatsapp.state === "live" ? "connected" : "needs_qr"}`} role="status"><span className="wa-dot" aria-hidden="true" />
            {d ? `${placed.length} people` : book.error ? "Not read" : "Reading…"}</span></div>
        <label className="wa-search"><Search size={15} aria-hidden="true" /><span className="wa-sr">Search people</span>
          <input ref={search} type="search" placeholder="Search name, place, company, notes" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); } else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
              else if (e.key === "Enter" && flat.length) { e.preventDefault(); onPane({ kind: "person", id: (flat.find((p) => p.id === openId) ?? flat[0]).id }); }
              else if (e.key === "Escape") { if (query) setQuery(""); else search.current?.blur(); }
            }} />
          {!query && <kbd aria-hidden="true">/</kbd>}</label>
        <div className="wa-tabs wa-chips" role="tablist" aria-label="Levels">
          {tabs.map(({ id, label }) => <button key={id} type="button" role="tab" className="wa-tab" aria-selected={filter === id} data-level={id === "all" ? undefined : id}
            onClick={() => { setFilter(id); setMore({}); }}>{id !== "all" && <i aria-hidden="true" />}{label}<small>{id === "all" ? placed.length : counts[id] ?? 0}</small></button>)}
        </div>
      </div>
      <div className="wa-side-scroll" data-rolodex-results="" data-query={q} data-count={hits?.length ?? scope.length}>
        {!d ? <div className="wa-side-note">{book.error ? <>{book.error} <button type="button" className="wa-link" onClick={() => void book.reload()}>Try again</button></> : "Reading your people…"}</div>
          : hits ? (hits.length ? <ul className="wa-menu">{hits.map(row)}</ul>
            : <p className="wa-side-note">No one matches “{query.trim()}”{filter !== "all" ? <> in {LEVEL_PLURAL[filter]}. <button type="button" className="wa-link" onClick={() => setFilter("all")}>Search everyone</button></> : "."}</p>)
          : <>
            {filter === "all" && <Section title="To do" folded={!!folded.todo} onFold={() => setFolded((f) => ({ ...f, todo: !f.todo }))}>
              <Tool icon={<Inbox size={15} />} label="Sort WhatsApp chats" sub="New chats to put on a level" count={d.inbox.length} active={pane.kind === "sort"} onClick={() => onPane({ kind: "sort" })} />
              <Tool icon={<ListChecks size={15} />} label="Fill the gaps" sub="Birthdays, companies, where they're from" count={gaps} active={pane.kind === "gaps"} onClick={() => onPane({ kind: "gaps" })} />
              <Tool icon={<CalendarClock size={15} />} label="Coming up" sub="Birthdays and next steps" count={soon.length} active={pane.kind === "coming"} onClick={() => onPane({ kind: "coming" })} />
            </Section>}
            {sections.map((s) => { const shown = more[s.level] ?? SHOWN; return <Section key={s.level} title={LEVEL_PLURAL[s.level]} count={s.rows.length} level={s.level} folded={!!folded[s.level]} onFold={() => setFolded((f) => ({ ...f, [s.level]: !f[s.level] }))}>
              {s.rows.slice(0, shown).map(row)}
              {s.rows.length > shown && <li><button type="button" className="wa-new-folder wa-more" onClick={() => setMore((m) => ({ ...m, [s.level]: shown + 200 }))}>Show {Math.min(200, s.rows.length - shown)} more of {(s.rows.length - shown).toLocaleString()}</button></li>}
            </Section>; })}
            {!sections.length && <p className="wa-side-note">{filter === "all" ? "No one on your levels yet. Start with Sort WhatsApp chats." : `No ${LEVEL_PLURAL[filter as Level].toLowerCase()} yet.`}</p>}
            {filter === "all" && !!(d.offCount || counts.off) && <button type="button" className="wa-new-folder" onClick={() => setFilter("off")}><Archive size={14} aria-hidden="true" />Off the Rolodex · {d.offCount ?? counts.off}</button>}
          </>}
      </div>
      {d && <footer className="wa-side-foot">
        <span>{d.whatsapp.state === "live" ? `WhatsApp live · ${d.whatsapp.chats.toLocaleString()} chats` : "WhatsApp not reachable: placed people only"}</span>
        <button type="button" className="wa-foot-btn" onClick={() => { setFilter("want"); onPane({ kind: "home" }); }}><UserPlus size={13} aria-hidden="true" />Add someone</button>
      </footer>}
    </aside>
    <main className="wa-main">
      <div className="rolodex-space wa-people-main">
        {!d ? <div className="wa-center" role="status">{book.error ? <><span>{book.error}</span><button type="button" className="rolodex-btn" onClick={() => void book.reload()}><RotateCw size={14} aria-hidden="true" />Try again</button></> : <><Loader2 className="wa-spin" size={22} aria-hidden="true" />Reading your people…</>}</div>
          : current ? <PersonPage key={current.id} person={current} people={people} now={now} act={book.act} onClose={() => onPane({ kind: "home" })} onOpen={(id) => onPane({ kind: "person", id })}
            projectHref={(p) => `#project/${encodeURIComponent(p.name)}`} onAsk={onAsk} onOpenChat={onOpenChat} />
          : pane.kind === "sort" ? <SortDeck book={book} data={d} onOpen={(id) => onPane({ kind: "person", id })} onGo={(s) => onPane(s === "gaps" ? { kind: "gaps" } : { kind: "home" })} />
          : pane.kind === "gaps" ? <GapsDeck book={book} data={d} onOpen={(id) => onPane({ kind: "person", id })} />
          : <Home people={placed} soon={soon} inbox={d.inbox.length} counts={counts} now={now} filter={filter} coming={pane.kind === "coming"} book={book}
            onPerson={(id) => onPane({ kind: "person", id })} onSort={() => onPane({ kind: "sort" })} onFilter={setFilter} />}
      </div>
    </main>
  </section>;
}

function Section({ title, count, level, folded, onFold, children }: { title: string; count?: number; level?: Level; folded: boolean; onFold: () => void; children: ReactNode }) {
  return <div className="wa-section" data-group={level}>
    <button type="button" className="wa-section-label" aria-expanded={!folded} onClick={onFold}>{level && <i className="wa-lvl-dot" style={levelTone(level)} aria-hidden="true" />}<span>{title}</span>{!!count && <b>{count.toLocaleString()}</b>}
      <span className="wa-chev" aria-hidden="true"><ChevronDown size={11} style={folded ? { transform: "rotate(-90deg)" } : undefined} /></span></button>
    {!folded && <ul className="wa-menu">{children}</ul>}
  </div>;
}

function Tool({ icon, label, sub, count, active, onClick }: { icon: ReactNode; label: string; sub: string; count: number; active: boolean; onClick: () => void }) {
  return <li className="wa-item"><button type="button" className="wa-btn wa-row wa-tool" data-active={active} aria-current={active ? "true" : undefined} onClick={onClick}>
    <span className="wa-tool-icon" aria-hidden="true">{icon}</span>
    <span className="wa-row-main"><span className="wa-row-top"><span className="wa-name">{label}</span></span><span className="wa-preview"><span className="wa-preview-text">{sub}</span>
      {count > 0 && <span className="wa-badge">{count > 999 ? "999+" : count}</span>}</span></span>
  </button></li>;
}

function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/** One person as a chat row: their level's colour on the avatar, what you know as the preview, how long since you spoke as the time. */
const PersonRow = memo(function PersonRow({ p, now, q, active, showLevel, onOpen }: { p: Person; now: number; q: string; active: boolean; showLevel: boolean; onOpen: (id: string) => void }) {
  const last = lastContact(p)?.at;
  const line = [p.fullName && p.fullName !== p.name ? p.fullName : "", p.company, p.from ?? p.lives, p.level === "want" ? p.why : p.work?.note].filter(Boolean).join(" · ");
  const quiet = isQuiet(p, now);
  return <li className="wa-item"><button type="button" className="wa-btn wa-row" data-person={p.id} data-active={active} aria-current={active ? "true" : undefined} onClick={() => onOpen(p.id)}>
    <span className={`wa-avatar is-sm${p.proposed ? " is-proposed" : ""}`} style={levelTone(p.level)} aria-hidden="true">{initials(p.name)}</span>
    <span className="wa-row-main">
      <span className="wa-row-top"><span className="wa-name" title={p.name}><Marked text={p.name} q={q && p.name.toLowerCase().includes(q) ? q : ""} /></span>
        {last ? <span className="wa-time" title={`Last in touch ${age(last, now)} ago`}>{age(last, now)}</span> : null}</span>
      <span className="wa-preview"><span className="wa-preview-text">{line || (p.gaps.length ? `${p.gaps.length} to fill in` : LEVEL_LINE[p.level])}</span>
        {showLevel && <span className="wa-lvl" style={levelTone(p.level)}>{LEVEL_WORD[p.level]}</span>}
        {quiet && <Moon size={12} className="wa-bell wa-quiet" aria-label="Gone quiet" />}
        {p.keys.length > 0 && !quiet && <MessageCircle size={12} className="wa-bell" aria-label="Has a WhatsApp chat" />}</span>
    </span>
  </button></li>;
});

// The launcher when no one is open, like the Chats home: what to do, what's coming up, who's gone quiet, the six levels.
function Home({ people, soon, inbox, counts, now, filter, coming, book, onPerson, onSort, onFilter }: { people: Person[]; soon: ReturnType<typeof comingUp>; inbox: number; counts: Record<string, number>; now: number; filter: Filter; coming: boolean; book: Book; onPerson: (id: string) => void; onSort: () => void; onFilter: (f: Filter) => void }) {
  const quiet = people.filter((p) => isQuiet(p, now)).sort((a, b) => (lastContact(a)?.at ?? 0) - (lastContact(b)?.at ?? 0)).slice(0, 9);
  const card = (p: Person, text: string, icon?: ReactNode) => <button key={p.id + text} type="button" className="wa-card" onClick={() => onPerson(p.id)}>
    <span className="wa-card-top"><span className="wa-avatar is-md" style={levelTone(p.level)} aria-hidden="true">{initials(p.name)}</span><span className="wa-card-name">{p.name}</span></span>
    <span className="wa-card-preview">{icon}{text}</span>
    <span className="wa-card-time">{LEVEL_WORD[p.level]}</span>
  </button>;
  return <div className="wa-home">
    <div className="wa-home-col">
      <header className="wa-home-head"><LivingIcon name="rolodex" size={44} active /><div><h2>{coming ? "Coming up" : "People"}</h2>
        <p>{coming ? "Birthdays in the next 30 days and next steps due this week" : `${people.length.toLocaleString()} people on six levels · ${inbox} WhatsApp chats to sort`}</p></div></header>
      {filter === "want" && !coming && <section><h3>Add someone to know</h3><WantBar book={book} onAdded={onPerson} /></section>}
      {inbox > 0 && !coming && <button type="button" className="wa-sort-cta" onClick={onSort}><Inbox size={18} aria-hidden="true" /><span><b>Sort {inbox} WhatsApp chats</b><small>Put each one on a level: client, partner, friend, family, network</small></span></button>}
      <section><h3>Coming up <b>{soon.length || ""}</b></h3>{soon.length ? <div className="wa-cards">{(coming ? soon : soon.slice(0, 6)).map((s) => card(s.person, s.text, s.kind === "birthday" ? <Cake size={12} aria-hidden="true" /> : <CalendarClock size={12} aria-hidden="true" />))}</div>
        : <p className="wa-home-note">Nothing coming up. Add birthdays and next steps on a person's page.</p>}</section>
      {!coming && quiet.length > 0 && <section><h3>Gone quiet <b>{quiet.length}</b></h3><div className="wa-cards">{quiet.map((p) => card(p, `Last in touch ${age(lastContact(p)!.at, now)} ago`, <Moon size={12} aria-hidden="true" />))}</div></section>}
      {!coming && <section><h3>Levels</h3><div className="wa-tiles">{LEVELS.map((l) => {
        const rows = people.filter((p) => p.level === l);
        return <button key={l} type="button" className="wa-tile" onClick={() => onFilter(l)} title={LEVEL_LINE[l]}>
          <i style={levelTone(l)} aria-hidden="true">{LEVEL_PLURAL[l][0]}</i><span className="wa-tile-name">{LEVEL_PLURAL[l]}</span>
          <span className="wa-tile-sub">{counts[l] ?? 0} · {LEVEL_LINE[l]}</span>
          <span className="wa-tile-faces">{rows.slice(0, 4).map((p) => <span key={p.id} className="wa-avatar is-sm" style={levelTone(p.level)} aria-hidden="true">{initials(p.name)}</span>)}</span>
        </button>; })}</div></section>}
    </div>
  </div>;
}
