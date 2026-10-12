import { useState } from "react";
import { refresh } from "./poll";

/** ↻ for Claude usage (Shaan, 10 Oct: "there should be a refresh button on it"): the node reads every Claude account from
 * Anthropic now (POST /api/claude-usage), then every view of /api/tokens reloads. Used by the Budget card and the composer's
 * usage card. */
export function useUsageRefresh() {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { const r = await fetch("/api/claude-usage", { method: "POST" }); if (!r.ok) throw new Error(String(r.status)); await refresh("/api/tokens"); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return { busy, failed, run };
}

/** "just now", "3m ago", "2h ago": how old a usage reading is. */
export const agoWords = (at: number, now: number) => { const m = Math.floor((now - at) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };

/** What the header says: refreshing, failed, or how old the newest reading is. */
export const freshWords = (busy: boolean, failed: boolean, at: number | null, now: number) =>
  busy ? "refreshing…" : failed ? "couldn't refresh" : at ? `updated ${agoWords(at, now)}` : "not read yet";
