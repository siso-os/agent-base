import { usageAge } from "../lib/usage-age";
import { creditFigure } from "../lib/credit-reading";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Blocks, Brain, CalendarDays, CheckIcon, CopyIcon, Crown, Feather, Flame, FolderGit2, Footprints, Heart, Medal, MoonStar, PanelRightOpen, Rocket, ShieldCheck, TrendingUp, Zap, type LucideProps } from "lucide-react";
import { useShared, useSharedState } from "../lib/poll";
import { compact } from "../lib/agents";
import { AgentFace } from "../lib/face";
import { useSpend } from "../lib/spend";
import { Ring } from "./page/Figures";

/*
 * MIT License
 * Copyright (c) 2026 xiufengsun
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
 * copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * The Tokens space, laid out as TokenTracker's dashboard (t-0043, Shaan: "bring over that ui from the like that open
 * source repo ... token tracker"). Ported from github.com/mm7894215/TokenTracker dashboard/src at 36f3151 (MIT, see
 * THIRD_PARTY_NOTICES.md): DashboardView's two columns, StatsPanel, ActivityHeatmap, UsageOverview (period tabs, the big
 * total, provider cards, model rows), LeaderboardPage's ranked table and medals, AchievementsSection's coin wall and
 * tier palette. Rewritten in TypeScript on this app's dark tokens (packages/siso-tokens via @siso/shell: bg-surface,
 * bg-raised, border-border, text-foreground, text-muted-foreground, brand orange), with no motion/dnd/i18n.
 * Data: GET /api/tokens (services/node/src/tokens.ts), unchanged; the last answer is kept in memory and localStorage so
 * the page paints at once and refreshes behind it.
 */

type Sum = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number; unpricedTokens: number; messages: number };
type Limit = { usedPct: number; resetsAt: number | null; expired: boolean } | null;
type Person = { email: string | null; label: string; mine: boolean };
type Account = {
  id: string;
  name: string;
  folder?: string;
  person?: Person | null;
  kind: "claude" | "codex" | "other" | "unattributed";
  command?: string;
  today: Sum;
  week: Sum;
  month: Sum;
  allTime: Sum;
  firstAt: number | null;
  lastAt: number | null;
  models: { model: string; total: number; cost: number }[];
  modelsToday?: { model: string; total: number; cost: number }[];
  modelsWeek?: { model: string; total: number; cost: number }[];
  limits: { fiveHour: Limit; weekly: Limit; at: number; source: string; stale?: boolean; ageMs?: number; credits?: { balance: number | null; hasCredits: boolean | null; unlimited: boolean | null } } | null;
};
type Badge = { id: string; name: string; what: string; value: number; tier: number; tierName: string | null; thresholds: number[]; next: number | null; local: boolean };
export type Tokens = {
  at: number;
  scanning: boolean;
  cached?: boolean;
  scanMs: number;
  files: number;
  ranges: { today: string; weekFrom: string; monthFrom: string; timeZone: string };
  overall: { today: Sum; week: Sum; month: Sum; allTime: Sum };
  accounts: Account[];
  daily: { day: string; total: number; output: number; cost: number; byAccount: Record<string, number> }[];
  heatmap: { day: string; value: number; level: number }[];
  hourOfDay: { hour: number; total: number; output: number }[];
  attribution: Record<string, number>;
  achievements: Badge[];
  notes: string[];
  oldest?: number | null;
};
type BurnWindow = { used_pct: number | null; resets_at: number | string | null; pct_per_hour: number | null; hours_to_full: number | null; stale: boolean };
type Usage = { stale?: boolean; refreshing?: boolean; attemptedAt?: number | null; reason?: string; source: "pending" | "stack-opt"; data?: { at: number; window_min: number; claude: { login: string; profile: string; five_hour: BurnWindow; seven_day: BurnWindow }[]; codex: { credits_per_hour: [number, number]; pct_of_budget_per_hour: [number, number]; today_credits: [number, number]; left: [number, number]; hours_left_at_rate: number | null; by_model_per_hour: Record<string, [number, number]> } } };
type Period = "today" | "week" | "month" | "allTime";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "allTime", label: "All time" },
];
const PALETTE = ["rgb(255 167 38)", "rgb(56 189 248)", "rgb(53 212 155)", "rgb(167 139 250)", "rgb(255 128 147)", "rgb(158 158 152)"];
// TokenTracker's UsageOverview PROVIDER_COLORS (Claude is Anthropic's orange-red, Codex blue-500).
const PROVIDER_COLOR: Record<string, string> = { Claude: "#d97757", Codex: "#3b82f6", Other: "#a78bfa" };
// TokenTracker's ActivityHeatmap HEATMAP_COLORS_DARK, level 0 lifted onto this app's surface.
const HEAT = ["rgb(255 255 255 / 0.05)", "#065f46", "#059669", "#10b981", "#34d399"];

const usd = (n: number) => (n <= 0 ? "$0" : n < 0.01 ? "<$0.01" : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(n >= 10 ? 0 : 2)}`);
const pct = (part: number, whole: number) => (whole > 0 ? ((100 * part) / whole).toFixed(1) : "0.0");
const left = (ms: number | null) => {
  if (!ms) return "";
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return m < 60 ? `${m}m left` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h left`;
};
const ago = (ms: number | null) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const providerOf = (a: Account) => (a.kind === "codex" ? "Codex" : a.kind === "other" ? "Other" : "Claude");

// ---------------------------------------------------------------- data, cached so the page opens at once

const STORE_KEY = "ab.tokens.v1";
let lastTokens: Tokens | null = null;
export function isTokensShape(value: unknown): value is Tokens {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<Tokens>;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const plain = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  const sum = (v: unknown) => plain(v) && ["input", "output", "cacheRead", "cacheWrite", "total", "cost", "unpricedTokens", "messages"].every((k) => finite(v[k]));
  const limit = (v: unknown) => v === null || (plain(v) && finite(v.usedPct) && (v.resetsAt === null || finite(v.resetsAt)) && typeof v.expired === "boolean");
  const account = (v: unknown) => plain(v) && typeof v.id === "string" && typeof v.name === "string" && ["claude", "codex", "other", "unattributed"].includes(String(v.kind)) && ["today", "week", "month", "allTime"].every((k) => sum(v[k]))
    && Array.isArray(v.models) && v.models.every((m) => plain(m) && typeof m.model === "string" && finite(m.total) && finite(m.cost))
    && (v.limits === null || (plain(v.limits) && finite(v.limits.at) && limit(v.limits.fiveHour) && limit(v.limits.weekly)));
  const totals = plain(d.overall) && ["today", "week", "month", "allTime"].every((k) => sum((d.overall as any)[k]));
  return finite(d.at) && typeof d.scanning === "boolean" && Array.isArray(d.accounts) && d.accounts.every(account) && Array.isArray(d.daily)
    && d.daily.every((x) => plain(x) && typeof x.day === "string" && finite(x.total) && finite(x.output) && finite(x.cost) && plain(x.byAccount))
    && Array.isArray(d.heatmap) && d.heatmap.every((x) => plain(x) && typeof x.day === "string" && finite(x.value) && finite(x.level))
    && Array.isArray(d.hourOfDay) && d.hourOfDay.every((x) => plain(x) && finite(x.hour) && finite(x.total) && finite(x.output))
    && Array.isArray(d.achievements) && d.achievements.every((b) => plain(b) && typeof b.id === "string" && typeof b.name === "string" && typeof b.what === "string" && finite(b.value) && finite(b.tier) && (b.tierName === null || typeof b.tierName === "string") && Array.isArray(b.thresholds) && b.thresholds.every(finite) && (b.next === null || finite(b.next)))
    && Array.isArray(d.notes) && d.notes.every((x) => typeof x === "string") && plain(d.attribution) && Object.values(d.attribution).every(finite)
    && plain(d.ranges) && typeof d.ranges.today === "string" && typeof d.ranges.weekFrom === "string" && typeof d.ranges.monthFrom === "string" && typeof d.ranges.timeZone === "string" && totals;
}
function cachedTokens(): Tokens | null {
  if (lastTokens) return lastTokens;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (isTokensShape(parsed)) lastTokens = parsed;
  } catch {
    /* no storage, or an old shape: fetch instead */
  }
  return lastTokens;
}

/** One poll of /api/tokens; `fresh` turns true at the first answer this visit (until then `data` is the saved last run). */
export function useTokens(enabled = true) {
  const [data, setData] = useState<Tokens | null>(cachedTokens);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let again = 60_000;
      // A hidden window does not read (the app's poll rule, lib/poll.ts); it looks again when it is next due.
      if (document.hidden) return void (timer = setTimeout(tick, 5_000));
      try {
        const r = await fetch("/api/tokens", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const parsed = await r.json();
        if (!isTokensShape(parsed)) throw new Error("Invalid tokens response");
        const d = parsed;
        if (!live) return;
        lastTokens = d;
        setData(d);
        setError(null);
        setFresh(true);
        if (d.scanning) again = 2_000; // the first read of every session file is still running
        else {
          try {
            localStorage.setItem(STORE_KEY, JSON.stringify(d));
          } catch {
            /* storage full or off: the server's cache still answers fast */
          }
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
      if (live) timer = setTimeout(tick, again);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  return { data, error, fresh };
}

// ---------------------------------------------------------------- TokenTracker's Card

function Card({ title, aside, children, className = "", testId, bodyClassName = "p-5" }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string; testId?: string; bodyClassName?: string }) {
  return (
    <section data-testid={testId} className={`min-w-0 rounded-xl border border-border bg-surface ${className}`}>
      {title && (
        <div className="flex items-baseline gap-2 border-b border-border px-5 py-3.5">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
          {aside && <span className="ml-auto truncate text-[11px] text-muted-foreground">{aside}</span>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- StatsPanel

function StatsPanel({ data, period }: { data: Tokens; period: Period }) {
  const days = data.daily;
  const last7 = days.slice(-7).reduce((a, d) => a + d.total, 0);
  const last30 = days.reduce((a, d) => a + d.total, 0);
  const active = days.filter((d) => d.total > 0).length;
  const tiles: [string, string][] = [
    [compact(last7), "Last 7 days"],
    [compact(last30), "Last 30 days"],
    [compact(active ? Math.round(last30 / active) : 0), "Avg / active day"],
    [compact(data.overall[period].messages), "Requests"],
  ];
  const models = topModels(data.accounts).slice(0, 3);
  const modelTotal = data.accounts.reduce((a, x) => a + x.models.reduce((b, m) => b + m.total, 0), 0);
  const streak = data.achievements.find((b) => b.id === "streak")?.value ?? 0;
  const since = data.oldest ? new Date(data.oldest).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—";
  return (
    <Card testId="tt-stats">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {tiles.map(([v, k]) => (
          <div key={k} className="flex min-w-0 flex-col items-center justify-center rounded-lg bg-raised px-2 py-2">
            <span className="w-full truncate text-center text-sm font-semibold tabular-nums text-foreground">{v}</span>
            <span className="mt-0.5 w-full truncate whitespace-nowrap text-center text-[10px] text-muted-foreground">{k}</span>
          </div>
        ))}
      </div>
      {models.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          {models.map((m, i) => (
            <div key={m.model} className={`flex items-center py-2 ${i < models.length - 1 ? "border-b border-white/[0.04]" : ""}`}>
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-raised text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
              <span className="flex-1 truncate px-2.5 text-sm text-secondary-label" title={m.model}>
                {m.model}
              </span>
              <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-foreground">{pct(m.total, modelTotal)}%</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          Since <span className="tabular-nums text-secondary-label">{since}</span>
        </span>
        <span>
          Best streak <span className="tabular-nums text-secondary-label">{streak ? `${streak} days` : "—"}</span>
        </span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- ActivityHeatmap

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function Heatmap({ days }: { days: Tokens["heatmap"] }) {
  // TokenTracker lays the year out as week columns (Sunday first) with month markers over the first column of a month.
  const weeks = useMemo(() => {
    if (!days.length) return [] as (Tokens["heatmap"][number] | null)[][];
    const lead = new Date(`${days[0].day}T12:00:00`).getDay();
    const cells: (Tokens["heatmap"][number] | null)[] = [...Array<null>(lead).fill(null), ...days];
    const out: (Tokens["heatmap"][number] | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [days]);
  const markers = useMemo(() => {
    const out: { label: string; col: number }[] = [];
    let prev = -1;
    weeks.forEach((w, col) => {
      const first = w.find(Boolean);
      if (!first) return;
      const m = Number(first.day.slice(5, 7)) - 1;
      if (m !== prev) out.push({ label: MONTHS[m], col });
      prev = m;
    });
    return out.filter((m, i) => i === 0 || m.col - out[i - 1].col >= 3);
  }, [weeks]);
  const total = days.reduce((a, d) => a + d.value, 0);
  const activeDays = days.filter((d) => d.value > 0).length;
  const cell = 11,
    gap = 3;
  // TokenTracker opens the strip on the current week (rightmost), not the oldest months.
  const scroller = useRef<HTMLDivElement>(null);
  // Scrolled to the right, the oldest month's marker sat half out of view ("MAY" read as "Y"): a marker that is not
  // wholly inside the visible strip is hidden, so every month label shown is whole.
  const [view, setView] = useState({ x: 0, w: Infinity });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => ((el.scrollLeft = el.scrollWidth), setView({ x: el.scrollLeft, w: el.clientWidth }));
    fit();
    // A narrower window (a phone, a split) keeps the current week in view, as on open.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);
  const markerX = (col: number) => 22 + gap + col * (cell + gap);
  const cut = (col: number) => markerX(col) < view.x || markerX(col) + 24 > view.x + view.w;
  return (
    <Card title="Activity" aside={`${compact(total)} tokens · ${activeDays} active days · 52 weeks`} testId="tt-heatmap">
      <div ref={scroller} data-testid="usage-heatmap" aria-label="Token usage heatmap, last 52 weeks" className="overflow-x-auto pb-1" onScroll={(e) => setView({ x: e.currentTarget.scrollLeft, w: e.currentTarget.clientWidth })}>
        <div className="inline-block">
          <div className="mb-1 grid text-[10px] uppercase text-muted-foreground" style={{ gridTemplateColumns: `22px repeat(${weeks.length}, ${cell}px)`, columnGap: gap }}>
            {markers.map((m) => (
              <span key={`${m.label}-${m.col}`} style={{ gridColumnStart: m.col + 2, visibility: cut(m.col) ? "hidden" : undefined }} className="whitespace-nowrap" data-testid="heat-month">
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex" style={{ gap }}>
            <div className="grid w-[22px] text-[10px] text-muted-foreground" style={{ gridTemplateRows: `repeat(7, ${cell}px)`, rowGap: gap }}>
              {["", "Mon", "", "Wed", "", "Fri", ""].map((l, i) => (
                <span key={i} className="leading-[11px]">
                  {l}
                </span>
              ))}
            </div>
            <div className="grid grid-flow-col" style={{ gridTemplateRows: `repeat(7, ${cell}px)`, gridAutoColumns: `${cell}px`, gap }}>
              {weeks.flatMap((w, wi) =>
                Array.from({ length: 7 }, (_, di) => {
                  const d = w[di];
                  return d ? (
                    <span key={d.day} title={`${d.day}: ${compact(d.value)} tokens`} className="rounded-[2px]" style={{ width: cell, height: cell, background: HEAT[Math.max(0, Math.min(4, d.level))] }} />
                  ) : (
                    <span key={`pad-${wi}-${di}`} style={{ width: cell, height: cell }} />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="text-[10px] text-muted-foreground">Less</span>
        <div className="flex gap-0.5">
          {HEAT.map((c) => (
            <span key={c} className="rounded-[1px]" style={{ width: 10, height: 10, background: c }} />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">More</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- TrendMonitor (30 days) and hour of day

function Trend({ data, colorOf }: { data: Tokens; colorOf: (id: string) => string }) {
  const days = data.daily;
  const peak = Math.max(...days.map((d) => d.total), 1);
  const w = 100 / Math.max(1, days.length);
  const short = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });
  const hours = data.hourOfDay;
  const hPeak = Math.max(...hours.map((h) => h.total), 1);
  return (
    <Card title="Trend" aside="last 30 days, by account" testId="tt-trend">
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label="Tokens per day, last 30 days">
        {days.map((d, i) => {
          let y = 44;
          return (
            <g key={d.day}>
              <title>{`${short(d.day)} · ${compact(d.total)} tokens · ${usd(d.cost)} est.`}</title>
              {data.accounts.map((a) => {
                const v = d.byAccount[a.id] ?? 0;
                if (!v) return null;
                const h = (42 * v) / peak;
                y -= h;
                return <rect key={a.id} x={i * w + w * 0.14} y={y} width={w * 0.72} height={h} fill={colorOf(a.id)} opacity={0.8} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{days[0] ? short(days[0].day) : ""}</span>
        <span>peak {compact(peak)} / day</span>
        <span>today</span>
      </div>
      <div className="mt-5 text-[10px] uppercase tracking-wide text-muted-foreground">When in the day · purple is 00:00–05:59</div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="mt-1 h-14 w-full" role="img" aria-label="Tokens by hour of day">
        {hours.map((h) => {
          const bh = (30 * h.total) / hPeak;
          return (
            <rect key={h.hour} x={h.hour * (100 / 24) + 0.6} y={32 - bh} width={100 / 24 - 1.2} height={bh} rx={0.5} fill={h.hour < 6 ? "rgb(167 139 250 / 0.8)" : "rgb(56 189 248 / 0.75)"}>
              <title>{`${String(h.hour).padStart(2, "0")}:00 · ${compact(h.total)} tokens`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- UsageOverview: period tabs, the big number, providers, models

function topModels(accounts: Account[]) {
  const by = new Map<string, { model: string; total: number; cost: number }>();
  for (const a of accounts)
    for (const m of a.models) {
      const x = by.get(m.model) ?? { model: m.model, total: 0, cost: 0 };
      x.total += m.total;
      x.cost += m.cost;
      by.set(m.model, x);
    }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

/** TokenTracker's AllToolsIcon: three stacked layers. */
function AllToolsIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 1.6 23 7.4 12 13.2 1 7.4 12 1.6Z" />
      <path d="m4 10.3-3 1.5 11 5.5 11-5.5-3-1.5-8 4-8-4Z" opacity="0.72" />
      <path d="m4 14.6-3 1.5 11 5.5 11-5.5-3-1.5-8 4-8-4Z" opacity="0.45" />
    </svg>
  );
}

function ModelRows({ models, color }: { models: { model: string; total: number; cost: number }[]; color: string }) {
  const whole = models.reduce((a, m) => a + m.total, 0);
  return (
    <div className="space-y-3">
      {models.map((m) => {
        const share = Number(pct(m.total, whole));
        return (
          <div key={m.model} data-model-rank-row>
            {/* On a phone the cost column goes, so the model's name stays readable. */}
            <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_max-content_3rem] items-baseline gap-x-3 sm:grid-cols-[minmax(0,1fr)_minmax(4rem,max-content)_minmax(4rem,max-content)_3.5rem]">
              <span className="min-w-0 truncate text-sm text-secondary-label" title={m.model} data-testid="tt-model-name">
                {m.model}
              </span>
              <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">{compact(m.total)}</span>
              <span className="hidden whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground sm:block">{m.cost > 0 ? usd(m.cost) : "—"}</span>
              <span className="whitespace-nowrap text-right text-sm tabular-nums text-foreground">{share.toFixed(1)}%</span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${share}%`, backgroundColor: color, opacity: 0.6 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsageOverview({ data, period, onPeriod, compactView = false }: { data: Tokens; period: Period; onPeriod: (p: Period) => void; compactView?: boolean }) {
  const [open, setOpen] = useState<string | null>(compactView ? null : "__all__");
  const s = data.overall[period];
  const providers = useMemo(() => {
    const by = new Map<string, { label: string; usage: number; cost: number; accounts: Account[] }>();
    for (const a of data.accounts) {
      // Fahmy's login is out of every total (overall), so it is out of the shares too: it read "Claude 102.8%" (usage lane).
      if (a.person?.mine === false) continue;
      const label = providerOf(a);
      const p = by.get(label) ?? { label, usage: 0, cost: 0, accounts: [] };
      p.usage += a[period].total;
      p.cost += a[period].cost;
      p.accounts.push(a);
      by.set(label, p);
    }
    return [...by.values()].filter((p) => p.usage > 0 || p.label === "Claude").sort((a, b) => b.usage - a.usage);
  }, [data, period]);
  const allModels = useMemo(() => topModels(data.accounts), [data]);
  const range = period === "today" ? data.ranges.today : period === "week" ? `${data.ranges.weekFrom} – ${data.ranges.today}` : period === "month" ? `${data.ranges.monthFrom} – ${data.ranges.today}` : "everything still on disk";
  return (
    <Card testId="tt-overview" className={compactView ? "usage-overview-compact" : ""}>
      {/* The period tabs wrap on a phone rather than scroll sideways. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Period" className="flex min-w-0 flex-1 flex-wrap gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="tab"
              type="button"
              aria-selected={period === p.key}
              onClick={() => onPeriod(p.key)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${period === p.key ? "bg-raised text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{data.ranges.timeZone}</span>
      </div>
      <div className="mb-8 text-center">
        <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">{PERIODS.find((p) => p.key === period)?.label} · tokens</div>
        <div data-testid="tt-total" className="text-5xl font-bold tracking-tight tabular-nums text-foreground sm:text-6xl" title={s.total.toLocaleString()}>
          {s.total.toLocaleString()}
        </div>
        <div className="mt-4 text-xl font-bold text-brand" title="Estimated at Anthropic API list prices">
          {usd(s.cost)}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          {range} · {compact(s.input)} in · {compact(s.output)} out · {compact(s.cacheRead)} cache read · {compact(s.cacheWrite)} cache write
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <button
          type="button"
          aria-expanded={open === "__all__"}
          onClick={() => setOpen(open === "__all__" ? null : "__all__")}
          className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${open === "__all__" ? "border-white/20 bg-raised" : "border-border hover:border-white/20"}`}
        >
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            <AllToolsIcon className="shrink-0 text-brand" />
            <span className="truncate text-sm font-medium text-foreground">All tools</span>
          </div>
          <div className="text-lg font-semibold tabular-nums text-foreground">100.0%</div>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{allModels.length} models</div>
        </button>
        {providers.map((p) => (
          <button
            key={p.label}
            type="button"
            data-testid="tt-provider"
            aria-expanded={open === p.label}
            onClick={() => setOpen(open === p.label ? null : p.label)}
            className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${open === p.label ? "border-white/20 bg-raised" : "border-border hover:border-white/20"}`}
          >
            <div className="mb-1 flex min-w-0 items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PROVIDER_COLOR[p.label] }} />
              <span className="truncate text-sm font-medium text-foreground">{p.label}</span>
            </div>
            <div className="text-lg font-semibold tabular-nums text-foreground">{pct(p.usage, s.total)}%</div>
            <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {compact(p.usage)} · {p.accounts.length} account{p.accounts.length === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </div>
      {open && (
        <div className="mt-4" data-testid="tt-models">
          <div className="mb-1.5 flex items-center gap-1.5">
            {open === "__all__" ? <AllToolsIcon size={14} className="shrink-0 text-brand" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: PROVIDER_COLOR[open] }} />}
            <span className="text-sm font-medium text-foreground">{open === "__all__" ? "All models" : `${open} models`}</span>
          </div>
          <p className="mb-4 text-[11px] leading-snug text-muted-foreground">All time on this machine, each account's top six models. Codex and other providers are counted but unpriced.</p>
          <ModelRows models={open === "__all__" ? allModels : topModels(providers.find((p) => p.label === open)?.accounts ?? [])} color={open === "__all__" ? "rgb(56 189 248)" : PROVIDER_COLOR[open]} />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Leaderboard

const RANK_MEDAL: Record<number, string> = {
  1: "text-amber-400 bg-amber-900/20",
  2: "text-gray-300 bg-gray-800/40",
  3: "text-orange-400 bg-orange-900/20",
};
function RankCell({ rank }: { rank: number }) {
  const medal = RANK_MEDAL[rank];
  return <span className={`inline-flex h-7 w-7 items-center justify-center ${medal ? `rounded-full text-xs font-bold ${medal}` : "text-sm text-muted-foreground"}`}>{rank}</span>;
}

/** The accounts on this machine ranked for the chosen period. TODO(tokens SPEC "Only Shaan can answer" #3): TokenTracker's public board or ours. */
function Leaderboard({ data, period, colorOf }: { data: Tokens; period: Period; colorOf: (id: string) => string }) {
  const rows = data.accounts.filter((a) => a[period].total > 0).sort((a, b) => b[period].total - a[period].total);
  const th = "px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
  return (
    <Card title="Leaderboard" aside={`${PERIODS.find((p) => p.key === period)?.label} · your accounts on this machine`} testId="tt-leaderboard" bodyClassName="overflow-x-auto">
      {rows.length === 0 ? (
        <p className="p-5 text-[12px] text-muted-foreground">Nothing in this period yet.</p>
      ) : (
        // Fixed columns, so a long account name truncates instead of pushing the table wider than a phone.
        <table className="w-full table-fixed text-left">
          <thead className="border-b border-border">
            <tr>
              <th className={`${th} w-12 text-center sm:w-14`}>Rank</th>
              <th className={th}>Account</th>
              <th className={`${th} hidden w-24 text-right sm:table-cell`}>Output</th>
              <th className={`${th} hidden w-24 text-right sm:table-cell`} title="Based on estimated API pricing, not actual billing">
                Est. cost
              </th>
              <th className={`${th} w-[84px] text-right sm:w-32`}>
                Total<span className="hidden sm:inline"> tokens</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={a.id} data-testid="tt-leaderboard-row" className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 text-center">
                  <RankCell rank={i + 1} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold text-black/80" style={{ background: colorOf(a.id) }}>
                      {providerOf(a)[0]}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground" title={a.id}>
                        {a.name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {providerOf(a)} · last used {ago(a.lastAt)}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground sm:table-cell">{compact(a[period].output)}</td>
                <td className="hidden px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground sm:table-cell">{a[period].unpricedTokens === a[period].total ? "—" : usd(a[period].cost)}</td>
                <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{compact(a[period].total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Achievements (coin wall, tier palette)

const BADGE_ICON: Record<string, ComponentType<LucideProps>> = {
  token_titan: Crown,
  big_day: Zap,
  wordsmith: Feather,
  marathoner: Footprints,
  streak: Flame,
  weekend_warrior: CalendarDays,
  momentum: TrendingUp,
  polyglot: Brain,
  trendsetter: Rocket,
  multitool: Blocks,
  podium: Medal,
  veteran: ShieldCheck,
  project_hopper: FolderGit2,
  project_devotion: Heart,
  night_owl: MoonStar,
};
type Coin = { rim: [string, string]; face: [string, string]; glyph: string; ring: string; label: string };
// TokenTracker's tier-palette.js.
const TIER_PALETTE: Coin[] = [
  { rim: ["#a8ada9", "#7c817d"], face: ["#5a5e5b", "#3d403e"], glyph: "#9a9f9b", ring: "#6f7470", label: "#8b908c" }, // locked, darkened for this surface
  { rim: ["#a06a44", "#5c3a22"], face: ["#d29a6c", "#96602f"], glyph: "#3f2817", ring: "#e8c3a0", label: "#c48a5c" },
  { rim: ["#aab3bb", "#67707b"], face: ["#dde2e7", "#9ba5ae"], glyph: "#39424b", ring: "#f2f5f7", label: "#aab3bb" },
  { rim: ["#c9971c", "#8a6508"], face: ["#f2ca52", "#cf9c26"], glyph: "#5c430e", ring: "#ffe9a8", label: "#e0b23a" },
  { rim: ["#62b1e0", "#7c6fd9"], face: ["#c8ecf6", "#84b4ea"], glyph: "#27496d", ring: "#eafcff", label: "#7cc0ec" },
];
const TIER_WORD = ["Locked", "Bronze", "Silver", "Gold", "Diamond"];
const metric = (b: Badge, v: number) => (b.id === "momentum" ? `${Math.round(v * 10) / 10}×` : v >= 1e4 ? compact(v) : Math.round(v).toLocaleString());

function AchievementBadge({ b, size = 64 }: { b: Badge; size?: number }) {
  const p = TIER_PALETTE[Math.max(0, Math.min(4, b.tier))];
  const Glyph = BADGE_ICON[b.id] ?? Medal;
  return (
    <span className="inline-flex shrink-0 rounded-full" style={{ width: size, height: size, padding: 2, background: `linear-gradient(135deg, ${p.rim[0]} 0%, ${p.ring} 42%, ${p.rim[1]} 100%)`, boxShadow: "0 0 0 1px rgba(0,0,0,0.3)" }}>
      <span className="flex h-full w-full items-center justify-center rounded-full" style={{ background: `linear-gradient(145deg, ${p.face[0]}, ${p.face[1]})` }}>
        <Glyph size={Math.round(size * 0.45)} color={p.glyph} strokeWidth={2} />
      </span>
    </span>
  );
}

function Achievements({ badges }: { badges: Badge[] }) {
  // Earned first (tier desc, catalog order), the locked ones after: TokenTracker's isOwn ordering.
  const cells = [...badges].map((b, i) => ({ b, i })).sort((x, y) => (y.b.tier > 0 ? 1 : 0) - (x.b.tier > 0 ? 1 : 0) || y.b.tier - x.b.tier || x.i - y.i);
  const earned = badges.filter((b) => b.tier > 0).length;
  return (
    <Card title="Achievements" aside={`${earned} of ${badges.length} earned · tiers from TokenTracker (MIT)`} testId="tt-achievements">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-y-5">
        {cells.map(({ b }) => {
          const prev = b.tier ? b.thresholds[b.tier - 1] : 0;
          const progress = b.next === null ? 1 : Math.min(1, Math.max(0, (b.value - prev) / (b.next - prev)));
          return (
            <div key={b.id} data-testid="tt-badge" className="group flex flex-col items-center rounded-xl px-1 pb-3 pt-4 text-center transition-colors hover:bg-white/[0.03]" title={`${b.name}: ${metric(b, b.value)} ${b.what}. Tiers ${b.thresholds.map((x) => metric(b, x)).join(" / ")}${b.next === null ? "" : ` · next at ${metric(b, b.next)}`}`}>
              <span className={`transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105 ${b.tier ? "" : "opacity-60"}`}>
                <AchievementBadge b={b} />
              </span>
              <span className="mt-2.5 w-full truncate text-xs font-medium leading-tight text-foreground">{b.name}</span>
              <span className="mt-1 flex h-4 w-full items-center justify-center">
                {b.tier ? (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: TIER_PALETTE[b.tier].label }}>
                    {TIER_WORD[b.tier]}
                  </span>
                ) : (
                  <span className="h-[3px] w-14 overflow-hidden rounded-full bg-white/[0.08]">
                    <span className="block h-full rounded-full bg-[rgb(255_167_38/0.75)]" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                )}
              </span>
              <span className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{metric(b, b.value)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Accounts and limits (UsageLimitsPanel)

function LimitBar({ label, l }: { label: string; l: Limit }) {
  if (!l) {
    return (
      <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 text-[11.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="h-[6px] rounded-full bg-white/5" />
        <span className="text-muted-foreground">not reported</span>
      </div>
    );
  }
  const p = Math.min(100, Math.max(0, l.usedPct));
  const tone = p >= 90 ? "bg-[rgb(255_128_147/0.85)]" : p >= 70 ? "bg-[rgb(255_167_38/0.85)]" : "bg-[rgb(53_212_155/0.75)]";
  return (
    <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 text-[11.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-[6px] rounded-full bg-white/5">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, p)}%` }} />
      </span>
      <span className="tabular-nums text-foreground">
        {p}% <span className="text-muted-foreground">{l.expired ? "· reset since" : `· ${left(l.resetsAt)}`}</span>
      </span>
    </div>
  );
}

function modelName(id: string) {
  const model = id.replace(/\[.*$/, "");
  const names: Record<string, string> = { "gpt-6-luna": "Luna 6", "gpt-6.1-sol": "Sol 6.1", "gpt-6-astra": "Astra 6", "gpt-5.6-luna": "Luna 5.6 (old)" };
  const claude = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?/);
  return names[model] ?? (claude ? `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}` : model);
}

function AccountCard({ a, color }: { a: Account; color: string }) {
  const [copied, setCopied] = useState(false);
  const kindWord = a.kind === "claude" ? "Claude" : a.kind === "codex" ? "Codex" : a.kind === "other" ? "Other providers" : "Shared folder";
  return (
    <div data-testid="token-account" className="flex flex-col gap-2.5 rounded-lg border border-border bg-raised/40 p-3.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />
        {/* TODO(tokens SPEC "Only Shaan can answer" #1): name each account (person / plan); the folder name until he does. */}
        <span className="truncate text-[13px] font-medium text-foreground" title={a.id}>
          {a.name}
        </span>
        <span className="ml-auto flex-none rounded-full border border-white/10 px-1.5 py-px text-[10px] text-muted-foreground">{kindWord}</span>
      </div>
      {a.command && <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <code className="font-mono">{a.command}</code>
        <button type="button" aria-label={`Copy ${a.command}`} title={`Copy ${a.command}`} className="rounded p-1 hover:bg-white/10" onClick={() => {
          void navigator.clipboard.writeText(a.command!).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}>{copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}</button>
      </div>}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Today", a.today],
            ["Week", a.week],
            ["Month", a.month],
          ] as const
        ).map(([k, s]) => (
          <div key={k}>
            <div className="text-[10.5px] text-muted-foreground">{k}</div>
            <div className="text-[15px] font-semibold tabular-nums text-foreground">{compact(s.total)}</div>
            <div className="text-[10.5px] tabular-nums text-muted-foreground">{s.unpricedTokens === s.total && s.total > 0 ? "unpriced" : usd(s.cost)}</div>
          </div>
        ))}
      </div>
      {a.kind === "codex" && (
        <div className="text-[11.5px] text-muted-foreground" data-testid="codex-credits">
          <b className="font-semibold tabular-nums text-foreground">{typeof a.limits?.credits?.balance === "number" && Number.isFinite(a.limits.credits.balance) ? creditFigure(a.limits.credits.balance) : "Unknown"}</b> reported credits (cached event)
          {a.limits?.credits?.unlimited === true ? " · event reports unlimited" : ""}
          <br />Account not identified by this source
        </div>
      )}
      {(a.kind === "claude" || a.kind === "codex") && (
        <div className="flex flex-col gap-1.5">
          <LimitBar label="5 hours" l={a.limits?.fiveHour ?? null} />
          <LimitBar label="Weekly" l={a.limits?.weekly ?? null} />
          <div className="text-[10.5px] text-muted-foreground">{a.limits ? `${a.limits.source} · ${a.kind === "codex" ? sampleLabel(a.limits.at) : usageAge({ limitsAt: a.limits.at, limitsStale: a.limits.stale }) || "live"}` : "no status line seen for this account yet"}</div>
        </div>
      )}
      <div className="truncate text-[10.5px] text-muted-foreground" title={`all time since ${a.firstAt === null ? "unknown" : new Date(a.firstAt).toLocaleDateString()} · ${compact(a.allTime.total)} · ${a.models.map((m) => `${modelName(m.model)} ${compact(m.total)}`).join(" · ")}`}>
        {a.modelsToday?.[0] ? `today mostly ${modelName(a.modelsToday[0].model)}` : "no model usage reported today"} · last used {ago(a.lastAt)}
      </div>
    </div>
  );
}

function BurnVelocity() {
  const { data: usage, error } = useSharedState<Usage>("/api/usage", 60_000);
  if (!usage || usage.source === "pending" || !usage.data)
    return (
      <section data-testid="burn-velocity" className="rounded-xl border border-border bg-surface px-5 py-3 text-[12px] text-muted-foreground">
        {error ? `Burn velocity unavailable (${error})` : usage?.reason ?? "Burn velocity: waiting for STACK-OPT's meter"}
      </section>
    );
  const data = usage.data;
  const perHour = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%/h`);
  const full = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}h to full`);
  const resets = (v: number | string | null) => (v == null ? "reset time unknown" : `resets ${new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
  const range = (v: [number, number] | undefined, unit = "") => (v ? `${v[0]}–${v[1]}${unit}` : "—");
  return (
    <Card title="Burn velocity" aside={`STACK-OPT · ${data.window_min} min window`} testId="burn-velocity">
      <p className="m-0 mb-2 text-[11px] text-muted-foreground" data-testid="burn-provenance">
        Cached burn reading · {sampleLabel(asMs(data.at))} · Codex account not identified by source
        {(error || usage.reason || usage.stale || usage.refreshing) && <span role="status"> · {error ? `Latest usage request failed (${error}); showing cached data` : usage.reason ?? (usage.refreshing ? "Refreshing source; showing cached data" : "Source cache is stale")}</span>}
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {data.claude.map((a) => (
          <div key={a.profile} data-testid="burn-account" className="rounded-lg border border-border p-2.5">
            <div className="mb-2 text-[12px] font-medium text-foreground">Claude · {a.login}</div>
            <div className="grid grid-cols-[56px_1fr] gap-x-2 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">5 hour</span>
              <span className="text-foreground">
                {perHour(a.five_hour.pct_per_hour)} · {full(a.five_hour.hours_to_full)} · {resets(a.five_hour.resets_at)}
                {a.five_hour.stale ? " · stale" : ""}
              </span>
              <span className="text-muted-foreground">Weekly</span>
              <span className="text-foreground">
                {perHour(a.seven_day.pct_per_hour)} · {full(a.seven_day.hours_to_full)} · {resets(a.seven_day.resets_at)}
                {a.seven_day.stale ? " · stale" : ""}
              </span>
            </div>
          </div>
        ))}
        <div data-testid="burn-account" className="rounded-lg border border-border p-2.5">
          <div className="mb-2 text-[12px] font-medium text-foreground">Codex</div>
          <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">Credits / hour</span>
            <span className="text-foreground">{range(data.codex.credits_per_hour)}</span>
            <span className="text-muted-foreground">Reported credits left</span>
            <span className="text-foreground">{range(data.codex.left)}</span>
            <span className="text-muted-foreground">Hours left at rate</span>
            <span className="text-foreground">{data.codex.hours_left_at_rate == null ? "—" : `${data.codex.hours_left_at_rate.toFixed(1)}h`}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- the money band (servers-tokens spec §3.1, Option A)
//
// Above TokenTracker's sections: how much is left and who is spending it. Account cards (Claude logins with their 5h and
// weekly rings and the $250 grant, Codex credits with the Luna/Sol split, DeepSeek), then who is burning it today
// (GET /api/spend, by owner) and where it ran (the VPS rollup). Dollars are API-equiv except the grant, which is money.

type Grant = { login: string; profile: string | null; limit: number | null; used: number | null; left: number | null; ends: number | null; perHour: number | null; perDayToSpend: number | null };
type Money = {
  at: number;
  pending: boolean;
  burnState?: { readAt: number | null; stale: boolean; refreshing: boolean; attemptedAt: number | null; reason: string | null };
  grants: Grant[] | null;
  codex: { balance: number | null; balanceAt: number | null; balanceSource?: string; eventCredits?: { at: number; hasCredits: boolean | null; unlimited: boolean | null } | null; budget: number | null; plan: string | null; todaySpent: number | null; yesterdaySpent: number | null; byDay: Record<string, number>; reset: number | null; resetNote: string | null };
  other: { name: string; leftPct: number | null; resets: number | string | null }[];
  notes: string[];
};
type Split = { day: string; pending?: boolean; error?: string; luna?: number; sol?: number; lunaPct?: number | null; solPct?: number | null; target?: { luna: number; sol: number }; seen?: number; total?: number | null; seenPct?: number | null };
type Fleet = { host: string; at: number | null; pending: boolean; error: string | null; devices: { device: string; today: number | null; total: number | null; lastSeen: number | null; stale: boolean }[] };
type BurnClaude = NonNullable<Usage["data"]>["claude"][number];

const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function sampleLabel(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return "sample time unknown";
  return `sampled ${new Date(value).toLocaleString()}${value > Date.now() ? " · sample timestamp is in the future" : ""}`;
}
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const asMs = (v: number | string | null | undefined) => (v == null ? null : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
const whenShort = (ms: number | null) => (ms ? new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const dateShort = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" }) : "—");
const norm = (s: string | null | undefined) => (s ?? "").replace(/^~\//, "").replace(/^\.config\//, "").replace(/^\./, "").toLowerCase();

/** A Claude account's burn-rate row and grant, by profile folder, then by the login's email or name. */
function burnFor(a: Account, rows: BurnClaude[]) {
  const id = norm(a.id.slice(7));
  return rows.find((r) => norm(r.profile) === id) ?? rows.find((r) => a.person && (r.login === a.person.email || r.login === a.person.label));
}
function grantFor(a: Account, grants: Grant[]) {
  const id = norm(a.id.slice(7));
  return grants.find((g) => norm(g.profile) === id || (a.person && (g.login === a.person.email || g.login === a.person.label || g.login.split("@")[0] === a.person.label)));
}

function Bar({ pct, tone = "ok", tick, children, testId }: { pct: number | null; tone?: "ok" | "warn" | "bad" | "info"; tick?: number; children?: ReactNode; testId?: string }) {
  const fill = { ok: "bg-[rgb(53_212_155/0.75)]", warn: "bg-[rgb(255_167_38/0.85)]", bad: "bg-[rgb(255_128_147/0.85)]", info: "bg-[rgb(56_189_248/0.8)]" }[tone];
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="relative h-[7px] rounded-full bg-white/[0.06]">
        {pct !== null && <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />}
        {tick !== undefined && <span className="absolute -top-[3px] h-[13px] w-px bg-white/60" style={{ left: `${tick}%` }} title={`target ${tick}%`} />}
      </span>
      {children && <span className="text-[11px] leading-snug text-muted-foreground">{children}</span>}
    </div>
  );
}

function ClaudeMoneyCard({ a, burn, grant, grantsKnown, compactCard = false }: { a: Account; burn?: BurnClaude; grant?: Grant; grantsKnown: boolean; compactCard?: boolean }) {
  const five = a.limits?.source === "live Claude OAuth usage" && a.limits.fiveHour ? { pct: a.limits.fiveHour.usedPct, resets: a.limits.fiveHour.resetsAt } : burn ? { pct: burn.five_hour.used_pct, resets: asMs(burn.five_hour.resets_at) } : a.limits?.fiveHour ? { pct: a.limits.fiveHour.usedPct, resets: a.limits.fiveHour.resetsAt } : null;
  const week = a.limits?.source === "live Claude OAuth usage" && a.limits.weekly ? { pct: a.limits.weekly.usedPct, resets: a.limits.weekly.resetsAt } : burn ? { pct: burn.seven_day.used_pct, resets: asMs(burn.seven_day.resets_at) } : a.limits?.weekly ? { pct: a.limits.weekly.usedPct, resets: a.limits.weekly.resetsAt } : null;
  const hot = week?.pct != null && week.pct >= 70;
  const full = burn?.seven_day.hours_to_full ?? null;
  const fullAt = full != null ? Date.now() + full * 3_600_000 : null;
  const grantPct = grant && grant.limit ? ((grant.left ?? 0) / grant.limit) * 100 : null;
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-4 ${hot ? "border-[rgb(255_167_38/0.45)]" : "border-border"}`} data-testid="money-account" data-account={a.id}>
      <div className="text-[10.5px] text-muted-foreground">{a.limits ? `${a.limits.source} · ${usageAge({ limitsAt: a.limits.at, limitsStale: a.limits.stale }) || "live"}` : "usage unavailable"}</div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: PROVIDER_COLOR.Claude }} />
        <span className="min-w-0 text-[14px] font-semibold text-foreground">{a.person?.label ?? a.name}<small className="block text-[11px] font-normal text-muted-foreground">{week?.resets ? `Week renews ${dateShort(week.resets)}` : "Weekly renewal unknown"}</small></span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground" title={a.person?.email ?? a.id}>
          {a.folder ?? a.id.slice(7)}
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        <Ring pct={five?.pct ?? null} label="5 hours" sub={five?.resets ? `resets ${whenShort(five.resets)}` : "not reported"} />
        <Ring pct={week?.pct ?? null} label="Week" sub={week?.resets ? `resets ${whenShort(week.resets)}` : "not reported"} tone={week?.pct == null ? "none" : week.pct >= 90 ? "bad" : week.pct >= 70 ? "warn" : "ok"} />
      </div>
      {hot && burn?.seven_day.pct_per_hour != null && fullAt && (
        <p className="m-0 text-[11.5px] text-[rgb(255_167_38)]" data-testid="money-week-warning">
          at {burn.seven_day.pct_per_hour.toFixed(2)}% an hour it is full in about {Math.round(full!)} hours, ~{new Date(fullAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
          {new Date(fullAt).toDateString() === new Date().toDateString() ? " today" : ` ${dateShort(fullAt)}`}; resets {whenShort(week?.resets ?? null)}
        </p>
      )}
      {grant ? (
        <Bar pct={grantPct} tone={grantPct !== null && grantPct < 20 ? "warn" : "ok"} testId="money-grant">
          <b className="font-semibold text-foreground">{grant.left != null ? money2(grant.left) : "—"} left</b> of {grant.limit != null ? `$${Math.round(grant.limit)}` : "—"} grant · ends {dateShort(grant.ends)}
          {!compactCard && grant.perDayToSpend != null && (
            <>
              <br />
              at {money2(grant.perDayToSpend)} a day it is used by then
              {grant.perHour != null ? `; last hour burned ${money2(grant.perHour)}` : ""}
            </>
          )}
        </Bar>
      ) : grantsKnown ? (
        <span className="text-[11px] text-muted-foreground">no cloud credits on this login</span>
      ) : null}
      {!compactCard && (
        <div className="text-[11.5px] text-muted-foreground" data-testid="money-today">
          today <b className="font-semibold tabular-nums text-foreground">{compact(a.today.total)}</b> · {usd(a.today.cost)} API-equiv
        </div>
      )}
    </div>
  );
}

function CodexMoneyCard({ m, codex, yesterday, today, error, compactCard = false }: { m: Money | null; codex?: Account; error?: string | null; yesterday: Split | null; today: Split | null; compactCard?: boolean }) {
  const c = m?.codex;
  // An explicit unknown in the money response must not resurrect an older account reading.
  const reported = c ? c.balance : codex?.limits?.credits?.balance;
  const balance = typeof reported === "number" && Number.isFinite(reported) ? reported : null;
  const budget = typeof c?.budget === "number" && Number.isFinite(c.budget) ? c.budget : null;
  const source = c ? c.balanceSource : codex?.limits?.source;
  const sampledAt = c ? c.balanceAt : codex?.limits?.at;
  const sample = typeof sampledAt === "number" && Number.isFinite(sampledAt) && Number.isFinite(new Date(sampledAt).getTime()) ? sampledAt : null;
  const event = c ? c.eventCredits : codex?.limits?.credits ? { ...codex.limits.credits, at: codex.limits.at } : null;
  const unlimited = event?.unlimited === true;
  const pct = !unlimited && balance !== null && balance > 0 && budget !== null && budget > 0 ? (100 * balance) / budget : null;
  const burnState = m?.burnState;
  const sp = yesterday && yesterday.lunaPct != null ? yesterday : today && today.lunaPct != null ? today : null;
  const spWord = sp === yesterday ? "yesterday" : "today";
  const solOff = sp?.solPct != null && sp.solPct > (sp.target?.sol ?? 20) + 10;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4" data-testid="money-codex">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: PROVIDER_COLOR.Codex }} />
        <span className="truncate text-[14px] font-semibold text-foreground">Codex</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{c?.plan ? `ChatGPT ${c.plan[0].toUpperCase()}${c.plan.slice(1)}` : "ChatGPT"}</span>
      </div>
      <Bar pct={pct} tone={pct !== null && pct < 20 ? "warn" : "info"} testId="money-codex-credits">
        <b className="font-semibold tabular-nums text-foreground">{balance !== null ? creditFigure(balance) : "Unknown"}</b> reported credits
        {budget !== null ? ` · configured weekly budget ${budget.toLocaleString()}` : ""}
        {c?.reset ? ` · reported weekly reset ${whenShort(c.reset)}` : ""}
        {c?.resetNote ? <span title={c.resetNote}> (burn-rate differs)</span> : null}
      </Bar>
      <div className="text-[10.5px] text-muted-foreground" data-testid="money-codex-provenance">
        Cached reading · {source || "source unknown"} · {sampleLabel(sample)}
        <br />Account not identified by this source
        {unlimited && <><br />Newest event reports unlimited credits{event?.at ? ` · recorded ${new Date(event.at).toLocaleString()}` : ""}</>}
        {(error || burnState?.reason || burnState?.stale || burnState?.refreshing) && <><br /><span role="status">{error ? `Latest money request failed (${error}); showing cached data` : burnState?.reason ?? (burnState?.refreshing ? "Refreshing burn source; showing cached data" : "Burn source cache is stale")}</span></>}
      </div>
      <span className="text-[11.5px] text-muted-foreground" data-testid="money-codex-spent">
        {c?.todaySpent != null ? `${Math.round(c.todaySpent).toLocaleString()} spent today` : "today not reported"}
        {c?.yesterdaySpent != null ? `, ${Math.round(c.yesterdaySpent).toLocaleString()} yesterday` : ""}
      </span>
      {sp ? (
        <div className="flex flex-col gap-1" data-testid="money-split">
          <span className="relative flex h-[7px] overflow-hidden rounded-full bg-white/[0.06]">
            <span className="h-full bg-[rgb(56_189_248/0.8)]" style={{ width: `${sp.lunaPct}%` }} title={`Luna ${sp.lunaPct}%`} />
            <span className="h-full bg-[rgb(255_167_38/0.85)]" style={{ width: `${sp.solPct}%` }} title={`Sol ${sp.solPct}%`} />
            <span className="absolute -top-[3px] h-[13px] w-px bg-white/70" style={{ left: `${sp.target?.luna ?? 80}%` }} title="target: Luna 80%" />
          </span>
          <span className={`text-[11px] ${solOff ? "text-[rgb(255_167_38)]" : "text-muted-foreground"}`}>
            Luna {sp.lunaPct}% · Sol {sp.solPct}% {spWord}, target {sp.target?.sol ?? 20}% Sol
            {!compactCard && sp.seenPct != null ? ` · this ledger saw ${sp.seenPct}% of the account's spend` : ""}
          </span>
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground">Luna/Sol split: {yesterday?.error ?? today?.error ?? "not read yet"}</span>
      )}
    </div>
  );
}

function OtherMoneyCard({ m }: { m: Money | null }) {
  const o = m?.other?.[0];
  if (!o) return null;
  const resets = asMs(o.resets);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4" data-testid="money-other">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: PROVIDER_COLOR.Other }} />
        <span className="truncate text-[14px] font-semibold text-foreground">DeepSeek</span>
        <span className="ml-auto text-[11px] text-muted-foreground">OpenCode Go</span>
      </div>
      <Bar pct={o.leftPct} tone={o.leftPct !== null && o.leftPct < 20 ? "warn" : "ok"}>
        <b className="font-semibold tabular-nums text-foreground">{o.leftPct ?? "—"}%</b> of the month left{resets ? ` · resets ${dateShort(resets)}` : typeof o.resets === "string" ? ` · resets ${o.resets}` : ""}
      </Bar>
    </div>
  );
}

type Burner = { owner: string; project: string; usd: number; credits: number; finished: number };
function burners(spend: ReturnType<typeof useSpend>): Burner[] {
  if (spend?.source !== "stack-opt") return [];
  return spend.data.projects
    .flatMap((p) => p.owners.map((o) => ({ owner: o.owner, project: p.project, usd: o.claude_usd_equiv, credits: o.codex_credits[1] ?? o.codex_credits[0] ?? 0, finished: o.finished })))
    .sort((a, b) => b.usd + b.credits / 10 - (a.usd + a.credits / 10));
}

function Burners({ list, max = 7, compactList = false }: { list: Burner[]; max?: number; compactList?: boolean }) {
  const top = list.slice(0, max);
  const peak = Math.max(1, ...top.map((b) => b.usd));
  if (!list.length) return <p className="m-0 p-4 text-[12px] text-muted-foreground">No spend report yet (spend-report).</p>;
  return (
    <div className="flex flex-col" data-testid="money-burners">
      {top.map((b, i) => (
        <div key={`${b.project}/${b.owner}`} className="grid grid-cols-[22px_26px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-white/[0.04] px-4 py-2 last:border-0" data-testid="money-burner">
          <RankCell rank={i + 1} />
          <AgentFace name={b.owner} status="waiting" size={26} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[13px] font-medium text-foreground">{b.owner}</span>
              {!compactList && <span className="truncate text-[11px] text-muted-foreground">{b.project}</span>}
            </div>
            <span className="mt-1 block h-[4px] rounded-full bg-white/[0.06]">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (100 * b.usd) / peak)}%`, background: PROVIDER_COLOR.Claude }} />
            </span>
          </div>
          <div className="text-right text-[11.5px] tabular-nums">
            <div className="font-semibold text-foreground" title="API-equiv: what these tokens would cost at API list prices, not a bill">${Math.round(b.usd).toLocaleString()} <span className="font-normal text-muted-foreground">API-equiv</span></div>
            {!compactList && (
              <div className="text-muted-foreground">
                {b.credits ? `${Math.round(b.credits)} credits · ` : ""}
                {b.finished ? `finished ${b.finished} task${b.finished === 1 ? "" : "s"}` : "none finished"}
              </div>
            )}
          </div>
        </div>
      ))}
      {list.length > max && <p className="m-0 px-4 py-2 text-[11px] text-muted-foreground">and {list.length - max} more</p>}
    </div>
  );
}

function WhereItRan({ fleet, here }: { fleet: Fleet | null; here: number }) {
  const fresh = (fleet?.devices ?? []).filter((d) => !d.stale);
  const stale = (fleet?.devices ?? []).filter((d) => d.stale);
  return (
    <div className="flex flex-col" data-testid="money-where">
      <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2 text-[12.5px]" data-testid="money-device" data-device="this-mac">
        <span className="text-foreground">This Mac</span>
        <span className="tabular-nums text-foreground">
          {compact(here)} <span className="text-[11px] text-muted-foreground">read live</span>
        </span>
      </div>
      {fresh.map((d) => (
        <div key={d.device} className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2 text-[12.5px] last:border-0" data-testid="money-device" data-device={d.device}>
          <span className="text-foreground">{d.device}</span>
          <span className="tabular-nums text-foreground">
            {d.today !== null ? compact(d.today) : "—"} <span className="text-[11px] text-muted-foreground">{ago(d.lastSeen)}</span>
          </span>
        </div>
      ))}
      <p className="m-0 px-4 py-2 text-[11px] leading-snug text-muted-foreground" data-testid="money-stale">
        {fleet?.pending
          ? "Reading the VPS rollup…"
          : fleet?.error
            ? `The VPS rollup did not answer: ${fleet.error}`
            : stale.length
              ? `Not reporting: ${stale.map((d) => `${d.device} (since ${dateShort(d.lastSeen)})`).join(", ")}. The rollup's hourly drain does not reach them.`
              : "Every machine in the rollup reported today."}
      </p>
    </div>
  );
}

/** The band above TokenTracker's sections; in the side panel, its compact form. */
export function MoneyBand({ data, density = "page" }: { data: Tokens; density?: "page" | "panel" }) {
  const { data: money, error: moneyError } = useSharedState<Money>("/api/tokens/money", 60_000);
  const usage = useShared<Usage>("/api/usage", 300_000);
  const today = dayKey();
  const yday = dayKey(Date.now() - 86_400_000);
  const splitY = useShared<Split>(`/api/tokens/split?day=${yday}`, 300_000);
  const splitT = useShared<Split>(`/api/tokens/split?day=${today}`, 300_000);
  const fleet = useShared<Fleet>(density === "page" ? "/api/tokens/fleet" : null, 300_000);
  const spend = useSpend();
  const rows = usage?.data?.claude ?? [];
  const grants = money?.grants ?? [];
  const claude = data.accounts.filter((a) => a.kind === "claude" && a.person?.mine !== false && (a.person || a.allTime.total > 0 || a.limits));
  const notMine = data.accounts.filter((a) => a.person?.mine === false);
  const codex = data.accounts.find((a) => a.kind === "codex");
  const list = burners(spend);
  const panel = density === "panel";
  return (
    <div className="mb-4 flex flex-col gap-4" data-testid="money-band" data-density={density}>
      <div className={panel ? "flex flex-col gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"}>
        {claude.map((a) => (
          <ClaudeMoneyCard key={a.id} a={a} burn={burnFor(a, rows)} grant={grantFor(a, grants)} grantsKnown={!!money?.grants} compactCard={panel} />
        ))}
        <CodexMoneyCard m={money} error={moneyError} codex={codex} yesterday={splitY} today={splitT} compactCard={panel} />
        {!panel && <OtherMoneyCard m={money} />}
      </div>
      {notMine.length > 0 && !panel && (
        <p className="m-0 -mt-1 text-[11px] text-muted-foreground" data-testid="money-not-mine">
          {notMine.map((a) => `${a.person!.label}'s login (${a.folder ?? a.id.slice(7)}) is not counted as yours: ${compact(a.today.total)} today`).join(" · ")}
        </p>
      )}
      {panel ? (
        <Card title="Burning it today" aside="top 5 · API-equiv" testId="money-burners-card" bodyClassName="">
          <Burners list={list} max={5} compactList />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card title="Who is burning it today" aside="by owner · $ API-equiv, Codex credits" testId="money-burners-card" bodyClassName="" className="lg:col-span-3">
            <Burners list={list} />
          </Card>
          <Card title="Where it ran" aside={fleet?.at ? `VPS rollup · read ${ago(fleet.at)}` : "VPS rollup"} testId="money-where-card" bodyClassName="" className="lg:col-span-2">
            <WhereItRan fleet={fleet} here={data.overall.today.total} />
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the page

/** The Tokens page; `density: "panel"` is its compact form for the side panel (servers-tokens §4): the money band only. */
export function TokensPage({ density = "page", onPopOut }: { density?: "page" | "panel"; onPopOut?: () => void }) {
  const { data, error } = useTokens();
  if (!data) return <div className="p-5 text-sm text-muted-foreground">{error ? `Could not read tokens: ${error}.` : "Reading every session file on this machine…"}</div>;
  if (density === "panel")
    return (
      <div data-testid="tokens-panel" data-density="panel" className="h-full overflow-y-auto p-3">
        <MoneyBand data={data} density="panel" />
      </div>
    );
  return <TokensView data={data} error={error} onPopOut={onPopOut} />;
}

/** The page for one payload (split from TokensPage so it can be rendered from a saved payload). */
export function TokensView({ data, error, onPopOut }: { data: Tokens; error: string | null; onPopOut?: () => void }) {
  const [period, setPeriod] = useState<Period>("today");
  if (!isTokensShape(data)) return <div role="status" className="p-5 text-sm text-muted-foreground">Token data is unavailable.</div>;
  const colorOf = (id: string) => PALETTE[Math.max(0, data.accounts.findIndex((a) => a.id === id)) % PALETTE.length];
  const shown = data.accounts.filter((a) => a.kind === "claude" || a.allTime.total > 0);
  return (
    <div data-testid="tokens-page" className="h-full overflow-y-auto px-5 pb-10 pt-4">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">Tokens</h2>
        <span className="text-[11.5px] text-muted-foreground">
          {data.cached
            ? `last saved ${ago(data.at)} · reading session files…`
            : data.scanning
              ? `reading session files… ${data.files ? `${data.files} so far` : ""}`
              : `${data.files} session files · read ${ago(data.at)} in ${(data.scanMs / 1000).toFixed(1)} s`}
        </span>
        {error && <span className="ml-auto text-[11px] text-[rgb(255_128_147)]">refresh failed: {error}</span>}
        {onPopOut && (
          <button type="button" className={`${error ? "" : "ml-auto "}grid size-7 flex-none place-items-center self-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground`} aria-label="Open in the side panel" title="Open in the side panel (⌥-click the icon does it too)" data-testid="pop-out" onClick={onPopOut}>
            <PanelRightOpen size={16} aria-hidden />
          </button>
        )}
      </div>

      <MoneyBand data={data} />

      {/* TokenTracker's DashboardView: a narrow left column (identity stats, heatmap, trend) and a wide right one. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 xl:col-span-4">
          <StatsPanel data={data} period={period} />
          <Heatmap days={data.heatmap ?? []} />
          <Trend data={data} colorOf={colorOf} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 xl:col-span-8">
          <UsageOverview data={data} period={period} onPeriod={setPeriod} />
          <Leaderboard data={data} period={period} colorOf={colorOf} />
          <Achievements badges={data.achievements} />
          <Card title="Accounts" aside={`limits · today, this week, this month since ${data.ranges.weekFrom.slice(5)}`} testId="tt-accounts">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {shown.map((a) => (
                <AccountCard key={a.id} a={a} color={colorOf(a.id)} />
              ))}
            </div>
          </Card>
          <BurnVelocity />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-1 text-[11px] text-muted-foreground">
        {data.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        <p>
          How the shared folder was split:{" "}
          {Object.entries(data.attribution)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${compact(v)}`)
            .join(" · ")}
        </p>
        <p>Layout and achievement tiers ported from TokenTracker (MIT, © 2026 xiufengsun); see THIRD_PARTY_NOTICES.md.</p>
      </div>
    </div>
  );
}

// uihub: statistics-card-7; TokenTracker graphs and original account rings, reused for AB-09.
// Usage lane (9 Oct): the answer above (UsageAnswer) carries the limits, credits, spend and burners; the account cards'
// detail (cloud grant, Luna/Sol split, DeepSeek, where it ran) folds here, read only when opened.
export function UsageTokenSections({ tokens }: { tokens?: { data: Tokens | null; error: string | null } }) {
  const own = useTokens(!tokens);
  const { data, error } = tokens ?? own;
  const [period, setPeriod] = useState<Period>('today');
  const [detail, setDetail] = useState(false);
  if (!data) return <p role="status">{error ? 'Usage unavailable. Retrying…' : 'Reading usage…'}</p>;
  const colorOf = (id: string) => PALETTE[Math.max(0, data.accounts.findIndex(a => a.id === id)) % PALETTE.length];
  return <div className="usage-sections">
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"><Trend data={data} colorOf={colorOf}/><UsageOverview data={data} period={period} onPeriod={setPeriod} compactView/></div>
    <details data-testid="usage-accounts-detail" onToggle={e => setDetail((e.currentTarget as HTMLDetailsElement).open)}><summary>Accounts in detail · cloud credit, Luna/Sol split, DeepSeek, where it ran</summary>{detail && <div><MoneyBand data={data}/></div>}</details>
    <details><summary>Activity and account detail</summary><div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"><Heatmap days={data.heatmap ?? []}/><StatsPanel data={data} period={period}/><Leaderboard data={data} period={period} colorOf={colorOf}/><Achievements badges={data.achievements}/></div></details>
  </div>;
}
