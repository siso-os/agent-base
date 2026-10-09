import { TaskActions, TaskActionReceipts } from "./TaskActions";
import { TaskFold } from "./TaskFold";
import { usePersisted } from "@siso/shell";
import { TaskTree, taskFamily, taskProgress } from "./panel/TaskTree";
import { CheckIcon, ChevronRightIcon, Maximize2Icon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FLYWHEEL, isDone, isNow, isParked, orderTasks, ownerNames, saveTask, taskRoots, tasksOf, useA0Tasks, canonName, type TaskEdit } from "../lib/a0-tasks";
import type { Agent } from "../lib/agents";
import { AgentFace, faceFor } from "../lib/face";
import type { TaskSummary } from "./widgets/TasksWidget";
import { planPhases, stepLetter, turnAction, yourTurn, type PlanPhase } from "../lib/task-plan";
import { formatAge } from "@siso/side-nav";
import "./TasksPage.css";
import "./OwnerTasksPanel.css";
import { OwnerStrip, StageControl, TaskProjects, bucketOf, inBucket, type Bucket } from "./panel/TaskProjects";
import { TaskWorkspaceGroups } from "./TaskWorkspaceGroups";
import { useTaskWorkspaces } from "../lib/task-workspaces";

type Fields = Partial<Pick<TaskSummary, "priority" | "next">> & { stage?: string };
type Status = { kind: "saving" } | { kind: "saved" } | { kind: "failed"; error: string; edit: TaskEdit };
type Field = keyof Fields;
export type Chip = "now" | "needs" | "open" | "done";
export type TaskGroup = "now" | "stage" | "owner";

/** The flywheel's stages in board order, for the stage bar and the By stage page. */
const STAGES = ["thought", "specced", "allocated", "building", "built", "tested", "preview", "live", "integrated", "feedback", "happy", "rework", "done", "dropped"];
const stageOf = (t: TaskSummary) => String(t.stage);
// A parked task never counts as waiting on him (A0 22:54).
const waits = (t: TaskSummary) => !!t.needs && !isParked(t);
const nextLine = (t: TaskSummary) => (t.next ?? "").replace(/^\s*NOW:\s*/i, "").trim();

/** Everything both the card and the page need: the live index with his optimistic edits, his scope and its splits. */
function useScoped(owner: string, everyone: boolean, who: string) {
  const { index, failed } = useA0Tasks();
  const { mine, status, save } = useTaskEdits(index?.tasks ?? []);
  const merged = useMemo(() => (index?.tasks ?? []).map((t) => (mine[t.id] ? ({ ...t, ...mine[t.id] } as TaskSummary) : t)), [index, mine]);
  const scoped = useMemo(() => tasksOf(merged, owner, everyone), [merged, owner, everyone]);
  const all = useMemo(() => (everyone && who !== "all" ? scoped.filter((t) => ownerNames(t.owner).includes(who)) : scoped), [scoped, everyone, who]);
  // Owners by open count, for the faces filter (Agent Zero's list only).
  const owners = useMemo(() => {
    if (!everyone) return [];
    const n = new Map<string, number>();
    for (const t of taskRoots(scoped.filter(t => !isDone(t)))) for (const o of new Set(ownerNames(t.owner))) n.set(o, (n.get(o) ?? 0) + 1);
    return [...n].sort((x, y) => y[1] - x[1]);
  }, [scoped, everyone]);
  const open = taskRoots(all.filter((t) => !isDone(t)));
  const lists: Record<Chip, TaskSummary[]> = {
    now: open.filter(isNow),
    needs: open.filter(waits),
    open: [...open.filter(waits), ...orderTasks(open.filter((t) => !waits(t)))],
    done: taskRoots(all).filter(isDone),
  };
  return { index, failed, status, save, open, lists, owners, allTasks: merged, all };
}

/** A face for a task's owner: the live agent's when there is one, else one drawn from its name. */
export function OwnerFace({ name, agents, size = 20 }: { name: string; agents: Agent[]; size?: number }) {
  const a = agents.find((x) => canonName(x.name) === name || (x.zero && /^(A0|AGENT ZERO)$/.test(name)));
  return (
    <span className="ab-task__face" title={name}>
      <AgentFace {...faceFor(a ?? { name, project: null, status: "idle" })} size={size} />
    </span>
  );
}

/** The 5 px bar of every open task by stage (SPEC-PANEL-CARDS §4); a tap opens the page grouped by stage. */
function StageBar({ open, onTap }: { open: TaskSummary[]; onTap?: () => void }) {
  const n = new Map<string, number>();
  for (const t of open) n.set(stageOf(t), (n.get(stageOf(t)) ?? 0) + 1);
  const parts = STAGES.filter((s) => n.has(s)).map((s) => [s, n.get(s)!] as const);
  const title = parts.map(([s, c]) => `${c} ${s}`).join(" · ");
  return (
    <button type="button" className="ab-stagebar" title={title} aria-label={`By stage: ${title}`} data-testid="stage-bar" onClick={onTap} disabled={!onTap || !open.length}>
      {parts.map(([s, c]) => (
        <i key={s} className={`is-${s}`} style={{ flexGrow: c }} />
      ))}
    </button>
  );
}

/** Owner faces by open count; a tap filters to that owner, a second tap clears it (it replaces the owner select). */
function OwnerFaces({ owners, who, setWho, agents }: { owners: [string, number][]; who: string; setWho: (w: string) => void; agents: Agent[] }) {
  if (!owners.length) return null;
  return (
    <div className="ab-ownerfaces" role="group" aria-label="Whose tasks">
      {owners.slice(0, 6).map(([o, c]) => (
        <button key={o} type="button" data-owner={o} aria-pressed={who === o} title={`${o} · ${c} open`} onClick={() => setWho(who === o ? "all" : o)}>
          <OwnerFace name={o} agents={agents} size={18} />
        </button>
      ))}
    </div>
  );
}

/**
 * The Tasks card (SPEC-PANEL-CARDS §4; Shaan 3 Oct 00:15: "tasks should be a better widget like i can't really see shit
 * from this it's kind of like cut off"). A stage bar of every open task; Now · Needs · All (and a quiet Done) with the
 * owners' faces as a filter; rows that give the title two full lines with its owner's face and the next step under it.
 * Priority and NOW are not drawn: they set the order, and a P0 row has a red rail. 5 rows, "Show 5 more" in place, then
 * "All N tasks ›" opens the page inside the panel. A tap opens a row in place to change it.
 */
export function TaskList({ owner, everyone = false, plain = false, chip: chipIn, onChip, agents = [], onPage }: { owner: string; everyone?: boolean; plain?: boolean; chip?: Chip; onChip?: (c: Chip) => void; agents?: Agent[]; onPage?: (group: TaskGroup) => void }) {
  const [chipOwn, setChipOwn] = useState<Chip>(everyone ? "open" : "now");
  const chip = chipIn ?? chipOwn;
  const [who, setWho] = useState<string>("all");
  const [shown, setShown] = useState(5);
  const [openId, setOpenId] = useState<string | null>(null);
  const setChip = (c: Chip) => (onChip ? onChip(c) : setChipOwn(c), setShown(5));
  const { index, failed, status, save, open, lists, owners, allTasks } = useScoped(owner, everyone, who);
  const { registry, failed: registryFailed, loaded: registryLoaded } = useTaskWorkspaces(index?.updated);
  // Nothing marked NOW: Now hides and All is selected rather than an empty box.
  const shownChip: Chip = chip === "now" && !lists.now.length ? "open" : chip;
  const list = plain ? open : lists[shownChip];
  const counts = { now: lists.now.length, needs: lists.needs.length, open: open.length, done: lists.done.length };
  return (
    <div className="owner-panel__body ab-tasks" data-testid="owner-tasks" aria-label={`${owner}'s tasks`}>
      {!plain && (
        <>
          <StageBar open={open} onTap={onPage && (() => onPage("stage"))} />
          <div className="ab-tasks__filters">
            <div className="ab-switch" role="group" aria-label="Which tasks">
              {(["now", "needs", "open", "done"] as const).map((c) =>
                (c === "needs" || c === "now") && !counts[c] ? null : (
                  <button key={c} type="button" data-chip={c} data-count={counts[c]} aria-pressed={shownChip === c} className={`is-${c}`} onClick={() => setChip(c)}>
                    {{ now: "Now", needs: "Needs", open: "All", done: "Done" }[c]}
                    {c !== "done" && <span>{counts[c]}</span>}
                  </button>
                ),
              )}
            </div>
            <OwnerFaces owners={owners} who={who} setWho={(w) => (setWho(w), setShown(5))} agents={agents} />
          </div>
        </>
      )}
      <TaskActionReceipts /><div className="owner-panel__list">
        {index && failed && <p role="status" className="owner-panel__empty">Task refresh unavailable; showing the last successful task list.</p>}
        {!index && <p className="owner-panel__empty">{failed ? "Agent Zero's task list is not readable right now." : "Reading the tasks…"}</p>}
        {index && !list.length && <p className="owner-panel__empty">{shownChip === "done" ? "Nothing finished yet" : `No open tasks for ${everyone && who === "all" ? "anyone" : who !== "all" ? who : owner}`}</p>}
        {everyone ? <TaskWorkspaceGroups tasks={list} all={allTasks} registry={registry} loaded={registryLoaded} failed={registryFailed} renderTask={t => <TaskLine t={t} agents={agents} open={openId === t.id} status={status[t.id]} tree={<TaskTree task={t} all={allTasks} openOnly={shownChip !== "done"} />} progress={taskProgress(t, allTasks)} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onSave={e => void save(t.id, e)} />} /> : list.slice(0, shown).map((t) => (
          <TaskLine key={t.id} t={t} who={everyone} agents={agents} open={openId === t.id} status={status[t.id]} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onSave={(e) => void save(t.id, e)} />
        ))}
      </div>
      {((!everyone && list.length > shown) || onPage) && (
        <div className="ab-tasks__foot">
          {!everyone && list.length > shown && (
            <button type="button" className="ab-more" data-testid="tasks-more" onClick={() => setShown(shown + 5)}>
              Show {Math.min(5, list.length - shown)} more
            </button>
          )}
          {onPage && (
            <button type="button" className="ab-pagelink" data-testid="tasks-page" onClick={() => onPage("now")}>
              All {open.length} tasks <ChevronRightIcon size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Tasks page, inside the panel (SPEC-PANEL-CARDS §4): search (/), Now · By stage · By owner with sticky group headers,
 * every row, each opening in place with his words, its next step, stage and priority, and its last 3 history lines.
 */
export function TasksPage({ owner, everyone = false, agents = [], group: groupIn = "now", who: whoIn, stage, onBoard }: { owner: string; everyone?: boolean; agents?: Agent[]; group?: TaskGroup; who?: string; stage?: string; onBoard?: () => void }) {
  const [group, setGroup] = useState<TaskGroup>(groupIn);
  const [q, setQ] = useState("");
  const [who, setWho] = useState(whoIn ?? "all");
  const [expanded, setExpanded] = usePersisted<Record<string, boolean>>("panel.tasks.open", {});
  const [done, setDone] = useState(false);
  // Agent Zero's list filters by four plain buckets, not fourteen stages (Shaan, 6 Oct 22:35: "all stages pills ugly").
  const [bucket, setBucket] = useState<Bucket>(bucketOf(stage));
  const { index, failed, status, save, open, lists, owners, allTasks } = useScoped(owner, everyone, who);
  const { registry, failed: registryFailed, loaded: registryLoaded } = useTaskWorkspaces(index?.updated);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(el.tagName) && !el.isContentEditable) (e.preventDefault(), search.current?.focus());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (t: TaskSummary) => !words.length || words.every((w) => `${t.id} ${t.short ?? ""} ${t.title} ${t.next ?? ""} ${t.owner ?? ""} ${t.agent ?? ""} ${t.his ?? ""}`.toLowerCase().includes(w));
  const matches = new Set(words.length ? allTasks.filter(hit).map((t) => t.id) : []);
  const familyHits = (t: TaskSummary) => words.length > 0 && taskFamily(t, allTasks).some((child) => matches.has(child.id));
  const pool = (done ? lists.done : lists.open).filter((t) => (everyone ? done || inBucket(t, bucket) : !stage || t.stage === stage) && (!words.length || familyHits(t)));
  const groupWho = (t: TaskSummary) => (everyone ? ownerNames(t.owner)[0] : t.agent?.trim() ? canonName(t.agent) : ownerNames(t.owner)[0]) || "Unassigned";
  const groups: [string, TaskSummary[]][] =
    group === "now"
      ? done
        ? [["Done", pool]]
        : [
            ["Now", pool.filter(isNow)],
            ["Needs you", pool.filter((t) => waits(t) && !isNow(t))],
            ["Open", pool.filter((t) => !isNow(t) && !waits(t))],
          ]
      : group === "stage"
        ? STAGES.map((s) => [s, pool.filter((t) => stageOf(t) === s)] as [string, TaskSummary[]])
        : [...new Set(pool.map(groupWho))].sort().map((o) => [o, pool.filter((t) => groupWho(t) === o)] as [string, TaskSummary[]]);
  return (
    <div className="ab-tpage" data-testid="tasks-page-view">
      <TaskActionReceipts /><div className="ab-tpage__top">
        <label className="ab-tpage__search">
          <SearchIcon size={13} aria-hidden="true" />
          <input ref={search} value={q} placeholder={`Search ${open.length} tasks`} aria-label="Search tasks" data-testid="tasks-search" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))} />
          <kbd>/</kbd>
        </label>
        {everyone && !done && <StageControl tasks={lists.open} value={bucket} onChange={setBucket} />}
        {everyone && <OwnerStrip tasks={lists.open} agents={agents} who={who} setWho={setWho} />}
        {!everyone && <div className="ab-tasks__filters">
          <div className="ab-switch" role="group" aria-label="Group by">
            {(["now", "stage", "owner"] as const).map((g) => (
              <button key={g} type="button" data-group={g} aria-pressed={group === g} onClick={() => setGroup(g)}>
                {{ now: "Plan", stage: "By stage", owner: everyone ? "By owner" : "By who" }[g]}
              </button>
            ))}
          </div>
          <OwnerFaces owners={owners} who={who} setWho={setWho} agents={agents} />
        </div>}
      </div>
      {index && failed && <p role="status" className="owner-panel__empty">Task refresh unavailable; showing the last successful task list.</p>}
      {!index && <p className="owner-panel__empty">{failed ? "Agent Zero's task list is not readable right now." : "Reading the tasks…"}</p>}
      {registryFailed && everyone && <p className="owner-panel__empty">Workspace registry unavailable; showing unplaced tasks.</p>}
      {index && everyone ? <TaskProjects tasks={pool} all={allTasks} registry={registry} loaded={registryLoaded || registryFailed} agents={agents} reveal={!!q} renderTask={t => <TaskLine t={t} agents={agents} open={familyHits(t) || !!expanded[t.id]} status={status[t.id]} progress={taskProgress(t, allTasks)} tree={<TaskTree task={t} all={allTasks} matches={matches} openOnly={!done} />} onToggle={() => setExpanded({ ...expanded, [t.id]: !expanded[t.id] })} onSave={e => void save(t.id, e)} />} /> : index && group === "now" && !done && !words.length && !stage ? <TaskPlan all={open} allTasks={allTasks} agents={agents} status={status} onSave={save} /> : groups
        .filter(([, l]) => l.length)
        .map(([name, l]) => (
          <section key={name} className="ab-tpage__group" data-testid="tasks-group" data-group={name}>
            <h4>
              {name} <span>{l.length}</span>
            </h4>
            {l.map((t) => (
              <TaskLine key={t.id} t={t} who={everyone} agents={agents} open={familyHits(t) || !!expanded[t.id]} status={status[t.id]} progress={taskProgress(t, allTasks)} tree={<TaskTree task={t} all={allTasks} matches={matches} />} onToggle={() => setExpanded({ ...expanded, [t.id]: !expanded[t.id] })} onSave={(e) => void save(t.id, e)} />
            ))}
          </section>
        ))}
      {index && !pool.length && <p className="owner-panel__empty">{q ? `Nothing matches “${q}”` : done ? "Nothing finished yet" : "No open tasks"}</p>}
      <div className="ab-tpage__foot">
        <span>
          {lists.now.length} now · {open.length} open
        </span>
        <button type="button" className="ab-more" aria-pressed={done} onClick={() => setDone(!done)}>
          {done ? "Open tasks" : `Done ${lists.done.length}`}
        </button>
        {onBoard && (
          <button type="button" className="ab-pagelink" onClick={onBoard}>
            Board <ChevronRightIcon size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The plan (Oh My Pi's todo, t-0336): numbered phases, lettered steps, ☑ struck when done, ● what someone is on now,
 * ○ the rest. A phase folds to one line with its done/total; Ideas starts folded. A step opens in place with its own
 * steps (when it has any) and its details.
 */
const CAP = 6;
function TaskPlan({ all, allTasks, agents, status, onSave }: { all: TaskSummary[]; allTasks: TaskSummary[]; agents: Agent[]; status: Record<string, Status>; onSave: (id: string, e: TaskEdit) => void }) {
  const [fold, setFold] = usePersisted<Record<string, boolean>>("panel.tasks.plan.fold", { ideas: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const now = Date.now();
  // Someone is on it: marked NOW, or its doer is a live agent that is not finished (the owner alone is not "on it").
  const onIt = (t: TaskSummary) => !!t.agent && agents.some((x) => canonName(x.name) === canonName(t.agent!) && x.status !== "done" && x.status !== "failed");
  const phases = planPhases(all, onIt, now).filter((p) => p.total);
  if (!phases.length) return <p className="owner-panel__empty">No open tasks</p>;
  return (
    <ol className="ab-plan" data-testid="task-plan">
      {phases.map((p: PlanPhase, n) => {
        const shut = fold[p.key] ?? false;
        return (
          <li key={p.key} className={`ab-plan__phase is-${p.key}`} data-phase={p.key}>
            <button type="button" className="ab-plan__head" aria-expanded={!shut} onClick={() => setFold({ ...fold, [p.key]: !shut })}>
              <span className="ab-plan__num">{n + 1}.</span>
              <b>{p.name}</b>
              <small>{p.done ? `${p.done}/${p.total}` : p.total}</small>
              {p.key === "turn" && <em className="ab-plan__hint">⌘R, try it, say good or redo</em>}
              <ChevronRightIcon size={12} className="ab-plan__fold" aria-hidden="true" />
            </button>
            <TaskFold open={!shut}>
              <ul className="ab-plan__steps">
                {(more[p.key] ? p.steps : p.steps.slice(0, CAP)).map(({ t, mark }, i) => {
                  const isOpen = openId === t.id, kids = taskProgress(t, allTasks), owner = ownerNames(t.owner)[0] ?? "", who = t.agent?.trim() ? canonName(t.agent) : owner;
                  const action = p.key === "turn" && mark !== "done" ? turnAction(t) : "";
                  const when = mark === "done" ? t.live_at ?? t.updated : t.updated;
                  return (
                    <li key={t.id} className={`ab-plan__step is-${mark}${isOpen ? " is-open" : ""}`} data-testid="plan-step" data-id={t.id} data-mark={mark}>
                      <button type="button" className="ab-plan__line" aria-expanded={isOpen} title={t.title} onClick={() => setOpenId(isOpen ? null : t.id)}>
                        <span className="ab-plan__box" aria-label={{ done: "Done", current: "Being worked on", todo: "To do" }[mark]}>{mark === "done" ? "☑" : mark === "current" ? "●" : "○"}</span>
                        <span className="ab-plan__letter">{stepLetter(i)}.</span>
                        <span className="ab-plan__copy">
                          <span className="ab-plan__title">{t.title}</span>
                          {(action || nextLine(t)) && <small className="ab-plan__action"><em>Next</em> {action || nextLine(t)}</small>}
                          <small className="ab-plan__meta">{t.stage} · {owner || "Unassigned"}{t.agent && canonName(t.agent) !== owner ? ` · ${t.agent}` : ""} · <time title={when} dateTime={when}>{formatAge(Date.parse(when), now)}</time></small>
                        </span>
                        {kids && <small className="ab-plan__kids">{kids}</small>}
                        {status[t.id]?.kind === "saved" ? <CheckIcon size={13} className="owner-panel__tick" aria-label="saved" /> : who && <OwnerFace name={who} agents={agents} size={22} />}
                      </button>
                      {(isOpen || t.stage === "preview" || t.stage === "feedback") && <TaskActions task={t} />}
                      {isOpen && (
                        <div className="ab-plan__open">
                          {kids && <TaskTree task={t} all={allTasks} />}
                          <TaskOpen t={t} owner={owner} agents={agents} onSave={(e) => onSave(t.id, e)} />
                        </div>
                      )}
                    </li>
                  );
                })}
                {p.steps.length > CAP && (
                  <li>
                    <button type="button" className="ab-plan__more" onClick={() => setMore({ ...more, [p.key]: !more[p.key] })}>
                      {more[p.key] ? "Show fewer" : `+${p.steps.length - CAP} more`}
                    </button>
                  </li>
                )}
              </ul>
            </TaskFold>
          </li>
        );
      })}
    </ol>
  );
}

/** The page bar's right side for Tasks: its counts and ⤢ (the full board page). */
export function TasksPageMeta({ owner, everyone = false, onBoard }: { owner: string; everyone?: boolean; onBoard?: () => void }): ReactNode {
  const { open } = useScoped(owner, everyone, "all");
  return (
    <>
      <span>
        {open.length} open{open.filter(yourTurn).length ? ` · ${open.filter(yourTurn).length} your turn` : ""}
      </span>
      {onBoard && (
        <button type="button" className="ab-drill__open" title="Open the board" aria-label="Open the board" onClick={onBoard}>
          <Maximize2Icon size={12} />
        </button>
      )}
    </>
  );
}

/** Compare the selected record, not unrelated rows or transport object identity. */
const taskEditRevision = (task?: TaskSummary) => task ? JSON.stringify(Object.entries(task).sort(([a], [b]) => a.localeCompare(b))) : null;

/** Accepted edits bridge the next index read; newer source snapshots always own the displayed fields. */
function useTaskEdits(tasks: TaskSummary[]) {
  const [mine, setMine] = useState<Record<string, Fields>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const statusRef = useRef<Record<string, Status>>({});
  const mounted = useRef(false);
  const sequence = useRef(0);
  const versions = useRef<Record<string, Partial<Record<Field, number>>>>({});
  const latestRequest = useRef<Record<string, number>>({});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const source = useRef(tasks);
  const previousSource = useRef(tasks);
  source.current = tasks;
  useEffect(() => {
    // Even a different recorded value is authoritative. Keeping an accepted overlay
    // until equality could hide a later edit forever (including same-second edits).
    setMine(m => Object.keys(m).length ? {} : m);
    const previous = new Map(previousSource.current.map(task => [task.id, taskEditRevision(task)]));
    const latest = new Map(tasks.map(task => [task.id, taskEditRevision(task)]));
    previousSource.current = tasks;
    setStatus(s => {
      const kept = Object.fromEntries(Object.entries(s).filter(([id, value]) => value.kind === "saving" ||
        (value.kind === "failed" && latest.has(id) && previous.get(id) === latest.get(id))));
      statusRef.current = kept;
      return Object.keys(kept).length === Object.keys(s).length ? s : kept;
    });
  }, [tasks]);
  const timers = useRef<Record<string, number>>({});
  const save = async (id: string, edit: TaskEdit) => {
    const fields: Fields = {};
    if (edit.stage) fields.stage = edit.stage;
    if (edit.priority) fields.priority = edit.priority;
    if (edit.next !== undefined) fields.next = edit.next;
    const owned = Object.keys(fields) as Field[];
    const captured: Partial<Record<Field, number>> = {};
    const current = (versions.current[id] ??= {});
    const requestId = ++sequence.current;
    latestRequest.current[id] = requestId;
    for (const field of owned) captured[field] = current[field] = requestId;
    window.clearTimeout(timers.current[id]);
    statusRef.current[id] = { kind: "saving" };
    setStatus((s) => ({ ...s, [id]: { kind: "saving" } }));
    const observed = taskEditRevision(source.current.find(task => task.id === id));
    const r = await saveTask(id, edit);
    if (!mounted.current) return;
    if (taskEditRevision(source.current.find(task => task.id === id)) !== observed) {
      // This response belongs to an older snapshot, never to its replacement row.
      if (latestRequest.current[id] === requestId) {
        delete statusRef.current[id];
        setStatus(({ [id]: _, ...rest }) => rest);
      }
      return;
    }
    const stillOwns = (field: Field) => versions.current[id]?.[field] === captured[field];
    if (r.ok) {
      const accepted = Object.fromEntries(Object.entries(fields).filter(([field]) => stillOwns(field as Field)));
      setMine(m => ({ ...m, [id]: { ...m[id], ...accepted } }));
      // A superseded response must not replace the newer request's status.
      if (latestRequest.current[id] === requestId) {
        const latestStatus = statusRef.current[id] as Status | undefined;
        if (latestStatus?.kind === "failed") return;
        statusRef.current[id] = { kind: "saved" };
        setStatus((s) => ({ ...s, [id]: { kind: "saved" } }));
        timers.current[id] = window.setTimeout(() => setStatus(({ [id]: _, ...rest }) => rest), 1600);
      }
    } else {
      const reverted = owned.filter(stillOwns);
      // If every field was superseded, this failure is no longer user-visible.
      if (!reverted.length) return;
      const failedEdit: TaskEdit = {};
      for (const field of reverted) {
        if (field === "stage") failedEdit.stage = edit.stage;
        if (field === "priority") failedEdit.priority = edit.priority;
        if (field === "next") failedEdit.next = edit.next;
      }
      failedEdit.reason = edit.reason;
      window.clearTimeout(timers.current[id]);
      statusRef.current[id] = { kind: "failed", error: r.error ?? "Not saved", edit: failedEdit };
      setStatus((s) => ({ ...s, [id]: { kind: "failed", error: r.error ?? "Not saved", edit: failedEdit } }));
    }
  };
  useEffect(() => () => Object.values(timers.current).forEach((timer) => window.clearTimeout(timer)), []);
  return { mine, status, save };
}


type Detail = { his?: string | null; evidence?: string[]; history?: { at?: string; stage?: string; by?: string; his?: string; note?: string; why?: string; evidence?: string }[]; links?: Record<string, string | null> };
const hhmm = (at?: string) => (at ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at)) : "");

/** The task file (GET /api/a0/tasks/:id): his words, history, links. Read when a row opens. */
function useDetail(id: string, updated: string) {
  const [d, setD] = useState<Detail | null | "failed">(null);
  useEffect(() => {
    let live = true;
    setD(null);
    fetch(`/api/a0/tasks/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((x) => { if (!x || x.id !== id || typeof x.title !== "string" || typeof x.stage !== "string") throw Error("Invalid task details"); if (live) setD(x); })
      .catch(() => live && setD("failed"));
    return () => {
      live = false;
    };
  }, [id, updated]);
  return d;
}

/**
 * One task: stage dot · title (two lines) · its owner's face; the next step on one quiet line. P0 gets a red rail; the dot
 * says "building · P0" on hover. Open: his words as a quote, Next, Stage, Priority, Owner and the last 3 history lines.
 */
export function TaskLine({ t, agents = [], open, status, onToggle, onSave, tree, progress }: { tree?: ReactNode; progress?: string; t: TaskSummary; who?: boolean; agents?: Agent[]; open: boolean; status?: Status; onToggle: () => void; onSave: (e: TaskEdit) => void }) {
  const owner = ownerNames(t.owner)[0] ?? "";
  const next = nextLine(t);
  return (
    <div className={`owner-panel__task ab-task${open ? " is-open" : ""}${t.priority === "P0" ? " is-p0" : ""}`} data-testid="owner-task" data-id={t.id}>
      <button type="button" className="ab-task__line" aria-expanded={open} onClick={onToggle}>
        <i className={`ab-task__dot is-${t.stage}`} title={`${t.stage} · ${t.priority}${waits(t) ? " · needs you" : ""}`} aria-label={`${t.stage}, ${t.priority}`} />
        <span className="ab-task__copy">
          <b className="ab-task__title" data-testid="task-title">
            {t.title}
          </b>
          <small className="ab-task__meta">{t.stage} · {owner || "Unassigned"}{t.agent && canonName(t.agent) !== owner ? ` · ${t.agent}` : ""}</small>
          {progress && !open && <small className="ab-task__progress">{progress} steps done</small>}
          {next && (
            <small className="ab-task__next">
              <em>next</em> {next}
            </small>
          )}
        </span>
        <span className="ab-task__tail">
          {status?.kind === "saved" ? <CheckIcon size={14} className="owner-panel__tick" aria-label="saved" /> : (t.agent || owner) ? <OwnerFace name={t.agent ? canonName(t.agent) : owner} agents={agents} /> : <span />}
          {tree !== undefined && <ChevronRightIcon size={12} className="ab-task__fold" aria-hidden="true" />}
        </span>
      </button>
      {(open || t.stage === "preview" || t.stage === "feedback") && <TaskActions task={t} />}
      {status?.kind === "failed" && (
        <p className="owner-panel__failed" role="alert" title={status.error}>
          Not saved · <button type="button" onClick={() => onSave(status.edit)}>Retry</button>
        </p>
      )}
      {open && (tree !== undefined ? <div className="ab-task__plan">
        {tree}
        <details className="ab-task__details"><summary>Task details</summary><TaskOpen t={t} owner={owner} agents={agents} onSave={onSave} /></details>
      </div> : <TaskOpen t={t} owner={owner} agents={agents} onSave={onSave} />)}
    </div>
  );
}

function TaskOpen({ t, owner, agents, onSave }: { t: TaskSummary; owner: string; agents: Agent[]; onSave: (e: TaskEdit) => void }) {
  const d = useDetail(t.id, t.updated);
  const [dropping, setDropping] = useState(false);
  const [why, setWhy] = useState("");
  const saveNext = (value: string) => {
    const v = value.replace(/\s+/g, " ").trim();
    if (v !== (t.next ?? "")) onSave({ next: v });
  };
  const detail = d && d !== "failed" ? d : null;
  const links = Object.entries(detail?.links ?? {}).filter(([, v]) => typeof v === "string" && v);
  return (
    <div className="owner-panel__edit ab-task__open" data-testid="task-more">
      {detail?.his && <blockquote className="ab-task__his">“{detail.his}”</blockquote>}
      <fieldset className="ab-task__grid" disabled={!detail || t.source === "unavailable"}>
        <span>Next</span>
        <input key={t.next ?? ""} className="ab-task__nextin" defaultValue={t.next ?? ""} placeholder="the next step, one line" onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} onBlur={(e) => saveNext(e.currentTarget.value)} />
        <span>Stage</span>
        <div className="owner-panel__chips" role="group" aria-label="Stage">
          {FLYWHEEL.map((s) => (
            <button key={s} type="button" aria-pressed={(t.stage as string) === s || (s === "live" && t.stage === "integrated")} onClick={() => (t.stage as string) !== s && onSave({ stage: s })}>
              <i className={`ab-task__dot is-${s}`} aria-hidden="true" />
              {s}
            </button>
          ))}
        </div>
        <span>Priority</span>
        <div className="owner-panel__chips" role="group" aria-label="Priority">
          {["P0", "P1", "P2", "P3"].map((p) => (
            <button key={p} type="button" aria-pressed={t.priority === p} className={p === "P0" ? "is-p0" : undefined} onClick={() => t.priority !== p && onSave({ priority: p })}>
              {p}
            </button>
          ))}
        </div>
        {owner && (
          <>
            <span>Owner</span>
            <span className="ab-task__owner">
              <OwnerFace name={owner} agents={agents} size={16} /> {t.owner}
            </span>
          </>
        )}
        {t.agent && <><span>Executor</span><span>{t.agent}</span></>}
      </fieldset>
      {d === null && <p className="owner-panel__more-wait">Reading the task…</p>}
      {d === "failed" && <p className="owner-panel__more-wait">The task file is not readable right now.</p>}
      {detail && (detail.history ?? []).length > 0 && (
        <div className="ab-task__hist">
          {(detail.history ?? []).slice(-3).reverse().map((h, i) => (
            <p key={i} className="owner-panel__hist">
              {hhmm(h.at)} {h.by} · {h.stage}
              {h.his || h.note || h.why ? ` · ${h.his ?? h.note ?? h.why}` : ""}
            </p>
          ))}
        </div>
      )}
      {detail && <details className="ab-task__details"><summary>Evidence and full history</summary>
        {(Array.isArray(detail.evidence) ? detail.evidence : []).filter(e => typeof e === "string").map((e, i) => <p key={`e${i}`}>{e}</p>)}
        {(detail.history ?? []).map((h, i) => <p key={i}>{h.at} · {h.by} · {h.stage}{h.his || h.note || h.why ? ` · ${h.his ?? h.note ?? h.why}` : ""}{h.evidence ? ` · ${h.evidence}` : ""}</p>)}
      </details>}
      <div className="owner-panel__foot">
        {dropping ? (
          <input
            className="owner-panel__why"
            autoFocus
            value={why}
            placeholder="Why drop it? Enter drops, Esc keeps it"
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.stopPropagation(), setDropping(false));
              if (e.key === "Enter" && why.trim()) {
                onSave({ stage: "dropped", reason: why.trim() });
                setDropping(false);
                setWhy("");
              }
            }}
          />
        ) : (
          (t.stage as string) !== "dropped" && (
            <button type="button" className="owner-panel__drop" disabled={!detail || t.source === "unavailable"} onClick={() => setDropping(true)}>
              Drop
            </button>
          )
        )}
        {links.length > 0 && (
          <span className="owner-panel__links">
            {links.map(([k, v]) =>
              /^https?:\/\//.test(v!) ? (
                <a key={k} href={v!} target="_blank" rel="noreferrer">
                  {k}
                </a>
              ) : (
                <span key={k} title={v!}>
                  {k}
                </span>
              ),
            )}
          </span>
        )}
      </div>
    </div>
  );
}
