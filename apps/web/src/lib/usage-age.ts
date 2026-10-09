/** Account usage has its own timestamp, independent of session context updates. */
export function usageAge(hud: { limitsAt?: number | null; limitsStale?: boolean } | null | undefined, now = Date.now()) {
  if (!hud?.limitsStale && hud?.limitsAt && now - hud.limitsAt <= 300_000) return "";
  return hud?.limitsAt ? `stale · as of ${new Date(hud.limitsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} (${Math.max(0, Math.floor((now - hud.limitsAt) / 60_000))} min ago)` : "usage update time unknown";
}
