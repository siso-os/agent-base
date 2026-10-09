import { useEffect, useState, type ReactNode } from "react";
import { GitFork, RotateCcw } from "lucide-react";
import "./ContextCard.css";

/**
 * The ctx ring's card body (Opus UI wave, 9 Oct). It answers three things at a glance: how full and how close to compaction
 * (the gauge), what is eating it (the mix and the three biggest), and what he can do (compact, fork from a turn).
 * Shaan, 4 Oct on ideas round 2: "the context one really good"; round 1: "wrapped the context percentage thing we already have,
 * not an extra pill". The mix comes from GET /api/agents/:id/context (context-mix.ts), an estimate at ~4 characters a token.
 */
export type Mix = { kinds: { files: number; shell: number; subagents: number; talk: number; tools: number }; top: { label: string; tokens: number }[]; turns?: { back: number; text: string }[]; files?: { label: string; state: "changed" | "unchanged" | "unknown" }[] };
export type MixStatus = { state: "loading" } | { state: "ready"; mix: Mix } | { state: "none"; why: string } | { state: "error"; why: string };
export const MIX_KINDS = [["files", "files read", "#93c5fd"], ["talk", "conversation", "#e6c79f"], ["subagents", "sub-agents", "#a78bfa"], ["shell", "shell output", "#86efac"], ["tools", "other tools", "#77736c"]] as const;
type Kind = (typeof MIX_KINDS)[number][0];
export const contextSegments = (mix: Mix | null) => mix ? MIX_KINDS.map(([key, label, color]) => ({ label, color, value: mix.kinds[key] })) : undefined;
const k_ = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
const colorOf = (kind: Kind) => MIX_KINDS.find(([k]) => k === kind)![2];
/** context-mix labels its biggest items "<tool> <what>"; the tool says which kind it is. */
const kindOfTop = (label: string): Kind => { const tool = label.split(" ", 1)[0]; return ["Read", "Grep", "Glob", "NotebookRead", "LS"].includes(tool) ? "files" : tool === "Agent" || tool === "Task" ? "subagents" : tool === "Bash" ? "shell" : "tools"; };
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ago`; };

/** A drop of 15+ points to under half is a compaction (the session id stays; the node resets its mix at the boundary). Kept per chat while the app runs. */
const seen = new Map<string, { last: number; at?: number; from?: number }>();
export function noteCompaction(key: string, pct: number | null): { at: number; from: number } | null {
  const rec = seen.get(key);
  if (pct !== null && Number.isFinite(pct)) {
    if (rec && rec.last - pct >= 15 && pct < rec.last / 2) { rec.at = Date.now(); rec.from = rec.last; }
    if (rec) rec.last = pct; else seen.set(key, { last: pct });
  }
  return rec?.at && rec.from !== undefined && Date.now() - rec.at < 3_600_000 ? { at: rec.at, from: rec.from } : null;
}

export const levelOf = (pct: number | null, compactAt: number) => pct === null ? "none" : pct >= 90 ? "full" : pct >= compactAt ? "hot" : "ok";

/** The card's title: the number, one bar (used part painted by kind, a notch at the compact mark) and one line of headroom. */
export function ContextGauge({ pct, compactAt, mix, compacted }: { pct: number | null; compactAt: number; mix: Mix | null; compacted: { at: number; from: number } | null }) {
  const used = pct === null ? 0 : Math.min(100, Math.max(0, pct)), level = levelOf(pct, compactAt);
  const total = mix ? Object.values(mix.kinds).reduce((n, v) => n + v, 0) : 0;
  const room = Math.round(compactAt - used);
  const line = pct === null ? "Not reported yet" : level === "full" ? "Nearly full. Write the handoff and compact now." : level === "hot" ? "Past its compact mark." : `${room} point${room === 1 ? "" : "s"} to go before it compacts`;
  return <span className="ab-ctx__gauge" data-testid="ctx-gauge" data-level={level}>
    <span className="ab-ctx__figure"><b>{pct === null ? "—" : `${Number(used.toFixed(1))}%`}</b> context used</span>
    <span className="ab-ctx__bar" role="img" aria-label={pct === null ? "Context not reported" : `${used}% used; compacts at ${compactAt}%`}>
      <span className="ab-ctx__used" style={{ ["--used" as string]: used / 100 }}>
        {total > 0 ? MIX_KINDS.map(([k, , c]) => mix!.kinds[k] > 0 && <i key={k} style={{ flexGrow: mix!.kinds[k], background: c }} />) : <i style={{ flexGrow: 1 }} />}
      </span>
      <span className="ab-ctx__mark" style={{ left: `${compactAt}%` }} />
    </span>
    <span className="ab-ctx__room" data-testid="ctx-headroom">{line}</span>
    {compacted && <span className="ab-ctx__compacted" data-testid="ctx-compacted"><RotateCcw size={11} aria-hidden /> Compacted {ago(compacted.at)} · was {compacted.from}%</span>}
  </span>;
}

/** What fills it and what to do about it. `compact` is the caller's handoff-then-compact button, shown first when present. */
export function ContextBreakdown({ agentId, status, compact, children }: { agentId: string; status: MixStatus; compact?: ReactNode; children?: ReactNode }) {
  const mix = status.state === "ready" ? status.mix : null;
  const total = mix ? Object.values(mix.kinds).reduce((n, v) => n + v, 0) : 0;
  const files = mix?.files ?? [], changed = files.filter((f) => f.state === "changed").length;
  return <div className="ab-ctx" data-testid="ctx-card">
    {status.state === "loading" && <div className="ab-ctx__loading" data-testid="ctx-loading" aria-busy="true" aria-label="Reading the session file"><i /><i /><i /></div>}
    {status.state === "none" && <p className="ab-ctx__none" data-testid="ctx-none">{status.why}</p>}
    {status.state === "error" && <p className="ab-ctx__none" data-testid="ctx-none" role="status">Breakdown unavailable right now ({status.why}).</p>}
    {mix && !total && <p className="ab-ctx__none" data-testid="ctx-none">{mix.turns?.length ? "Nothing carried yet since the last compaction." : "Nothing in this chat yet."}</p>}
    {mix && total > 0 && <section className="ab-ctx__mix" data-testid="context-mix">
      <h4>Estimated source mix <abbr title="Estimated from the session file at about 4 characters a token. The system prompt and tool definitions are not in the file.">?</abbr></h4>
      <ul className="ab-ctx__kinds">{MIX_KINDS.filter(([k]) => mix.kinds[k] > 0).map(([k, label, c]) => <li key={k}><i style={{ background: c }} />{label}<b>{k_(mix.kinds[k])}</b></li>)}</ul>
      {mix.top.length > 0 && <><h4>Biggest</h4><ol className="ab-ctx__top" data-testid="ctx-top">{mix.top.map((t, i) => {
        const what = t.label.replace(/^\S+\s/, "");
        return <li key={`${t.label}:${i}`}><i style={{ background: colorOf(kindOfTop(t.label)) }} /><span className="ab-ctx__top-label" title={t.label}>{what}</span><b>{k_(t.tokens)}</b></li>;
      })}</ol></>}
    </section>}
    {(compact || !!mix?.turns?.length) && <div className="ab-ctx__actions" data-testid="ctx-actions">{compact}{mix && <Fork agentId={agentId} turns={mix.turns ?? []} />}</div>}
    {files.length > 0 && <section className="ab-ctx__files" data-testid="ctx-files">
      <h4 title="Estimated from modification times">Files read · {changed ? `${changed} changed of ${files.length}` : `${files.length}, none changed`}</h4>
      {/* Changed files stay in view (the model's copy is stale); the rest fold away. */}
      {files.filter((f) => f.state === "changed").map(fileRow)}
      {changed < files.length && <details><summary>{files.length - changed} {changed ? "more" : "files"}</summary>{files.filter((f) => f.state !== "changed").map(fileRow)}</details>}
    </section>}
    {children}
  </div>;
}

const fileRow = (file: NonNullable<Mix["files"]>[number], i: number) => <div key={`${file.label}:${i}`}><span title={file.label}>{file.label}</span><b data-state={file.state}>{file.state === "changed" ? "Changed since read" : file.state === "unknown" ? "Not checked" : "No newer edit"}</b></div>;

/** Rewind and fork (ideas r2 #7): a new chat from one of his turns, beside this one; this chat is left as it is. Kept as it was ("probably not useful": do not grow it). */
function Fork({ agentId, turns }: { agentId: string; turns: { back: number; text: string }[] }) {
  const [forking, setForking] = useState<number | null>(null), [note, setNote] = useState<string | null>(null);
  useEffect(() => { setNote(null); }, [agentId]);
  if (!turns.length) return null;
  return <details className="ab-fork ab-ctx__fork"><summary><GitFork size={12} aria-hidden /> Fork from a turn</summary>
    {turns.map((t) => <button key={t.back} type="button" disabled={forking !== null} title="A new chat with everything up to this turn's answer; this one stays as it is" onClick={() => {
      setForking(t.back);
      fetch(`/api/agents/${encodeURIComponent(agentId)}/fork`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ back: t.back }) })
        .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`); window.dispatchEvent(new CustomEvent("siso-open-split", { detail: { name: d.name } })); setNote(`Opening ${d.name} beside this chat…`); })
        .catch((e: Error) => setNote(e.message)).finally(() => setForking(null));
    }}><i>{t.back === 0 ? "latest" : `${t.back} back`}</i>{t.text}</button>)}
    {note && <span className="ab-ctx__note">{note}</span>}
  </details>;
}
