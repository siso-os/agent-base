import { ArrowLeftIcon, ExpandIcon } from "lucide-react";
import { CodexWorkerPage } from "./CodexWorkerPage";
import { useEffect, useRef, useState, useId, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { formatDuration } from "@siso/side-nav";
import { type Agent, type Org, type Page, type Stats } from "../lib/agents";
import { isDone, isParked, ownerNames, tasksOf, canonName, useA0Tasks } from "../lib/a0-tasks";
import { accentRgb } from "../lib/face";
import { WORD, markOf } from "./Sidebar";
import { ChatView } from "./ChatView";
import { TasksPage, TasksPageMeta, type TaskGroup } from "./OwnerTasksPanel";
import { ResizeHandle, useResizable } from "@siso/shell";
import { subName } from "./panel/SubRow";
import { SubagentView } from "./panel/SubagentView";
import { StatsPageMeta, StatsPanelPage } from "./panel/StatsCard";
import { TimelinePage } from "./Timeline";
import { Fold, FoldCards } from "./PanelFold";
import { PagesList, PanelTabs, TeachTasks, primaryPanelTab, type PanelTab } from "./panel/PanelTabs";
import { type PageRowProps } from "./PageRow";
import "./Composer.css";
import "./AgentPanel.css";
import { A0Board } from "./panel/A0Board";
import { AgentWidgets } from "./widgets/AgentWidgets";
import { ServersPage } from "./ServersSpace";
import { ChangesPanel } from "./ChangesPanel";
import type { NavWorkspace } from "../lib/workspace-nav";
import { AgentOverview, AgentSpendDetail } from "./panel/AgentOverview";
import { ZeroHome } from "./panel/ZeroHome";
import { AgentTeam } from "./panel/AgentTeam";
import "./panel/AgentCompanion.css";

/** What the panel shows: its home (the sections), or one thing drilled into with ‹ back (rightpanel SPEC §2.7). */
export type Drill = { kind: "agent"; id: string } | { kind: "subagent"; key: string; title: string; meta: string; /** undefined means selected agent; null means an unbound fleet parent. */ parentId?: string | null } | { kind: "intent"; name: string; title: string } | { kind: "page"; page: "tasks" | "subagents" | "org" | "team" | "timeline" | "stats" | "pages" | "board" | "widgets" | "infra" | "spend" | "changes"; widgetId?: string; group?: TaskGroup; who?: string; stage?: string; hour?: number; /** Opened from the icon row: no back bar, its icon lit. */ tab?: boolean };
export type PanelFocus = { section: "tasks" | "team"; at: number } | null;
const PANEL_MIN = 320;
const PANEL_MAX = 720;
type People = NonNullable<ComponentProps<typeof ChatView>["people"]>;

/**
 * R1.23, the right panel, option A (rightpanel SPEC, approved 20:47; Shaan 20:45: "you go agent base, you can see what sub
 * agents he's running from that pain and then you can click the agents inside that pain and see what they're running";
 * "not have to like go to a whole org chart just to click off of it"). One 360 px column beside the chat, sections in a
 * fixed order, each a fold with a count. Everything opens in place: a row expands under itself, a sub-agent or a peeked
 * agent slides the panel to its transcript with ‹ back. Nothing in the panel changes the page.
 */
/** Keep this component mounted and change `open` so every close path can finish its exit.
 * The parent must derive its <1200px rail from requested visibility, without persisting that override. */
export function AgentPanel({ open = true, ...props }: Omit<ComponentProps<typeof AgentPanelContent>, "closing"> & { open?: boolean }) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const timer = window.setTimeout(() => setPresent(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
    return () => window.clearTimeout(timer);
  }, [open]);
  // Dismissal belongs to the parent immediately. Only unmount waits for the exit animation:
  // changing agent/route or refreshing during that delay must not lose the saved close,
  // and a newer explicit open must not be overwritten by an old close callback.
  return present ? <AgentPanelContent {...props} closing={!open} /> : null;
}

function AgentPanelContent({
  a,
  agents,
  org,
  stats,
  people,
  focus,
  onDrilled,
  onOpenAgent,
  onStatsPage,
  onOrgChart,
  onPage,
  onBoard,
  onStanding,
  onClose,
  pages,
  closing = false,
}: {
  closing?: boolean;
  a: Agent;
  agents: Agent[];
  workspaces?: NavWorkspace[];
  org: Org | null;
  stats: Stats | null;
  people: People;
  focus: PanelFocus;
  onDrilled?: (drilled: boolean) => void;
  onOpenAgent: (a: Agent) => void;
  onStatsPage: () => void;
  onOrgChart: () => void;
  onPage: (p: Page) => void;
  onBoard?: () => void;
  /** Agent Zero's page ("Where things stand"), which has no tab of its own since 3 Oct. */
  onStanding?: () => void;
  onClose: () => void;
  /** Its pages and his pins, as a row in the card's head (pagestrip SPEC §0a, R1). */
  pages?: PageRowProps;
}) {
  const panel = useRef<HTMLElement>(null);
  const viewId = useId();
  const [phone, setPhone] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : document.querySelector<HTMLElement>('[data-testid="chat-panel-toggle"]');
    const root = panel.current;
    root?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && (document.activeElement === document.body || root?.contains(document.activeElement))) opener.focus({ preventScroll: true });
    };
  }, []);
  const [stack, setStack] = useState<Drill[]>([]);
  const home = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const top = stack[stack.length - 1] ?? null;
  const kind = a.zero ? "zero" : a.kind === "worker" || a.lead ? "worker" : "owner";
  const drill = (d: Drill) => {
    scroll.current = home.current?.scrollTop ?? 0;
    setStack((s) => [...s, d]);
  };
  const back = () => {
    setStack((s) => s.slice(0, -1));
    window.requestAnimationFrame(() => {
      const tab = panel.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      tab?.focus({ preventScroll: true });
      tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    });
  };
  // The icon row (ui-hub right-panel): Dashboard is the home; every other icon is that section's page, opened in place.
  const pick = (t: PanelTab) => (scroll.current = home.current?.scrollTop ?? scroll.current, setStack(t === "home" ? [] : [{ kind: "page", page: t, tab: true }]));
  useEffect(() => {
    onDrilled?.(!!top);
  }, [top, onDrilled]);
  // A new agent opens on its own home.
  useEffect(() => setStack([]), [a.id]);
  // Back returns to the same scroll.
  useEffect(() => {
    if (!top && home.current) home.current.scrollTop = scroll.current;
  }, [top]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (closing) return;
      if (e.key === "Escape") {
        if (document.getElementById("agent-notifications") || document.querySelector('[data-esc-own]')) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (top) back(); else onClose();
      }
      if (e.key === "Tab" && window.matchMedia("(max-width: 639px)").matches) {
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"], summary') ?? [])].filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [top, closing, onClose]);
  // The header task action opens the retained task tree directly.
  useEffect(() => {
    if (focus?.section === "tasks") setStack([{ kind: "page", page: "tasks", tab: true }]);
    // The Fleet lives in Team now (Shaan, 6 Oct 22:00: "this fleet pops out randomly ... it should actually be in the pop-out
    // card"); a fresh request still wins when the panel switches agent in the same click.
    if (focus?.section === "team" && Date.now() - focus.at < 3000) setStack([{ kind: "page", page: "subagents", tab: true }]);
  }, [focus, a.id]);
  const activeTab = primaryPanelTab(!top ? "home" : top.kind === "page" ? top.page : null);

  // Drag its left edge (Shaan 3 Oct 00:05: "make the width drag and droppable"): 320-720 px, remembered per agent kind,
  // double-click resets (SPEC-PANEL-CARDS §11). Pages open at his width; only a peeked agent's chat gets 480 px at least.
  const { width, handleProps } = useResizable({ key: `panel.w.${kind === "zero" ? "zero" : "agent"}`, min: PANEL_MIN, max: PANEL_MAX, initial: 360, edge: "left" });
  const w = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Number(width) || 360));
  const shown = closing ? 0 : top?.kind === "agent" ? Math.max(w, 480) : w;
  // Owner pop-ups sit beside the panel, never over its tabs (they covered the icon row on a fresh load, 6 Oct).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ab-panel-space", `${shown ? shown + 16 : 0}px`);
    return () => { root.style.removeProperty("--ab-panel-space"); };
  }, [shown]);

  return (
    <aside ref={panel} role={phone ? "dialog" : undefined} aria-modal={phone || undefined} inert={closing} aria-hidden={closing || undefined} className={`ab-panel${top ? " is-drilled" : ""}${closing ? " is-closing" : ""}`} style={{ width: closing ? 0 : top?.kind === "agent" ? Math.max(w, 480) : w, "--panel-width": `${top?.kind === "agent" ? Math.max(w, 480) : w}px` } as CSSProperties} aria-label={`${a.name}'s panel`} data-testid="agent-panel" data-ab-comp="right-panel" data-kind={kind} data-drill={top?.kind ?? "home"}>
      <div className="ab-panel__grip" aria-hidden="true" />
      {/* t-0263: on a phone the panel is a bottom sheet; the dimmed chat above it and its handle close it. */}
      <button type="button" className="ab-panel__scrim" aria-label="Close the panel sheet" tabIndex={-1} onClick={onClose} />
      <ResizeHandle edge="left" label="Resize the panel" {...handleProps} />
      {/* A floating card in the composer's halo rim (Shaan 3 Oct 00:20: "the border you've wrapped my input in ... can
          we use that for the agent sidecar ... like how codex has done it"): its colour follows this agent's state; the
          header stays put and everything else scrolls inside it. */}
      <div className={`siso-rim ab-rim ab-panel__card ${a.status === "working" ? "is-working" : "is-idle"}`} style={rimStyle(a)} data-testid="panel-card" data-state={a.status}>
      <button type="button" className="ab-panel__handle" aria-label="Close the panel sheet" data-testid="sheet-handle" onClick={onClose} />
      <PanelTabs viewId={viewId} active={activeTab} zero={kind === "zero"} onPick={pick} counts={{ pages: pages ? pages.pinned.length + pages.dropped.length : 0 }} />
      <div id={viewId} className="ab-panel__view" role="tabpanel" aria-labelledby={`${viewId}-${activeTab}`} aria-label={top && !(top.kind === "page" && top.tab) ? "Panel content" : undefined} tabIndex={0}>
      {top ? (
        <DrillView pages={pages} top={top} parent={a} kind={kind} agents={agents} org={org} stats={stats} onStatsPage={onStatsPage} people={people} onBack={back} onOpenAgent={onOpenAgent} onBoard={onBoard} onOrgChart={onOrgChart} onPagePost={onPage} onDrill={drill} onGo={(key, title) => setStack(st => {
          const current = st.at(-1);
          return [...st.slice(0, -1), { kind: "subagent", key, title, meta: "", parentId: current?.kind === "subagent" ? current.parentId : undefined }];
        })} />
      ) : (
        <div className="ab-panel__home">
          <FoldCards.Provider value>
          <div className="ab-panel__scroll" ref={home} data-testid="panel-scroll">
          {/* Agent Zero's home (A0-HOME-SPEC, 6 Oct 23:40): Needs you, Owners, Budget, Shipped today; the old Overview folds below it. */}
          {kind === "zero" ? <ZeroHome a={a} agents={agents} onPeek={x => drill({ kind: "agent", id: x.id })} onTask={stage => drill({ kind: "page", page: "tasks", group: "stage", stage })} onOpenAgent={onOpenAgent} onPick={pick}
            legacy={<><NeedsYou a={a} agents={agents} onPeek={x => drill({ kind: "agent", id: x.id })} onTask={stage => drill({ kind: "page", page: "tasks", group: "stage", stage })} />
              <AgentOverview a={a} agents={agents} org={org} stats={stats} onPick={pick} onStanding={onStanding} /></>} /> : <>
          <NeedsYou a={a} agents={agents} onPeek={x => drill({ kind: "agent", id: x.id })} onTask={stage => drill({ kind: "page", page: "tasks", group: "stage", stage })} />
          <AgentOverview a={a} agents={agents} org={org} stats={stats} onPick={pick} onStanding={undefined} /></>}
          {kind === "owner" && <DomainFold a={a} org={org} />}
          </div>
          </FoldCards.Provider>
        </div>
      )}
      </div>
      </div>
    </aside>
  );
}

/** The rim's hue: amber while it waits on him, red when it failed, else its project's colour (as the composer's). */
function rimStyle(a: Agent): CSSProperties {
  const hue = a.status === "needs" ? "#f0b03f" : a.status === "failed" ? "rgb(var(--crm-danger-rgb))" : `rgb(${accentRgb(a.project)})`;
  return { "--rim-hue": hue } as CSSProperties;
}

// ---------------------------------------------------------------- identity (kept, with "works for X ↑" and a0-017)

// ---------------------------------------------------------------- needs you (only when > 0)

function NeedsYou({ a, agents, onPeek, onTask }: { a: Agent; agents: Agent[]; onPeek: (x: Agent) => void; onTask: (stage: string) => void }) {
  const { index } = useA0Tasks();
  const [all, setAll] = useState(false);
  // A parked task never waits on him (A0 22:54).
  // Landed work waiting for his verdict is the Tasks card's "Landed · rate it", not a second list here (5 Oct).
  const tasks = tasksOf((index?.tasks ?? []).filter((t) => t.needs && !isDone(t) && !isParked(t) && t.stage !== "preview" && t.stage !== "feedback"), a.name, !!a.zero);
  // Agent Zero: everyone in the team waiting on him; anyone else: its own blocked state, one line.
  // A failed sub-agent run is its parent's to handle, and one that failed hours ago is history, not a block on him (5 Oct:
  // "PACK-RIGHT is stuck 25h" sat in Needs you). Asking for him always counts.
  const stuck = (x: Agent) => x.status === "needs" || (x.status === "failed" && !x.parentId && Date.now() - x.since < 2 * 3600e3);
  const waiting = a.zero ? agents.filter((x) => x.row === "live" && !x.zero && stuck(x)) : stuck(a) ? [a] : [];
  const rows: ReactNode[] = [
    ...waiting.map((x) => (
      <button key={`a:${x.id}`} type="button" className="ab-needs__row" onClick={() => onPeek(x)}>
        <span className="ab-needs__dot" />
        <span className="ab-needs__title">
          {x.name} is {x.status === "failed" ? "stuck" : "waiting on you"}
        </span>
        <span className="ab-needs__who">{formatDuration(Date.now() - x.since)}</span>
      </button>
    )),
    ...tasks.map((t) => (
      <button key={t.id} type="button" className="ab-needs__row" data-testid="needs-row" data-id={t.id} title={t.next ?? t.title} onClick={() => onTask(t.stage)}>
        <span className="ab-needs__dot" />
        <span className="ab-needs__title">{t.short ?? t.title}</span>
        {a.zero && <span className="ab-needs__who">{ownerNames(t.owner)[0]}</span>}
        <b className={`a0-prio is-${t.priority.toLowerCase()}`}>{t.priority}</b>
      </button>
    )),
  ];
  if (!rows.length) return null;
  // Folded: amber dot · the top one · its owner · +N (SPEC-PANEL-CARDS §3).
  const first = waiting[0] ? `${waiting[0].name} is waiting on you` : tasks[0] ? tasks[0].short ?? tasks[0].title : "";
  const peek = (
    <>
      <span className="ab-needs__dot" />
      <span>
        {first}
        {!waiting[0] && tasks[0] && a.zero && <small> · {ownerNames(tasks[0].owner)[0]}</small>}
      </span>
      {rows.length > 1 && <b>+{rows.length - 1}</b>}
    </>
  );
  return (
    <Fold id="needs" title="Needs you" note={rows.length} open tone="needs" peek={peek}>
      {all ? rows : rows.slice(0, 3)}
      {rows.length > 3 && !all && (
        <button type="button" className="ab-more" onClick={() => setAll(true)}>
          {rows.length - 3} more
        </button>
      )}
    </Fold>
  );
}

// ---------------------------------------------------------------- domain (t-0194, owners only)

function DomainFold({ a, org }: { a: Agent; org: Org | null }) {
  const me = canonName(a.name);
  const hit = org?.groups.flatMap((g) => g.projects.flatMap((p) => p.owners.map((o) => ({ o, p, g })))).find((x) => canonName(x.o.name) === me) ?? null;
  const plan = hit?.o.plan ?? null;
  return (
    <Fold id="domain" title="Domain" note={hit?.o.domain ?? a.domain ?? undefined} open={false} testid="fold-domain">
      <dl className="ab-domain">
        <dt>Domain</dt>
        <dd>{hit?.o.domain ?? a.domain ?? "not set yet (Agent Zero sets it)"}</dd>
        <dt>Project</dt>
        <dd>{hit ? `${hit.g.name} › ${hit.p.name}` : a.project ?? "Unsorted"}</dd>
        {hit?.p.line && (
          <>
            <dt>Front door</dt>
            <dd>{hit.p.line}</dd>
          </>
        )}
        {plan && (
          <>
            <dt>Plan</dt>
            <dd>
              {plan.checked} of {plan.total} checked{plan.asked ? ` · ${plan.asked} asked` : ""}
              <span className="ab-domain__bar">
                <i style={{ width: `${plan.total ? Math.round((plan.checked / plan.total) * 100) : 0}%` }} />
              </span>
            </dd>
          </>
        )}
        {hit?.o.lastReport && (
          <>
            <dt>Last report</dt>
            <dd>{hit.o.lastReport.text}</dd>
          </>
        )}
      </dl>
    </Fold>
  );
}

// ---------------------------------------------------------------- drill-in (‹ back)

function DrillView({ pages, top, parent, kind, agents, org, stats, onStatsPage, people, onBack, onOpenAgent, onBoard, onOrgChart, onPagePost, onDrill, onGo }: { pages?: PageRowProps; top: Drill; parent: Agent; kind: "zero" | "owner" | "worker"; agents: Agent[]; org: Org | null; stats: Stats | null; onStatsPage: () => void; people: People; onBack: () => void; onOpenAgent: (a: Agent) => void; onBoard?: () => void; onOrgChart: () => void; onPagePost: (p: Page) => void; onDrill: (d: Drill) => void; onGo: (key: string, title: string) => void }) {
  const peeked = top.kind === "agent" ? agents.find((x) => x.id === top.id) ?? null : null;
  const crewParent = top.kind === "subagent" && top.parentId !== undefined ? agents.find(a => a.id === top.parentId) : parent;
  const title = top.kind === "agent" ? peeked?.name ?? "Gone from herdr" : top.kind === "page" ? { tasks: "Tasks", subagents: "Team", org: "Team", team: "Team", timeline: "Activity", stats: "Stats", pages: "Pages", board: "Your board", widgets: "Widgets", infra: "Infrastructure", spend: "Spend", changes: "Changes" }[top.page] : top.kind === "subagent" ? "Sub-agents" : top.title;
  const meta: ReactNode =
    top.kind === "agent" ? (peeked ? [peeked.hud?.model, WORD[markOf(peeked)]].filter(Boolean).join(" · ") : "") : top.kind === "subagent" ? "⌥↑↓ next" : top.kind === "page" ? (top.page === "tasks" ? (
        <>
          <TasksPageMeta owner={parent.name} everyone={kind === "zero"} onBoard={onBoard} />
          <TeachTasks name={kind === "zero" ? undefined : parent.name} label="Copy skill" />
        </>
      ) : top.page === "stats" ? <StatsPageMeta a={parent} onFull={onStatsPage} /> : ["board", "widgets", "infra", "spend", "pages", "changes"].includes(top.page) ? "" : "today") : "distilled intent";
  return (
    <div className="ab-drill" data-testid="panel-drill">
      <div className={`ab-drill__bar${top.kind === "page" && top.tab ? " is-tab" : ""}`}>
        <button type="button" className="ab-drill__back" aria-label="Back" title="Back · Esc" data-testid="drill-back" onClick={onBack}>
          <ArrowLeftIcon size={15} />
        </button>
        <span className="ab-drill__title">{title}</span>
        {peeked && (
          <button type="button" className="ab-drill__open" title="Make it the open chat" data-testid="drill-open" onClick={() => onOpenAgent(peeked)}>
            <ExpandIcon size={12} /> Open
          </button>
        )}
        {meta && <span className="ab-drill__meta">{meta}</span>}
      </div>
      <div className="ab-drill__body">
        {top.kind === "agent" &&
          (peeked?.codexWorker ? (
            <CodexWorkerPage agent={peeked} />
          ) : peeked?.chat ? (
            <ChatView key={peeked.id} agentId={peeked.id} active people={people} accent={accentRgb(peeked.project)} />
          ) : peeked ? (
            <p className="ab-empty p-4">Its chat shows once it has written its first message. “Open” switches to it.</p>
          ) : null)}
        {top.kind === "subagent" && (crewParent ? <SubagentView key={`${crewParent.id}:${top.key}`} parent={crewParent} id={top.key} onGo={onGo} /> : <p className="ab-empty p-4" role="status">The original parent is unavailable. Return to Team to choose an available conversation.</p>)}
        {top.kind === "page" && ["org", "subagents", "team"].includes(top.page) && (
          <AgentTeam a={parent} agents={agents} org={org} onGraph={onOrgChart} onOpenAgent={onOpenAgent} onFleetCrew={r => onDrill({ kind: "subagent", key: r.crew?.toolUseId ?? r.crew?.id ?? r.id, title: r.name, meta: "", parentId: r.crewParentId?.trim() || null })} onSubagent={r => { const crew = r.agentId ? agents.find(x => x.id === r.agentId) : null; onDrill(crew ? { kind: "agent", id: crew.id } : { kind: "subagent", key: r.toolUseId ?? r.id, title: subName(r), meta: "" }); }} />
        )}
        {top.kind === "intent" && <IntentView name={top.name} />}
        {top.kind === "page" && top.page === "tasks" && <TasksPage owner={parent.name} everyone={kind === "zero"} agents={agents} group={top.group} who={top.who} stage={top.stage} onBoard={onBoard} />}
        {top.kind === "page" && top.page === "timeline" && (
          <TimelinePage a={parent} hour={top.hour} onIntent={(name, title) => onDrill({ kind: "intent", name, title })} onSubagent={(key, title) => onDrill({ kind: "subagent", key, title, meta: "" })} onPage={onPagePost} />
        )}
        {top.kind === "page" && top.page === "stats" && <StatsPanelPage a={parent} stats={stats} />}
        {top.kind === "page" && top.page === "board" && <A0Board a={parent} agents={agents} onBoard={onBoard} />}
        {top.kind === "page" && top.page === "widgets" && kind === "zero" && <AgentWidgets agent="A0" selectedId={top.widgetId ?? null} onSelect={id => onDrill({ kind: "page", page: "widgets", widgetId: id ?? undefined, tab: true })} />}
        {top.kind === "page" && top.page === "infra" && <ServersPage density="panel" agents={agents} onOpenAgent={id => { const agent = agents.find(x => x.id === id); if (agent) onOpenAgent(agent); }} onOpenUrl={(url, title) => onPagePost({ url, title: title || url })} />}
        {top.kind === "page" && top.page === "spend" && <AgentSpendDetail onBack={onBack} />}
        {top.kind === "page" && top.page === "changes" && <ChangesPanel agentId={parent.id} sessionId={parent.session ?? null} />}
        {top.kind === "page" && top.page === "pages" && <PagesList pages={pages} owner={kind === "zero" ? null : parent.name} />}
      </div>
    </div>
  );
}

/** One distilled intent file (t-0259: each of his lines links the file it became). */
function IntentView({ name }: { name: string }) {
  const [d, setD] = useState<{ when: string | null; text: string } | null | "gone">(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/a0/intent/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((x) => alive && setD(x))
      .catch(() => alive && setD("gone"));
    return () => {
      alive = false;
    };
  }, [name]);
  if (d === null) return <p className="ab-empty p-4">Reading…</p>;
  if (d === "gone") return <p className="ab-empty p-4">That intent file is not readable.</p>;
  return (
    <div className="ab-intent" data-testid="intent-view">
      {d.when && <p className="ab-intent__when">{new Date(d.when).toLocaleString()}</p>}
      <pre>{d.text}</pre>
    </div>
  );
}
