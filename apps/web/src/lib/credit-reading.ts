/** Preserve reported numeric observations; malformed values never become zero. */
export function reportedCredit(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export const creditFigure = (value: unknown) => reportedCredit(value)?.toLocaleString("en-US", { maximumSignificantDigits: 21 }) ?? "Unknown";

/** Only a source sample timestamp belongs here, never a route/cache read clock. */
export function creditSample(value: unknown, secondsOrText = false): string {
  const at = typeof value === "number" ? (secondsOrText && value < 1e12 ? value * 1000 : value)
    : secondsOrText && typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(new Date(at).getTime())) return "sample time unknown";
  return `sampled ${new Date(at).toLocaleString()}${at > Date.now() ? " · sample timestamp is in the future" : ""}`;
}
