import { Icon, WidgetCard, type WidgetFile, type WidgetSize, type IconName } from "./widgets/WidgetCard";
import { NeedsWidget, type NeedsWidgetFile } from "./widgets/NeedsWidget";
import { ProgressWidget, type ProgressWidgetFile } from "./widgets/ProgressWidget";
import { TeamWidget, type TeamWidgetFile } from "./widgets/TeamWidget";
import { SystemsWidget, type SystemsWidgetFile } from "./widgets/SystemsWidget";
import { ListWidget, type ListWidgetFile } from "./widgets/ListWidget";
import { TasksWidget } from "./widgets/TasksWidget";
import { AgentFace, type AgentStatus } from "../../../../packages/halo-face";
import "./AgentZeroPage.css";
import { todayUsd, useSpend } from "../lib/spend";
import type { A0SourceStates } from "../lib/a0-widgets";

/** Mirrors the Agent Zero portion of GET /api/hub/a0. */
export type HubA0 = {
  current: { session: string; model: string; effort: string; state: "working" | "done" | "idle" | "off" };
  sessions: { id: string; started: string }[];
  goals: { day: string; title: string; quote?: string }[];
  timeline: { at: string; kind: "checkpoint" | "done" | "board"; text: string; points?: string[] }[];
  needsYou: { id: string; title: string; link?: string }[];
  tasks: { counts: Record<string, number>; running: { id: string; title: string }[] };
  memory: { title: string; file: string; hook: string }[];
  gaps: string[];
};

export type A0WidgetSet = {
  needs: NeedsWidgetFile;
  progress: ProgressWidgetFile;
  team: TeamWidgetFile;
  systems: SystemsWidgetFile;
  list: ListWidgetFile;
};

function timeLabel(value: string) {
  const time = /T(\d{2}:\d{2})/.exec(value)?.[1];
  if (time) return time;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}

function Timeline({ data }: { data: HubA0["timeline"] }) {
  return <WidgetCard
    size="M"
    title="What happened lately"
    description="My last checkpoints, newest first."
    icon="history"
    count={data.length}
    className="widget-timeline"
  >
    <ol className="widget-timeline__rows">{data.slice(0, 8).map((entry, index) => <li className={`is-${entry.kind}`} key={`${entry.at}-${entry.kind}-${index}`}>
      <span className="widget-timeline__mark"><Icon name={entry.kind === "done" ? "check-circle" : entry.kind === "board" ? "radio" : "history"} size={12} /></span>
      <div><span className="widget-list__meta">{timeLabel(entry.at)} · {entry.kind}</span><p>{entry.text}</p>{entry.points?.length ? <small>{entry.points.join(" · ")}</small> : null}</div>
    </li>)}</ol>
    {!data.length && <p className="siso-widget__empty">No checkpoints yet.</p>}
  </WidgetCard>;
}

function Missing({ gaps }: { gaps: HubA0["gaps"] }) {
  return <WidgetCard
    size="M"
    title="What I know I'm missing"
    description="Say out loud what else is missing; it lands in my goals."
    icon="search"
    count={gaps.length}
    className="widget-missing"
  >
    {gaps.length ? <ul className="widget-missing__rows">{gaps.map((gap) => <li key={gap}><Icon name="badge-alert" size={13} /><span>{gap}</span></li>)}</ul> : <p className="siso-widget__empty">No known gaps.</p>}
  </WidgetCard>;
}

/** R1.15: today's fleet spend, the same figure as the top bar's chip. */
function SpendTile() {
  const today = todayUsd(useSpend());
  return <WidgetCard size="S" title="Spend today" description="Today's fleet spend" icon="coins" metric={today ?? "—"} label={today ? "spent today, Claude at API prices" : "spend today · waiting on EFFICIENCY's meter"} className="spend-widget" />;
}

function PendingWidget({ size, title, icon, unavailable }: { size: WidgetSize; title: string; icon: IconName; unavailable: boolean }) {
  const status = unavailable ? "Data unavailable. Trying again shortly." : "Loading…";
  return <WidgetCard size={size} title={title} description={status} icon={icon} metric="—" label={`${title} · ${status}`} count={unavailable ? "unavailable" : "loading"}><p className="siso-widget__empty">{status}</p></WidgetCard>;
}

export function AgentZeroPage({ data, widgets, sources, onTasksPage }: { data: HubA0; widgets: A0WidgetSet; sources?: A0SourceStates; onTasksPage?: () => void }) {
  const teamReady = !sources || sources.team === "ready" || sources.team === "stale";
  const systemsReady = !sources || sources.systems === "ready" || sources.systems === "stale";
  const state = data.current.state === "off" ? "Not running" : data.current.state === "done" ? "Turn done" : data.current.state[0].toUpperCase() + data.current.state.slice(1);
  const faceStatus: AgentStatus = data.current.state === "working" ? "working" : data.current.state === "off" ? "offline" : "waiting";
  return <main className="agent-zero-page" data-testid="agent-zero-page" data-ab-comp="agent-zero-board">
    <div className="a0-workspace"><div className="a0-main-column"><header className="a0-hero">
      <div className="a0-hero__face"><span className="a0-hero__ring" /><AgentFace name="Agent Zero" project="Agent Zero" hue={75} status={faceStatus} size={72} track interactive /></div>
      <div className="a0-hero__identity">
        <div className={`a0-eyebrow is-${data.current.state}`}><i />Agent Zero · {state}</div>
        <h1>Here's where everything stands</h1>
        <p>I run the owners and keep your goals. Top: what needs you. Then what I'm running, how far it is, and the machines.</p>
        <span className="a0-session">Chat {data.current.session} · {data.current.model} · effort {data.current.effort}</span>
      </div>
      <div className="a0-hero__widgets" aria-label="Agent Zero summary widgets">
        <NeedsWidget widget={widgets.needs} size="S" />
        {teamReady ? <TeamWidget widget={widgets.team} size="S" /> : <PendingWidget size="S" title="Who A0 runs" icon="users-round" unavailable={sources?.team === "unavailable"} />}
        <TasksWidget size="S" onTasksPage={onTasksPage} />
        <SpendTile />
      </div>
    </header>

    <div className="a0-widget-grid">
      <div className="a0-span-12"><NeedsWidget widget={widgets.needs} size="L" /></div>
      <div className="a0-span-6">{teamReady ? <TeamWidget widget={widgets.team} size="M" /> : <PendingWidget size="M" title="Who A0 runs" icon="users-round" unavailable={sources?.team === "unavailable"} />}</div>
      <div className="a0-span-6">{teamReady ? <ProgressWidget widget={widgets.progress} size="M" /> : <PendingWidget size="M" title="How far the plan is" icon="rocket" unavailable={sources?.team === "unavailable"} />}</div>
      <div className="a0-span-6"><ListWidget widget={widgets.list} size="M" /></div>
      <div className="a0-span-8"><Timeline data={data.timeline} /></div>
      <div className="a0-span-4"><Missing gaps={data.gaps} /></div>
    </div>
    </div><aside className="a0-right-column" aria-label="Agent Zero task and machine panels">
      <TasksWidget size="L" onTasksPage={onTasksPage} />
      {systemsReady ? <SystemsWidget widget={widgets.systems} size="M" /> : <PendingWidget size="M" title="How the machines are" icon="server" unavailable={sources?.systems === "unavailable"} />}
    </aside></div>
  </main>;
}

/** Used by the widget preview to exercise an unrecognized JSON shape without crashing. */
export type { WidgetFile };
