/** Small formatters lifted from SISO Internal's VoiceBoardCards (no date-fns: Intl does it). */

export const formatGrouped = (n: number) => n.toLocaleString("en-US");

/** ShareCardStats.humanDuration parity: "4d 11h" / "2h 13m" / "0m". */
export function formatSavedMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Local yyyy-MM-dd, the key the node uses for a day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "Today", "Yesterday", a weekday this week, else "Mon 14 Sep" (with the year when it is not this year). */
export function dayLabel(day: string, now = new Date()): string {
  const d = parseDay(day);
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === today) return "Today";
  if (day === dayKey(y)) return "Yesterday";
  const ago = (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - d.getTime()) / 86_400_000;
  if (ago > 0 && ago < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** 14:05 */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** 1m 12s */
export function formatSeconds(s: number | null): string | null {
  if (s == null || !Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
