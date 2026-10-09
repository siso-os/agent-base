/** Old servers without measurement provenance remain unavailable; never infer rate from total tokens. */
export type WorkerRate = { running: boolean; kind: string; rate?: number; rateAt?: number; rateWindowMs?: number; estimated?: boolean; rateEstimated?: boolean; status?: string };
export function measuredWorkerRate(row: WorkerRate, now: number): number | undefined {
  if (!row.running || ["blocked", "failed", "stopped"].includes(row.status ?? "") || row.kind === "shell" || !Number.isFinite(row.rate) || row.rate! < 0 || !Number.isFinite(row.rateAt) || !row.rateWindowMs) return undefined;
  const age = now - row.rateAt!;
  return age >= -1000 && age <= 10_000 ? row.rate : undefined;
}
export function workerRateSummary(rows: readonly WorkerRate[], now: number) {
  const active = rows.filter(row => row.running && !["blocked", "failed", "stopped"].includes(row.status ?? "") && row.kind !== "shell");
  const measured = active.flatMap(row => { const rate = measuredWorkerRate(row, now); return rate === undefined ? [] : [{ rate, estimated: !!(row.rateEstimated ?? row.estimated) }]; });
  const value = measured.reduce((sum, row) => sum + row.rate, 0);
  const estimated = measured.some(row => row.estimated), partial = measured.length < active.length;
  return { value, measured: measured.length, total: active.length, estimated, partial,
    label: measured.length ? `${estimated ? "~" : ""}${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}${partial ? "+" : ""}` : "—",
    title: measured.length ? `Recent output-token average; ${measured.length} of ${active.length} working agents measured.${partial ? " + means other agents have no current measurement." : ""}${estimated ? " ~ includes an estimate from generated text." : ""} Input and cache tokens excluded.` : "Output rate unavailable: waiting for current output-token measurements. Input and cache tokens are never used." };
}
