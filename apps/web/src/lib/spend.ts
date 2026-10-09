import { useEffect, useSyncExternalStore } from "react";
import type { SpendData, SpendResponse } from "../components/SpendPanel";

/**
 * Today's fleet spend (ab-142, R1.15): one read of GET /api/spend, every minute while anything shows it, so the top bar's
 * chip, Agent Zero's hero tile and the Stats page always carry the same number.
 */
let spend: SpendResponse | null = null;
let users = 0;
let timer: number | undefined;
const subs = new Set<() => void>();
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const plain = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const credits = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(finite);
const day = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
function validData(d: unknown): d is SpendData {
  return plain(d) && day(d.day) && finite(d.claude_usd_equiv) && credits(d.codex_credits) && finite(d.attributed_to_plan_items)
    && Array.isArray(d.plan_items) && d.plan_items.every(i => plain(i) && typeof i.id === "string" && typeof i.title === "string" && (i.plan === null || typeof i.plan === "string") && finite(i.claude_usd_equiv))
    && Array.isArray(d.projects) && d.projects.every(p => plain(p) && typeof p.project === "string" && finite(p.claude_usd_equiv) && credits(p.codex_credits)
      && Array.isArray(p.owners) && p.owners.every(o => plain(o) && typeof o.owner === "string" && finite(o.claude_usd_equiv) && credits(o.codex_credits)
        && Array.isArray(o.agents) && o.agents.every(a => plain(a) && typeof a.agent === "string" && finite(a.claude_usd_equiv) && credits(a.codex_credits) && plain(a.items) && Object.values(a.items).every(finite))));
}
/** Retain only attribution on transport failure; an old Tokens counter must not become today's live total. */
export function failedSpend(previous: SpendResponse | null, reason: "transport" | "schema", at = Date.now()): SpendResponse {
  const good = previous?.source === "stack-opt" ? previous : null;
  return {
    ...(good ? { source: "stack-opt" as const, data: good.data } : { source: "pending" as const }),
    attribution: { source: "stack-opt", scope: "report-day", state: good ? "stale" : "unavailable", observedAt: good?.attribution?.observedAt ?? null, attemptedAt: at, day: good?.data.day ?? null, reason },
  };
}
/** Validate before replacing the last readable hierarchy, including metadata and the independent Tokens value. */
export function acceptSpend(previous: SpendResponse | null, value: unknown, at = Date.now()): SpendResponse {
  if (!plain(value) || (value.source !== "pending" && value.source !== "stack-opt") || (value.source === "stack-opt" && !validData(value.data))) return failedSpend(previous, "schema", at);
  const a = value.attribution;
  if (!plain(a) || a.source !== "stack-opt" || a.scope !== "report-day" || !finite(a.attemptedAt)
    || !(a.observedAt === null || finite(a.observedAt)) || !(a.day === null || day(a.day))
    || !(a.reason === null || ["unavailable", "timeout", "malformed", "schema", "day-mismatch"].includes(String(a.reason)))
    || (value.source === "pending" ? a.state !== "unavailable" || a.day !== null || a.observedAt !== null : !["fresh", "stale"].includes(String(a.state)) || a.day !== (value.data as SpendData).day || !finite(a.observedAt))
    || (a.state === "fresh" && a.reason !== null)) return failedSpend(previous, "schema", at);
  const t = value.today;
  if (t !== undefined && (!plain(t) || t.from !== "tokens" || !finite(t.usd) || !day(t.day) || !finite(t.observedAt))) return failedSpend(previous, "schema", at);
  const next = value as SpendResponse;
  // A restarted node may have no report yet; this browser still has its last successful attribution.
  if (next.source === "pending" && previous?.source === "stack-opt") return { ...failedSpend(previous, "transport", at), attribution: { ...previous.attribution!, state: "stale", attemptedAt: next.attribution!.attemptedAt, reason: next.attribution!.reason }, today: next.today };
  return next;
}
let loading: Promise<void> | null = null;
const load = () => loading ??= (async () => {
  try {
    const response = await fetch("/api/spend", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("unavailable");
    spend = acceptSpend(spend, await response.json());
  } catch { spend = failedSpend(spend, "transport"); }
  subs.forEach(f => f());
})().finally(() => { loading = null; });

export function useSpend(): SpendResponse | null {
  useEffect(() => {
    if (users++ === 0) {
      void load();
      timer = window.setInterval(load, 60_000);
    }
    return () => {
      if (--users === 0) window.clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => spend,
  );
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
/** Today on this Mac's clock (YYYY-MM-DD): the meter counts its day from local midnight, so "today" is his, not UTC's. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The report, when it is today's: just after midnight the last one read can still be yesterday's (HUB-DESIGN 00:22). */
export const todayReport = (s: SpendResponse | null) => (s?.source === "stack-opt" && s.attribution?.state === "fresh" && s.data.day === localDay() && typeof s.data.claude_usd_equiv === "number" ? s.data : null);
/** Only the Tokens scan supplies today's figure; attribution never substitutes for it. */
const todayFigure = (s: SpendResponse | null) => s?.today?.from === "tokens" && s.today.day === localDay() && finite(s.today.usd) ? s.today.usd : null;
export const todayUsd = (s: SpendResponse | null) => { const value = todayFigure(s); return value === null ? null : usd.format(value); };
export const todayUsdShort = (s: SpendResponse | null) => { const value = todayFigure(s); return value === null ? null : short.format(value).replace(/K$/, "k"); };
