import type { ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { compact } from "../lib/agents";
import { creditFigure, creditSample, reportedCredit } from "../lib/credit-reading";
import { AgentFace } from "../lib/face";
import { useSharedResult } from "../lib/poll";
import { todayReport, todayUsd, useSpend } from "../lib/spend";
import { dayGroup, useA0Tasks } from "../lib/a0-tasks";
import { topSpendProject } from "./SpendPanel";
import { WhatsNewLink } from "./WhatsNew";
import "./FleetStats.css";

// ---------------------------------------------------------------- what the routes answer (only the fields read here)

type Health = { source: string; at: number | null; level: string; why: string[]; detail: string | null; cpus: number | null; load: number[] | null; memTotalGb: number | null; memAvailGb: number | null; diskTotalGb: number | null; diskFreeGb: number | null; diskUsedGb: number | null };
type Server = { key: string; name: string; here: boolean; client: boolean; watched: boolean; health: Health; agents: { count: number | null; byStatus: Record<string, number> | null; note: string | null }; tokensToday: unknown; tokensWhyNull: string | null; services: { count: number | null; failed: number | null } | null };
type Servers = { servers: Server[]; fleetAt: number | null };
type Lane = { id: string; branch: string; by: string; state: string; built_at: string | null; live_at: string | null; why: string };
type Ship = { at: string; today: { live: number; deploys: number; leadMin: { median: number; min: number; max: number } | null; waiting: number; conflict: number; failed: number; dropped: number; gaps: { from: string; to: string; held: string | null }[] }; lanes: Lane[] };
type Window = { used_pct?: number | null; resets_at?: number | string | null; pct_per_hour?: number | null; hours_to_full?: number | null; stale?: boolean };
type Login = { login: string; profile: string; five_hour?: Window; seven_day?: Window };
type Grant = { name?: string; label?: string; left_usd?: number; limit_usd?: number; spent_usd?: number; usd_per_hour?: number | null; usd_per_day_to_spend_it?: number | null; ends?: string | null };
type Codex = { balance?: { now?: number; of?: number; limit?: number; today_spent?: number; per_day?: number }; per_day?: number; limit?: number; reset?: string | number | null };
type Usage = { source: "pending" | "stack-opt"; stale?: boolean; refreshing?: boolean; reason?: string; at?: number; data?: { at?: number | string; claude?: Login[]; grants?: Grant[]; codex?: Codex; split?: { today: unknown; yesterday: unknown } } };
type Tokens = { accounts?: { id: string; today?: { total: number; cost: number } }[] };

// ---------------------------------------------------------------- small parts

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hhmm = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "";
  const d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
  return Number.isNaN(d.valueOf()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};
/** "06:50" today, else "Tue 20:00". */
const dayTime = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "";
  const d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toDateString() === new Date().toDateString() ? hhmm(v) : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(v)}`;
};
const msOf = (v: number | string | null | undefined) => (v == null ? NaN : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
const pct = (n: number | null | undefined) => (typeof n === "number" ? Math.max(0, Math.min(100, n)) : null);

/** Each card's **i**: the endpoint and field it reads (rule 7: sources go behind an i, never under a value). */
function Info({ src }: { src: string }) {
  return <span className="ab-st__i" tabIndex={0} role="img" title={`From ${src}`} aria-label={`From ${src}`}>i</span>;
}
/** A card that loads, fails and fills on its own: one failing route blanks only its card. */
function Card({ title, src, error, loading, className = "", testid, children }: { title: ReactNode; src: string; error?: string; loading?: boolean; className?: string; testid: string; children?: ReactNode }) {
  return <section className={`ab-st__card ${className}`} data-testid={testid}>
    <header className="ab-st__head"><h2>{title}</h2><Info src={src} /></header>
    {error ? <p className="ab-st__down" role="status">Unavailable: {error}</p> : loading ? <div className="ab-st__skel" aria-label="Loading" /> : children}
  </section>;
}
function Meter({ value, warnAt, label }: { value: number | null; warnAt?: number; label: string }) {
  return <span className={`ab-st__meter${warnAt !== undefined && value !== null && value >= warnAt ? " is-hot" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
    <i style={{ width: `${value ?? 0}%` }} />
  </span>;
}

// ---------------------------------------------------------------- the data, one read each (lib/poll: ≥ 5 s, nothing while hidden)

function useFleet() {
  const servers = useSharedResult<Servers>("/api/servers", 30_000);
  const ship = useSharedResult<Ship>("/api/ship", 30_000);
  const usage = useSharedResult<Usage>("/api/usage", 60_000);
  const tokens = useSharedResult<Tokens>("/api/tokens", 60_000);
  const spend = useSpend();
  const { index } = useA0Tasks();
  const list = servers.data?.servers ?? [];
  const here = list.find((s) => s.here) ?? null;
  const working = here?.agents.byStatus?.working ?? null;
  const tasksLive = index ? index.tasks.filter((t) => t.live_at && dayGroup(t.live_at) === "Today").length : null;
  return { servers, ship, usage, tokens, spend, list, here, working, tasksLive };
}
type Fleet = ReturnType<typeof useFleet>;

/** "10 things went live today, half within 30 min of being built." */
function liveClause(ship: Ship): string {
  const live = ship.lanes.filter((l) => l.live_at && dayGroup(l.live_at) === "Today");
  if (!ship.today.live) return "Nothing has gone live today.";
  const quick = live.filter((l) => (msOf(l.live_at) - msOf(l.built_at)) / 60_000 <= 30).length;
  const n = ship.today.live;
  const share = quick === n ? (n === 1 ? "within" : "all within") : quick === 0 ? "none within" : n >= 4 && Math.abs(quick * 2 - n) <= 1 ? "half within" : `${quick} within`;
  return `${n} thing${n === 1 ? "" : "s"} went live today, ${share} 30 min of being built.`;
}
const loginsOf = (u: Usage | null) => [...(u?.data?.claude ?? [])].sort((a, b) => (b.seven_day?.used_pct ?? -1) - (a.seven_day?.used_pct ?? -1));

/** "3 working · 10 live today": the popped-out header's one line. */
export function StatsAnswer() {
  const f = useFleet();
  const bits = [f.working !== null ? `${f.working} working` : null, f.ship.data ? `${f.ship.data.today.live} live today` : null].filter(Boolean);
  return bits.length ? <>{bits.join(" · ")}</> : null;
}

// ---------------------------------------------------------------- the cards

function StatBar({ f }: { f: Fleet }) {
  const others = f.list.filter((s) => !s.here && (s.agents.count ?? 0) > 0);
  const otherCount = others.reduce((n, s) => n + (s.agents.count ?? 0), 0);
  const report = todayReport(f.spend);
  const top = report ? topSpendProject(report) : null;
  const t = f.ship.data?.today;
  const cell = (key: string, label: string, period: string, figure: ReactNode, pill: ReactNode, pillTone: string, line: ReactNode, src: string, state: { error?: string; loading?: boolean }) =>
    <div className="ab-st__cell" data-cell={key} key={key}>
      <div className="ab-st__celltop"><span className="ab-st__label">{label} <small>{period}</small></span><b className="ab-st__fig">{state.error ? "—" : state.loading ? "…" : figure}</b></div>
      {state.error ? <p className="ab-st__down">Unavailable: {state.error}</p> : !state.loading && <>
        {pill && <span className={`ab-st__pill is-${pillTone}`}>{pill}</span>}
        {line && <p className="ab-st__muted">{line}</p>}
      </>}
      <Info src={src} />
    </div>;
  return <div className="ab-st__bar" data-testid="stat-bar">
    {cell("working", "Working now", "agents", f.working ?? "—", f.here?.agents.count != null ? `${f.here.agents.count} open on this Mac` : null, "cyan", otherCount ? `+${otherCount} running on ${others.map((s) => s.name).join(" and ")}` : "nothing recorded running elsewhere", "/api/servers → servers[].agents (byStatus.working from herdr on this Mac; count from the fleet record elsewhere)", { error: f.servers.error, loading: !f.servers.data })}
    {cell("live", "Went live", "today", t?.live ?? "—", t ? `${t.deploys} deploy${t.deploys === 1 ? "" : "s"}` : null, "green", f.tasksLive !== null ? `${f.tasksLive} task${f.tasksLive === 1 ? "" : "s"} moved to Live` : null, "/api/ship → today.live, today.deploys; /api/a0/tasks → live_at today", { error: f.ship.error, loading: !f.ship.data })}
    {cell("lead", "Built → live", "median today", t?.leadMin ? `${t.leadMin.median} min` : "—", "alarm at 20", "grey", t ? `${t.leadMin ? `fastest ${t.leadMin.min} · slowest ${t.leadMin.max} · ` : ""}${t.waiting} waiting` : null, "/api/ship → today.leadMin {median, min, max}, today.waiting", { error: f.ship.error, loading: !f.ship.data })}
    {cell("spend", "Spend", "today", todayUsd(f.spend) ?? "—", "API prices", "grey", top ? `${top.project} ${usd(top.claude_usd_equiv)} of it` : f.spend ? "waiting on EFFICIENCY's meter" : null, "/api/spend → today.usd (the Tokens scan), data.projects", { loading: !f.spend })}
  </div>;
}

function ShipCard({ f }: { f: Fleet }) {
  const s = f.ship.data;
  const now = Date.now();
  const lanes = (s?.lanes ?? []).filter((l) => l.built_at && ["live", "landed", "queued", "merged"].includes(l.state) && (l.state !== "live" || (l.live_at && dayGroup(l.live_at) === "Today")));
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const from = Math.max(midnight.valueOf(), Math.min(now - 3_600_000, ...lanes.map((l) => msOf(l.built_at))));
  const span = Math.max(1, now - from);
  const x = (ms: number) => `${(100 * (Math.max(from, Math.min(now, ms)) - from)) / span}%`;
  const hours: number[] = [];
  // Each hour on a short day; every 2nd, 3rd… on a long one, so the labels never collide (at most 8).
  const step = 3_600_000 * Math.max(1, Math.ceil(span / 3_600_000 / 8));
  for (let h = Math.ceil(from / step) * step; h < now - span * 0.08; h += step) hours.push(h);
  const t = s?.today;
  const also = t ? [t.conflict && `${t.conflict} handed back with conflicts`, t.failed && `${t.failed} failed check${t.failed === 1 ? "" : "s"}`, t.dropped && `${t.dropped} dropped`, ...t.gaps.map((g) => `no deploy ${hhmm(g.from)}–${hhmm(g.to)}${g.held ? ` (held: ${g.held})` : ""}`)].filter(Boolean) : [];
  const minutes = (l: Lane) => Math.round(((l.live_at ? msOf(l.live_at) : now) - msOf(l.built_at)) / 60_000);
  const recent = [...lanes].sort((a, b) => msOf(b.live_at ?? b.built_at) - msOf(a.live_at ?? a.built_at)).slice(0, 5);
  return <Card title="Shipped today, built → live" src="/api/ship → lanes[] (built_at, live_at), today" error={f.ship.error} loading={!s} className="is-ship" testid="stats-ship">
    {s && (lanes.length ? <>
      <ol className="ab-ship" aria-label="Lanes on a shared time axis">
        {lanes.map((l) => {
          const kind = l.state === "live" ? "live" : l.state === "landed" ? "held" : "alive";
          return <li key={l.id} className={`ab-ship__row is-${kind}`} data-lane={l.id}>
            <AgentFace name={l.by || l.branch} status={kind === "live" ? "done" : "working"} size={14} />
            <span className="ab-ship__branch" title={l.branch}>{l.branch}</span>
            <span className="ab-ship__track"><i style={{ left: x(msOf(l.built_at)), width: `calc(${x(l.live_at ? msOf(l.live_at) : now)} - ${x(msOf(l.built_at))})` }} title={kind === "held" ? `landed, deploy waiting${l.why ? `: ${l.why}` : ""}` : kind === "alive" ? `${l.state}, not live yet` : `live ${hhmm(l.live_at)}`} /></span>
            <b className="ab-ship__min">{minutes(l)} min</b>
          </li>;
        })}
      </ol>
      <div className="ab-ship__axis" aria-hidden="true">{hours.map((h) => <span key={h} style={{ left: x(h) }}>{hhmm(h)}</span>)}<span style={{ left: "100%" }}>now</span></div>
      <ol className="ab-ship__recent" aria-label="The five most recent lanes">
        {recent.map((l) => <li key={l.id}><AgentFace name={l.by || l.branch} status={l.live_at ? "done" : "working"} size={20} /><span><b title={l.branch}>{l.branch}</b><small>{(l.by || "—").toUpperCase()} · {l.live_at ? `live ${hhmm(l.live_at)}` : l.state === "landed" ? "landed, deploy waiting" : l.state}</small></span><em className={l.live_at ? "is-live" : "is-alive"}>{minutes(l)} min</em></li>)}
      </ol>
      <p className="ab-ship__sum">{t!.live} live · {t!.waiting} waiting · {t!.conflict} handed back</p>
    </> : <p className="ab-st__quiet">Nothing built today has reached the ship queue yet.</p>)}
    {also.length > 0 && <p className="ab-st__foot">Also today: {also.join(" · ")}</p>}
  </Card>;
}

function LoginsCard({ f }: { f: Fleet }) {
  const logins = loginsOf(f.usage.data);
  const accounts = f.tokens.data?.accounts ?? [];
  const pending = f.usage.data?.source === "pending";
  return <Card title={<>Claude logins{f.usage.data?.stale && f.usage.data.at ? <small> · as of {hhmm(f.usage.data.at)}</small> : null}</>} src="/api/usage → data.claude[]; /api/tokens → accounts[] (today)" error={f.usage.error} loading={!f.usage.data} className="is-logins" testid="stats-logins">
    {pending ? <p className="ab-st__quiet">Waiting for STACK-OPT's burn-rate.</p> : logins.length ? <div className="ab-logins">{logins.map((l) => {
      const id = `claude:${l.profile.split("/").filter(Boolean).pop() ?? l.login}`;
      const acct = accounts.find((a) => a.id === id) ?? accounts.find((a) => a.id === `claude:${l.login}`);
      const w = l.seven_day ?? {}, h = l.five_hour ?? {};
      const fills = w.hours_to_full != null && Number.isFinite(msOf(w.resets_at)) && Date.now() + w.hours_to_full * 3_600_000 < msOf(w.resets_at);
      return <div className="ab-login" key={l.profile || l.login} data-login={l.login}>
        <div className="ab-login__name"><b>{l.login}</b><small title={l.profile}>{l.profile}</small></div>
        {acct?.today && <p className="ab-st__muted">{compact(acct.today.total)} tokens · {usd(acct.today.cost)} today</p>}
        <div className="ab-login__meter"><span>5 h</span><Meter value={pct(h.used_pct)} label={`${l.login} 5 hour window`} /><b>{pct(h.used_pct) ?? "—"}%</b><small>{h.resets_at ? `resets ${dayTime(h.resets_at)}` : ""}</small></div>
        <div className="ab-login__meter"><span>week</span><Meter value={pct(w.used_pct)} warnAt={70} label={`${l.login} week`} /><b>{pct(w.used_pct) ?? "—"}%</b><small>{w.resets_at ? `resets ${dayTime(w.resets_at)}` : ""}</small></div>
        {fills && <p className="ab-login__warn"><b>Full in ~{Math.round(w.hours_to_full!)} h</b>{w.pct_per_hour != null ? ` at +${w.pct_per_hour.toFixed(1)} %/h` : ""}, well before it resets</p>}
      </div>;
    })}</div> : <p className="ab-st__quiet">No Claude logins reported.</p>}
  </Card>;
}

function Ring({ value, size }: { value: number; size: number }) {
  const r = 15.5, c = 2 * Math.PI * r;
  return <svg className="ab-ring" viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
    <circle cx="18" cy="18" r={r} className="ab-ring__bg" />
    <circle cx="18" cy="18" r={r} className="ab-ring__fg" strokeDasharray={`${(c * Math.max(0, Math.min(1, value))).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 18 18)" />
  </svg>;
}

function GrantCard({ f }: { f: Fleet }) {
  const grants = f.usage.data?.data?.grants ?? [];
  return <Card title="The cloud grant" src="/api/usage → data.grants[] (left_usd, usd_per_hour, usd_per_day_to_spend_it, ends)" error={f.usage.error} loading={!f.usage.data} className="is-grant" testid="stats-grant">
    {grants.length ? grants.map((g, i) => {
      const left = g.left_usd ?? null;
      const limit = g.limit_usd ?? (left !== null && g.spent_usd != null ? left + g.spent_usd : null);
      const spent = g.spent_usd ?? (limit !== null && left !== null ? limit - left : null);
      const empties = left !== null && g.usd_per_hour ? left / g.usd_per_hour : null;
      return <div className="ab-grant" key={g.name ?? g.label ?? i}>
        <Ring value={left !== null && limit ? left / limit : 0} size={64} />
        <div>
          <p className="ab-grant__fig"><b>{left !== null ? usd(left) : "—"}</b> left{limit ? ` of ${usd(limit)}` : ""}</p>
          <p className="ab-st__muted">{spent !== null ? <>Spent <b>{usd(spent)}</b>. </> : null}{g.usd_per_hour ? <>The last hour ran at <b>{usd(g.usd_per_hour)}/h</b>{empties !== null ? `, which would empty it in ~${Math.round(empties)} h` : ""}; </> : null}{g.usd_per_day_to_spend_it ? <><b>{usd(g.usd_per_day_to_spend_it)} a day</b> uses it all{g.ends ? ` by ${new Date(g.ends).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}.</> : null}</p>
        </div>
      </div>;
    }) : <p className="ab-st__quiet">{f.usage.data?.source === "pending" ? "Waiting for STACK-OPT's burn-rate." : "No grant reported."}</p>}
  </Card>;
}

/** A spend-ledger number: a count, a [lo, hi] range or { lo, hi } / { min, max } / { credits }. */
const amount = (v: unknown): [number, number] | null => {
  if (typeof v === "number") return [v, v];
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")) return v as [number, number];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const [a, b] of [["lo", "hi"], ["min", "max"]] as const) if (typeof o[a] === "number" && typeof o[b] === "number") return [o[a] as number, o[b] as number];
    for (const k of ["credits", "total", "range"]) if (o[k] !== undefined) return amount(o[k]);
  }
  return null;
};
const pick = (o: unknown, name: string): unknown => {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, unknown>;
  const hit = Object.keys(r).find((k) => k.toLowerCase() === name);
  if (hit) return r[hit];
  for (const k of ["split", "models", "by_model", "credits"]) if (r[k] && typeof r[k] === "object") { const v = pick(r[k], name); if (v !== undefined) return v; }
  return undefined;
};
const topOf = (v: unknown): string[] => {
  const list = v && typeof v === "object" ? (v as Record<string, unknown>).top ?? (v as Record<string, unknown>).most : undefined;
  return Array.isArray(list) ? list.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).agent ?? "") : "")).filter(Boolean).slice(0, 2) : [];
};
/** Sol and Luna from one day of `spend-ledger split --json`; null when it carries neither. */
export function readSplit(day: unknown): { sol: [number, number]; luna: [number, number]; share: number; top: string[] } | null {
  const sol = amount(pick(day, "sol")), luna = amount(pick(day, "luna"));
  if (!sol || !luna) return null;
  const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
  const total = mid(sol) + mid(luna);
  return total > 0 ? { sol, luna, share: mid(sol) / total, top: topOf(pick(day, "sol")) } : null;
}
const range = (r: [number, number]) => (r[0] === r[1] ? `${Math.round(r[0])}` : `${Math.round(r[0])}–${Math.round(r[1])}`);

function CodexCard({ f }: { f: Fleet }) {
  const c = f.usage.data?.data?.codex;
  const b = c?.balance ?? {};
  const of = reportedCredit(b.of ?? b.limit ?? c?.limit);
  const perDay = reportedCredit(b.per_day ?? c?.per_day);
  const spent = reportedCredit(b.today_spent);
  const split = f.usage.data?.data?.split;
  const today = readSplit(split?.today), yesterday = readSplit(split?.yesterday);
  const shown = today ?? yesterday;
  return <Card title="Codex credits" src="/api/usage → cached burn-rate data.codex (balance, per_day, reset), data.at (sample time), data.split (spend-ledger split); account identity unavailable" error={f.usage.error} loading={!f.usage.data} className="is-codex" testid="stats-codex">
    {c ? <>
      <p className="ab-codex__fig"><b>{creditFigure(b.now)}</b> reported credits{of !== null ? ` · reported capacity ${creditFigure(of)}` : ""}</p>
      <p className="ab-st__muted" data-testid="stats-codex-provenance">Cached burn reading · {creditSample(f.usage.data?.data?.at, true)}<br />Account not identified by this source</p>
      {spent !== null && <div className="ab-login__meter"><span>reported today</span><Meter value={perDay !== null && perDay > 0 ? pct((100 * spent) / perDay) : null} label="Codex today" /><b>{creditFigure(spent)}{perDay !== null ? ` / ${creditFigure(perDay)}` : ""}</b><small>{c.reset ? `reported reset ${dayTime(c.reset)}` : ""}</small></div>}
      {shown ? <div className="ab-split" data-testid="codex-split">
        <span className="ab-split__bar" aria-label={`Sol ${Math.round(shown.share * 100)}%`}><i className="is-sol" style={{ width: `${shown.share * 100}%` }} /><i className="is-luna" /><em style={{ left: "20%" }} title="Your 20% Sol target" /></span>
        <p><b>{today ? "Today's" : "Yesterday's"} split</b> · Sol <b>{Math.round(shown.share * 100)}%</b> against your 20%</p>
        <p className="ab-st__muted">Sol {range(shown.sol)}{shown.top.length ? ` · most to ${shown.top.join(", ")}` : ""} · Luna {range(shown.luna)}</p>
      </div> : <p className="ab-st__quiet">No Sol/Luna split recorded yet.</p>}
    </> : <p className="ab-st__quiet">{f.usage.data?.source === "pending" ? "Waiting for STACK-OPT's burn-rate." : "No Codex balance reported."}</p>}
    {f.usage.data?.stale && <p className="ab-st__muted">Burn source is stale</p>}
    {f.usage.data?.refreshing && <p className="ab-st__muted" role="status">Refreshing burn source</p>}
    {f.usage.data?.reason && <p className="ab-st__down" role="status">{f.usage.data.reason}</p>}
  </Card>;
}

function MachinesCard({ f }: { f: Fleet }) {
  const withData = f.list.filter((s) => s.health.source !== "none" && (s.health.load || s.health.memTotalGb || s.health.diskTotalGb));
  const without = f.list.filter((s) => !withData.includes(s));
  const bar = (v: number | null, over: number, label: string) => <span className={`ab-mach__bar${v !== null && v > over ? " is-over" : ""}`} title={v === null ? `${label}: no data` : `${label} ${Math.round(v * 100)}%`}><i style={{ width: `${Math.min(100, (v ?? 0) * 100)}%` }} /></span>;
  return <Card title="Machines" src="/api/servers → servers[].health, agents, services" error={f.servers.error} loading={!f.servers.data} className="is-machines" testid="stats-machines">
    {withData.length > 0 && <ol className="ab-mach">{withData.map((s) => {
      const h = s.health;
      const load = h.load?.[0] != null && h.cpus ? h.load[0] / h.cpus : null;
      const mem = h.memTotalGb && h.memAvailGb != null ? (h.memTotalGb - h.memAvailGb) / h.memTotalGb : null;
      const disk = h.diskTotalGb ? (h.diskUsedGb ?? h.diskTotalGb - (h.diskFreeGb ?? 0)) / h.diskTotalGb : null;
      const note = s.services?.count != null ? `${s.services.count} services${s.services.failed ? `, ${s.services.failed} failed` : ""}` : s.agents.count != null ? `${s.agents.count} agent${s.agents.count === 1 ? "" : "s"}` : "";
      const level = h.level === "bad" || h.level === "down" ? "bad" : h.level === "ok" ? "ok" : "warn";
      return <li key={s.key} className={`ab-mach__row is-${level}`} data-machine={s.key}>
        <i className="ab-mach__dot" title={h.level} />
        <b className="ab-mach__name">{s.name}</b>
        <span className="ab-mach__bars">{bar(load, 1, "load ÷ cores")}{bar(mem, 0.9, "memory used")}{bar(disk, 0.9, "disk used")}</span>
        <small className="ab-mach__note">{note}</small>
        {level === "bad" && h.why.length > 0 && <p className="ab-mach__why">{h.why.join(" · ")}</p>}
      </li>;
    })}</ol>}
    {without.length > 0 && <p className="ab-st__quiet">{without.map((s) => `${s.name}: ${s.agents.note?.replace(/^not connected: /, "") ?? s.health.detail ?? "no fleet record"}`).join(" · ")}</p>}
    {!f.list.length && <p className="ab-st__quiet">No machines on the estate map.</p>}
  </Card>;
}

/**
 * The fleet's Stats page (SPEC-STATS-TASKS §3.1, option A, "one screen"; Shaan 3 Oct ~05:00: "spec out a new stats page"):
 * the answer as a sentence, then a stat bar (working, went live, built → live, spend), today's ship timeline, the Claude
 * logins, the cloud grant, Codex credits and the machines. Every figure is a field of /api/servers, /api/ship, /api/spend,
 * /api/usage or /api/tokens, named behind each card's i; one failing route blanks only its card. The same tree fills the
 * popped-out column, laid out by a container query at 470 px.
 */
export function FleetStatsPage({ host = "page", onPop, overview = false }: { host?: "page" | "pop"; onPop?: () => void; overview?: boolean }) {
  const f = useFleet();
  const ship = f.ship.data;
  const top = loginsOf(f.usage.data)[0];
  const week = pct(top?.seven_day?.used_pct);
  const stamps = [f.servers.data ? Date.now() : null, ship ? Date.parse(ship.at) : null].filter((n): n is number => n !== null);
  const notRecorded = [
    ...(() => { const names = f.list.filter((s) => !s.here && !s.client && s.tokensWhyNull).map((s) => s.name); return names.length ? [`tokens used on ${names.join(" and ")} (this app reads only this Mac's session files)`] : []; })(),
    ...(f.usage.data?.data && !readSplit(f.usage.data.data.split?.today) ? ["today's Sol/Luna split (spend-ledger reads only this Mac's Codex rollouts, so yesterday's shows until today has credits)"] : []),
  ];
  const Container = overview ? "section" : "main";
  return <Container className="ab-st" data-host={host} data-testid="fleet-stats">
    {!overview && <header className="ab-st__top">
      <div className="ab-st__title">
        {host === "page" && <h1>Stats</h1>}
        <p className="ab-st__sentence" data-testid="stats-sentence">
          {f.working !== null ? <b>{f.working} agent{f.working === 1 ? "" : "s"} working.</b> : f.servers.error ? "Agents unavailable." : "Counting agents…"}{" "}
          {ship ? liveClause(ship) : null}{" "}
          {top && week !== null && week >= 60 ? <><b>{top.login}</b> is at {Math.round(week)}% of its week.</> : null}
        </p>
      </div>
      {host === "page" && <div className="ab-st__right">
        {stamps.length > 0 && <small>updated {hhmm(Math.max(...stamps))}</small>}
        <WhatsNewLink testid="stats-whats-new" />
        {onPop && <button type="button" className="ab-st__pop" onClick={onPop} title="Pop out beside the side nav · ⌥-click Stats"><PanelLeftOpen size={14} aria-hidden="true" />Pop out</button>}
      </div>}
    </header>}
    <StatBar f={f} />
    {overview && <ShipCard f={f} />}
    {!overview && <div className="ab-st__grid">
      <ShipCard f={f} />
      <LoginsCard f={f} />
      <GrantCard f={f} />
      <CodexCard f={f} />
      <MachinesCard f={f} />
    </div>}
    {/* SPEC-STATS-TASKS §6 q2-q3, the spec's defaults, said on the page. */}
    {!overview && <p className="ab-st__foot" data-testid="stats-foot">
      {notRecorded.length ? <>Not recorded yet: {notRecorded.join(" · ")}. </> : null}
      Working counts this Mac's herdr only; other machines report running processes, not states.
    </p>}
  </Container>;
}
