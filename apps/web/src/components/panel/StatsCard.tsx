import { usageAge } from "../../lib/usage-age";
import { ChevronRightIcon, Maximize2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { type Agent, type Stats, compact } from "../../lib/agents";
import { every } from "../../lib/poll";
import { Fold } from "../PanelFold";
import { Bars } from "../StatsBars";
import { modelChip, type SubRowData } from "./SubRow";
import "./panel.css";

const dur = (a: string | null, b: string | null) => {
  if (!a || !b) return "";
  const m = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const MODEL_COLOR: Record<string, string> = { opus: "#f5d0a0", sonnet: "#60a5fa", haiku: "#34c38f", fable: "#f472b6", herdr: "#a78bfa", codex: "#a78bfa", other: "rgb(255 255 255 / 0.3)" };

/** Its sub-agents' tokens by model, and how many run now (read every 5 s while shown). */
function useSpend(id: string) {
  const [rows, setRows] = useState<SubRowData[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/agents/${encodeURIComponent(id)}/subagents`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
        .then((x) => alive && setRows((x.rows ?? []).filter((r: SubRowData) => !r.agentId)))
        .catch(() => alive && setRows((v) => v ?? []));
    load();
    const stop = every(load, 5000);
    return () => {
      alive = false;
      stop();
    };
  }, [id]);
  const by = new Map<string, { n: number; tokens: number }>();
  for (const r of rows ?? []) {
    const m = modelChip(r) || "other";
    const cur = by.get(m) ?? { n: 0, tokens: 0 };
    by.set(m, { n: cur.n + 1, tokens: cur.tokens + r.tokens });
  }
  return { rows, running: (rows ?? []).filter((r) => r.running).length, by: [...by].sort((a, b) => b[1].tokens - a[1].tokens) };
}

/** Output per hour as a small area chart (a sparkline on the card, the full chart on the page). */
function Area({ hours, tall = false }: { hours: Stats["hours"]; tall?: boolean }) {
  if (hours.length < 2) return tall ? <p className="ab-empty">Not enough hours of output to draw yet.</p> : null;
  const peak = Math.max(1, ...hours.map((h) => h.output));
  const pts = hours.map((h, i) => [(i / (hours.length - 1)) * 100, 38 - (h.output / peak) * 34] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const label = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="ab-areawrap">
      <svg className={tall ? "ab-area is-tall" : "ab-area"} viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Written per hour">
        <path d={`${line} L100,40 L0,40 Z`} fill="rgb(245 167 66 / 0.22)" />
        <path d={line} fill="none" stroke="#f5a742" strokeWidth={tall ? 0.8 : 1.2} vectorEffect="non-scaling-stroke" />
      </svg>
      {tall && (
        <div className="ab-areawrap__axis">
          <span>{label(hours[0].hour)}</span>
          <span>peak {compact(peak)} / h</span>
          <span>{label(hours.at(-1)!.hour)}</span>
        </div>
      )}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const c = 2 * Math.PI * 14;
  return (
    <svg className="ab-ring" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="14" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="4" />
      <circle cx="17" cy="17" r="14" fill="none" stroke="#2dd4bf" strokeWidth="4" strokeDasharray={`${(c * pct) / 100} ${c}`} strokeLinecap="round" transform="rotate(-90 17 17)" />
    </svg>
  );
}

/** The four tiles: Tokens (with output per hour), Cache (a ring), Context (a bar, 5h and week), Sub-agents (a model split). */
/** Without `spend` (the dashboard, whose Sub-agents card already says it) the sub-agents tile is left out. */
function Tiles({ a, s, spend }: { a: Agent; s: Stats; spend?: ReturnType<typeof useSpend> }) {
  const ctx = a.hud?.context ?? a.context;
  const totalSub = spend?.by.reduce((n, [, v]) => n + v.tokens, 0) || 1;
  return (
    <div className="ab-tiles" data-testid="stats-tiles">
      <div className="ab-tile" data-tile="tokens">
        <small>Tokens · session</small>
        <b>{compact(s.tokens.total)}</b>
        <span>↓ {compact(s.tokens.output)} written</span>
        <Area hours={s.hours} />
      </div>
      <div className="ab-tile" data-tile="cache">
        <small>Cache</small>
        <b>{s.tokens.cachePct ?? 0}%</b>
        <span>{compact(s.tokens.cacheRead)} read</span>
        <Ring pct={s.tokens.cachePct ?? 0} />
      </div>
      <div className="ab-tile" data-tile="context">
        <small>Context</small>
        <b>{ctx == null ? "—" : `${ctx}%`}</b>
        <span>{a.hud?.model ?? a.tool}</span>
        <i className="ab-tile__bar">
          <i style={{ width: `${ctx ?? 0}%` }} />
        </i>
        {(a.hud?.fiveHour || a.hud?.week) && (
          <span className="ab-tile__lim">
            {a.hud?.fiveHour ? `5h ${a.hud.fiveHour.pct}%` : ""}
            {a.hud?.fiveHour && a.hud?.week ? " · " : ""}
            {a.hud?.week ? `wk ${a.hud.week.pct}%` : ""} {usageAge(a.hud)}
          </span>
        )}
      </div>
      {spend && <div className="ab-tile" data-tile="subagents">
        <small>Sub-agents</small>
        <b>{spend.rows ? spend.rows.length : s.subagents.count}</b>
        <span className="is-running">{spend.running} running</span>
        <i className="ab-tile__split">
          {spend.by.map(([m, v]) => (
            <i key={m} title={`${m} · ${v.n} · ${compact(v.tokens)}`} style={{ flexGrow: Math.max(1, (v.tokens / totalSub) * 100), background: MODEL_COLOR[m] ?? MODEL_COLOR.other }} />
          ))}
        </i>
      </div>}
    </div>
  );
}

/**
 * The Stats card (SPEC-PANEL-CARDS §10, option A; Shaan 3 Oct 00:05: "redesign the stats card and maybe there's a stats
 * sub card on there like you click it and it still stays in the side now having its own stat page"). Four tiles, two
 * across (four at 470 px or more), then tool calls · turns · prompts · how long. No dollar figure: costUsd is null on his
 * plan. Stats › opens the page inside the panel.
 */
export function StatsCard({ a, stats, onOpen }: { a: Agent; stats: Stats | null; onOpen: () => void }) {
  const s = stats && !stats.error ? stats : null;
  return (
    <Fold id="stats" title="Stats" open={false} testid="fold-stats" onOpen={s ? onOpen : undefined} peek={s ? <StatsPeek s={s} /> : undefined} widget={s ? <StatsWidget a={a} s={s} /> : undefined}>
      {!s ? <p className="ab-empty">{stats?.error ?? "Reading the session…"}</p> : <StatsBody a={a} s={s} onOpen={onOpen} />}
    </Fold>
  );
}

function StatsWidget({ a, s }: { a: Agent; s: Stats }) {
  return (
    <div className="ab-statsw">
      <Tiles a={a} s={s} />
      <p className="ab-statsc__line ab-widget__foot">
        <b>{s.toolCalls}</b> tool calls · <b>{s.apiCalls}</b> turns · <b>{s.prompts}</b> prompts{dur(s.first, s.last) && ` · ${dur(s.first, s.last)}`}
      </p>
    </div>
  );
}

function StatsPeek({ s }: { s: Stats }) {
  return (
    <>
      <span className="ab-peekspark">
        <Area hours={s.hours} />
      </span>
      <span>
        <b>{compact(s.tokens.total)}</b> tokens · {s.tokens.cachePct ?? 0}% cache · {s.toolCalls} tool calls
      </span>
    </>
  );
}

function StatsBody({ a, s, onOpen }: { a: Agent; s: Stats; onOpen: () => void }) {
  const spend = useSpend(a.id);
  return (
    <div className="ab-statsc" data-testid="stats-card">
      <Tiles a={a} s={s} spend={spend} />
      <p className="ab-statsc__line">
        <b>{s.toolCalls}</b> tool calls · <b>{s.apiCalls}</b> turns · <b>{s.prompts}</b> prompts{dur(s.first, s.last) && ` · ${dur(s.first, s.last)}`}
      </p>
      <div className="ab-tasks__foot">
        <button type="button" className="ab-pagelink" data-testid="stats-page" onClick={onOpen}>
          Stats <ChevronRightIcon size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * The Stats page in the panel: the tiles, written per hour, where the tokens went (cache read / cache write / written /
 * fresh in), tools, sub-agent spend by model, limits and skills. Today and 7 days need a per-day read that does not exist
 * yet, so only Session shows.
 */
export function StatsPanelPage({ a, stats }: { a: Agent; stats: Stats | null }) {
  const s = stats && !stats.error ? stats : null;
  const spend = useSpend(a.id);
  if (!s) return <p className="ab-empty p-4">{stats?.error ?? "Reading the session…"}</p>;
  const t = s.tokens;
  const parts: [string, number, string][] = [
    ["cache read", t.cacheRead, "#2dd4bf"],
    ["cache write", t.cacheWrite, "#818cf8"],
    ["written", t.output, "#f5a742"],
    ["fresh in", t.input, "#ffffff"],
  ];
  const sum = parts.reduce((n, [, v]) => n + v, 0) || 1;
  const peakSpend = Math.max(1, ...spend.by.map(([, v]) => v.tokens));
  const skills = Object.entries(s.skills);
  return (
    <div className="ab-statsp" data-testid="stats-page-view">
      <div className="ab-switch" role="group" aria-label="Period">
        <button type="button" aria-pressed="true">
          Session
        </button>
      </div>
      <Tiles a={a} s={s} spend={spend} />
      <section>
        <h4>Written per hour</h4>
        <Area hours={s.hours} tall />
      </section>
      <section>
        <h4>Where {compact(t.total)} tokens went</h4>
        <i className="ab-tokbar" data-testid="stats-stack">
          {parts.map(([k, v, c]) => (
            <i key={k} title={`${k} ${compact(v)}`} style={{ flexGrow: v ? Math.max(0.3, (v / sum) * 100) : 0, minWidth: v ? undefined : 0, background: c }} />
          ))}
        </i>
        <p className="ab-legend">
          {parts.map(([k, v, c]) => (
            <span key={k}>
              <i style={{ background: c }} /> {k} {compact(v)}
            </span>
          ))}
        </p>
      </section>
      <section>
        <h4>Tools · {s.toolCalls} calls</h4>
        <Bars rows={Object.entries(s.tools)} max={8} />
      </section>
      {spend.by.length > 0 && (
        <section>
          <h4>Sub-agent spend · {compact(spend.by.reduce((n, [, v]) => n + v.tokens, 0))}</h4>
          {spend.by.map(([m, v]) => (
            <p key={m} className="ab-spend">
              <span>
                {m} · {v.n}
              </span>
              <i>
                <i style={{ width: `${(v.tokens / peakSpend) * 100}%`, background: MODEL_COLOR[m] ?? MODEL_COLOR.other }} />
              </i>
              <b>{compact(v.tokens)}</b>
            </p>
          ))}
        </section>
      )}
      {(a.hud?.fiveHour || a.hud?.week) && (
        <section>
          <h4>Limits</h4>
          <div className="ab-limits">
            {a.hud?.fiveHour && (
              <p>
                {usageAge(a.hud)} <b>{a.hud.fiveHour.pct}%</b> 5 hour{a.hud.fiveHour.resetsAt ? ` · resets ${new Date(a.hud.fiveHour.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}
              </p>
            )}
            {a.hud?.week && (
              <p>
                {usageAge(a.hud)} <b>{a.hud.week.pct}%</b> week{a.hud.week.resetsAt ? ` · resets ${new Date(a.hud.week.resetsAt).toLocaleDateString([], { weekday: "short" })}` : ""}
              </p>
            )}
          </div>
        </section>
      )}
      {skills.length > 0 && (
        <section>
          <h4>Skills used</h4>
          <p className="ab-skills">
            {skills
              .sort((x, y) => y[1] - x[1])
              .map(([k, n]) => (
                <span key={k}>
                  <b>{k}</b> {n}
                </span>
              ))}
          </p>
        </section>
      )}
    </div>
  );
}

/** The page's bar: its session and ⤢ (the full Stats page). */
export function StatsPageMeta({ a, onFull }: { a: Agent; onFull: () => void }) {
  return (
    <>
      <span>session {a.session ? a.session.slice(0, 8) : ""}</span>
      <button type="button" className="ab-drill__open" title="Open as page" aria-label="Open as page" onClick={onFull}>
        <Maximize2Icon size={12} />
      </button>
    </>
  );
}
