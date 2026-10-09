import type { ReactNode } from "react";
import "./figures.css";

/**
 * Small figure parts the Servers and Tokens pages share (servers-tokens spec, the comps' visual rules 2-6):
 *
 *   StatBar   one joined bar of cells, each a figure, a sentence and an optional pill (statistics-card-7)
 *   Spark     a load sparkline; segments above one load per core turn red (system-monitor)
 *   StoreBar  a label, a segmented bar and a sentence; amber under 20 % free, red under 10 % (dashboard/storage)
 *   Glow      a status dot that glows: green 2xx, amber 3xx/4xx, red 5xx or no answer, grey not checked
 *   Ring      a small ring meter for a used percent (tracker-card)
 *
 * Pure: they take numbers and words, nothing about machines or accounts.
 */
export type PillTone = "ok" | "warn" | "bad" | "info" | "none";
export type StatCell = { id: string; label: string; value: ReactNode; sentence?: ReactNode; pill?: { text: ReactNode; tone: PillTone; onClick?: () => void; pressed?: boolean; title?: string } };

export function StatBar({ cells, label }: { cells: StatCell[]; label?: string }) {
  return (
    <div className="ab-statbar" role="group" aria-label={label} data-testid="stat-bar">
      {cells.map((c) => (
        <div key={c.id} className="ab-statbar__cell" data-cell={c.id} data-testid="stat-cell">
          <span className="ab-statbar__label">{c.label}</span>
          <b className="ab-statbar__value">{c.value}</b>
          {c.sentence && (
            <span className="ab-statbar__sentence" title={typeof c.sentence === "string" ? c.sentence : undefined}>
              {c.sentence}
            </span>
          )}
          {c.pill &&
            (c.pill.onClick ? (
              <button type="button" className="ab-pill" data-tone={c.pill.tone} aria-pressed={c.pill.pressed} title={c.pill.title} onClick={c.pill.onClick} data-testid="stat-pill">
                {c.pill.text}
              </button>
            ) : (
              <span className="ab-pill" data-tone={c.pill.tone} title={c.pill.title} data-testid="stat-pill">
                {c.pill.text}
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}

/** Up to 60 points of load; `per` is the core count (a segment above 1 load per core is red). */
export function Spark({ points, per, height = 34, label }: { points: number[]; per: number | null; height?: number; label: string }) {
  if (points.length < 2) return <div className="ab-spark is-empty" style={{ height }} aria-label={`${label}: not enough readings yet`} data-testid="spark" />;
  const max = Math.max(...points, per ?? 0, 0.01) * 1.1;
  const w = 100;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => height - (v / max) * (height - 2) - 1;
  const segs = points.slice(1).map((v, i) => ({ x1: x(i), y1: y(points[i]), x2: x(i + 1), y2: y(v), hot: per !== null && (v > per || points[i] > per) }));
  return (
    <svg className="ab-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label} data-testid="spark">
      {per !== null && per < max && <line x1={0} x2={w} y1={y(per)} y2={y(per)} className="ab-spark__limit" />}
      {segs.map((s, i) => (
        <line key={i} {...s} className={s.hot ? "ab-spark__hot" : "ab-spark__line"} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** Free share → tone: red under 10 %, amber under 20 %. */
export const freeTone = (freePct: number | null): PillTone => (freePct === null ? "none" : freePct < 10 ? "bad" : freePct < 20 ? "warn" : "ok");

export function StoreBar({ label, usedPct, freePct, sentence, compact = false }: { label: string; usedPct: number | null; freePct: number | null; sentence: ReactNode; compact?: boolean }) {
  const used = usedPct === null ? null : Math.max(0, Math.min(100, usedPct));
  const segs = compact ? 10 : 20;
  const lit = used === null ? 0 : Math.round((used / 100) * segs);
  return (
    <div className={`ab-store${compact ? " is-compact" : ""}`} data-tone={freeTone(freePct)} data-testid="store-bar" data-label={label}>
      <span className="ab-store__label">{label}</span>
      <span className="ab-store__bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used ?? undefined}>
        {Array.from({ length: segs }, (_, i) => (
          <i key={i} className={i < lit ? "is-on" : undefined} />
        ))}
      </span>
      {!compact && <span className="ab-store__sentence">{sentence}</span>}
    </div>
  );
}

export const httpTone = (code: number | null): PillTone => (code === null ? "none" : code === 0 || code >= 500 ? "bad" : code >= 300 ? "warn" : "ok");
export function Glow({ code, title }: { code: number | null; title?: string }) {
  return <span className="ab-glow" data-tone={httpTone(code)} title={title ?? (code === null ? "not checked yet" : code === 0 ? "no answer" : `HTTP ${code}`)} data-testid="glow" />;
}

export function Ring({ pct, size = 44, label, sub, tone }: { pct: number | null; size?: number; label: string; sub?: ReactNode; tone?: PillTone }) {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const t = tone ?? (pct === null ? "none" : p >= 90 ? "bad" : p >= 70 ? "warn" : "ok");
  return (
    <span className="ab-ring" data-tone={t} data-testid="ring" title={typeof sub === "string" ? `${label} · ${sub}` : label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ab-ring__track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ab-ring__fill" strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
          {pct === null ? "—" : `${Math.round(p)}%`}
        </text>
      </svg>
      <span className="ab-ring__text">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}
