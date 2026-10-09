import { Bot, BriefcaseBusiness, ChevronDown, ChevronRight, Coins, Copy, ExternalLink, Gauge, Info, Laptop, ListTree, PanelRightOpen, ScrollText, Server as ServerIcon, Target, X } from "lucide-react";
import { load, save } from "@siso/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Agent, compact } from "../lib/agents";
import { AgentFace, faceFor } from "../lib/face";
import { useShared, useSharedState } from "../lib/poll";
import { useSpend } from "../lib/spend";
import { Glow, Spark, StatBar, type StatCell, StoreBar } from "./page/Figures";
import { DASH, HubPage, Widget, WidgetGrid, type Tone } from "./page/HubPage";
import { LaptopJobsPage } from "./LaptopJobsPage";

/** One machine as GET /api/servers reports it (services/node/src/servers.ts). */
type Health = {
  source: "live" | "probe" | "fleet record" | "none";
  at: number | null;
  level: "ok" | "warn" | "bad" | "down" | "unknown";
  why: string[];
  state: string | null;
  detail: string | null;
  cpus: number | null;
  load: number[] | null;
  memTotalGb: number | null;
  memAvailGb: number | null;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
  diskUsedGb: number | null;
  upDays: number | null;
};
type AgentCount = { count: number | null; byStatus: Record<string, number> | null; byKind: Record<string, number> | null; source: string; note: string | null };
type ProbeView = { state: "ok" | "probing" | "failed" | "down" | "none"; at: number | null; okAt: number | null; error: string | null; fails: number };
type Server = {
  key: string;
  name: string;
  role: string;
  status: string;
  here: boolean;
  client: boolean;
  owner?: string | null;
  alias?: string | null;
  onBoard?: boolean;
  agentsVisible: boolean;
  agentMachine: string | null;
  watched: boolean;
  health: Health;
  probe?: ProbeView;
  spark?: number[];
  agents: AgentCount;
  agentFaces?: { name: string; status: string }[] | null;
  tokensToday: { total: number; output: number; at: number } | null;
  tokensWhyNull: string | null;
  services: { count: number | null; failed: number | null; failedNames?: string[]; source?: string } | null;
  containers: number | null;
  urls?: { url: string; status: number | null; unit: string }[];
};
type Service = { unit: string; kind: "systemd" | "user" | "launchd" | "docker"; user: string | null; state: string; failed: boolean; since: number | null; description: string | null; ports: number[]; image?: string; what: string | null; owner: string | null; url: string | null; urlStatus: number | null; group: string; catalogued: boolean; seeded?: boolean };
type RemoteAgent = { name: string; harness: string; status: string; session: string; cwd: string | null };
type MiniAgent = { name: string; activity: "idle" | "working"; model: string | null; cwd: string | null; context: number | null; cpu: number; rssMb: number; startedAt: number | null };
type ServerDetails = Server & {
  host: string;
  statusFull: string;
  roleFull: string;
  usedFor: string[];
  fallback: string[];
  never: string[];
  os: string | null;
  hostname: string | null;
  record: Health | null;
  top: { cpu: number; rss_mb: number; name: string }[];
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number; total: number; messages: number; byModel: Record<string, number>; files: number; at: number; scanMs: number; source: string } | null;
  serviceList?: Service[];
  servicesSource?: "probe" | "seed" | "none";
  agentList?: RemoteAgent[] | null;
  sessions?: string[];
  missing?: { owner: number; url: number };
  sources?: string[];
};
type OffBoard = { key: string; name: string; why: string };
type List = { servers: Server[]; offBoard?: OffBoard[]; fleetAt: number | null };
export type Density = "page" | "panel";

const ago = (ms: number | null) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const gbs = (n: number | null) => (n === null ? DASH : n >= 100 ? `${Math.round(n)}` : `${Math.round(n * 10) / 10}`);

const TONE: Record<Health["level"], Tone> = { ok: "ok", warn: "warn", bad: "bad", down: "bad", unknown: "none" };
const STATUS_DOT: Record<Agent["status"], string> = { working: "bg-working", needs: "bg-needs", failed: "bg-failed", done: "bg-done", idle: "bg-white/25" };
/** herdr's words for a remote agent's state, as the app's. */
const asStatus = (s: string): Agent["status"] => (s === "working" ? "working" : s === "blocked" || s === "needs" ? "needs" : s === "failed" ? "failed" : s === "done" ? "done" : "idle");

/** The short name a sentence uses: its ssh alias (siso-vps, mac-mini), "laptop" for this Mac. */
const short = (s: Server) => (s.here ? "laptop" : (s.alias ?? s.key));
/** On the board: probed by the node (or this Mac). An older answer (before the probe) has no flag: its watched boxes. */
const onBoard = (s: Server) => s.onBoard ?? (!s.client && (s.here || s.watched));
/** live: read within 90 s; stale: an older reading; down: two probes failed; failed: the last one did. */
function liveness(s: Server): { state: "live" | "stale" | "failed" | "down"; word: string } {
  const p = s.probe;
  if (p?.state === "down") return { state: "down", word: `down: ${s.health.why[0] ?? p.error ?? "no answer"}` };
  if (p?.state === "failed") return { state: "failed", word: s.health.why[0] ?? `no answer (${p.error})` };
  if (s.here) return { state: "live", word: "read live on this Mac" };
  const at = p?.okAt ?? s.health.at;
  if (at && Date.now() - at < 90_000 && s.health.source === "probe") return { state: "live", word: "probed just now" };
  return { state: "stale", word: s.health.source === "fleet record" ? `fleet record, ${ago(s.health.at)}` : at ? ago(at) : "no reading yet" };
}

function Live({ s }: { s: Server }) {
  const l = liveness(s);
  return <span className="ab-live" data-state={l.state === "live" ? "live" : l.state === "down" ? "down" : "stale"} title={l.word} aria-label={l.word} data-testid="live-dot" />;
}

function OwnerFace({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex flex-none" title={`Owner: ${name}`} data-testid="owner-face">
      <AgentFace name={name} status="waiting" size={size} />
    </span>
  );
}

function Faces({ list, size = 22, max = 5 }: { list: { name: string; status: string; project?: string | null }[]; size?: number; max?: number }) {
  return (
    <span className="flex flex-none items-center" data-testid="face-stack">
      {list.slice(0, max).map((a, i) => (
        <span key={`${a.name}-${i}`} className="rounded-full ring-2 ring-[var(--crm-color-surface)]" style={{ marginLeft: i ? -6 : 0 }} title={`${a.name} · ${a.status}`}>
          <AgentFace {...faceFor({ name: a.name, project: a.project ?? undefined, status: asStatus(a.status) })} size={size} />
        </span>
      ))}
    </span>
  );
}

/** The three storage bars: load, memory, disk; a sentence each. */
function Bars({ h, compact = false }: { h: Health; compact?: boolean }) {
  const loadPct = h.load && h.cpus ? (100 * h.load[0]) / h.cpus : null;
  const memFree = h.memAvailGb !== null && h.memTotalGb ? (100 * h.memAvailGb) / h.memTotalGb : null;
  const diskFree = h.diskFreeGb !== null && h.diskTotalGb ? (100 * h.diskFreeGb) / h.diskTotalGb : null;
  return (
    <div className={compact ? "flex items-center gap-2" : "flex flex-col gap-1.5"}>
      <StoreBar compact={compact} label={compact ? "L" : "Load"} usedPct={loadPct} freePct={loadPct === null ? null : Math.max(0, 100 - loadPct)} sentence={h.load && h.cpus ? `${h.load[0]} on ${h.cpus} cores` : DASH} />
      <StoreBar compact={compact} label={compact ? "M" : "Memory"} usedPct={memFree === null ? null : 100 - memFree} freePct={memFree} sentence={h.memAvailGb !== null ? `${gbs(h.memAvailGb)} GB free of ${gbs(h.memTotalGb)}` : DASH} />
      <StoreBar compact={compact} label={compact ? "D" : "Disk"} usedPct={diskFree === null ? null : 100 - diskFree} freePct={diskFree} sentence={h.diskFreeGb !== null ? `${gbs(h.diskFreeGb)} GB free of ${gbs(h.diskTotalGb)}` : DASH} />
    </div>
  );
}

const agentWords = (a: AgentCount) => {
  if (a.byStatus && a.byKind) {
    const kinds = Object.entries(a.byKind).map(([k, v]) => `${v} ${k}`).join(", ");
    const working = a.byStatus.working ?? 0;
    return `${kinds}${a.count ? (working ? `, ${working} working` : ", all idle") : ""}`;
  }
  if (a.byKind) return Object.entries(a.byKind).map(([k, v]) => `${v} ${k}`).join(", ") || "none seen";
  return a.note ?? "no reading";
};

function UrlPill({ u, onOpenUrl }: { u: { url: string; status: number | null; unit: string }; onOpenUrl?: (url: string) => void }) {
  const label = u.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <button
      type="button"
      className="inline-flex max-w-[150px] items-center gap-1.5 rounded-full border border-white/[0.08] px-2 py-0.5 text-[11px] text-foreground hover:bg-white/[0.05]"
      title={`${u.url} · ${u.unit}`}
      data-testid="url-pill"
      data-status={u.status ?? ""}
      onClick={(e) => (e.stopPropagation(), onOpenUrl ? onOpenUrl(u.url) : window.open(u.url, "_blank", "noopener"))}
    >
      <Glow code={u.status} />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------- data

/** Every machine; the last answer is kept (in memory, then on disk), so the page paints at once and refreshes behind it. */
function useServers(): { data: List | null; error: string | null } {
  const { data: live, error } = useSharedState<List>("/api/servers?view=1", 15_000);
  useEffect(() => {
    if (live) save("servers-last", live);
  }, [live]);
  return { data: live ?? load<List | null>("servers-last", null), error };
}

function totals(board: Server[]) {
  const answering = board.filter((s) => s.here || s.probe?.state === "ok");
  const down = board.filter((s) => s.probe?.state === "down").length;
  const slow = board.filter((s) => s.probe?.state === "failed").length;
  const svc = board.map((s) => ({ s, n: s.services?.count ?? 0, f: s.services?.failed ?? 0 }));
  const agents = board.map((s) => ({ s, n: s.agents.count ?? 0, w: s.agents.byStatus?.working ?? 0 }));
  const tokens = board.reduce((a, s) => a + (s.tokensToday?.total ?? 0), 0);
  // The tightest resource: the lowest free share of memory or disk on any machine.
  let tight: { s: Server; what: "disk" | "memory"; pct: number; gb: number } | null = null;
  for (const s of board) {
    const h = s.health;
    if (h.diskFreeGb !== null && h.diskTotalGb) {
      const pct = (100 * h.diskFreeGb) / h.diskTotalGb;
      if (!tight || pct < tight.pct) tight = { s, what: "disk", pct, gb: h.diskFreeGb };
    }
    if (h.memAvailGb !== null && h.memTotalGb) {
      const pct = (100 * h.memAvailGb) / h.memTotalGb;
      if (!tight || pct < tight.pct) tight = { s, what: "memory", pct, gb: h.memAvailGb };
    }
  }
  return { answering, down, slow, svc, agents, tokens, tight };
}

// ---------------------------------------------------------------- the six boxes

function MachineBox({ s, appAgents, onOpen, onOpenUrl }: { s: Server; appAgents: Agent[]; onOpen: () => void; onOpenUrl?: (url: string) => void }) {
  const h = s.health;
  const l = liveness(s);
  const faces = s.here ? appAgents.filter((a) => a.machine === s.agentMachine).map((a) => ({ name: a.name, status: a.status, project: a.project })) : (s.agentFaces ?? []);
  const where = [s.role, h.cpus ? `${h.cpus} cores` : null, h.upDays !== null ? `up ${Math.round(h.upDays)} day${Math.round(h.upDays) === 1 ? "" : "s"}` : null].filter(Boolean).join(", ");
  const failed = s.services?.failedNames ?? [];
  return (
    <Widget
      id={`server-${s.key}`}
      size="S-wide"
      icon={s.here ? Laptop : ServerIcon}
      title={
        <>
          <Live s={s} />
          {s.name}
          {s.owner && <OwnerFace name={s.owner} />}
        </>
      }
      sub={l.state === "live" ? where : `${where}${where ? " · " : ""}${l.word}`}
      door={{ label: `Open ${s.name}`, onOpen }}
      tone={l.state === "down" ? "bad" : h.level === "warn" || h.level === "bad" ? TONE[h.level] : "none"}
      footer={s.urls && s.urls.length > 0 ? s.urls.map((u) => <UrlPill key={u.url} u={u} onOpenUrl={onOpenUrl} />) : undefined}
    >
      {(l.state === "failed" || l.state === "down") && <span className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">last known</span>}
      <div className={`flex flex-col gap-2.5 ${l.state === "failed" ? "opacity-60" : ""} ${l.state === "down" ? "line-through opacity-60" : ""}`} data-testid="box-body" data-state={l.state}>
        <Spark points={s.spark ?? []} per={h.cpus} height={30} label={`${s.name} load, last ${(s.spark ?? []).length} probes`} />
        <Bars h={h} />
        <div className="flex flex-col gap-1 text-[12px]">
          <span className="truncate text-foreground" data-testid="box-services" title={failed.join(", ")}>
            {s.services?.count != null ? `${s.services.count} running` : "services not read"}
            {(s.services?.failed ?? 0) > 0 && <span className="text-failed">{` · ${s.services!.failed} failed${failed.length ? `: ${failed.join(", ")}` : ""}`}</span>}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground" data-testid="box-agents">
            {faces.length > 0 && <Faces list={faces} />}
            <b className="font-semibold tabular-nums text-foreground">{s.agents.count ?? DASH}</b>
            <span className="truncate">{s.here ? `agents${s.agents.note ? ` · ${s.agents.note}` : ""}` : agentWords(s.agents)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="box-tokens">
            <Coins size={12} aria-hidden />
            {s.tokensToday ? `${compact(s.tokensToday.total)} tokens today` : (s.tokensWhyNull ?? "tokens not read")}
          </span>
        </div>
      </div>
    </Widget>
  );
}

function PopOut({ onPopOut }: { onPopOut?: () => void }) {
  if (!onPopOut) return null;
  return (
    <button type="button" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground" aria-label="Open in the side panel" title="Open in the side panel (⌥-click the icon does it too)" data-testid="pop-out" onClick={onPopOut}>
      <PanelRightOpen size={16} aria-hidden />
    </button>
  );
}

/**
 * The Servers page (servers-tokens spec §2, Option A; Shaan 2 Oct: "the six boxes of the health of those servers ... then
 * you can click on it to see like a server details page"). One joined stat bar, a box per machine the node probes, the
 * rest in one quiet line at the foot. It paints from the last answer and refreshes behind it; a thin line runs while a
 * probe that has never answered is out. `density: "panel"` is the same page for the side panel (§4).
 */
export function ServersPage({ agents, onOpenAgent, onOpenUrl, density = "page", onPopOut }: { agents: Agent[]; onOpenAgent: (agentId: string) => void; onOpenUrl?: (url: string, title?: string) => void; density?: Density; onPopOut?: () => void }) {
  const [jobsOpen, setJobsOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const { data, error } = useServers();
  const spend = useSpend();
  const all = data?.servers ?? [];
  const board = all.filter(onBoard);
  const actions = <div className="flex items-center gap-3">{density === "page" && <button type="button" className="text-xs text-foreground" onClick={() => setJobsOpen(true)}>Laptop jobs</button>}<PopOut onPopOut={onPopOut} /></div>;
  if (jobsOpen && density === "page") return <LaptopJobsPage onBack={() => setJobsOpen(false)} />;
  if (!data && error) return (
    <HubPage id="servers" icon={ServerIcon} kicker="Estate" title="Servers" action={actions}>
      <WidgetGrid label="Our machines">
        <Widget id="servers-failed" size="XL" icon={ServerIcon} title="Could not read the machines" failed={`${error}; trying again every 15 s.`} />
      </WidgetGrid>
    </HubPage>
  );
  if (density === "panel") return <ServersPanel board={board} agents={agents} onOpenUrl={onOpenUrl} onOpenAgent={onOpenAgent} />;
  if (open) return <MachinePage id={open} card={all.find((s) => s.key === open) ?? null} agents={agents} onBack={() => setOpen(null)} onOpenAgent={onOpenAgent} onOpenUrl={onOpenUrl} />;
  const off: OffBoard[] = data?.offBoard ?? all.filter((s) => !onBoard(s)).map((s) => ({ key: s.key, name: s.name, why: s.client ? "client box" : s.status || "not probed" }));
  const t = totals(board);
  const probing = board.some((s) => s.probe?.state === "probing");
  const failedTotal = t.svc.reduce((a, x) => a + x.f, 0);
  const usdEquiv = spend?.source === "stack-opt" ? spend.data.claude_usd_equiv : null;
  const by = (xs: { s: Server; n: number }[]) => xs.filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => `${short(x.s)} ${x.n}`).join(", ");
  const cells: StatCell[] = [
    { id: "machines", label: "Machines", value: t.answering.length, sentence: "answering now", pill: t.down ? { text: `${t.down} down`, tone: "bad" } : t.slow ? { text: `${t.slow} slow`, tone: "warn" } : { text: "all up", tone: "ok" } },
    { id: "services", label: "Services", value: t.svc.reduce((a, x) => a + x.n, 0), sentence: `running${by(t.svc) ? ` (${by(t.svc)})` : ""}`, pill: failedTotal ? { text: `${failedTotal} failed`, tone: "bad", onClick: () => setOnlyFailed((v) => !v), pressed: onlyFailed, title: onlyFailed ? "Show every machine" : "Show only machines with a failed service" } : undefined },
    { id: "agents", label: "Agents", value: t.agents.reduce((a, x) => a + x.n, 0), sentence: `on ${t.agents.filter((x) => x.n > 0).length} machines${by(t.agents) ? ` (${by(t.agents)})` : ""}`, pill: { text: `${t.agents.reduce((a, x) => a + x.w, 0)} working`, tone: "info" } },
    { id: "tokens", label: "Tokens today", value: compact(t.tokens), sentence: "all machines that report", pill: usdEquiv !== null ? { text: `$${Math.round(usdEquiv).toLocaleString()} API-equiv`, tone: "none", title: "What today's tokens would cost at API list prices: not a bill" } : undefined },
    { id: "tightest", label: "Tightest", value: t.tight ? `${t.tight.pct.toFixed(1)}%` : DASH, sentence: t.tight ? `${short(t.tight.s)} ${t.tight.what} free` : "no reading", pill: t.tight ? { text: `${gbs(t.tight.gb)} GB left`, tone: t.tight.pct < 10 ? "bad" : t.tight.pct < 20 ? "warn" : "ok" } : undefined },
  ];
  const shown = onlyFailed ? board.filter((s) => (s.services?.failed ?? 0) > 0) : board;
  return (
    <HubPage id="servers" icon={ServerIcon} kicker="Estate" title="Servers" blurb="Each machine probed live over ssh: its room, its services and who runs there. Click a box for the machine." action={actions}>
      {probing && <div className="ab-progress" data-testid="probe-progress" aria-label="Probing the machines" />}
      {data && <StatBar cells={cells} label="The fleet now" />}
      <WidgetGrid label="Our machines">
        {data ? shown.map((s) => <MachineBox key={s.key} s={s} appAgents={agents} onOpen={() => setOpen(s.key)} onOpenUrl={onOpenUrl} />) : [0, 1, 2].map((i) => <Widget key={i} id={`server-${i}`} size="S-wide" icon={ServerIcon} title="Reading the machines…" loading />)}
      </WidgetGrid>
      {off.length > 0 && (
        <p className="m-0 mt-1 text-[12px] text-muted-foreground" data-testid="off-board">
          Not on the board:{" "}
          {off.map((o, i) => (
            <span key={o.key} data-key={o.key}>
              {i ? ", " : ""}
              {o.name} ({o.why})
            </span>
          ))}
        </p>
      )}
    </HubPage>
  );
}

// ---------------------------------------------------------------- one machine

const GROUP_ORDER = ["Sites and APIs", "Agents and terminals", "Data", "Streaming", "Plumbing", "System"];

function ServiceRow({ x, onLogs, onOpenUrl, agentsByName, onOpenAgent }: { x: Service; onLogs: () => void; onOpenUrl?: (url: string) => void; agentsByName: Map<string, Agent>; onOpenAgent: (id: string) => void }) {
  const owner = x.owner ? agentsByName.get(x.owner) : undefined;
  return (
    <div className="grid grid-cols-[10px_minmax(120px,0.9fr)_minmax(0,1.6fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-white/[0.04] py-1.5 text-[12.5px] last:border-b-0" data-testid="service-row" data-unit={x.unit} data-failed={x.failed || undefined}>
      <span className={`size-2 rounded-full ${x.failed ? "bg-failed" : /running|active|up/i.test(x.state) ? "bg-done" : "bg-white/25"}`} title={x.state} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[12px] text-foreground" title={x.unit}>
          {x.unit.replace(/\.service$/, "")}
        </span>
        {x.kind === "docker" && <span className="flex-none rounded border border-white/10 px-1 text-[10px] text-muted-foreground">container</span>}
        {x.kind === "user" && x.user && <span className="flex-none rounded border border-white/10 px-1 text-[10px] text-muted-foreground">{x.user}</span>}
      </span>
      <span className="min-w-0 truncate text-muted-foreground" title={x.what ?? ""}>
        {x.failed ? <b className="font-medium text-failed">failed{x.since ? ` ${ago(x.since)}` : ""}{x.what ? " · " : ""}</b> : null}
        {x.what ?? (x.catalogued ? "" : DASH)}
      </span>
      <span className="flex flex-none items-center gap-2">
        {x.owner && (
          <button type="button" className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground" disabled={!owner} onClick={() => owner && onOpenAgent(owner.id)} title={owner ? `Open ${x.owner}'s chat` : `Owner: ${x.owner}`}>
            <AgentFace name={x.owner} status="waiting" size={22} />
            {x.owner}
          </button>
        )}
        {x.ports.length > 0 && <span className="font-mono text-[11px] text-muted-foreground">:{x.ports.slice(0, 2).join(" :")}</span>}
        {x.url && (
          <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-foreground hover:bg-white/[0.06]" onClick={() => (onOpenUrl ? onOpenUrl(x.url!) : window.open(x.url!, "_blank", "noopener"))} title={x.url} data-testid="service-open">
            <Glow code={x.urlStatus} /> Open <ExternalLink size={11} aria-hidden />
          </button>
        )}
        <button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground" aria-label={`Logs of ${x.unit}`} title="Logs (read-only)" onClick={onLogs} data-testid="service-logs" disabled={x.seeded}>
          <ScrollText size={13} aria-hidden />
        </button>
      </span>
    </div>
  );
}

function Services({ list, onLogs, onOpenUrl, agents, onOpenAgent }: { list: Service[]; onLogs: (x: Service) => void; onOpenUrl?: (url: string) => void; agents: Agent[]; onOpenAgent: (id: string) => void }) {
  const byName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents]);
  const failed = list.filter((x) => x.failed);
  const groups = GROUP_ORDER.map((g) => ({ g, rows: list.filter((x) => !x.failed && x.group === g) })).concat([{ g: "Other", rows: list.filter((x) => !x.failed && !GROUP_ORDER.includes(x.group)) }]).filter((x) => x.rows.length);
  const [shut, setShut] = useState<Set<string>>(() => new Set(["System"]));
  return (
    <div className="flex flex-col gap-3">
      {failed.length > 0 && (
        <div data-testid="service-group" data-group="Failed">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-failed">Failed</div>
          {failed.map((x) => (
            <ServiceRow key={`${x.kind}:${x.unit}`} x={x} onLogs={() => onLogs(x)} onOpenUrl={onOpenUrl} agentsByName={byName} onOpenAgent={onOpenAgent} />
          ))}
        </div>
      )}
      {groups.map(({ g, rows }) => (
        <div key={g} data-testid="service-group" data-group={g}>
          <button type="button" className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground" onClick={() => setShut((s) => { const next = new Set(s); if (!next.delete(g)) next.add(g); return next; })} aria-expanded={!shut.has(g)}>
            {shut.has(g) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {g} <span className="font-normal normal-case tracking-normal">{rows.length}</span>
          </button>
          {!shut.has(g) && rows.map((x) => <ServiceRow key={`${x.kind}:${x.unit}`} x={x} onLogs={() => onLogs(x)} onOpenUrl={onOpenUrl} agentsByName={byName} onOpenAgent={onOpenAgent} />)}
        </div>
      ))}
    </div>
  );
}

const ERRORS = /\b(error|err|fail(?:ed|ure)?|fatal|panic|exception|refused|denied|crit(?:ical)?|traceback)\b/i;

/** A unit's last 200 lines (servers-tokens §2.2): slides up over the page, follows every 2 s, read-only. Esc closes. */
function LogsDrawer({ machine, x, onClose, sheet = false }: { machine: string; x: Service; onClose: () => void; sheet?: boolean }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const q = `/api/servers/${encodeURIComponent(machine)}/logs?unit=${encodeURIComponent(x.unit)}&kind=${x.kind}&n=200`;
  useEffect(() => {
    let live = true;
    fetch(q, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!live) return;
        if (!r.ok) return setError(d.error ?? `HTTP ${r.status}`);
        setLines(d.lines);
        setCommand(d.command ?? null);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [q]);
  useEffect(() => {
    if (!follow) return;
    const es = new EventSource(`${q}&follow=1`);
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data) as { lines: string[]; reset: boolean };
        setLines((cur) => (d.reset || !cur ? d.lines : [...cur, ...d.lines].slice(-1000)));
      } catch {
        /* a torn message */
      }
    };
    es.addEventListener("failed", (ev) => {
      try {
        setError(JSON.parse((ev as MessageEvent).data).error);
      } catch {
        /* none */
      }
    });
    return () => es.close();
  }, [q, follow]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onClose]);
  const shown = (lines ?? []).filter((l) => !errorsOnly || ERRORS.test(l));
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length, follow]);
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => (setCopied(what), setTimeout(() => setCopied(null), 1200)));
  const chip = (on: boolean) => `rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-white/30 bg-white/[0.08] text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground"}`;
  return (
    <div className={`${sheet ? "absolute inset-0" : "sticky bottom-0 h-[40vh]"} z-10 flex flex-col border-t border-white/[0.08] bg-[var(--crm-color-surface)] shadow-[0_-12px_32px_rgb(0_0_0/0.35)]`} data-esc-own role="dialog" aria-label={`Logs of ${x.unit}`} data-testid="logs-drawer">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <ScrollText size={14} className="text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-mono text-[12px] text-foreground">{x.unit}</span>
        <span className="text-[11px] text-muted-foreground">on {machine} · last 200 lines · read-only</span>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" className={chip(follow)} aria-pressed={follow} onClick={() => setFollow((v) => !v)} data-testid="logs-follow">
            Follow
          </button>
          <button type="button" className={chip(errorsOnly)} aria-pressed={errorsOnly} onClick={() => setErrorsOnly((v) => !v)} data-testid="logs-errors">
            Errors only
          </button>
          <button type="button" className={chip(copied === "lines")} onClick={() => copy("lines", shown.join("\n"))} data-testid="logs-copy">
            <Copy size={11} className="mr-1 inline" aria-hidden />
            {copied === "lines" ? "Copied" : "Copy"}
          </button>
          {command && (
            <button type="button" className={chip(copied === "cmd")} onClick={() => copy("cmd", command)} title={`Copy the command, to run it in a terminal: ${command}`} data-testid="logs-command">
              {copied === "cmd" ? "Copied" : "Copy command"}
            </button>
          )}
          <button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground" aria-label="Close the logs" title="Close · Esc" onClick={onClose}>
            <X size={14} aria-hidden />
          </button>
        </span>
      </div>
      <pre ref={box} className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-2 font-mono text-[12px] leading-[1.5] text-secondary-label" data-testid="logs-lines">
        {error ? <span className="text-failed">{error}</span> : lines === null ? "Reading…" : shown.length ? shown.map((l, i) => <span key={i} className={`block ${ERRORS.test(l) ? "text-failed" : /line hidden/.test(l) ? "italic text-muted-foreground" : ""}`}>{l}</span>) : errorsOnly ? "No error lines in the last 200." : "No lines."}
      </pre>
    </div>
  );
}

function AgentRows({ agents, onOpenAgent }: { agents: Agent[]; onOpenAgent: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-white/[0.06]">
      {agents.map((a) => (
        <button key={a.id} type="button" onClick={() => onOpenAgent(a.id)} data-testid="server-agent" className="grid w-full grid-cols-[minmax(140px,1.3fr)_80px_1fr_110px] items-center gap-3 border-b border-white/[0.04] px-3 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-white/[0.04]">
          <span className="flex min-w-0 items-center gap-2">
            <AgentFace {...faceFor(a)} size={22} />
            <span className="truncate text-foreground" title={a.title || a.name}>
              {a.name}
            </span>
          </span>
          <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
            <span className={`size-1.5 flex-none rounded-full ${STATUS_DOT[a.status]}`} />
            {a.status}
          </span>
          <span className="truncate text-muted-foreground">{a.domain ?? a.project ?? DASH}</span>
          <span className="truncate text-muted-foreground">{a.hud?.model ?? a.tool}</span>
        </button>
      ))}
    </div>
  );
}

function RemoteAgentRows({ list, agents, onOpenAgent }: { list: RemoteAgent[]; agents: Agent[]; onOpenAgent: (id: string) => void }) {
  const byName = new Map(agents.map((a) => [a.name, a]));
  return (
    <div className="overflow-hidden rounded-[10px] border border-white/[0.06]">
      {list.map((r) => {
        const mine = byName.get(r.name);
        return (
          <div key={`${r.session}/${r.name}`} data-testid="server-agent" className="grid grid-cols-[minmax(140px,1.3fr)_80px_80px_1fr_auto] items-center gap-3 border-b border-white/[0.04] px-3 py-2 text-[12.5px] last:border-b-0">
            <span className="flex min-w-0 items-center gap-2">
              <AgentFace {...faceFor({ name: r.name, project: undefined, status: asStatus(r.status) })} size={22} />
              <span className="truncate text-foreground">{r.name}</span>
            </span>
            <span className="text-muted-foreground">{r.harness}</span>
            <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
              <span className={`size-1.5 flex-none rounded-full ${STATUS_DOT[asStatus(r.status)]}`} />
              {r.status}
            </span>
            <span className="truncate text-muted-foreground" title={r.cwd ?? ""}>
              session {r.session}
              {r.cwd ? ` · ${r.cwd}` : ""}
            </span>
            {mine ? (
              <button type="button" className="rounded-md px-2 py-0.5 text-[11.5px] text-foreground hover:bg-white/[0.06]" onClick={() => onOpenAgent(mine.id)}>
                Open chat
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <span className="w-[72px] text-muted-foreground">{label}</span>
      {items.map((x) => (
        <span key={x} className="rounded-full border border-white/[0.08] px-2 py-px text-foreground">
          {x}
        </span>
      ))}
    </div>
  );
}

function MiniAgentsWidget() {
  const { data } = useSharedState<{ agents: MiniAgent[]; error?: string }>("/api/servers/mini/agents", 15_000);
  const agents = data?.agents ?? [];

  return (
    <Widget
      id="mini-agents"
      size="XL"
      icon={Bot}
      title="Running on the Mac mini"
      sub="Agents running on the build machine with CPU and RAM usage."
      stat={agents.length > 0 ? { value: agents.length, label: "agents" } : undefined}
      empty={agents.length === 0 ? (data?.error ? `${data.error}; trying again every 15 s.` : "No agents running.") : undefined}
    >
      {agents.length > 0 && <MiniAgentsList agents={agents} />}
    </Widget>
  );
}

function MiniAgentsList({ agents }: { agents: MiniAgent[] }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [stopLoading, setStopLoading] = useState<string | null>(null);
  // What the last button did, said on its row (a click that changed nothing must not look like one that worked).
  const [notice, setNotice] = useState<Record<string, string>>({});
  const say = (name: string, text: string) => setNotice((n) => ({ ...n, [name]: text }));
  const answer = async (r: Response, ok: string) => r.ok ? ok : `${(await r.json().catch(() => null))?.error ?? `failed (${r.status})`}`;

  const handleStop = async (name: string) => {
    setStopLoading(name);
    try {
      const r = await fetch(`/api/servers/mini/agents/${encodeURIComponent(name)}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      say(name, await answer(r, "Stopped"));
    } catch { say(name, "Could not reach Agent Base's node"); } finally {
      setStopLoading(null);
      setConfirming(null);
    }
  };

  const handleCollect = async (name: string) => {
    try {
      const r = await fetch(`/api/servers/mini/agents/${encodeURIComponent(name)}/collect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      say(name, await answer(r, "Asked to commit, push and report"));
    } catch { say(name, "Could not reach Agent Base's node"); }
  };

  if (!agents.length) return <p className="m-0 text-[11.5px] text-muted-foreground">No agents running on the mini.</p>;

  return (
    <div className="flex flex-col gap-2">
      {agents.map((a) => (
        <div key={a.name} className="rounded-[8px] border border-white/[0.08] p-2" data-testid="mini-agent-row">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="inline-flex flex-none">
              <AgentFace {...faceFor({ name: a.name, status: asStatus(a.activity) })} size={24} />
            </span>
            <span className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-foreground truncate">{a.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{a.cwd || "—"}</div>
            </span>
            <span className={`flex-none text-[11px] font-medium ${a.activity === "working" ? "text-working" : "text-muted-foreground"}`}>
              {a.activity}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] mb-2">
            <span className="text-muted-foreground">{a.cpu.toFixed(1)}% CPU</span>
            <span className="text-muted-foreground">{a.rssMb >= 1024 ? `${(a.rssMb / 1024).toFixed(1)} GB` : `${a.rssMb} MB`}</span>
            {a.context !== null && <span className="text-muted-foreground">{a.context}% context</span>}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="flex-1 rounded-[6px] bg-white/[0.08] px-2 py-1 text-[11px] font-medium hover:bg-white/[0.12] disabled:opacity-50"
              onClick={() => handleCollect(a.name)}
              title="Send wrap-up prompt"
            >
              Collect work
            </button>
            <button
              type="button"
              className="flex-1 rounded-[6px] bg-white/[0.08] px-2 py-1 text-[11px] font-medium hover:bg-white/[0.12] disabled:opacity-50"
              onClick={() => setConfirming(a.name)}
              disabled={stopLoading === a.name}
              title="Stop this agent"
            >
              {stopLoading === a.name ? "Stopping…" : "Stop"}
            </button>
          </div>
          {confirming === a.name && (
            <div className="mt-2 rounded-[6px] bg-white/[0.04] p-2 flex items-center gap-2">
              <span className="text-[11px]">Stop {a.name}?</span>
              <button
                type="button"
                className="ml-auto text-[11px] font-medium text-foreground hover:text-white"
                onClick={() => handleStop(a.name)}
                disabled={stopLoading === a.name}
              >
                Stop
              </button>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
            </div>
          )}
          {notice[a.name] && <p className="m-0 mt-1.5 text-[11px] text-muted-foreground" role="status" data-testid="mini-agent-notice">{notice[a.name]}</p>}
        </div>
      ))}
    </div>
  );
}

/** One machine's page (servers-tokens §2.2): painted at once from its box, the services and agents filling in behind it. */
function MachinePage({ id, card, agents, onBack, onOpenAgent, onOpenUrl }: { id: string; card: Server | null; agents: Agent[]; onBack: () => void; onOpenAgent: (agentId: string) => void; onOpenUrl?: (url: string) => void }) {
  const got = useSharedState<{ server: ServerDetails }>(`/api/servers/${encodeURIComponent(id)}?view=1`, 10_000);
  const d = got.data?.server ?? null;
  const [logs, setLogs] = useState<Service | null>(null);
  const s: Server | null = d ?? card;
  const back = { label: "Servers", onClick: onBack };
  if (!s)
    return (
      <HubPage id="server" icon={ServerIcon} kicker="Server" title={id} blurb={got.error ? "Could not read the machine." : "Reading the machine…"} back={back}>
        <WidgetGrid>
          <Widget id="machine" size="XL" icon={Gauge} title="Machine" loading={!got.error} failed={got.error ? `${got.error}; trying again every 10 s.` : null} />
        </WidgetGrid>
      </HubPage>
    );
  const h = s.health;
  const l = liveness(s);
  const mine = s.agentsVisible ? agents.filter((a) => a.machine === s.agentMachine) : [];
  const list = d?.serviceList ?? null;
  const tokens = d?.tokens ?? null;
  const cells: StatCell[] = [
    { id: "load", label: "Load", value: h.load ? h.load[0] : DASH, sentence: h.cpus ? `on ${h.cpus} cores` : "no reading", pill: h.load && h.cpus && h.load[0] / h.cpus > 1 ? { text: "over 1 per core", tone: "bad" } : undefined },
    { id: "memory", label: "Memory", value: h.memAvailGb !== null ? `${gbs(h.memAvailGb)} GB` : DASH, sentence: h.memTotalGb ? `free of ${gbs(h.memTotalGb)}` : "no reading" },
    { id: "disk", label: "Disk", value: h.diskFreeGb !== null ? `${gbs(h.diskFreeGb)} GB` : DASH, sentence: h.diskTotalGb ? `free of ${gbs(h.diskTotalGb)}` : "no reading", pill: h.diskFreeGb !== null && h.diskTotalGb && h.diskFreeGb / h.diskTotalGb < 0.1 ? { text: `${((100 * h.diskFreeGb) / h.diskTotalGb).toFixed(1)}% free`, tone: "bad" } : undefined },
    { id: "uptime", label: "Uptime", value: h.upDays !== null ? `${h.upDays} d` : DASH, sentence: l.word },
    { id: "services", label: "Services", value: s.services?.count ?? DASH, sentence: "running", pill: (s.services?.failed ?? 0) > 0 ? { text: `${s.services!.failed} failed`, tone: "bad" } : undefined },
    { id: "agents", label: "Agents", value: s.agents.count ?? DASH, sentence: agentWords(s.agents) },
  ];
  return (
    <HubPage
      id="server"
      icon={s.here ? Laptop : s.client ? BriefcaseBusiness : ServerIcon}
      kicker={s.here ? "This Mac" : s.client ? "Client box" : "Server"}
      title={
        <span className="flex items-center gap-2.5">
          <Live s={s} />
          {s.name}
        </span>
      }
      blurb={d?.roleFull || s.role || "No role on the estate map."}
      back={back}
      action={
        s.owner ? (
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <OwnerFace name={s.owner} size={56} />
            <span className="flex flex-col">
              <small>owner</small>
              <b className="text-foreground">{s.owner}</b>
            </span>
          </span>
        ) : undefined
      }
    >
      <StatBar cells={cells} label={`${s.name} now`} />
      <div className="mb-3 rounded-[14px] border border-[var(--crm-color-line-subtle)] bg-[var(--crm-color-surface)] px-4 pb-2 pt-3">
        <div className="mb-1 flex text-[11px] text-muted-foreground">
          <span>Load, one point per probe</span>
          <span className="ml-auto">{(s.spark ?? []).length} readings · red above 1 per core</span>
        </div>
        <Spark points={s.spark ?? []} per={h.cpus} height={48} label={`${s.name} load`} />
      </div>
      <WidgetGrid label={s.name}>
        {/* t-0549: what runs on the mini, first, so he and Agent Zero can close some down at a glance. */}
        {s.key === "mini" && <MiniAgentsWidget />}
        <Widget
          id="services"
          size="XL"
          icon={ListTree}
          title="Services"
          sub={d?.servicesSource === "seed" ? "From the nightly scan: no probe has answered yet." : d?.servicesSource === "none" ? "No probe and no scan for this machine." : "Grouped by what they are. Failed float to the top. Logs are read-only."}
          stat={list ? { value: list.length, label: "units" } : undefined}
          loading={!d}
          empty={list && !list.length ? "No services read here." : undefined}
        >
          {list && list.length > 0 ? <Services list={list} onLogs={setLogs} onOpenUrl={onOpenUrl} agents={agents} onOpenAgent={onOpenAgent} /> : null}
        </Widget>
        <Widget
          id="agents"
          size="XL"
          icon={Bot}
          title={`Agents on ${s.name}`}
          sub={s.agentsVisible ? "Open one to go to its chat." : d?.sessions?.length ? `herdr sessions ${d.sessions.join(", ")}` : "No herdr session for this machine in the catalog: counted from processes."}
          stat={{ value: s.agentsVisible ? mine.length : (d?.agentList?.length ?? s.agents.count) }}
          empty={s.agentsVisible ? "No agents running here." : d?.agentList ? "No agents in its sessions." : agentWords(s.agents)}
        >
          {s.agentsVisible && mine.length > 0 ? <AgentRows agents={mine} onOpenAgent={onOpenAgent} /> : d?.agentList && d.agentList.length > 0 ? <RemoteAgentRows list={d.agentList} agents={agents} onOpenAgent={onOpenAgent} /> : null}
        </Widget>
        <Widget id="purpose" size="M" icon={Target} title="What it is for" sub="From the estate map." loading={!d} empty={d && !d.usedFor.length && !d.fallback.length && !d.never.length ? "The estate map gives it no work." : undefined}>
          {d && (d.usedFor.length > 0 || d.fallback.length > 0 || d.never.length > 0) ? (
            <div className="flex flex-col gap-1.5">
              <Chips label="Takes" items={d.usedFor} />
              <Chips label="Overflow" items={d.fallback} />
              <Chips label="Never" items={d.never} />
            </div>
          ) : null}
        </Widget>
        <Widget id="today" size="M" icon={Coins} title="Tokens today" sub={s.here ? "Claude session files on this Mac" : "From the VPS token rollup"} empty={s.tokensWhyNull ?? undefined}>
          {s.tokensToday ? (
            <div className="flex flex-col gap-1 text-[12px]">
              <b className="text-[20px] font-semibold tabular-nums text-foreground">{compact(s.tokensToday.total)}</b>
              {tokens &&
                Object.entries(tokens.byModel)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([m, n]) => (
                    <div key={m} className="flex justify-between gap-3">
                      <span className="truncate text-muted-foreground">{m}</span>
                      <span className="tabular-nums text-foreground">{compact(n)}</span>
                    </div>
                  ))}
            </div>
          ) : null}
        </Widget>
      </WidgetGrid>
      {d && (
        <p className="m-0 flex items-center gap-1.5 text-[11.5px] text-muted-foreground" data-testid="machine-foot">
          {d.missing && (d.missing.owner || d.missing.url) ? `Not recorded yet: owner for ${d.missing.owner} unit${d.missing.owner === 1 ? "" : "s"} · URL for ${d.missing.url}` : "Every unit has an owner and a URL on record."}
          <span className="inline-flex cursor-help" title={(d.sources ?? []).join("\n")} aria-label={`Sources: ${(d.sources ?? []).join("; ")}`}>
            <Info size={12} aria-hidden />
          </span>
        </p>
      )}
      {logs && <LogsDrawer machine={s.key} x={logs} onClose={() => setLogs(null)} sheet={typeof window !== "undefined" && window.innerWidth < 560} />}
    </HubPage>
  );
}

// ---------------------------------------------------------------- the side panel (compact)

function PanelMachine({ s, agents, onOpenUrl, onOpenAgent, onLogs }: { s: Server; agents: Agent[]; onOpenUrl?: (url: string) => void; onOpenAgent: (id: string) => void; onLogs: (key: string, x: Service) => void }) {
  const [open, setOpen] = useState(false);
  const d = useShared<{ server: ServerDetails }>(open ? `/api/servers/${encodeURIComponent(s.key)}?view=1` : null, 10_000)?.server ?? null;
  const faces = s.here ? agents.filter((a) => a.machine === s.agentMachine).map((a) => ({ name: a.name, status: a.status, project: a.project })) : (s.agentFaces ?? []);
  const failed = s.services?.failedNames ?? [];
  return (
    <div className="border-b border-white/[0.05] last:border-b-0" data-testid="panel-machine" data-key={s.key}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Live s={s} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{s.name}</span>
        <Bars h={s.health} compact />
      </button>
      <div className="flex items-center gap-2 px-3 pb-2 pl-7 text-[11px] text-muted-foreground">
        <span>
          {s.services?.count ?? DASH} ok{(s.services?.failed ?? 0) > 0 && <b className="font-medium text-failed"> · {s.services!.failed} failed</b>}
        </span>
        <span className="ml-auto">{faces.length > 0 ? <Faces list={faces} size={18} max={4} /> : `${s.agents.count ?? DASH} agents`}</span>
      </div>
      {failed.length > 0 && !open && <div className="truncate px-3 pb-2 pl-7 text-[11px] text-failed">{failed.join(", ")}</div>}
      {open && (
        <div className="px-3 pb-3 pl-7" data-testid="panel-services">
          {!d ? (
            <p className="m-0 text-[11.5px] text-muted-foreground">Reading its services…</p>
          ) : (
            (d.serviceList ?? [])
              .filter((x) => x.group !== "System")
              .slice(0, 40)
              .map((x) => (
                <div key={`${x.kind}:${x.unit}`} className="flex items-center gap-2 py-0.5 text-[11.5px]" data-testid="panel-service" data-unit={x.unit}>
                  <span className={`size-1.5 flex-none rounded-full ${x.failed ? "bg-failed" : "bg-done"}`} />
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground" title={x.what ?? x.unit}>
                    {x.unit.replace(/\.service$/, "")}
                  </span>
                  {x.url && (
                    <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => (onOpenUrl ? onOpenUrl(x.url!) : window.open(x.url!, "_blank", "noopener"))} title={x.url}>
                      <Glow code={x.urlStatus} /> Open
                    </button>
                  )}
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Logs of ${x.unit}`} onClick={() => onLogs(s.key, x)} data-testid="service-logs">
                    <ScrollText size={12} aria-hidden />
                  </button>
                </div>
              ))
          )}
          {d && agents.length > 0 && s.here && (
            <div className="mt-1 flex flex-wrap gap-1">
              {agents
                .filter((a) => a.machine === s.agentMachine)
                .slice(0, 8)
                .map((a) => (
                  <button key={a.id} type="button" onClick={() => onOpenAgent(a.id)} title={`Open ${a.name}`}>
                    <AgentFace {...faceFor(a)} size={18} />
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServersPanel({ board, agents, onOpenUrl, onOpenAgent }: { board: Server[]; agents: Agent[]; onOpenUrl?: (url: string) => void; onOpenAgent: (id: string) => void }) {
  const [logs, setLogs] = useState<{ key: string; x: Service } | null>(null);
  const failures = board.flatMap((s) => (s.services?.failedNames ?? []).map((n) => `${short(s)}: ${n}`));
  return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="servers-panel" data-density="panel">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {board.length === 0 && <p className="m-0 p-3 text-[12px] text-muted-foreground">Reading the machines…</p>}
        {board.map((s) => (
          <PanelMachine key={s.key} s={s} agents={agents} onOpenUrl={onOpenUrl} onOpenAgent={onOpenAgent} onLogs={(key, x) => setLogs({ key, x })} />
        ))}
        {failures.length > 0 && (
          <div className="px-3 py-2 text-[11px]" data-testid="panel-failures">
            <div className="mb-0.5 font-semibold uppercase tracking-wide text-failed">Failed</div>
            {failures.map((f) => (
              <div key={f} className="truncate text-muted-foreground">
                {f}
              </div>
            ))}
          </div>
        )}
      </div>
      {logs && <LogsDrawer machine={logs.key} x={logs.x} onClose={() => setLogs(null)} sheet />}
    </div>
  );
}
