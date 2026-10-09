import { clock, useSharedState, refresh as refreshSource } from "../lib/poll";
import { ProviderUsageMeters } from "./ProviderUsageMeters";
import { DevPill } from "./DevPill";
import { SubagentsPopover } from "./SubagentsPopover";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { type Agent, useStats } from "../lib/agents";
import { AgentFace } from "../lib/face";
import { ModelMenu, modelLabel, type AccountSwitch } from "./ModelMenu";
import type { SwitchStatus } from "../../../../services/node/src/account-switch";
import { ComposerHud, ContextPopover } from "../../../../packages/siso-composer/src/ComposerHud";
import type { MoveStatus, MoveTarget } from "../../../../services/node/src/move";
import { ContextBreakdown, ContextGauge, contextSegments, levelOf, noteCompaction, type Mix, type MixStatus } from "./ContextCard";
import "./Hud.css";

/** What the agent's chat says is running (ChatView announces it): sub-agents running / started, background jobs. */
function useActivity(agentId: string) {
  const [a, setA] = useState<{ running: number; total: number; bg: number; shells?: { id: string; kind: string; description?: string }[] } | null>(null);
  useEffect(() => {
    setA(null);
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.agentId === agentId) setA({ running: d.running, total: d.total, bg: d.bg, shells: d.shells });
    };
    window.addEventListener("siso-chat-activity", on);
    return () => window.removeEventListener("siso-chat-activity", on);
  }, [agentId]);
  return a;
}
/** Groups with thin rules between them, unpilled and left-aligned (2 Oct 13:52: "it is clean not being in pills"). */
const Rule = () => <i aria-hidden className="ab-hud__rule" />;
const join = (parts: ReactNode[]) =>
  parts.filter(Boolean).map((p, i) => (
    <Fragment key={i}>
      {i > 0 && <Rule />}
      {p}
    </Fragment>
  ));

const k = (n: number | null) => (n === null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ago`; };
/** What is filling the context (ui-hub ideas round 2 #2): read when the card opens, kept fresh while the chat is shown. */
function useContextMix(agentId: string, session: string | null | undefined, open: boolean, why: string): MixStatus {
  const url = session ? `/api/agents/${encodeURIComponent(agentId)}/context?session=${encodeURIComponent(session)}` : null;
  const {data,error} = useSharedState<Mix>(url,30_000);
  useEffect(() => {if(open && url)void refreshSource(url,true);},[open,url]);
  // A 404 is the node saying there is no Claude session file (Codex, terminal-only): an honest line, not an error.
  if (!url || error === "HTTP 404") return { state: "none", why };
  if (data) return { state: "ready", mix: data };
  return error ? { state: "error", why: error } : { state: "loading" };
}
/** The breakdown alone, for previews that hand in a mix (preview/model-accounts.tsx). */
export function ContextMix({ agentId, mix }: { agentId: string; mix: Mix | null }) {
  return <ContextBreakdown agentId={agentId} status={mix ? { state: "ready", mix } : { state: "none", why: "No Claude session file for this chat." }}/>;
}
export { contextSegments, type Mix };
/** Move to… (ab-131), handed in by App: R1.21 took it out of the header and into this menu. `disabled` says why not. */
export type HudMove = { current: MoveTarget; status?: MoveStatus | null; disabled?: string; agentZero?: boolean; onMove: (to: MoveTarget, effort?: string) => void };

/**
 * This chat's Claude login switch (t-0577): POST starts it (202), then GET every 2 s until done or failed. The node runs the
 * switch script and confirms from the host records; this only shows what it says. Read when the menu opens.
 */
function useAccountSwitch(name: string): AccountSwitch {
  const url = `/api/agents/${encodeURIComponent(name)}/claude-account`;
  const [status, setStatus] = useState<SwitchStatus | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setBlocked(typeof d?.blocked === "string" ? d.blocked : null);
      setStatus(d?.state && d.state !== "idle" ? d as SwitchStatus : null);
    } catch { /* The next read tries again. */ }
  }, [url]);
  const running = !!status && !["done", "failed"].includes(status.state);
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(timer); }, [running, refresh]);
  // A confirmed switch changes the chat's account: read the agent list again so the check moves.
  useEffect(() => { if (status?.state === "done") void refreshSource("/api/agents", true); }, [status?.state]);
  const onSwitch = useCallback(async (to: string) => {
    setStatus({ state: "queued", message: "Queued", stages: ["Queued"] });
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to }) });
      const d = await r.json().catch(() => ({}));
      setStatus(r.ok && d?.state ? d as SwitchStatus : { state: "failed", message: d?.error ?? d?.message ?? `The switch was refused (HTTP ${r.status}); nothing moved` });
    } catch { setStatus({ state: "failed", message: "Could not reach the node; nothing moved" }); }
  }, [url]);
  return { status, blocked, onSwitch: to => void onSwitch(to), refresh: () => void refresh() };
}

/**
 * The model chip ▾ (R1.21's ModelMenu with R1.19's switcher on top): a terminal Claude's chat gets `/model <id>` typed
 * in through its own input; SDK seats send set_model and publish the acknowledged host model.
 * Move to… (another harness) sits under it.
 */
export function ModelChip({ a, model, move }: { a: Agent; model: string | null; move?: HudMove }) {
  const why = !a.host && a.tool !== "claude" && !move?.agentZero ? `${a.tool} picks its model in its own pane` : !a.chat ? "open its chat to switch" : null;
  // t-0570: "Opus 5.5 · 1M" under the composer, not "Claude Opus 5.5 · 1M"; the face keeps the full name, so it looks the same.
  const full = model ? modelLabel(model) : a.tool, label = full.replace(/^Claude /, "");
  const account = useAccountSwitch(a.name);
  return (
    <ModelMenu
      key={`${a.id}:${a.session}`}
      label={label}
      accountId={a.hud?.accountId}
      account={a.tool === "codex" ? undefined : account}
      className="ab-hud__model"
      face={<AgentFace name={full} project={full} family={a.tool === "codex" ? "codex" : a.tool === "claude" ? "claude" : undefined} status="waiting" size={16} />}
      switcher={{ model, why, harness: a.tool === "codex" ? "codex" : a.host ? "claude" : a.tool, effort: a.hud?.effort ?? null, models: a.hud?.models, ...(a.host ? { onModel: (picked: string) => window.dispatchEvent(new CustomEvent("siso-chat-model", { detail: { agentId: a.id, session: a.session, model: picked } })), onEffort: (effort: string) => window.dispatchEvent(new CustomEvent("siso-chat-effort", { detail: { agentId: a.id, session: a.session, effort } })) } : {}), onSay: (text) => window.dispatchEvent(new CustomEvent("siso-chat-say", { detail: { agentId: a.id, session: a.session, settings: true, text } })) }}
      {...move}
    />
  );
}

/** From here the ctx ring glows amber and its card offers Compact (4 Oct: "wrapped the context percentage thing we already have, not an extra pill"). */
/**
 * The agent's own Claude HUD (Shaan, 2 Oct: "the model … the percentage bar … tokens in, tokens out … the 5 hour limit,
 * and the weekly limit and how many hours and minutes left"), read from the file siso-hud.mjs writes per session.
 * `rim` is the row inside the chat's halo-rim composer (R1.19, SPEC-CHAT-HUD §1); `strip` is the bar under a terminal.
 * The Spend chip is gone (21:10: "I don't like this spend halo thing"); fleet spend is in the top bar.
 */
export function Hud({ a, crew = [], onOpenCrew, variant = "strip", model }: { a: Agent; crew?: Agent[]; onOpenCrew: (agent: Agent) => void; variant?: "strip" | "rim"; model?: HudMove }) {
  const h = a.hud;
  const compactAt = a.compactAt ?? (a.tool === 'codex' ? 75 : 35);
  const onCompactAt = a.compactAt !== undefined && a.tool !== 'codex' ? async (pct: number) => {
    const response = await fetch(`/api/agents/${encodeURIComponent(a.name)}/compact-at`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pct }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error ?? 'Could not change compaction.');
    void refreshSource('/api/agents', true);
  } : undefined;
  const compactReadOnlyReason = a.tool === 'codex' ? "Codex manages its own compaction. This mark is read-only." : "Compaction settings are unavailable for this agent.";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let shownAt = Date.now();
    return clock(() => { const at = Date.now(); if (at - shownAt >= 30_000) { shownAt = at; setNow(at); } });
  }, []);
  const act = useActivity(a.id);
  const stats = useStats(a.session ? a.id : null, true);
  const [ctxOpen, setCtxOpen] = useState(false);
  useEffect(() => { setCtxOpen(false); }, [a.id, a.session]);
  const mixStatus = useContextMix(a.id, variant === "rim" && a.tool !== "codex" ? a.session : null, ctxOpen, a.tool === "codex" ? "Codex keeps its own context; there is no Claude session file." : "No Claude session file for this chat.");
  const mix = mixStatus.state === "ready" ? mixStatus.mix : null;
  const compacted = noteCompaction(`${a.id}:${a.session}`, h?.context ?? null);
  const gauge = <ContextGauge pct={h?.context ?? null} compactAt={compactAt} mix={mix} compacted={compacted}/>;
  // The faces pill's count (crew in herdr plus sub-agents this chat started), running from the chat and the crew.
  const total = crew.length + Math.max(stats?.subagents?.count ?? 0, act?.total ?? 0);
  const running = crew.filter((c) => c.status === "working").length + (act?.running ?? 0);
  if (variant === "rim") {
    const chatLine = <span className="ab-hud__line"><i>This chat</i> <span className="ab-hud__up">↑</span> {k(h?.tokensIn ?? null)} <span className="ab-hud__dn">↓</span> {k(h?.tokensOut ?? null)} · cache {h?.cachePct ?? "—"}%{h?.costUsd != null && ` · $${h.costUsd.toFixed(2)}`}</span>;
    const level = levelOf(h?.context ?? null, compactAt);
    // The handoff first, then compact (ui-hub VISION §7C; his rule: "compact at a clean break after writing HANDOFF.md").
    const compact = (level === "hot" || level === "full") && <button type="button" className={`ab-hud__compact${level === "full" ? " is-urgent" : ""}`} data-testid="hud-compact" onClick={() => {
      window.dispatchEvent(new CustomEvent("siso-chat-say", { detail: { agentId: a.id, text: "Checkpoint before compacting: write or update .agents/HANDOFF.md with where this work stands (done, in progress, next, open questions), in a few lines. Then stop." } }));
      window.dispatchEvent(new CustomEvent("siso-chat-say", { detail: { agentId: a.id, text: "/compact" } })); setCtxOpen(false); }}>Write the handoff, then compact</button>;
    return <ComposerHud
      identity={<ModelChip a={a} model={h?.model ?? null} move={model}/>}
      context={<ContextPopover key={`${a.id}:${a.session}`} value={h?.context ?? null} open={ctxOpen} onOpenChange={setCtxOpen} title={gauge} segments={contextSegments(mix)} compactAt={compactAt} onCompactAt={onCompactAt} compactReadOnlyReason={compactReadOnlyReason}><ContextBreakdown agentId={a.id} status={mixStatus} compact={compact}>{chatLine}</ContextBreakdown></ContextPopover>}
      usage={<ProviderUsageMeters now={now} session={a.tool !== "codex" ? { accountId: h?.accountId ?? null, fiveHour: h?.fiveHour ?? null, week: h?.week ?? null, at: h?.at ?? null, limitsAt: h?.limitsAt, limitsStale: h?.limitsStale } : null}/>}
      /* No ↑ ↓ tokens or cache % in the bar (Shaan, 6 Oct 21:00: "the cache rate ... doesn't need to be there"); they stay in the ctx card. */
      rate={h?.tokensPerSecond != null && Number.isFinite(h.tokensPerSecond) && <span className="ab-hud__tok ab-hud__rate" data-testid="hud-rate" title={`This agent's last reported output rate${h.at ? ` · read ${ago(h.at)}` : ""}; worker rates are in the faces pill`}>{h.tokensPerSecond.toFixed(1)} tok/s</span>}
      activity={<SubagentsPopover agent={a} total={total} running={running} crew={crew} onOpenCrew={onOpenCrew} shells={act?.shells ?? []}/>}
    />;
  }
  const left_ = [
    <ModelChip key="model" a={a} model={h?.model ?? null} move={model} />,
    h ? <ContextPopover key={`${a.id}:${a.session}`} value={h.context} title={gauge} compactAt={compactAt} onCompactAt={onCompactAt} compactReadOnlyReason={compactReadOnlyReason}/> : null,
    h?.tokensPerSecond != null ? <span key="speed" className="ab-hud__tok" title="Output tokens divided by elapsed turn time, from Codex usage events">{h.tokensPerSecond.toFixed(1)} tok/s</span> : null,
    // This chat's own cost (R1.15: the bottom bar keeps the chat's figures; the fleet's is in the top bar).
    h?.costUsd != null ? (
      <span key="cost" className="ab-hud__cost" data-testid="hud-cost" title="This session's cost so far: Claude's own figure, at API prices">
        ${h.costUsd.toFixed(2)}
      </span>
    ) : null,
    !h ? (
      // An SDK seat's HUD is read from its session file (R1.19): it has none only before its first reply.
      <span key="none" className="ab-hud__k" title={a.host ? "siso-host's HUD comes from its session file, after its first reply" : "herdr reports no Claude session for this pane, or its HUD has not written yet"}>
        {a.host ? "HUD after its first reply" : "no HUD for this agent yet"}
      </span>
    ) : !h.model ? (
      <span key="wait" className="ab-hud__k" title="The HUD writes the model and limits on its next refresh">
        limits on its next refresh
      </span>
    ) : null,
  ];
  const right = (
    <>
      <ProviderUsageMeters now={now} session={a.tool !== "codex" ? { accountId: h?.accountId ?? null, fiveHour: h?.fiveHour ?? null, week: h?.week ?? null, at: h?.at ?? null, limitsAt: h?.limitsAt, limitsStale: h?.limitsStale } : null}/>
      <SubagentsPopover agent={a} total={total} running={running} crew={crew} onOpenCrew={onOpenCrew} shells={act?.shells ?? []} />
      <DevPill />
    </>
  );
  return <ComposerHud variant="strip" items={join(left_)} trailing={right}/>;
}
