import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";
import { AgentFace, type AgentStatus } from "../../../../../packages/halo-face";

export type TeamMember = {
  name: string;
  state: "working" | "done" | "idle" | "off";
  model: string;
  task: string;
  project?: string;
  lastReport?: { at: string; text: string } | null;
};
export type TeamWidgetFile = WidgetFile<"team", { members: TeamMember[] }>;

const faceHue = (project?: string) => /halo/i.test(project ?? "") ? 325 : /fahmy/i.test(project ?? "") ? 215 : /agent base/i.test(project ?? "") ? 190 : /efficiency/i.test(project ?? "") ? 268 : /health/i.test(project ?? "") ? 145 : 75;
const faceStatus = (state: TeamMember["state"]): AgentStatus => state === "working" ? "working" : state === "off" ? "offline" : "waiting";

function age(at?: string | null) {
  if (!at) return "no report yet";
  const date = new Date(at);
  if (Number.isNaN(date.valueOf())) return "time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

export function TeamWidget({ widget, size }: { widget: TeamWidgetFile; size: WidgetSize }) {
  const members = widget.data.members;
  const working = members.filter((member) => member.state === "working").length;
  return <WidgetCard
    size={size}
    title="Who A0 runs"
    description="The owners under Agent Zero and what each is on now."
    icon="users-round"
    count={`${working} working`}
    metric={members.length}
    label={`owners · ${working} working`}
    tileExtra={<span className="widget-team__faces">{members.map((member) => <AgentFace key={member.name} name={member.name} project={member.project ?? "Agent Zero"} hue={faceHue(member.project)} status={faceStatus(member.state)} size={19} title={member.name} />)}</span>}
    className="widget-team"
  >
    <ul className="widget-list widget-team__list">{(size === "L" ? members : members.slice(0, 4)).map((member) => <li key={member.name}>
      <AgentFace className="widget-team__face" name={member.name} project={member.project ?? "Agent Zero"} hue={faceHue(member.project)} status={faceStatus(member.state)} size={34} title={`${member.name} · ${member.state}`} />
      <div className="widget-team__copy"><div className="widget-team__row-head"><b>{member.name}</b><span className={`widget-team__state is-${member.state}`}>{member.state === "done" ? "Turn done" : member.state === "off" ? "Not running" : member.state}</span></div>
        <span className="widget-team__task">{member.task || "—"}</span>
        {size === "L" && <span className="widget-list__meta">{member.model || "Model unknown"} · last report {age(member.lastReport?.at)}</span>}
      </div>
    </li>)}</ul>
  </WidgetCard>;
}
