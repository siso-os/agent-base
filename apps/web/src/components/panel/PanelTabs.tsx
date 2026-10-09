import { useEffect, useState } from "react";
import { ActivityIcon, CheckIcon, ChevronRightIcon, ClipboardCopyIcon, FilesIcon, GlobeIcon, LayoutGridIcon, ListChecksIcon, NetworkIcon, PinIcon, SearchIcon, XIcon } from "lucide-react";
import { usePersisted } from "@siso/shell";
import { canonName, isDone, nameKey, taskRoots, tasksOf, useA0Tasks } from "../../lib/a0-tasks";
import type { Agent, Page } from "../../lib/agents";
import type { PageRowProps } from "../PageRow";
import { openOwnerLink, useOwners } from "../../lib/owners";
import { AgentFace } from "../../lib/face";
import { CardRow, EvidenceLightbox, cardOrder, doer, type CardTask } from "./LandedRows";
import { TaskActionReceipts } from "../TaskActions";
export { taskName } from "./LandedRows";
import { clock } from "../../lib/poll";
import { TaskWorkspaceGroups } from "../TaskWorkspaceGroups";
import { useTaskWorkspaces } from "../../lib/task-workspaces";
import type { NavWorkspace } from "../../lib/workspace-nav";

/**
 * The side panel's icon row (ui-hub right-panel; Shaan 4 Oct ~17:40: "below the name maybe you don't even need the name
 * there it's got icons ... a dashboard icon that shows all of them on widgets, and then you've got the icons across").
 * No name and no ✕: the header capsule already says who, and its ◨ (or Esc) closes the panel.
 */
export type PanelTab = "home" | "tasks" | "subagents" | "timeline" | "stats" | "pages" | "org" | "board" | "widgets" | "infra" | "spend" | "changes";

/** Five primary destinations; the overview owns spend/stats and secondary tools. */
const TABS: { id: PanelTab; label: string; Icon: typeof LayoutGridIcon }[] = [
  { id: "home", label: "Overview", Icon: LayoutGridIcon },
  { id: "tasks", label: "Tasks", Icon: ListChecksIcon },
  { id: "subagents", label: "Team", Icon: NetworkIcon },
  { id: "pages", label: "Pages", Icon: FilesIcon },
  { id: "timeline", label: "Activity", Icon: ActivityIcon },
];
export const primaryPanelTab = (tab: PanelTab | "team" | null): PanelTab =>
  tab === "org" || tab === "team" ? "subagents" : TABS.some(t => t.id === tab) ? tab as PanelTab : "home";

export function PanelTabs({ active, onPick, counts, viewId = "panel-view" }: { active: PanelTab | null; zero: boolean; onPick: (t: PanelTab) => void; counts: Partial<Record<PanelTab, number>>; viewId?: string }) {
  const tabs = TABS;
  active = primaryPanelTab(active);
  return (
    <nav className="ab-ptabs" role="tablist" aria-label="Panel views" data-testid="panel-tabs">
      {tabs.map(({ id, label, Icon }, index) => (
        <button key={id} id={`${viewId}-${id}`} type="button" role="tab" aria-controls={viewId} aria-selected={active === id} tabIndex={active === id || (!active && index === 0) ? 0 : -1} aria-label={label} title={label} className="ab-ptabs__tab" data-testid={`panel-tab-${id}`} onClick={() => onPick(id)} onKeyDown={e => {
          const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
          if (next === null) return;
          e.preventDefault(); onPick(tabs[next].id);
          const target = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next];
          target?.focus(); target?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}>
          <Icon size={16} aria-hidden /><span className="ab-ptabs__label">{label}</span>
          {!!counts[id] && <i className="ab-ptabs__n">{counts[id]}</i>}
        </button>
      ))}
    </nav>
  );
}

/** Where a page lives, short: ":8891/card/x" for this laptop's servers, else the site's name. */
const host = (u: string) => { try { const x = new URL(u); return /^(127\.0\.0\.1|localhost)$/.test(x.hostname) ? `:${x.port}${x.pathname.split("/").slice(0, 3).join("/")}` : x.hostname.replace(/^www\./, ""); } catch { return u; } };
const DAY = 864e5;
const when = (t: number, now: number) => {
  const d = new Date(t), start = new Date(now).setHours(0, 0, 0, 0);
  return t >= start ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t >= start - 6 * DAY ? d.toLocaleDateString([], { weekday: "short" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};
const dayOf = (t: number | undefined, now: number) => { const start = new Date(now).setHours(0, 0, 0, 0); return !t ? "Earlier" : t >= start ? "Today" : t >= start - DAY ? "Yesterday" : "Earlier"; };

/**
 * Its pages as a readable list (right-panel pack finding 3), cleaned up for Shaan, 6 Oct 22:35 ("pages is also too
 * messy"): the owners' newest links on top (22:00: "it should have been in Pages"), then his pins, then everything else by
 * day, Earlier folded. A link an owner card carries is not listed twice. Hovering a row shows its full address.
 */
export function PagesList({ pages, owner }: { pages?: PageRowProps; /** null: every owner (Agent Zero's panel); a name: that owner's. */ owner?: string | null }) {
  const owners = useOwners();
  const [q, setQ] = useState(""), [earlier, setEarlier] = useState(false);
  const now = Date.now();
  const links = owner === undefined ? [] : (owners?.owners ?? []).filter((o) => o.page && !o.readError && (owner === null || o.name === owner)).sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  const carried = new Set(links.map(o => o.page!));
  const needle = q.trim().toLowerCase(), hit = (...t: (string | undefined)[]) => !needle || t.join(" ").toLowerCase().includes(needle);
  const pinned = (pages?.pinned ?? []).filter(p => hit(p.title, p.url));
  const rest = (pages?.dropped ?? []).filter(p => !carried.has(p.url) && hit(p.title, p.url)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const shownLinks = links.filter(o => hit(o.name, o.subtitle, o.title, o.page!));
  const total = links.length + (pages?.pinned.length ?? 0) + (pages?.dropped.length ?? 0);
  if (!total) return <p className="ab-empty p-4">No pages yet. What it posts or you drop here shows up as a list.</p>;
  const days = (["Today", "Yesterday", "Earlier"] as const).map(day => ({ day, list: rest.filter(p => dayOf(p.at, now) === day) })).filter(d => d.list.length);
  const row = (p: Page, pin = false) => (
    <li key={p.url} className={pages?.open.has(p.url) ? "is-open" : ""}>
      <button type="button" className="ab-plist__open" title={p.url} onClick={() => pages?.onOpen(p)}>
        {pin ? <PinIcon size={13} aria-hidden /> : <GlobeIcon size={13} aria-hidden />}
        <span className="ab-plist__t"><span className="ab-plist__tt">{p.title || host(p.url)}</span></span>
        <span className="ab-plist__h"><span className="ab-plist__tt">{host(p.url)}</span>{p.at ? <time aria-hidden>{when(p.at, now)}</time> : null}</span>
      </button>
      <button type="button" className="ab-plist__x" aria-label={`Hide ${p.title}`} title={pin ? "Unpin" : "Hide"} onClick={() => (pin ? pages?.onUnpin(p) : pages?.onHide(p))}>
        <XIcon size={11} />
      </button>
    </li>
  );
  return (<div className="ab-pages" data-testid="pages-list">
    {total > 8 && <label className="ab-pages__find"><SearchIcon size={13} aria-hidden /><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Find in ${total} pages`} aria-label="Find a page" /></label>}
    {shownLinks.length > 0 && <section aria-label="From owners"><h4 className="ab-pages__h">From owners <small>newest first</small></h4><ul className="ab-plist is-owners" data-testid="panel-owner-links">
      {shownLinks.map((o) => <li key={o.name}><button type="button" className="ab-plist__open" title={`${o.page!}${o.summary ? `\n\n${o.summary}` : ""}`} onClick={() => openOwnerLink(o.page!, `${o.name} · ${o.subtitle || o.title}`.slice(0, 80))}>
        <AgentFace name={o.name} project={o.workspace} status={["ready", "done"].includes(o.status) ? "done" : o.status === "blocked" ? "blocked" : "waiting"} size={22} />
        <span className="ab-plist__t"><b>{o.name}</b>{o.updated && <time>{when(Date.parse(o.updated), now)}</time>}</span>
        <span className="ab-plist__h">{o.subtitle || o.title}</span>
      </button></li>)}
    </ul></section>}
    {pinned.length > 0 && <section aria-label="Pinned"><h4 className="ab-pages__h">Pinned <small>{pinned.length}</small></h4><ul className="ab-plist" data-testid="panel-pages">{pinned.map(p => row(p, true))}</ul></section>}
    {days.map(({ day, list }) => {
      const folded = day === "Earlier" && !earlier && !needle, visible = folded ? list.slice(0, 4) : list;
      return <section key={day} aria-label={day}><h4 className="ab-pages__h">{day} <small>{list.length}</small></h4><ul className="ab-plist" data-testid={pinned.length ? undefined : "panel-pages"}>{visible.map(p => row(p))}</ul>
        {folded && list.length > 4 && <button type="button" className="ab-pages__more" onClick={() => setEarlier(true)}>Show {list.length - 4} more</button>}</section>;
    })}
    {needle && !shownLinks.length && !pinned.length && !rest.length && <p className="ab-empty p-4">No page matches “{q}”.</p>}
  </div>);
}

/**
 * What he pastes to an agent so it keeps its own board (Shaan 4 Oct ~21:00: "copy a little skill or something which I
 * could send the agent and the agent would know how to update its tasks"). The board reads Agent Zero's task store, so
 * the skill is the a0-task commands with its own name filled in.
 */
export function taskSkill(name?: string) {
  // The board matches owners by this upper-case name (canonName), so the skill writes it that way; with no name (Agent
  // Zero's board, everyone's tasks) the agent fills in its own.
  const owner = name ? canonName(name) : "YOUR-NAME";
  return `Keep your work on your Tasks board in Agent Base (I read it in your side panel). It is Agent Zero's task store: change it only with a0-task, never by hand.

T=~/SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task
$T list --json | jq -r '.[] | select(.owner == "${owner}") | "\\(.id) \\(.stage) \\(.title)"'   # your tasks
$T add "Short title" --his "my words for it" --owner "${owner}" --stage building   # prints the new id
$T set <id> next="the one step you are on now" --by "${owner}"
$T move <id> <stage> --evidence "how you checked it" --by "${owner}"

Stages, in order: thought, specced, allocated, building, built, tested, preview, live, feedback, happy (rework if I send it back).
Subtasks: add each phase as its own task, then $T set <phase-id> parent=<task-id>. Add each step as its own task, then $T set <step-id> parent=<phase-id> (a step belongs to its phase). Keep the same owner on phases and steps. Phases are numbered; their steps are lettered. Move finished steps and phases to live to tick them; mark your current step with next="NOW: what you are doing". Add as many phases and steps as the work needs.

Update it when you start a task, finish a step or change plan, so the board is never stale.`;
}

export function TeachTasks({ name, label = "Copy task skill" }: { name?: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(taskSkill(name)).then(() => (setDone(true), window.setTimeout(() => setDone(false), 2400)));
  return (
    <button type="button" className={`ab-teach${done ? " is-done" : ""}`} data-testid="tasks-teach" title={`Copies instructions you can paste to ${name ?? "any agent"} so it keeps this board itself`} onClick={copy}>
      {done ? <CheckIcon size={12} aria-hidden /> : <ClipboardCopyIcon size={12} aria-hidden />}
      {done ? `Copied · paste it to ${name ?? "the agent"}` : label}
    </button>
  );
}

/** Moving means someone is on it now (Shaan, 5 Oct: "tasks which are moving which don't have agents"): its doer is a
 * live agent that is not done or failed. Building or rework with nobody on it folds into "Not being worked on". */
const onIt = (t: CardTask, agents: Agent[]) => {
  const who = nameKey(canonName(doer(t)));
  return agents.some(x => nameKey(canonName(x.name)) === who && x.status !== "done" && x.status !== "failed");
};

export function TasksCard({ a, agents, everyone, workspaces, onOpen }: { a: Agent; agents: Agent[]; everyone: boolean; workspaces?: NavWorkspace[]; onOpen: (stage?: string) => void }) {
  const { index } = useA0Tasks();
  const { registry, failed: registryFailed, loaded: registryLoaded } = useTaskWorkspaces(index?.updated, workspaces);
  const [expanded, setExpanded] = usePersisted<Record<string, boolean>>("panel.tasks.card.open", {});
  const [morePreview, setMorePreview] = useState(false), [moreNext, setMoreNext] = useState(false), [moreIdle, setMoreIdle] = useState(false), [moreShip, setMoreShip] = useState(false);
  const [now, setNow] = useState(Date.now()), [image, setImage] = useState<{ task: CardTask; side: number } | null>(null);
  useEffect(() => clock(() => setNow(Date.now())), []);
  const all = (index?.tasks ?? []) as CardTask[];
  const open = taskRoots(tasksOf(all.filter(t => !isDone(t)), a.name, everyone));
  const groups = [
    { key: "moving", label: "Moving", stages: ["building", "rework"], mode: "moving" as const, keep: (t: CardTask) => onIt(t, agents) },
    { key: "preview", label: "Landed · rate it", stages: ["preview", "feedback"], mode: "preview" as const },
    { key: "shipping", label: "Shipping", stages: ["built", "tested"], mode: "shipping" as const },
    { key: "next", label: "Up next", stages: ["specced", "allocated"], mode: "next" as const },
    { key: "idle", label: "Not being worked on", stages: ["building", "rework"], mode: "next" as const, keep: (t: CardTask) => !onIt(t, agents) },
  ];
  // Each section folds like a tree (Shaan, 5 Oct: "not like a nice drop down tree"); Moving and Landed start open.
  const [shut, setShut] = usePersisted<Record<string, boolean>>("panel.tasks.card.shut", { shipping: true, next: true, idle: true });
  const ideas = open.filter(t => t.stage === "thought");
  return <section className="ab-fold is-card ab-tcard ab-taskcard" data-testid="fold-tasks">
    <TaskActionReceipts />
    <button type="button" className="ab-fold__head" onClick={() => onOpen()}><span className="ab-fold__title">Tasks</span><span className="ab-fold__note">{index ? `${open.length} open` : "…"}</span></button>
    {index && !open.length && <div className="ab-tcard__empty"><p>No open tasks</p><TeachTasks name={everyone ? undefined : a.name} label="Teach it the board" /></div>}
    {everyone ? <TaskWorkspaceGroups tasks={open} all={all} registry={registry} loaded={registryLoaded} failed={registryFailed} renderTask={task => {
      const t = task as CardTask;
      const mode = ["preview", "feedback"].includes(t.stage) ? "preview" : ["built", "tested"].includes(t.stage) ? "shipping" : onIt(t, agents) ? "moving" : "next";
      return <ul className="ab-taskcard__rows"><CardRow t={t} all={all} agents={agents} now={now} mode={mode} openOnly expanded={!!expanded[t.id]} onExpand={() => setExpanded({ ...expanded, [t.id]: !expanded[t.id] })} onOpen={() => onOpen()} onImage={(task, side) => setImage({ task, side })} /></ul>;
    }} /> : groups.map(g => {
      const tasks = cardOrder(open.filter(t => g.stages.includes(t.stage) && (!g.keep || g.keep(t)))), isShut = !!shut[g.key], more = g.key === "preview" ? morePreview : g.key === "next" ? moreNext : g.key === "idle" ? moreIdle : g.key === "shipping" ? moreShip : true;
      if (!tasks.length) return null;
      const capped = g.key !== "moving", visible = capped && !more ? tasks.slice(0, 3) : tasks;
      return <div key={g.key} className={`ab-taskcard__section${isShut ? " is-shut" : ""}`} data-section={g.key}><button type="button" className="ab-taskcard__heading" aria-expanded={!isShut} onClick={() => setShut({ ...shut, [g.key]: !isShut })}><ChevronRightIcon size={12} className="ab-taskcard__chev" aria-hidden /><span className="ab-taskcard__label">{g.label}</span><span>{tasks.length}</span></button>
        {!isShut && <><ul className="ab-taskcard__rows">{visible.map(t => <CardRow key={t.id} t={t} all={all} agents={agents} now={now} mode={g.mode} expanded={!!expanded[t.id]} onExpand={() => setExpanded({ ...expanded, [t.id]: !expanded[t.id] })} onOpen={() => onOpen()} onImage={(task, side) => setImage({ task, side })} />)}</ul>
        {capped && tasks.length > 3 && <button type="button" className="ab-taskcard__more" aria-label={more ? `Show fewer ${g.key === "preview" ? "landed" : "upcoming"} tasks` : `Show ${tasks.length - 3} more ${g.key === "preview" ? "landed" : "upcoming"} tasks`} onClick={() => g.key === "preview" ? setMorePreview(!more) : g.key === "idle" ? setMoreIdle(!more) : g.key === "shipping" ? setMoreShip(!more) : setMoreNext(!more)}>{more ? "Show fewer" : `+${tasks.length - 3}${g.key === "preview" ? " more" : ""}`}</button>}</>}
      </div>;
    })}
    {!everyone && !!ideas.length && <button type="button" className="ab-taskcard__ideas" onClick={() => onOpen("thought")}>{ideas.length} ideas <span aria-hidden>›</span></button>}
    {image && <EvidenceLightbox task={image.task} side={image.side} onClose={() => setImage(null)} />}
  </section>;
}
