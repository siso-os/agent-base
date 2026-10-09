import { useSyncExternalStore } from "react";
import { AgentFace } from "../lib/face";
import { measuredWorkerRate } from "../lib/subagent-rate";
import type { Agent } from "../lib/agents";
import "./SubagentRow.css";

/** One row of GET /api/agents/:id/subagents. name/model come from the sub-agent's .meta.json; toolUseId is the key the chat files its steps under. */
export type SubagentRowData = { id: string; agentId?: string; kind: "claude" | "codex" | "shell"; type: string; what: string; spec: string; about?: string; start: string | null; end: string | null; tools: number | null; tokens: number; running: boolean; background: boolean; toolUseId?: string; name?: string; model?: string; batch?: string; batchId?: string; rate?: number; rateAt?: number; rateWindowMs?: number; rateEstimated?: boolean; estimated?: boolean; quiet?: boolean; status?: string };
export type SubagentsResult = { rows: SubagentRowData[]; running: number; tokens: number };

/** The transcript's six dot colours (SPEC-CHAT-HUD §2); a sub-agent row is running (cyan) or done (green). */
export const DOT = { prose: "var(--crm-color-text)", done: "rgb(var(--crm-success-rgb))", failed: "rgb(var(--crm-danger-rgb))", running: "#22D3EE", waiting: "rgb(var(--crm-brand-rgb))", quiet: "rgba(255,255,255,.25)" } as const;
export type DotTone = keyof typeof DOT;
export const rowTone = (row: SubagentRowData): DotTone => row.status === "failed" || row.status === "blocked" ? "failed" : row.quiet || row.status === "stopped" ? "waiting" : row.running ? "running" : "done";

export const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
export function clock(at: string | null) {
  if (!at) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}
export function duration(start: string | null, end: string | null, now: number) {
  if (!start) return "—";
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

/** Opens a row: a crew row opens that agent's own chat; a sub-agent opens in the chat by its Agent tool_use id, not the file id (R1.20b). */
export function openSubagent(row: SubagentRowData, crew: Agent[], onOpenCrew: (agent: Agent) => void) {
  if (row.id.startsWith("child-") && row.agentId?.startsWith("service-")) { window.dispatchEvent(new CustomEvent("siso-open-split", { detail: { name: row.agentId.slice(8) } })); return; }
  if (row.agentId) { const a = crew.find((x) => x.id === row.agentId); if (a) onOpenCrew(a); }
  else window.dispatchEvent(new CustomEvent("siso-open-subagent", { detail: { id: row.toolUseId ?? row.id } }));
}

/**
 * Talk to a worker: the node reopens a Sol's Codex thread (or seeds a chat for a Claude sub-agent) and the app splits that
 * live chat in beside its parent. Resolves to why not, or null.
 */
export async function talkToSubagent(parentId: string, row: SubagentRowData): Promise<string | null> {
  try {
    const r = await fetch(`/api/agents/${encodeURIComponent(parentId)}/subagents/${encodeURIComponent(row.toolUseId ?? row.id)}/talk`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.name) return d.error ?? `could not open ${row.name ?? "it"}`;
    window.dispatchEvent(new CustomEvent("siso-open-split", { detail: { name: d.name } }));
    return null;
  } catch {
    return "the node did not answer";
  }
}

export function SubagentRow({ row, now, onOpen }: { row: SubagentRowData; now: number; onOpen: (row: SubagentRowData) => void }) {
  const rate = measuredWorkerRate(row, now);
  return <button type="button" className="ab-subagents__row" data-testid="subagent-row" data-tone={rowTone(row)} data-tool={row.toolUseId} data-running={row.running && !row.agentId ? "1" : undefined} title={row.running && !row.agentId ? "Enter opens it here · ⌫ stops it" : undefined} onClick={() => onOpen(row)}>
    <span className="ab-subagents__icon"><AgentFace name={row.name ?? row.type} project={row.name ?? row.type} status={row.running ? "working" : "done"} size={22} /></span>
    <span className="ab-subagents__copy"><b>{row.name || row.what || row.type}</b><small>{[row.name ? row.what : null, row.type, row.model, row.background ? "background" : null].filter(Boolean).join(" · ")}</small>{row.spec && <em>{row.spec}</em>}</span>
    <span className={`ab-subagents__stats${row.running ? " is-running" : ""}`}><b>{row.running ? `running ${duration(row.start, null, now)}` : duration(row.start, row.end, now)}</b><small>{row.tools === null ? "" : `${row.tools} tools · `}{fmtTokens(row.tokens)} tokens</small>{rate !== undefined && <small>{(row.rateEstimated ?? row.estimated) ? "~" : ""}{Math.round(rate)} tok/s</small>}{!row.running && <small>{row.status ? `RETURN: ${row.status}` : `${clock(row.start)}–${clock(row.end)}`}</small>}</span>
  </button>;
}

/**
 * Sub-agent rows (name, model, running, times, tokens) by their Agent tool_use id, from the last GET /api/agents/:id/subagents any view read (the
 * HUD's faces pill polls it). The chat's fan-out rows read it, so a row says SPEC-HEADER · opus, not general-purpose.
 */
const metaByTool = new Map<string, SubagentRowData>();
const metaSubs = new Set<() => void>();
let metaVersion = 0;
export function rememberSubagents(rows: SubagentRowData[]) {
  let changed = false;
  for (const r of rows) {
    if (!r.toolUseId) continue;
    const had = metaByTool.get(r.toolUseId);
    if (had && had.name === r.name && had.model === r.model && had.running === r.running && had.end === r.end && had.tokens === r.tokens) continue;
    metaByTool.set(r.toolUseId, r);
    changed = true;
  }
  if (changed) (metaVersion++, metaSubs.forEach((fn) => fn()));
}
export function useSubagentMeta(toolUseId: string) {
  useSyncExternalStore((fn) => (metaSubs.add(fn), () => void metaSubs.delete(fn)), () => metaVersion);
  return metaByTool.get(toolUseId);
}
export const subagentMetaOf = (toolUseId: string) => metaByTool.get(toolUseId);
