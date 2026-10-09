import { useState, type ReactNode } from "react";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import type { Agent } from "../../lib/agents";
import { isDone, isParked, ownerNames, tasksOf, useA0Tasks } from "../../lib/a0-tasks";
import { AgentFace } from "../../lib/face";
import { openOwner, useOwners, type Owner } from "../../lib/owners";
import { useSharedResult, useSharedState } from "../../lib/poll";
import { providerUsage, resetDescription, type UsageSnapshot } from "../../lib/provider-usage";
import { useReleases } from "../../lib/releases";
import { face, LinkChip, live } from "../OwnerBoard";
import { LOUD_STATUS, noteOf, OwnerNoteRow, useOwnerNotes } from "../OwnerLinkToast";
import { UsageOrb } from "../ProviderUsageMeters";
import type { PanelTab } from "./PanelTabs";
import "./ZeroHome.css";

/**
 * Agent Zero's home (A0-HOME-SPEC, Shaan 6 Oct 23:35: "this is your home operation base ... I'm starting to get more
 * comfortable with just talking to Agent Zero"). Four blocks, top to bottom, every row one click to the place itself:
 * Needs you (only what needs him), Owners (who is working, their step, their latest link), Budget (the plan window left
 * and the laptop's load, read before any fan-out, ADR-0001) and Shipped today (what went live, in his words).
 */
const DAY_MS = 24 * 3600e3;
const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Block({ title, meta, children, testid }: { title: string; meta?: ReactNode; children: ReactNode; testid: string }) {
  return <section className="zh-block" data-testid={testid} aria-label={title}><header><h3>{title}</h3>{meta != null && <small>{meta}</small>}</header>{children}</section>;
}

function NeedsYouBlock({ a, agents, owners, onPeek, onTask }: { a: Agent; agents: Agent[]; owners: Owner[]; onPeek: (x: Agent) => void; onTask: (stage: string) => void }) {
  const { notes } = useOwnerNotes();
  const { index } = useA0Tasks();
  const read = new Set(notes.filter(n => n.read).map(n => n.key));
  // An owner's finished or blocked card with a link, from the last day, until he opens it (opening it in the bell counts).
  const fromOwners = owners.filter(o => !o.readError && o.page && LOUD_STATUS.includes(o.status) && o.updated && Date.now() - Date.parse(o.updated) < DAY_MS)
    .map(o => noteOf(o)).filter(n => !read.has(n.key)).sort((x, y) => y.at - x.at);
  const tasks = tasksOf((index?.tasks ?? []).filter(t => t.needs && !isDone(t) && !isParked(t) && t.stage !== "preview" && t.stage !== "feedback"), a.name, true);
  const stuck = (x: Agent) => x.status === "needs" || (x.status === "failed" && !x.parentId && Date.now() - x.since < 2 * 3600e3);
  const waiting = agents.filter(x => x.row === "live" && !x.zero && stuck(x));
  const count = fromOwners.length + tasks.length + waiting.length;
  return <Block title="Needs you" meta={count || undefined} testid="zh-needs">
    {!count && <p className="zh-quiet">Nothing waiting</p>}
    {fromOwners.slice(0, 5).map(n => <OwnerNoteRow key={n.key} note={n} />)}
    {waiting.map(x => <button key={x.id} type="button" className="zh-row" onClick={() => onPeek(x)}>
      <AgentFace name={x.name} project={x.project ?? undefined} status={x.status === "failed" ? "blocked" : "needs-shaan"} size={24} />
      <span><b>{x.name}</b><small>{x.status === "failed" ? "stuck" : "waiting on you"}</small></span><ArrowUpRightIcon size={13} aria-hidden />
    </button>)}
    {tasks.slice(0, 5).map(t => <button key={t.id} type="button" className="zh-row" data-testid="zh-task" title={t.next ?? t.title} onClick={() => onTask(t.stage)}>
      <i className={`zh-dot is-${t.priority.toLowerCase()}`} aria-hidden />
      <span><b>{t.short ?? t.title}</b><small>{ownerNames(t.owner)[0]} · {t.priority}</small></span><ArrowUpRightIcon size={13} aria-hidden />
    </button>)}
  </Block>;
}

const WORD = { working: "Working", idle: "Idle", needs: "Needs you", failed: "Failed", offline: "Offline" } as const;
function OwnersBlock({ owners, agents, onOpenAgent }: { owners: Owner[]; agents: Agent[]; onOpenAgent: (a: Agent) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const roots = owners.filter(o => !o.parent || !owners.some(p => p.name === o.parent));
  const agentOf = (name: string) => agents.find(x => x.name.toLowerCase() === name.toLowerCase() && !x.zero);
  const state = (o: Owner) => live(o) ?? (agentOf(o.name)?.status === "working" ? "working" : "idle");
  const sorted = [...roots].sort((x, y) => Number(state(y) === "working") - Number(state(x) === "working") || Date.parse(y.updated ?? "0") - Date.parse(x.updated ?? "0"));
  const working = sorted.filter(o => state(o) === "working").length;
  return <Block title="Owners" meta={`${working} working · ${sorted.length - working} idle`} testid="zh-owners">
    {sorted.map(o => {
      const agent = agentOf(o.name), ctx = agent?.context ?? agent?.hud?.context ?? null, now = state(o);
      const workers = [...owners.filter(c => c.parent === o.name).map(c => c.name), ...o.subagents.map(s => s.name)];
      return <div key={o.name} className="zh-owner" data-state={now}>
        <button type="button" className="zh-owner__row" data-testid={`zh-owner-${o.name}`} title={o.summary || o.subtitle || o.title} onClick={() => agent ? onOpenAgent(agent) : openOwner(o.name)}>
          <AgentFace {...face(o)} size={28} />
          <span className="zh-owner__copy"><b>{o.name}</b><small>{o.subtitle || o.title}</small></span>
          <span className="zh-owner__state"><em className={`is-${now}`}><i aria-hidden />{WORD[now]}</em>{ctx != null && <small className={ctx > 30 ? "is-high" : undefined} title="Context used">{Math.round(ctx)}% ctx</small>}</span>
        </button>
        <div className="zh-owner__foot"><LinkChip o={o} />{workers.length > 0 && <button type="button" className="zh-owner__workers" aria-expanded={open === o.name} onClick={() => setOpen(v => v === o.name ? null : o.name)}>{workers.length} {workers.length === 1 ? "worker" : "workers"}<ChevronDownIcon size={12} aria-hidden /></button>}</div>
        {open === o.name && <ul className="zh-owner__crew">{workers.map(w => <li key={w}>{w}</li>)}</ul>}
      </div>;
    })}
    {!sorted.length && <p className="zh-quiet">No owner has reported yet</p>}
  </Block>;
}

type Health = { load?: number[] | null; cpus?: number | null; memAvailGb?: number | null; swapUsedGb?: number | null; diskFreeGb?: number | null };
type Servers = { servers?: { key: string; here?: boolean; health?: Health }[] };
function BudgetBlock() {
  const { data, error } = useSharedState<UsageSnapshot>("/api/tokens", 60_000);
  const servers = useSharedResult<Servers>("/api/servers", 30_000).data;
  const now = Date.now();
  const [claude, codex] = providerUsage(data, error, now);
  // The freshest Claude account's two windows; Codex as one ring (its tighter window).
  const windows = claude.accounts[0]?.windows ?? [];
  const codexWindow = (codex.accounts[0]?.windows ?? []).filter(w => w.pct !== null).sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0))[0];
  const orbs = [
    ...windows.map(w => ({ key: `claude-${w.id}`, label: `Claude ${w.shortLabel}`, w })),
    ...(codexWindow ? [{ key: "codex", label: `Codex ${codexWindow.shortLabel}`, w: codexWindow }] : []),
  ];
  const h = servers?.servers?.find(s => s.here)?.health;
  const laptop = h ? [h.load?.[0] != null && h.cpus ? `load ${h.load[0].toFixed(1)}/${h.cpus}` : null, h.memAvailGb != null ? `${h.memAvailGb} GB free` : null, h.swapUsedGb != null ? `swap ${h.swapUsedGb} GB` : null, h.diskFreeGb != null ? `disk ${h.diskFreeGb} GB` : null].filter(Boolean).join(" · ") : null;
  const tight = !!h && ((h.load?.[0] ?? 0) > (h.cpus ?? 8) || (h.swapUsedGb ?? 0) > 6 || (h.memAvailGb ?? 99) < 2);
  return <Block title="Budget" meta="plan window used" testid="zh-budget">
    <div className="zh-orbs">{orbs.map(({ key, label, w }) => <div key={key} className="zh-orb" title={w.reason ?? undefined} data-state={w.state}>
      <UsageOrb pct={w.pct} size={44} stale={w.state !== "fresh"} label />
      <b>{label}</b><small>{w.pct !== null && w.pct >= 100 ? "out · " : ""}{resetDescription(w, now)}</small>
    </div>)}{!orbs.length && <p className="zh-quiet">{error ? "Usage unavailable" : "Reading usage…"}</p>}</div>
    {laptop && <p className={`zh-laptop${tight ? " is-tight" : ""}`} data-testid="zh-laptop">Laptop · {laptop}</p>}
  </Block>;
}

function ShippedBlock({ onPick }: { onPick: (t: PanelTab) => void }) {
  const releases = useReleases()?.releases ?? [];
  // Two releases can carry the same note (the newest one their commits hold): show each shipped thing once.
  const seen = new Set<string>();
  const today = releases.filter(r => sameDay(r.at)).filter(r => { const k = r.note?.sha ?? r.sha; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  const rows = today.length ? today : releases.slice(0, 1);
  return <Block title="Shipped today" meta={today.length ? undefined : "nothing yet today"} testid="zh-shipped">
    {rows.map(r => <button key={r.sha} type="button" className="zh-row zh-ship" onClick={() => onPick("timeline")} title={r.note?.why ?? undefined}>
      <time>{sameDay(r.at) ? time(r.at) : new Date(r.at).toLocaleDateString([], { day: "numeric", month: "short" })}</time>
      <span><b>{r.note?.title ?? r.commits[0]?.line ?? `v${r.version}`}</b>{r.note?.see && <small>{r.note.see}</small>}</span><ArrowUpRightIcon size={13} aria-hidden />
    </button>)}
    {!rows.length && <p className="zh-quiet">No releases recorded</p>}
  </Block>;
}

export function ZeroHome({ a, agents, onPeek, onTask, onOpenAgent, onPick, legacy }: { a: Agent; agents: Agent[]; onPeek: (x: Agent) => void; onTask: (stage: string) => void; onOpenAgent: (a: Agent) => void; onPick: (t: PanelTab) => void; legacy: ReactNode }) {
  const owners = useOwners()?.owners ?? [];
  const [old, setOld] = useState(false);
  return <div className="zh" data-testid="zero-home">
    <NeedsYouBlock a={a} agents={agents} owners={owners} onPeek={onPeek} onTask={onTask} />
    <OwnersBlock owners={owners} agents={agents} onOpenAgent={onOpenAgent} />
    <BudgetBlock />
    <ShippedBlock onPick={onPick} />
    {/* Add beside, don't swap: the previous Overview stays one click away for this round. */}
    <button type="button" className="zh-old" aria-expanded={old} onClick={() => setOld(v => !v)}>{old ? "Hide the previous overview" : "Previous overview"}<ChevronDownIcon size={12} aria-hidden /></button>
    {old && legacy}
  </div>;
}
