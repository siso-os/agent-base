/** Standing workers launched by codex-run; read-only, refreshed with the agents list. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_ROOT } from "./a0-tasks.ts";
import { readMeta } from "./codex-runs.ts";

export type RunItem = { id: string; kind: string; text: string; status?: string };
export type WorkerRun = { id: string; name: string; model: string; started: number; alive: boolean; tickets: string[]; step: string; items: RunItem[]; returned: string; result: string; tokensPerSecond: number; rateEstimated: boolean; ended: number; returnStatus: "done" | "blocked" | "failed" | null };
export type CodexWorker = { id: string; name: string; runs: WorkerRun[] };
const cache = new Map<string, { stamp: string; items: RunItem[]; step: string; tokens: number; usage: number; hasUsage: boolean; samples: { at: number; tokens: number; usage: number; hasUsage: boolean }[] }>();
const read = (file: string) => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
function alive(pid: unknown) {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}
export function codexWorkers(now = Date.now()): CodexWorker[] {
  const dir = process.env.AB_CODEX_RUNS ?? path.join(homedir(), ".local/state/codex-run/runs");
  let names: string[];
  try { names = readdirSync(dir).filter(n => /^[A-Za-z0-9_-]+\.meta\.json$/.test(n)); } catch { return []; }
  const workers = new Map<string, CodexWorker>();
  const seen = new Set<string>();
  for (const file of names) {
    let meta: any;
    // Parsed once per stat stamp (9 Oct: every agents read re-parsed all ~260 run files); a copy, as the cache is shared.
    meta = readMeta(path.join(dir, file)); if (!meta || typeof meta !== "object") continue; meta = { ...meta };
    if (typeof meta.worker !== "string" || !meta.worker.trim()) {
      if (typeof meta.name !== "string" || !meta.name.trim()) continue;
      meta.worker = meta.name.trim();
    }
    const id = file.replace(/\.meta\.json$/, ""), log = path.join(dir, `${id}.jsonl`);
    seen.add(log);
    let stamp = "", modified = 0;
    try { const s = statSync(log); modified = s.mtimeMs; stamp = `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { /* not written yet */ }
    let hit = cache.get(log);
    if (!hit || hit.stamp !== stamp) {
      const items = new Map<string, RunItem>();
      let step = "Starting", ordinal = 0, usage = 0, hasUsage = false;
      for (const line of read(log).split("\n")) {
        let event: any; try { event = JSON.parse(line); } catch { continue; }
        const outputTokens = event.usage?.output_tokens ?? event.usage?.completion_tokens;
        if (typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens >= 0) { usage += outputTokens; hasUsage = true; }
        const item = event.item;
        if (item && typeof item === "object") {
          const text = item.text ?? item.command ?? (Array.isArray(item.changes) ? item.changes.map((c: any) => `${c.kind ?? "change"} ${c.path ?? ""}`).join("\n") : item.message ?? "");
          const key = String(item.id ?? `event-${ordinal++}`);
          items.set(key, { id: key, kind: String(item.type ?? "event"), text: String(text), status: item.status });
          if (item.type === "command_execution" && item.aggregated_output) items.set(`${key}-output`, { id: `${key}-output`, kind: "command_output", text: String(item.aggregated_output) });
          step = String(text || item.type).replace(/\s+/g, " ").slice(0, 180);
        } else {
          step = String(event.type ?? "Working").replaceAll(".", " ");
          if (event.error?.message || event.message) items.set(`event-${ordinal++}`, { id: `error-${ordinal}`, kind: "error", text: String(event.error?.message ?? event.message) });
        }
      }
      const rows = [...items.values()];
      const tokens = rows.filter(i => i.kind === "agent_message").reduce((n, i) => n + i.text.length / 4, 0);
      // Untimestamped codex exec events are timed when first observed. The first
      // read is a baseline: historical output must not become live throughput.
      const samples = [...(hit?.samples ?? []), ...(hit ? [{ at: now, tokens: Math.max(0, tokens - hit.tokens), usage: Math.max(0, usage - hit.usage), hasUsage: hasUsage && usage !== hit.usage }] : [])].filter(s => now - s.at <= 5000 && s.at <= now);
      hit = { stamp, items: rows, step, tokens, usage, hasUsage, samples }; cache.set(log, hit);
    }
    const result = read(path.join(dir, `${id}.last.md`));
    const returned = /^STATUS:\s*(.+)$/im.exec(result)?.[1]?.trim() ?? (result ? "RETURN recorded" : "No RETURN yet");
    const ticketIds = Array.isArray(meta.tickets) ? meta.tickets : typeof meta.tickets === "string" ? meta.tickets.split(/[\s,]+/) : [];
    const tickets = ticketIds.filter((t: unknown): t is string => typeof t === "string" && /^t-\d+$/.test(t)).map((t: string) => {
      let title = ""; try { title = JSON.parse(read(path.join(process.env.AB_A0_TASKS ?? DEFAULT_ROOT, `${t}.json`))).title ?? ""; } catch { /* ticket may not exist yet */ }
      return title ? `${t}: ${title}` : t;
    });
    const running = alive(meta.pid), samples = hit.samples.filter(s => now - s.at < 5000 && s.at <= now);
    const measured = samples.some(s => s.hasUsage);
    const rate = running ? samples.reduce((sum, s) => sum + (measured ? s.usage : s.tokens), 0) / 5 : 0;
    let ended = modified;
    if (result) { try { ended = statSync(path.join(dir, `${id}.last.md`)).mtimeMs; } catch { /* writer may rotate */ } }
    const returnStatus = /^(done|blocked|failed)\b/i.exec(returned)?.[1]?.toLowerCase() as WorkerRun["returnStatus"] ?? null;
    const run: WorkerRun = { id, name: String(meta.name ?? id), model: String(meta.model ?? "Codex"), started: typeof meta.started === "number" ? (meta.started < 1e12 ? meta.started * 1000 : meta.started) : Date.parse(meta.started) || 0, alive: running, tickets, step: hit.step, items: hit.items, returned, result, tokensPerSecond: rate, rateEstimated: !measured, ended, returnStatus };
    const name = meta.worker.trim();
    if (!workers.has(name)) workers.set(name, { id: `codex-worker-${encodeURIComponent(name)}`, name, runs: [] });
    workers.get(name)!.runs.push(run);
  }
  for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
  return [...workers.values()].map(w => ({ ...w, runs: w.runs.sort((a, b) => Number(b.alive) - Number(a.alive) || b.started - a.started || b.id.localeCompare(a.id)) }));
}
const INFRA_ROLES = new Set(["HEALTH", "EFFICIENCY", "ESTATE"]);
// Cache only the compact projection; the org refresh reads a bounded tail asynchronously.
const ledgers = new Map<string, string>();
export async function roleLedger(role: string): Promise<string> {
  const dir = process.env.AB_A0_ROLES ?? path.join(path.dirname(DEFAULT_ROOT), "roles");
  let ledger = "No ledger entry yet";
  let file;
  try {
    file = await open(path.join(dir, `${role.toLowerCase()}.jsonl`), "r");
    const { size } = await file.stat();
    const offset = Math.max(0, size - 16 * 1024);
    const buffer = Buffer.alloc(Math.min(size, 16 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    let tail = buffer.toString("utf8", 0, bytesRead);
    if (offset) { const newline = tail.indexOf("\n"); tail = newline < 0 ? "" : tail.slice(newline + 1); }
    for (const line of tail.trim().split("\n").reverse()) {
      try {
        const entry = JSON.parse(line);
        if (typeof entry.number === "string" && typeof entry.status === "string") {
          ledger = `${entry.number} · ${entry.status}`.replace(/\s+/g, " ");
          break;
        }
      } catch { /* Skip a writer's incomplete final line. */ }
    }
  } catch { /* A role may not have recorded a ledger yet. */ }
  finally { await file?.close().catch(() => {}); }
  ledgers.set(role.toUpperCase(), ledger);
  return ledger;
}
export function codexWorkerRows(machine: string) {
  return codexWorkers().map(w => {
    const infrastructureRole = INFRA_ROLES.has(w.name.toUpperCase()) ? w.name.toUpperCase() : null;
    const run = w.runs[0], working = w.runs.some(r => r.alive);
    const title = run.tickets.map(t => t.includes(": ") ? t.slice(t.indexOf(": ") + 2) : "").filter(Boolean).join(" · ") || run.name;
    const workerSummary = { tickets: run.tickets, model: run.model, elapsed: Math.max(0, (run.alive ? Date.now() : run.ended) - run.started), state: run.alive ? "Working" : run.returnStatus ?? "Idle", message: run.items.filter(i => i.kind === "agent_message").at(-1)?.text.replace(/\s+/g, " ").slice(0, 180) ?? "No agent message yet" };
    const infrastructureSummary = infrastructureRole ? {
      line: `${run.tickets.join(" · ") || run.name} · ${run.items.filter(i => i.kind === "agent_message").at(-1)?.text.replace(/\s+/g, " ").slice(0, 180) || (working ? "Working" : "Idle")}`,
      ledger: ledgers.get(infrastructureRole) ?? "No ledger entry yet",
    } : null;
    return { infrastructureRole, infrastructureSummary, id: w.id, key: `${machine}/${w.id}`, pane: "", name: w.name, title, workerSummary, status: working ? "working" : run.returnStatus === "done" ? "done" : run.returnStatus === "failed" || run.returnStatus === "blocked" ? "failed" : "idle", since: run.started, row: "live", snoozedUntil: null, settledAt: null, seenAt: null, order: null, tool: "codex", cwd: "", folder: "", machine, session: null, context: null, hud: null, zero: false, chat: true, codexWorker: true, lead: infrastructureRole ? null : "Agent Zero", project: null, domain: null, role: null, pinned: false, pages: [] };
  });
}
