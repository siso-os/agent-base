import { AgentFace } from "../../lib/face";
import { duration, fmtTokens, type SubagentRowData } from "../SubagentRow";
import "./panel.css";

/** A /subagents row with what the panel adds: quiet (unfinished, silent 10 min), its newest step, failed tool calls. */
export type SubRowData = SubagentRowData & { quiet?: boolean; last?: string; errors?: number; title?: string; tickets?: { id: string; title: string }[]; why?: string; effort?: string; machine?: "laptop" | "mini"; pid?: number; proc?: { cpu: number; rssMb: number; at: number }; usage?: { in: number; out: number }; miniName?: string };
export type SubTone = "running" | "done" | "quiet";

export const subTone = (r: SubRowData): SubTone => (r.quiet ? "quiet" : r.running ? "running" : "done");
/** opus / sonnet / haiku / fable, herdr for a crew tab, else its kind. */
export const modelChip = (r: SubRowData) => (r.agentId ? "herdr" : (/opus|sonnet|haiku|fable/i.exec(r.model ?? r.type ?? "")?.[0] ?? (r.kind === "codex" ? "codex" : "")).toLowerCase());
/** Its own name (from .meta.json) when it has one, else what it was sent to do. */
export const subName = (r: SubRowData) => r.name?.replace(/^#+\s*/, "").split(":", 1)[0] || r.what || r.type;
export const minutesSince = (at: string | null, now: number) => Math.max(0, Math.round((now - Date.parse(at ?? "")) / 60_000));
/** The time on its right: ticking while it runs, ✓ and how long when done, quiet and for how long. */
export function subTime(r: SubRowData, now: number) {
  if (r.quiet) return `quiet ${minutesSince(r.end ?? r.start, now)}m`;
  if (r.running) return r.start ? duration(r.start, null, now) : "running";
  return r.start ? `✓ ${duration(r.start, r.end, now)}` : "✓ done";
}
export function SubFace({ r, project, size = 22 }: { r: SubRowData; project?: string | null; size?: number }) {
  return <AgentFace name={subName(r)} project={project ?? undefined} status={r.running ? "working" : r.quiet ? "waiting" : "done"} size={size} />;
}

/**
 * One sub-agent (SPEC-PANEL-CARDS §5; Shaan 3 Oct 00:05: "the subtext is just a bit too much"): face · NAME · model chip
 * · its time; then one quiet line: running, `▸ <its newest step>`; done, what it was for. Tokens sit on the right of that
 * line. Never taller than 44 px. Shared by the panel's card and its Sub-agents page.
 */
export function SubRow({ r, now, project, onOpen, detail = false }: { r: SubRowData; now: number; project?: string | null; onOpen: (r: SubRowData) => void; detail?: boolean }) {
  const tone = subTone(r);
  const chip = modelChip(r);
  const quiet = r.running && r.last ? `▸ ${r.last}` : r.what && r.what !== subName(r) ? r.what : r.type;
  return (
    <button type="button" className={`ab-sa${detail ? " ab-fleet-row" : ""}`} data-testid={detail ? "fleet-row" : "subagent-row"} data-tone={tone} title={r.spec || undefined} onClick={() => onOpen(r)}>
      <span className="ab-sa__face">
        <SubFace r={r} project={project} />
      </span>
      <span className="ab-sa__l1">
        <b className={r.name ? "is-name" : undefined}>{subName(r)}</b>
        {detail && <em className="ab-fleet-machine">{r.machine ?? "laptop"}</em>}
        {chip && <em className={`ab-chip is-${chip}`}>{chip}</em>}
        <time className={`ab-sa__time is-${tone}`}>{subTime(r, now)}</time>
      </span>
      {detail && <span className="ab-fleet-row__brief">
        <strong>{r.title || r.what || r.type}</strong>
        {r.about && <small>{r.about}</small>}
        {r.tickets?.length ? <small className="ab-fleet-row__task">for: {r.tickets.map(t => t.title).join(" · ")}</small> : null}
      </span>}
      <span className="ab-sa__l2">
        <small className={r.running && r.last ? "is-step" : undefined}>{quiet}</small>
        {r.tokens > 0 && <i>{r.estimated ? "~" : ""}{fmtTokens(r.tokens)}</i>}
      </span>
    </button>
  );
}
