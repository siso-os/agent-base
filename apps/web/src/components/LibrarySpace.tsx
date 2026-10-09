import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenIcon, CopyIcon, ExternalLinkIcon, FolderOpenIcon, GithubIcon, SparklesIcon, XIcon, LaptopIcon, MessageSquareIcon, MonitorIcon, MoreHorizontalIcon, SearchIcon, ServerIcon, CloudIcon } from "lucide-react";
import { usePersisted } from "@siso/shell";
import { AgentFace } from "../lib/face";
import "./LibrarySpace.css";
import { DonorWork } from "./DonorWork";
import type { DonorWorkData } from "../../../../services/node/src/donor-work";
import { every, useSharedState } from "../lib/poll";
import { libraryReader } from "../lib/library-read";
import { LibraryPage } from "./LibraryPage";
import { libraryRoute, libraryHref, type LibraryTab } from "./LibraryNavigation";

/**
 * R1.24, ecosystem SPEC phase 1 (Shaan 14:40: "eyes on all of the stuff that I've built over the last two years and where
 * it sits and how to work with it"; 22:35: "we have a cloudfalre url which does te lirbrary and template ready"). One rail
 * tool, three views: Built (the estate register), Live (every hosted page, probed), Works (the Great Library's catalog and
 * the template bank). Nothing is rebuilt: a Work, a template or a live page opens in a page tab.
 */
type Building = { postcode: string; path: string; island: string; lifecycle: string; machines: string[]; commits: number | null; sizeKb: number | null; seat: string | null; provenance: string | null; description: string; live: string | null };
type LiveRow = { id: string; name: string; group: string; project?: string; url?: string; host: string; app?: string; machine?: string; path?: string; edit?: string; deploy?: string; owner_seat?: string; auth?: string; note?: string; status: "up" | "login" | "down" | "app" | "checking"; code: number | null; checkedAt: number | null };
export type Work = { id?: string; owner?: string | null; reference?: string; revision?: string | null; sourceLinks?: { kind: string; label?: string; url: string; visibility?: string }[]; slug: string; name: string; summary: string; kind: string; maturity: string; section: string; url: string };
type Template = { id: string; name: string; status: string; url: string };
export type DocumentRow = { id: string; workId?: string; title: string; project: string; domain: string; owner: string | null; source: string; reference: string; revision: string | null; privacy: string; availability: "local" | "unverified" | "unavailable"; checkedAt: number | null; url: string | null; text?: string; note: string };
export type LibraryData = {
  documents?: { rows: DocumentRow[]; source: string; fetchedAt: number | null; stale: boolean; error: string | null; scope: string };
  at: number;
  counts: { built: number; live: number; works: number; templates: number; lifecycle: Record<string, number>; islands: Record<string, number>; vps: number };
  built: { rows: Building[]; source: "register" | "site" | "none"; error: string | null };
  live: { rows: LiveRow[]; source: "estate" | "seed" };
  works: { rows: Work[]; templates: Template[]; site: string; shell: string; generated: string | null; fetchedAt: number | null; stale: boolean; error: string | null; templatesError: string | null };
};
type Tab = LibraryTab;
type Props = { onOpenProject?: (projectId: string) => void; onOpenTask?: (taskId: string) => void; onOpenUrl: (url: string, title?: string) => void; keeperLive: (seat: string) => boolean; onAsk: (seat: string, words?: string) => void };
type Card = { postcode: string; door: { text: string; from: string } | null; lastCommit: { sha: string; at: string; subject: string } | null; github: string | null; live: { id: string; name: string; url: string | null }[] };

const ISLANDS = ["agency", "engine", "library", "home", "territory", "vault", "foreign"];
const HIDDEN = new Set(["vault", "foreign"]);
const STATES = ["active", "warm", "dormant", "dark", "archived", "unscored"];
const MACHINES = ["laptop", "siso-vps", "mini"];
const GROUPS: [string, string][] = [["agency", "Agency"], ["labs", "Labs"], ["family", "Family"], ["stack", "Agent stack"]];
const HUE: Record<string, number> = { agency: 28, engine: 200, library: 265, home: 140, territory: 50, vault: 0, foreign: 320 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const kindWord = (k: string) => cap(k.replace(/_/g, " "));
const ago = (t: number | null, now: number) => {
  if (!t) return "";
  const m = Math.round((now - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const size = (kb: number | null) => (kb === null ? "" : kb > 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : kb > 1024 ? `${Math.round(kb / 1024)} MB` : `${kb} KB`);
const hostLine = (r: LiveRow) => {
  if (r.host === "app") return `app · ${r.app ?? r.name}`;
  let u: URL | null = null;
  try {
    u = r.url ? new URL(r.url) : null;
  } catch {
    /* shown as written */
  }
  const where = r.host === "cloudflare" ? "Cloudflare" : r.host === "vps" ? r.machine ?? "VPS" : r.machine ?? "laptop";
  return `${where} · ${u ? (/^(127\.0\.0\.1|localhost)$/.test(u.hostname) ? `:${u.port}` : u.host) : r.url ?? ""}`;
};
const STATUS_WORD: Record<LiveRow["status"], string> = { up: "up", login: "login", down: "down", app: "app", checking: "checking" };

function Machines({ ms }: { ms: string[] }) {
  return (
    <span className="ab-lib__machines" aria-label={ms.join(", ")}>
      {ms.map((m) => (m === "laptop" ? <LaptopIcon key={m} size={12} /> : m === "mini" ? <MonitorIcon key={m} size={12} /> : m === "cloudflare" ? <CloudIcon key={m} size={12} /> : <ServerIcon key={m} size={12} />))}
    </span>
  );
}

export function LibrarySpace({ onOpenUrl, keeperLive, onAsk, onOpenProject, onOpenTask }: Props) {
  const [data, setData] = useState<LibraryData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const readerRef = useRef<ReturnType<typeof libraryReader> | null>(null);
  const [tab, setTab] = usePersisted<Tab>("library.tab", "docs");
  const [q, setQ] = usePersisted<string>("library.search", "");
  const [route, setRoute] = useState(() => libraryRoute(location.hash));
  useEffect(() => {
    const update = () => setRoute(libraryRoute(location.hash));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => { if (route?.kind === "list") setTab(route.tab); }, [route, setTab]);
  const activeTab = route?.kind === "list" ? route.tab : tab;
  const goTab = (next: Tab) => { setTab(next); location.hash = `library/${next}`; };
  const [now, setNow] = useState(Date.now());
  const search = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const reader = libraryReader(
      (next) => { setData(next); setFailed(null); setNow(Date.now()); },
      setFailed,
      setReading,
    );
    readerRef.current = reader;
    const stop = every(() => { void reader.read(true); }, 120_000);
    return () => {
      stop();
      reader.close();
      readerRef.current = null;
    };
  }, []);
  // ⌘F finds within the view.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (search.current && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") (e.preventDefault(), search.current?.focus());
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const c = data?.counts;
  const card = activeTab === "built" && picked ? data?.built.rows.find((b) => b.postcode === picked) : undefined;
  // Keep this enabled during a read: a deliberate retry can replace a hung request.
  const refresh = <button type="button" className="ab-lib__refresh" onClick={() => { void readerRef.current?.read(); }} aria-label={reading ? "Restart Library refresh" : failed ? "Retry Library refresh" : "Refresh Library"}>{reading ? "Restart refresh" : failed ? "Retry" : "Refresh"}</button>;
  const progress = reading && <p className="ab-lib__summary" role="status" data-testid="library-refresh-status">{data ? "Refreshing the Library… Showing the last loaded copy." : "Reading the Library…"}</p>;
  if (route && route.kind !== "list") return <div className="ab-lib-frame"><div className="ab-lib"><LibraryPage route={route} data={data} error={failed} refresh={refresh} progress={progress} onOpenUrl={onOpenUrl} /></div></div>;
  return (
    <div className="ab-lib-frame">
    <div className="ab-lib" data-testid="library">
      <header className="ab-lib__head">
        <BookOpenIcon size={18} aria-hidden />
        <h1>Library</h1>
        <div className="ab-lib__tabs" role="tablist" aria-label="Library views">
          {(
            [
              ["docs", "Docs", data?.documents?.rows.length],
              ["built", "Built", c?.built],
              ["live", "Live", c?.live],
              ["works", "Works", c?.works],
            ] as [Tab, string, number | undefined][]
          ).map(([id, word, n]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} data-tab={id} onClick={() => goTab(id)}>
              {word}
              {n !== undefined && <span>{n}</span>}
            </button>
          ))}
        </div>
        <label className="ab-lib__search">
          <SearchIcon size={13} aria-hidden />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" aria-label="Find in the Library" />
        </label>
        {refresh}
      </header>
      {progress}
      {!data && failed && <p className="ab-lib__quiet" role="status">The Library is not readable right now ({failed}).</p>}
      {!data && !failed && !reading && <p className="ab-lib__quiet">The Library has not been loaded yet.</p>}
      {data && failed && <p className="ab-lib__summary ab-lib__stale" data-testid="library-refresh-error" role="status">The Library refresh is unavailable ({failed}); showing the last good copy.</p>}
      {data && activeTab === "docs" && <Documents data={data} q={q} />}
      {data && activeTab === "built" && <Built data={data} q={q} onOpenUrl={onOpenUrl} keeperLive={keeperLive} onAsk={onAsk} picked={picked} onPick={setPicked} />}
      {data && activeTab === "live" && <Live rows={data.live.rows} q={q} now={now} onOpenUrl={onOpenUrl} />}
      {data && activeTab === "works" && <Works data={data} q={q} now={now} onOpenUrl={onOpenUrl} onOpenProject={onOpenProject} onOpenTask={onOpenTask} />}
    </div>
      {card && <BuildingCard key={card.postcode} b={card} keeper={!!card.seat && keeperLive(card.seat)} onOpenUrl={onOpenUrl} onAsk={onAsk} onClose={() => setPicked(null)} />}
    </div>
  );
}

// ---------- Built ----------

function Built({ data, q, onOpenUrl, keeperLive, onAsk, picked, onPick }: { data: LibraryData; q: string; picked: string | null; onPick: (p: string | null) => void } & Props) {
  const [island, setIsland] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [machine, setMachine] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [sort, setSort] = usePersisted<"moving" | "az" | "size">("library.sort", "moving");
  const [limit, setLimit] = useState(60);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => !(e.target as HTMLElement).closest?.(".ab-lib__menu, .ab-lib__dots") && setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("pointerdown", away), document.removeEventListener("keydown", esc));
  }, [menu]);
  const { rows, source, error } = data.built;
  const lc = data.counts.lifecycle;
  const islands = ISLANDS.filter((i) => data.counts.islands[i]).concat(Object.keys(data.counts.islands).filter((i) => !ISLANDS.includes(i)));
  const hiddenN = islands.filter((i) => HIDDEN.has(i)).reduce((n, i) => n + data.counts.islands[i], 0);
  const shownIslands = more ? islands : islands.filter((i) => !HIDDEN.has(i));
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const rank = (s: string) => (STATES.indexOf(s) + 1 || 99);
    return rows
      .filter((b) => (island ? b.island === island : more || !HIDDEN.has(b.island) || state !== null || machine !== null || needle !== ""))
      .filter((b) => !state || b.lifecycle === state)
      .filter((b) => !machine || b.machines.includes(machine))
      .filter((b) => !needle || `${b.postcode} ${b.path} ${b.description} ${b.seat ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === "az" ? a.postcode.localeCompare(b.postcode) : sort === "size" ? (b.sizeKb ?? -1) - (a.sizeKb ?? -1) : (b.commits ?? -1) - (a.commits ?? -1) || rank(a.lifecycle) - rank(b.lifecycle) || a.postcode.localeCompare(b.postcode),
      );
  }, [rows, island, state, machine, more, needle, sort]);

  if (source === "none") return <p className="ab-lib__quiet">{error ?? "The register has not been built on this machine. `estate register` builds it."}</p>;
  const pick = <T,>(cur: T | null, set: (v: T | null) => void, v: T) => (set(cur === v ? null : v), setLimit(60));
  return (
    <section className="ab-lib__body" data-testid="library-built">
      <p className="ab-lib__summary" data-testid="built-summary">
        {source === "site" ? "From the Great Library's estate map (the register is not on this machine): " : ""}
        <b>{data.counts.built}</b> things built ·{" "}
        {(["active", "warm", "dark"] as const).map((s, i) => (
          <span key={s}>
            {i > 0 && ", "}
            <button type="button" className="ab-lib__num" aria-pressed={state === s} onClick={() => pick(state, setState, s)}>
              {lc[s] ?? 0} {s}
            </button>
          </span>
        ))}
        {data.counts.vps > 0 && (
          <>
            {" · "}
            <button type="button" className="ab-lib__num" aria-pressed={machine === "siso-vps"} onClick={() => pick(machine, setMachine, "siso-vps")}>
              {data.counts.vps} run on siso-vps
            </button>
          </>
        )}
      </p>
      <div className="ab-lib__chips" role="group" aria-label="Island" data-testid="island-chips">
        {shownIslands.map((i) => (
          <button key={i} type="button" aria-pressed={island === i} data-island={i} onClick={() => pick(island, setIsland, i)}>
            <i style={{ background: `hsl(${HUE[i] ?? 0} 55% 62%)` }} />
            {cap(i)} {data.counts.islands[i]}
          </button>
        ))}
        {hiddenN > 0 && (
          <button type="button" className="ab-lib__morechip" aria-expanded={more} onClick={() => (setMore(!more), more && island && HIDDEN.has(island) && setIsland(null))}>
            {more ? "Fewer" : `Show ${hiddenN} more`}
          </button>
        )}
      </div>
      <div className="ab-lib__chips" role="group" aria-label="State and machine">
        {STATES.filter((s) => lc[s]).map((s) => (
          <button key={s} type="button" aria-pressed={state === s} onClick={() => pick(state, setState, s)}>
            <i className={`ab-lib__life is-${s}`} />
            {s}
          </button>
        ))}
        <span className="ab-lib__sep" />
        {MACHINES.map((m) => (
          <button key={m} type="button" aria-pressed={machine === m} onClick={() => pick(machine, setMachine, m)}>
            {m}
          </button>
        ))}
        <span className="ab-lib__sort" role="group" aria-label="Sort">
          {(
            [
              ["moving", "Moving"],
              ["az", "A–Z"],
              ["size", "Size"],
            ] as const
          ).map(([id, w]) => (
            <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)}>
              {w}
            </button>
          ))}
        </span>
      </div>
      <div className="ab-lib__rows">
        {!list.length && <p className="ab-lib__quiet">Nothing built matches.</p>}
        {list.slice(0, limit).map((b) => {
          const open = picked === b.postcode;
          const live = !!b.seat && keeperLive(b.seat);
          return (
            <div key={b.postcode} className={`ab-lib__building${open ? " is-open" : ""}${menu === b.postcode ? " has-menu" : ""}`} data-testid="building" data-postcode={b.postcode}>
              <button type="button" className="ab-lib__main" aria-pressed={open} onClick={() => onPick(open ? null : b.postcode)}>
                <span className="ab-lib__mark" style={{ background: `hsl(${HUE[b.island] ?? 0} 55% 62%)` }} aria-hidden>
                  {(b.postcode.split("/").pop()!.replace(/^[^A-Za-z0-9]+/, "")[0] ?? "·").toUpperCase()}
                </span>
                <span className="ab-lib__text">
                  <span className="ab-lib__name">
                    <b>{b.postcode}</b>
                    <em className={`ab-lib__state is-${b.lifecycle}`}>{b.lifecycle}</em>
                    <Machines ms={b.machines} />
                    <span className="ab-lib__activity">
                      {!!b.commits && <span>{b.commits} commit{b.commits === 1 ? "" : "s"} · 14d</span>}
                      {b.seat && (
                        <span className="ab-lib__seat" data-testid="keeper">
                          <AgentFace name={b.seat} project={b.seat} status={live ? "waiting" : "offline"} size={18} />
                          {b.seat}
                        </span>
                      )}
                    </span>
                  </span>
                  <small>{b.description || <code>{b.path}</code>}</small>
                </span>
              </button>
              <span className="ab-lib__acts">
                {b.live && (
                  <button type="button" onClick={() => onOpenUrl(b.live!, b.postcode)}>
                    <ExternalLinkIcon size={12} /> Open
                  </button>
                )}
                {live && (
                  <button type="button" onClick={() => onAsk(b.seat!)} title={`Open ${b.seat}'s chat`}>
                    <MessageSquareIcon size={12} /> Ask keeper
                  </button>
                )}
                <button type="button" className="ab-lib__dots" aria-label={`More for ${b.postcode}`} aria-expanded={menu === b.postcode} onClick={() => setMenu(menu === b.postcode ? null : b.postcode)}>
                  <MoreHorizontalIcon size={14} />
                </button>
              </span>
              {menu === b.postcode && <BuildingMenu b={b} keeper={live} onOpenUrl={onOpenUrl} onAsk={onAsk} lunaLive={keeperLive("A0")} close={() => setMenu(null)} />}
            </div>
          );
        })}
        {list.length > limit && (
          <button type="button" className="ab-lib__more" onClick={() => setLimit(list.length)}>
            Show all {list.length}
          </button>
        )}
      </div>
    </section>
  );
}

const readCard = (postcode: string): Promise<Card | null> =>
  fetch(`/api/library/building?postcode=${encodeURIComponent(postcode)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

/** §3.1 #7: the ⋯ menu. GitHub comes from the building's own git remote, read when the menu opens. */
function BuildingMenu({ b, keeper, lunaLive, onOpenUrl, onAsk, close }: { b: Building; keeper: boolean; lunaLive: boolean; close: () => void } & Pick<Props, "onOpenUrl" | "onAsk">) {
  const [gh, setGh] = useState<string | null | undefined>(undefined);
  useEffect(() => void readCard(b.postcode).then((c) => setGh(c?.github ?? null)), [b.postcode]);
  const item = (Icon: typeof CopyIcon, word: string, go: () => void, off = false, title?: string) => (
    <button type="button" role="menuitem" disabled={off} title={title} onClick={() => (go(), close())}>
      <Icon size={12} /> {word}
    </button>
  );
  return (
    <div className="ab-lib__menu" role="menu" data-testid="building-menu">
      {b.live && item(ExternalLinkIcon, "Open live page", () => onOpenUrl(b.live!, b.postcode))}
      {b.seat && item(MessageSquareIcon, "Ask keeper", () => onAsk(b.seat!, `about ${b.postcode}: `), !keeper, keeper ? `Opens ${b.seat}'s chat with "about ${b.postcode}" typed` : `${b.seat} is not running`)}
      {item(CopyIcon, "Copy path", () => void navigator.clipboard?.writeText(b.path))}
      {item(FolderOpenIcon, "Reveal in Finder", () => void post("/api/library/reveal", { postcode: b.postcode }))}
      {item(GithubIcon, gh === undefined ? "Open on GitHub…" : "Open on GitHub", () => gh && onOpenUrl(gh, b.postcode), !gh, gh === null ? "No GitHub remote on this machine" : undefined)}
      {item(SparklesIcon, "Put Luna on it", () => onAsk("A0", `Luna task on ${b.postcode}: `), !lunaLive, lunaLive ? "Opens Agent Zero's chat with the task started" : "Agent Zero is not running")}
    </div>
  );
}

/** §3.1 #8: the building card in the right panel: door text, keeper, where it runs, size, last commit, its live pages. */
function BuildingCard({ b, keeper, onOpenUrl, onAsk, onClose }: { b: Building; keeper: boolean; onClose: () => void } & Pick<Props, "onOpenUrl" | "onAsk">) {
  const [c, setC] = useState<Card | null | undefined>(undefined);
  useEffect(() => void readCard(b.postcode).then(setC), [b.postcode]);
  const when = c?.lastCommit ? ago(Date.parse(c.lastCommit.at), Date.now()) : "";
  return (
    <aside className="ab-lib__aside" data-testid="building-card" aria-label={`${b.postcode} card`}>
      <header>
        <span className="ab-lib__mark" style={{ background: `hsl(${HUE[b.island] ?? 0} 55% 62%)` }} aria-hidden>
          {(b.postcode.split("/").pop()!.replace(/^[^A-Za-z0-9]+/, "")[0] ?? "·").toUpperCase()}
        </span>
        <b>{b.postcode}</b>
        <em className={`ab-lib__state is-${b.lifecycle}`}>{b.lifecycle}</em>
        <button type="button" className="ab-lib__dots" aria-label="Close the card" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </header>
      <p className="ab-lib__door" data-testid="door">
        {c === undefined ? "Reading its door…" : c?.door ? c.door.text : b.description || "No AGENTS.md or README on this machine."}
        {c?.door && <small> · from {c.door.from}</small>}
      </p>
      <dl className="ab-lib__card">
        <dt>Keeper</dt>
        <dd>
          {b.seat ? (
            <span className="ab-lib__seat">
              <AgentFace name={b.seat} project={b.seat} status={keeper ? "waiting" : "offline"} size={18} />
              {b.seat}
              {keeper && (
                <button type="button" className="ab-lib__link" onClick={() => onAsk(b.seat!)}>
                  Ask
                </button>
              )}
            </span>
          ) : (
            "none yet"
          )}
        </dd>
        <dt>Runs on</dt>
        <dd>{b.machines.join(", ") || "not on a machine"}</dd>
        <dt>Path</dt>
        <dd>
          <code>{b.path}</code>
        </dd>
        {b.sizeKb !== null && (
          <>
            <dt>Size</dt>
            <dd>{size(b.sizeKb)}</dd>
          </>
        )}
        <dt>Last commit</dt>
        <dd data-testid="last-commit">{c === undefined ? "…" : c?.lastCommit ? `${c.lastCommit.subject} · ${when}` : "not a git checkout here"}</dd>
        {!!b.commits && (
          <>
            <dt>14 days</dt>
            <dd>
              {b.commits} commit{b.commits === 1 ? "" : "s"}
            </dd>
          </>
        )}
        {b.provenance && (
          <>
            <dt>Whose</dt>
            <dd>{b.provenance}</dd>
          </>
        )}
        <dt>Live</dt>
        <dd>
          {c?.live.length || b.live ? (
            (c?.live.length ? c.live : [{ id: "live", name: b.live!, url: b.live }]).map((l) =>
              l.url ? (
                <button key={l.id} type="button" className="ab-lib__link" onClick={() => onOpenUrl(l.url!, l.name)}>
                  {l.name}
                </button>
              ) : (
                <span key={l.id}>{l.name}</span>
              ),
            )
          ) : (
            "no live page"
          )}
        </dd>
      </dl>
    </aside>
  );
}

// ---------- Live ----------

function Live({ rows, q, now, onOpenUrl }: { rows: LiveRow[]; q: string; now: number; onOpenUrl: Props["onOpenUrl"] }) {
  const [menu, setMenu] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || `${r.name} ${r.url ?? ""} ${r.note ?? ""}`.toLowerCase().includes(needle));
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => !(e.target as HTMLElement).closest?.(".ab-lib__menu, .ab-lib__dots") && setMenu(null);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [menu]);
  const open = async (r: LiveRow) => {
    if (r.host !== "app") return r.url && onOpenUrl(r.url, r.name);
    setSaid((s) => ({ ...s, [r.id]: `Opening ${r.app}…` }));
    const res = await fetch("/api/library/open-app", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id }) }).catch(() => null);
    setSaid((s) => ({ ...s, [r.id]: res?.ok ? `Opened ${r.app}` : `Could not open ${r.app}` }));
  };
  const groups = GROUPS.map(([g, word]) => [word, shown.filter((r) => r.group === g)] as const).concat([["Other", shown.filter((r) => !GROUPS.some(([g]) => g === r.group))]]);
  return (
    <section className="ab-lib__body" data-testid="library-live">
      {!shown.length && <p className="ab-lib__quiet">No live page matches.</p>}
      {groups
        .filter(([, rs]) => rs.length)
        .map(([word, rs]) => (
          <div key={word} className="ab-lib__group">
            <h2>{word}</h2>
            <div className="ab-lib__grid">
              {rs.map((r) => (
                <div key={r.id} className="ab-lib__tile" data-testid="live-tile" data-id={r.id} data-status={r.status}>
                  <button type="button" className="ab-lib__tilemain" onClick={() => void open(r)}>
                    <span className="ab-lib__tilemark" aria-hidden>
                      {r.name.replace(/^[^A-Za-z0-9]+/, "")[0]?.toUpperCase()}
                    </span>
                    <b>{r.name}</b>
                    <small>{hostLine(r)}</small>
                    {r.note && <small className="ab-lib__note">{r.note}</small>}
                  </button>
                  <div className="ab-lib__tilefoot">
                    <span className={`ab-lib__status is-${r.status}`}>
                      <i />
                      {said[r.id] ?? (r.status === "app" ? "app" : `${STATUS_WORD[r.status]}${r.status === "down" && r.code ? ` ${r.code}` : ""}${r.checkedAt ? ` · checked ${ago(r.checkedAt, now)}` : ""}`)}
                    </span>
                    <button type="button" className="ab-lib__open" onClick={() => void open(r)}>
                      Open
                    </button>
                    <button type="button" className="ab-lib__dots" aria-label={`More for ${r.name}`} aria-expanded={menu === r.id} onClick={() => setMenu(menu === r.id ? null : r.id)}>
                      <MoreHorizontalIcon size={14} />
                    </button>
                  </div>
                  {menu === r.id && (
                    <div className="ab-lib__menu" role="menu" data-testid="live-menu">
                      {(r.edit || r.path) && (
                        <p>
                          <span>Edit</span>
                          <code>{r.edit ?? r.path}</code>
                        </p>
                      )}
                      {r.deploy && (
                        <p>
                          <span>Deploy</span>
                          <code>{r.deploy}</code>
                        </p>
                      )}
                      {r.url && (
                        <button type="button" role="menuitem" onClick={() => (void navigator.clipboard?.writeText(r.url!), setMenu(null))}>
                          <CopyIcon size={12} /> Copy URL
                        </button>
                      )}
                      {r.url && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => (void fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: r.url }) }), setMenu(null))}
                        >
                          <ExternalLinkIcon size={12} /> Open in your browser
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}

// ---------- Works ----------

function Works({ data, q, now, onOpenUrl, onOpenProject, onOpenTask }: { data: LibraryData; q: string; now: number } & Pick<Props, "onOpenUrl" | "onOpenProject" | "onOpenTask">) {
  const work = useSharedState<DonorWorkData>("/api/donor/work", 30_000);
  const [kind, setKind] = usePersisted<string | null>("library.works.kind", null);
  const w = data.works;
  const needle = q.trim().toLowerCase();
  const kinds = useMemo(() => Object.entries(w.rows.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]), [w.rows]);
  const works = w.rows.filter((x) => (!kind || x.kind === kind) && (!needle || `${x.name} ${x.summary} ${x.slug}`.toLowerCase().includes(needle)));
  const templates = w.templates.filter((t) => !needle || `${t.id} ${t.name} ${t.status}`.toLowerCase().includes(needle));
  const built = w.generated ? new Date(w.generated).toLocaleDateString([], { day: "numeric", month: "short" }) : null;
  return (
    <section className="ab-lib__body" data-testid="library-works">
      <DonorWork data={work.data} error={work.error} onOpenProject={onOpenProject} onOpenTask={onOpenTask} />
      <p className="ab-lib__summary" data-testid="works-summary">
        {w.error && !w.rows.length ? (
          `The Great Library site is not answering (${w.error}) and there is no saved copy yet.`
        ) : (
          <>
            <b>{w.rows.length}</b> Works{built ? ` · site built ${built}` : ""}
            {w.fetchedAt ? ` · read ${ago(w.fetchedAt, now)}` : ""}
            {w.stale && <span className="ab-lib__stale" data-testid="works-stale"> · showing a cached copy; freshness not confirmed</span>}
            {" · "}
            <button type="button" className="ab-lib__link" onClick={() => onOpenUrl(w.site, "Great Library of SISO")}>
              Open the Library site
            </button>
          </>
        )}
      </p>
      <div className="ab-lib__chips" role="group" aria-label="Kind">
        <button type="button" aria-pressed={kind === null} onClick={() => setKind(null)}>
          All {w.rows.length}
        </button>
        {kinds.map(([k, n]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
            {kindWord(k)} {n}
          </button>
        ))}
        {w.templates.length > 0 && (
          <button type="button" aria-pressed={kind === "templates"} data-kind="templates" onClick={() => setKind(kind === "templates" ? null : "templates")}>
            Templates {w.templates.length}
          </button>
        )}
      </div>
      <div className="ab-lib__rows">
        {kind !== "templates" &&
          works.map((x) => (
            <button key={x.slug} type="button" className="ab-lib__work" data-testid="work" data-slug={x.slug} onClick={() => { location.hash = libraryHref("work", x.id ?? x.slug); }}>
              <em className="ab-lib__kind">{kindWord(x.kind)}</em>
              <span className="ab-lib__text">
                <b>{x.name}</b>
                <small>{x.summary}</small>
              </span>
              {x.maturity && <span className="ab-lib__maturity">{x.maturity}</span>}
            </button>
          ))}
        {(kind === null || kind === "templates") && templates.length > 0 && (
          <>
            <h2 className="ab-lib__subhead">
              Templates
              <button type="button" className="ab-lib__link" onClick={() => onOpenUrl(w.shell, "SISO templates")}>
                the bank ›
              </button>
            </h2>
            {templates.map((t) => (
              <button key={t.id} type="button" className="ab-lib__work" data-testid="template" data-id={t.id} onClick={() => onOpenUrl(t.url, `${t.id} · ${t.name}`)}>
                <em className="ab-lib__kind">{t.id}</em>
                <span className="ab-lib__text">
                  <b>{t.name}</b>
                  {t.status && <small>{t.status}</small>}
                </span>
              </button>
            ))}
          </>
        )}
        {w.templatesError && !w.templates.length && <p className="ab-lib__quiet">The template bank is not answering ({w.templatesError}).</p>}
        {!works.length && kind !== "templates" && !templates.length && <p className="ab-lib__quiet">No Work matches.</p>}
      </div>
    </section>
  );
}

// ---------- §3.4 a project dashboard's Live strip ----------

/** Up to four of the project's Live rows, compact; "No live page yet" when none. Same data and probes as Library › Live. */
export function LiveStrip({ project, onOpenUrl }: { project: { id: string; name: string }; onOpenUrl: Props["onOpenUrl"] }) {
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/library")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: LibraryData) => alive && (setRows(d.live.rows), setError(null)))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => void (alive = false);
  }, []);
  const ids = [project.id, project.name].map((x) => x.toLowerCase());
  const mine = (rows ?? []).filter((r) => r.project && ids.includes(r.project.toLowerCase()));
  const open = async (r: LiveRow) => {
    if (r.host !== "app") return r.url && onOpenUrl(r.url, r.name);
    const res = await post("/api/library/open-app", { id: r.id });
    setSaid((s) => ({ ...s, [r.id]: res?.ok ? `Opened ${r.app}` : `Could not open ${r.app}` }));
  };
  return (
    <section className="ab-livestrip" data-testid="live-strip" aria-label={`${project.name} live pages`}>
      <h2>Live</h2>
      {error && <p className="ab-livestrip__quiet ab-lib__stale" data-testid="live-strip-error" role="status">Live pages are unavailable ({error}).</p>}
      {rows === null && !error ? (
        <p className="ab-livestrip__quiet">Checking…</p>
      ) : rows !== null && !mine.length ? (
        <p className="ab-livestrip__quiet">No live page yet</p>
      ) : rows !== null ? (
        mine.slice(0, 4).map((r) => (
          <button key={r.id} type="button" className="ab-livestrip__tile" data-testid="live-strip-tile" data-id={r.id} data-status={r.status} onClick={() => void open(r)}>
            <span className={`ab-lib__status is-${r.status}`}>
              <i />
            </span>
            <span className="ab-livestrip__text">
              <b>{r.host === "app" ? `Open ${r.name} (${r.app})` : r.name}</b>
              <small>{said[r.id] ?? `${hostLine(r)}${r.status === "login" ? " · login" : r.status === "down" ? " · down" : ""}`}</small>
            </span>
          </button>
        ))
      ) : null}
    </section>
  );
}


function Documents({ data, q }: { data: LibraryData; q: string }) {
  const [scope, setScope] = usePersisted<string>("library.docs.scope", "all");
  const docs = data.documents;
  if (!docs) return <p className="ab-lib__quiet">Document discovery is not available from this server yet.</p>;
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = docs.rows.filter(d => (scope === "all" || (scope === "internal" ? d.privacy === "internal" : d.privacy !== "internal")) && terms.every(t => `${d.title} ${d.project} ${d.domain} ${d.owner ?? ""} ${d.source} ${d.reference} ${d.privacy}`.toLowerCase().includes(t)));
  return <section className="ab-lib__body" data-testid="library-docs">
    <p className="ab-lib__summary"><b>{rows.length}</b> of {docs.rows.length} document links{docs.fetchedAt ? ` · catalogue read ${ago(docs.fetchedAt, data.at)}` : ""} · {docs.scope}</p>
    {(docs.stale || docs.error) && <p className="ab-lib__summary ab-lib__stale" role="status">{docs.stale ? "Catalogue copy is stale; source availability is unverified." : "Catalogue unavailable; internal documents remain listed."}</p>}
    <div className="ab-lib__chips" role="group" aria-label="Document source">{[["all", "All documents"], ["internal", "Domain base"], ["catalogue", "Catalogue"]].map(([id, label]) => <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)}>{label}</button>)}</div>
    {!rows.length && <p className="ab-lib__quiet">No documents match. Try a project, owner or source path.</p>}
    <div className="ab-lib__rows">{rows.map(d => {
      return <article className="ab-lib__document" key={d.id} data-testid="document-row">
        <div className="ab-lib__text"><b>{d.title}</b><small>{d.project} · {d.domain} · {d.owner ?? "Owner not recorded"} · {d.privacy}</small><small>{d.source} · {d.reference}</small><small>{d.note}{d.revision ? ` · Source revision: ${d.revision}` : ""}</small></div>
        <button type="button" className="ab-lib__open" onClick={() => { location.hash = libraryHref("document", d.id); }}>View document</button>
      </article>;
    })}</div>
  </section>;
}
