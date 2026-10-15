import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, BookOpenText, FileText, MessageSquareText, Network, PlayCircle, Rss, UsersRound, X } from "lucide-react";
import { HubPage, Widget, WidgetGrid } from "../../components/page/HubPage";
import { useSharedResult } from "../../lib/poll";
import { initials, layout, people, pullLine, works, type GNode, type Graph, type Person, type Pull, type Watch, type Work } from "./model";
import "./people-hub.css";

/**
 * People hub (PEOPLE-GRAPH; Shaan, 15 Oct: "using the principles from the UI hub to make a people graph hub, knowing
 * kinda what the base dashboard looks and feels like"). The base dashboard's page (HubPage: hero, 12-column widgets) over
 * two sources: the library's graph (who made what, who said how much, through /api/people, signed in server-side) and
 * the tracker's latest pulls (/api/people-watch). Views: Overview, People, Works, Latest, Graph. A doc or a person opens
 * in place, in the drawer; a pull opens at its source.
 */
type Tab = "Overview" | "People" | "Works" | "Latest" | "Graph";
const TABS: Tab[] = ["Overview", "People", "Works", "Latest", "Graph"];
type Open = { kind: "doc"; href: string; title: string } | { kind: "person"; slug: string };

const ago = (ms?: number) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const day = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const SOURCE: Record<string, { icon: typeof Rss; label: string }> = {
  x: { icon: MessageSquareText, label: "X" },
  youtube: { icon: PlayCircle, label: "YouTube" },
  web: { icon: FileText, label: "Blog" },
};
const src = (s: string) => SOURCE[s] ?? { icon: Rss, label: s };

function Face({ name, size = 28 }: { name: string; size?: number }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return <span className="ppl-face" style={{ width: size, height: size, fontSize: size * 0.38, ["--hue" as string]: hue }} aria-hidden>{initials(name)}</span>;
}

const keyOpen = (go: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") (e.preventDefault(), go()); };

function PullRow({ p, name }: { p: Pull; name: string }) {
  const S = src(p.source);
  return (
    <a className="ppl-row ppl-pull" href={p.url} target="_blank" rel="noreferrer" title={p.text}>
      <Face name={name} size={26} />
      <span className="ppl-row__main">
        <b className="ppl-clamp">{pullLine(p)}</b>
        <small><S.icon size={12} aria-hidden /> {S.label} · {name}</small>
      </span>
      <time className="ppl-row__end">{day(p.date)}</time>
    </a>
  );
}

function WorkRow({ w, by, onOpen }: { w: Work; by?: string; onOpen: (w: Work) => void }) {
  // the publisher is named once; the voices line carries only the guests
  const guests = w.voices.filter((v) => v.id !== `p:${w.by}`);
  return (
    <div className="ppl-row" role="button" tabIndex={0} onClick={() => onOpen(w)} onKeyDown={keyOpen(() => onOpen(w))}>
      <span className="ppl-work-icon"><BookOpenText size={15} aria-hidden /></span>
      <span className="ppl-row__main">
        <b className="ppl-clamp">{w.title}</b>
        <small>{[by, day(w.date), ...guests.map((v) => `with ${v.name.replace(/-/g, " ")} (${v.n})`)].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="ppl-row__end"><b>{w.quotes}</b><small>quotes</small></span>
    </div>
  );
}

function PersonRow({ p, onOpen, wide }: { p: Person; onOpen: (slug: string) => void; wide?: boolean }) {
  return (
    <div className="ppl-row" role="button" tabIndex={0} onClick={() => onOpen(p.slug)} onKeyDown={keyOpen(() => onOpen(p.slug))}>
      <Face name={p.name} size={wide ? 34 : 28} />
      <span className="ppl-row__main">
        <b>{p.name}</b>
        <small>
          {Object.entries(p.pulls).map(([s, n]) => `${src(s).label} ${n}`).join(" · ") || "not tracked"}
          {wide && p.accounts.length > 0 && <> · {p.accounts.join(" · ")}</>}
        </small>
      </span>
      {wide && <span className="ppl-tag" data-on={p.qid ? "1" : "0"}>{p.qid ?? "no QID"}</span>}
      <span className="ppl-row__end"><b>{p.works.length}</b><small>{p.works.length === 1 ? "work" : "works"}</small></span>
    </div>
  );
}

const COLOR: Record<GNode["type"], string> = {
  person: "var(--crm-color-brand)",
  speaker: "#f472b6",
  video: "var(--color-working)",
  account: "var(--crm-color-text-faint)",
  wikidata: "#a78bfa",
};

function GraphView({ g, height, onNode, labels = true }: { g: Graph; height: number; onNode: (n: GNode) => void; labels?: boolean }) {
  const W = 900;
  const pos = useMemo(() => layout(g, W, height), [g, height]);
  return (
    <svg className="ppl-graph" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="People graph">
      {g.edges.map((e, i) => {
        const a = pos.get(e.source), b = pos.get(e.target);
        return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={e.n ? 1 + Math.log2(1 + e.n) / 2 : 1} /> : null;
      })}
      {g.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const r = n.type === "person" ? 9 : n.type === "speaker" || n.type === "video" ? 7 : 4.5;
        const go = n.type !== "account";
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} className={go ? "is-go" : undefined} onClick={go ? () => onNode(n) : undefined}>
            <circle r={r} fill={COLOR[n.type]} />
            {(labels || n.type === "person") && <text x={r + 5} y={4}>{n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label.replace(/-/g, " ")}</text>}
            <title>{n.label}</title>
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  return <span className="ppl-legend">{(Object.keys(COLOR) as GNode["type"][]).map((t) => <span key={t}><i style={{ background: COLOR[t] }} />{t}</span>)}</span>;
}

function Drawer({ open, folks, pulls, onOpen, onClose }: { open: Open; folks: Person[]; pulls: Pull[]; onOpen: (o: Open) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const person = open.kind === "person" ? folks.find((p) => p.slug === open.slug) : undefined;
  return (
    <aside className="ppl-drawer" aria-label={open.kind === "doc" ? open.title : person?.name ?? "Person"} data-testid="people-drawer">
      <header className="ppl-drawer__head">
        {person && <Face name={person.name} size={30} />}
        <h3>{open.kind === "doc" ? open.title : person?.name}</h3>
        {open.kind === "doc" && <a className="hub-widget__door" href={`/api/people${open.href}`} target="_blank" rel="noreferrer" aria-label="Open in its own tab" title="Open in its own tab"><ArrowUpRight size={15} aria-hidden /></a>}
        <button type="button" className="hub-widget__door" onClick={onClose} aria-label="Close" title="Close"><X size={15} aria-hidden /></button>
      </header>
      {open.kind === "doc" && <iframe className="ppl-drawer__frame" src={`/api/people${open.href}`} title={open.title} />}
      {person && (
        <div className="ppl-drawer__body">
          <p className="ppl-drawer__line">
            {person.qid ? <a href={`https://www.wikidata.org/wiki/${person.qid}`} target="_blank" rel="noreferrer">{person.qid}</a> : "No Wikidata match yet"}
            {person.accounts.length > 0 && <> · {person.accounts.join(" · ")}</>}
          </p>
          <div className="ppl-figs">
            <span><b>{person.works.length}</b><small>works in the library</small></span>
            <span><b>{person.quotes}</b><small>quotes credited</small></span>
            <span><b>{person.pulled}</b><small>items tracked</small></span>
          </div>
          {person.href && <button type="button" className="ppl-link" onClick={() => onOpen({ kind: "doc", href: person.href!, title: person.name })}>Library page →</button>}
          <h4>Works</h4>
          {person.works.length ? person.works.map((w) => <WorkRow key={w.id} w={w} onOpen={(x) => onOpen({ kind: "doc", href: x.href ?? "/", title: x.title })} />)
            : <p className="hub-widget__note">Nothing distilled yet. The factory adds a work when one of their videos runs through it.</p>}
          <h4>Latest pulls</h4>
          {pulls.filter((p) => p.person === person.slug).slice(0, 12).map((p) => <PullRow key={p.url} p={p} name={person.name} />)}
        </div>
      )}
    </aside>
  );
}

export default function PeopleHub() {
  const graph = useSharedResult<Graph>("/api/people/graph.json", 5 * 60_000);
  const watch = useSharedResult<Watch>("/api/people-watch", 60_000);
  const [tab, setTab] = useState<Tab>("Overview");
  const [open, setOpen] = useState<Open | null>(null);
  const [who, setWho] = useState<string | null>(null);

  const g = graph.data, w = watch.data;
  const all = useMemo(() => works(g), [g]);
  const folks = useMemo(() => people(g, w), [g, w]);
  const nameOf = (slug: string) => folks.find((p) => p.slug === slug)?.name ?? slug;
  const pulls = w?.items ?? [];
  const tracked = (w?.counts ?? []).reduce((s, c) => s + c.n, 0);
  const openWork = (x: Work) => x.href && setOpen({ kind: "doc", href: x.href, title: x.title });
  const openPerson = (slug: string) => setOpen({ kind: "person", slug });
  const onNode = (n: GNode) => {
    if (n.type === "person") openPerson(n.id.slice(2));
    else if (n.type === "wikidata" && n.href) window.open(n.href, "_blank", "noopener");
    else if (n.href) setOpen({ kind: "doc", href: n.href, title: n.label.replace(/-/g, " ") });
  };
  const gFailed = graph.error && !g ? `The library did not answer: ${graph.error}` : null;
  const wFailed = watch.error && !w ? `The tracker did not answer: ${watch.error}` : null;
  const wFloor = w && <>{w.stale ? <span className="ppl-warn">Showing the read from {ago(w.read)}: {w.error}</span> : <span>Tracker polled {ago(w.polled)}</span>}<span>{tracked} items from {Object.keys(w.people).length} people</span></>;

  const latest = (rows: Pull[]) => rows.map((p) => <PullRow key={p.url} p={p} name={nameOf(p.person)} />);

  return (
    <div className="ppl-hub">
      <HubPage id="people" icon={UsersRound} kicker="Agent Base · people" title="People"
        blurb="Who we follow, what they made, and what they said last."
        chips={[{ label: "people", value: folks.length || null }, { label: "items tracked", value: tracked || null }]}>
        <div className="ppl-tabs" role="tablist" aria-label="People views">
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
        </div>

        {tab === "Overview" && (
          <WidgetGrid label="People overview">
            <Widget id="people-latest" size="L" icon={Rss} title="Latest pulls" sub="Newest first, from the tracker" door={{ label: "All pulls", onOpen: () => setTab("Latest") }}
              loading={!w && !watch.error} failed={wFailed} empty="The tracker has pulled nothing yet." footer={wFloor}>
              {pulls.length > 0 && <div className="ppl-list">{latest(pulls.slice(0, 7))}</div>}
            </Widget>
            <Widget id="people-people" size="S-wide" icon={UsersRound} title="People" sub="Watched and in the graph" stat={{ value: folks.length || null }}
              door={{ label: "All people", onOpen: () => setTab("People") }} loading={!g && !w && !graph.error} empty="Nobody is watched yet.">
              {folks.length > 0 && <div className="ppl-list">{folks.map((p) => <PersonRow key={p.slug} p={p} onOpen={openPerson} />)}</div>}
            </Widget>
            <Widget id="people-graph" size="M" icon={Network} title="Graph" sub="People, their works, who said what" door={{ label: "Open the graph", onOpen: () => setTab("Graph") }}
              loading={!g && !graph.error} failed={gFailed} footer={<Legend />}>
              {g && <GraphView g={g} height={330} onNode={onNode} labels={false} />}
            </Widget>
            <Widget id="people-works" size="M" icon={BookOpenText} title="Works" sub="Distilled: the full doc and transcript per video" stat={{ value: all.length || null }}
              door={{ label: "All works", onOpen: () => setTab("Works") }} loading={!g && !graph.error} failed={gFailed} empty="Nothing distilled yet.">
              {all.length > 0 && <div className="ppl-list">{all.map((x) => <WorkRow key={x.id} w={x} by={x.by ? nameOf(x.by) : undefined} onOpen={openWork} />)}</div>}
            </Widget>
          </WidgetGrid>
        )}

        {tab === "People" && (
          <WidgetGrid label="People">
            <Widget id="people-all" size="XL" icon={UsersRound} title="Everyone" sub="Feeds tracked, graph rows, Wikidata match and works" loading={!g && !w} failed={gFailed && wFailed} empty="Nobody yet.">
              {folks.length > 0 && <div className="ppl-list">{folks.map((p) => <PersonRow key={p.slug} p={p} onOpen={openPerson} wide />)}</div>}
            </Widget>
          </WidgetGrid>
        )}

        {tab === "Works" && (
          <WidgetGrid label="Works">
            <Widget id="works-all" size="XL" icon={BookOpenText} title="Works" sub="Each opens its full doc: summary, every segment, quotes with timestamps, what SISO takes from it"
              loading={!g && !graph.error} failed={gFailed} empty="Nothing distilled yet.">
              {all.length > 0 && <div className="ppl-list">{all.map((x) => <WorkRow key={x.id} w={x} by={x.by ? nameOf(x.by) : undefined} onOpen={openWork} />)}</div>}
            </Widget>
          </WidgetGrid>
        )}

        {tab === "Latest" && (
          <WidgetGrid label="Latest pulls">
            <Widget id="latest-all" size="XL" icon={Rss} title="Latest pulls" sub="Everything the tracker pulled, newest first" loading={!w && !watch.error} failed={wFailed} footer={wFloor}>
              <div className="ppl-filter">
                {[null, ...folks.map((p) => p.slug)].map((s) => <button key={s ?? "all"} type="button" aria-pressed={who === s} onClick={() => setWho(s)}>{s ? nameOf(s) : "Everyone"}</button>)}
              </div>
              <div className="ppl-list">{latest(pulls.filter((p) => !who || p.person === who).slice(0, 60))}</div>
            </Widget>
          </WidgetGrid>
        )}

        {tab === "Graph" && (
          <WidgetGrid label="Graph">
            <Widget id="graph-all" size="XL" icon={Network} title="People graph" sub="Click a person for their page, a video for its doc, a speaker for what they said" loading={!g && !graph.error} failed={gFailed} footer={<Legend />}>
              {g && <GraphView g={g} height={560} onNode={onNode} />}
            </Widget>
          </WidgetGrid>
        )}
      </HubPage>
      {open && <Drawer open={open} folks={folks} pulls={pulls} onOpen={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
