import { AsleepLine, type SleepView } from './AsleepLine';
import { useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { inPortal } from "@siso/shell";
import { MessageSquare, MessageSquareDashed, Cpu, Sparkles, Pencil } from "lucide-react";
import { useIntentHover } from "./hoverIntent";
import "./AgentHoverCard.css";
import { AgentFace } from "../lib/face";
import { MachineGlyph } from "./MachineGlyph";

export type AgentHoverCardAgent = {
  sleep?: SleepView;
  sleepPolicy?: { keepAwake?: boolean; idleSince?: number | null; idleSleepMin?: number | null };
  name: string;
  kind: "owner" | "worker" | "zero";
  project: string;
  owner?: string;
  role?: string;
  accent: string;
  /** The project the face is coloured by when it differs from the one shown (an unsorted agent). */
  faceProject?: string;
  harness: "claude" | "codex" | "siso" | "herdr";
  model: string;
  machine: string;
  /** The machine's estate key: its glyph (R1.4). */
  machineKey?: string;
  state: "working" | "done" | "idle" | "off";
  holding?: { id: string; title: string; status: "asked" | "specced" | "allocated" | "building" | "built" | "checked" | "parked" | "dropped" } | null;
  lastReport?: { at: string; ageMin: number; text: string; log: string } | null;
  plan?: { checked: number; total: number; counts: Record<"asked" | "specced" | "allocated" | "building" | "built" | "checked" | "parked" | "dropped", number> } | null;
};

type HoverCardStyle = CSSProperties & { "--agent-accent": string };

const stateLabel = { working: "Working", done: "Turn done", idle: "Idle", off: "Not running" };
const states = ["asked", "specced", "allocated", "building", "built", "checked", "parked", "dropped"] as const;
const prettyHarness = { claude: "Claude Code", codex: "Codex", siso: "SISO", herdr: "herdr" };

function ageLabel(age: number) {
  if (age < 1) return "just now";
  if (age < 60) return `${age} min ago`;
  const hours = Math.floor(age / 60);
  const minutes = age % 60;
  return minutes ? `${hours} h ${minutes} min ago` : `${hours} h ago`;
}

const FACE = { working: "working", done: "done", idle: "waiting", off: "offline" } as const;

/** What the card lets him change in place (t-0269, "I love how you can edit stuff like that"), saved to the agent table. */
export type CardEdit = { name: string; role: string | null; domain: string | null; onSave: (field: "name" | "role" | "domain", value: string) => void };

/**
 * One field edited in place, as the chat header's name and the Agent Zero switcher do it: a click turns it into an input,
 * Enter saves, Esc or a click away keeps what was there. It shows the saved words at once, before the table answers.
 */
function CardField({ field, value, placeholder, label, onSave }: { field: "name" | "role" | "domain"; value: string | null; placeholder: string; label: string; onSave: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<{ from: string | null; to: string } | null>(null);
  const shown = saved && saved.from === value ? saved.to : value;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (editing)
    return <input className={`ab-hover-edit is-${field}`} autoFocus defaultValue={shown ?? ""} placeholder={placeholder} aria-label={label} data-testid={`card-edit-${field}-input`} maxLength={field === "role" ? 200 : 80}
      onPointerDown={stop} onClick={stop}
      onKeyDown={(e) => {
        // Its keys stay in the field: Esc must not close the card, nor Space and Enter pick up the row to drag.
        e.stopPropagation();
        if (e.key === "Escape") setEditing(false);
        if (e.key === "Enter") {
          const to = e.currentTarget.value.trim();
          if (to !== (shown ?? "") && (to || field !== "name")) (setSaved({ from: value, to }), onSave(to));
          setEditing(false);
        }
      }}
      onBlur={() => setEditing(false)} />;
  return <button type="button" className={`ab-hover-field is-${field}${shown ? "" : " is-empty"}`} title={`${label}: click to change`} aria-label={`${label}: ${shown || "not set"}, click to change`} data-testid={`card-edit-${field}`}
    onPointerDown={stop} onClick={(e) => (e.stopPropagation(), setEditing(true))}>
    <span>{shown || placeholder}</span><Pencil size={10} aria-hidden="true" />
  </button>;
}

/** `row`: the trigger is a whole side-nav row (a block, and the row itself takes focus). */
/** `extra`: sections the side nav adds (its workers, limits and buttons; sidenav spec "Hover card"). */
/** `edit`: the name, role line and domain become fields he can change in place. */
export function AgentHoverCard({ agent, children, preview = false, row = false, extra, edit, side, details }: { agent: AgentHoverCardAgent; children?: ReactNode; preview?: boolean; row?: boolean; extra?: ReactNode; edit?: CardEdit; side?: "left"; details?: ReactNode }) {
  // One shared engine for every agent card: 120 ms intent, instant swap between agents, a grace period, Esc (hoverIntent.ts).
  const hover = useIntentHover<HTMLSpanElement>({ label: "Agent details", side, enabled: !preview });
  const plan = agent.plan;
  const model = agent.model && agent.model !== "—" && agent.model.toLowerCase() !== agent.harness && agent.model !== prettyHarness[agent.harness] ? agent.model : null;
  // Nothing held, nothing reported, no plan: one line instead of three empty sections.
  const idle = !agent.holding && !agent.lastReport && !(agent.kind === "owner" && plan?.total);
  // Over ~240 characters the last message is cut at four lines; the card says where the rest is.
  const long = (agent.lastReport?.text.length ?? 0) > 240;
  const relationship = agent.kind === "worker" ? `Crew · reports to ${agent.owner ?? "—"}` : agent.kind === "zero" ? "Agent Zero" : `Owner · ${agent.project}`;
  return <>
    <span className={`ab-hover-trigger${row ? " is-row" : ""}`} tabIndex={row ? undefined : 0} {...hover.triggerProps}>{children ?? agent.name}</span>
    {hover.open && !preview && createPortal(<div className="ab-hover-bridge" {...hover.bridge} />, document.body)}
    {(preview || hover.open) && inPortal(!preview, <div className={`siso-hovercard ab-hover-card${preview ? " is-preview" : ""}`} style={{ ...hover.style, ...(preview ? { position: "relative", left: "auto", top: "auto", visibility: "visible" } : {}), "--agent-accent": agent.accent } as HoverCardStyle} {...(preview ? {} : hover.cardProps)}>
      <header className="ab-hover-head">
        <div className="ab-hover-face is-agent"><AgentFace name={agent.name} project={agent.faceProject ?? agent.project} status={FACE[agent.state]} paused={!!agent.sleep} size={44} /><span className="ab-hover-harness" aria-label={prettyHarness[agent.harness]}><Sparkles size={11} /></span></div>
        {edit ? <div className="ab-hover-identity">
          <strong><CardField field="name" value={edit.name} placeholder="Name" label="Name" onSave={(v) => edit.onSave("name", v)} /></strong>
          <span>{relationship}</span>
          <CardField field="role" value={edit.role} placeholder="Add what it does" label="Role" onSave={(v) => edit.onSave("role", v)} />
        </div> : <div className="ab-hover-identity"><strong>{agent.name}</strong><span>{relationship}</span></div>}
        <span className={`ab-hover-state is-${agent.state}`}><i />{agent.sleep ? "Asleep" : stateLabel[agent.state]}</span>
      </header>
      {agent.sleep && <AsleepLine sleep={agent.sleep} />}
      {!agent.sleep && agent.sleepPolicy?.keepAwake && <p className="ab-asleep-line">Kept awake</p>}
      {!agent.sleep && !agent.sleepPolicy?.keepAwake && agent.sleepPolicy?.idleSince && !!agent.sleepPolicy.idleSleepMin && agent.state === 'idle' && <p className="ab-asleep-line">Sleeps in {Math.max(0,Math.ceil((agent.sleepPolicy.idleSince + agent.sleepPolicy.idleSleepMin * 60000 - Date.now())/60000))} min after its last answer</p>}
      <div className="ab-hover-facts">
        {/* harness · model · machine (R1.14): the model only when it is one, not the tool's name again ("claude" beside "Claude Code"). */}
        <span><Sparkles size={13} />{prettyHarness[agent.harness]}</span>{model && <span data-testid="hover-model"><Cpu size={13} />{model}</span>}<span><MachineGlyph machineKey={agent.machineKey} name={agent.machine} size={13} />{agent.machine}</span>
      </div>
      {edit && agent.kind !== "zero" && <div className="ab-hover-domain"><span className="ab-hover-label">Domain</span><CardField field="domain" value={edit.domain} placeholder="Add its domain" label="Domain" onSave={(v) => edit.onSave("domain", v)} /></div>}
      {details ?? (idle ? <div className="ab-hover-empty is-nochat" data-testid="hover-idle"><MessageSquareDashed size={14} aria-hidden="true" /><span><b>No chat yet</b>Nothing on its plate. Click to start one.</span></div> : <>
      <section className="ab-hover-section"><div className="ab-hover-label">Now</div>
        <div className="ab-hover-now">{agent.holding ? <><span className={`ab-plan-chip is-${agent.holding.status}`}>{agent.holding.id} · {agent.holding.status}</span><p>{agent.holding.title}</p></> : <p className="is-muted">No plan item assigned</p>}</div>
      </section>
      <section className="ab-hover-section"><div className="ab-hover-label">Last report</div>
        {/* A working agent's report changes while the card is open: the words fade in place (keyed), the card never jumps. */}
        {agent.lastReport ? <div className={`ab-hover-report${agent.state === "working" ? " is-live" : ""}`} data-testid="hover-report"><span><MessageSquare size={12} />{agent.lastReport.at} · {ageLabel(agent.lastReport.ageMin)}{agent.state === "working" && <em className="ab-hover-live">Live</em>}</span><p key={agent.lastReport.text} title={long ? agent.lastReport.text : undefined}>{agent.lastReport.text}</p>{long && <small className="ab-hover-more">The rest is in its chat</small>}</div> : <div className="ab-hover-empty">No report yet</div>}
      </section>
      {agent.kind === "owner" && <div className="ab-hover-plan"><span>{plan ? `${plan.checked} of ${plan.total} checked` : "Plan not available"}</span>{plan && <div className="ab-hover-stack" aria-label={`${plan.checked} of ${plan.total} plan items checked`}>{states.map((state) => plan.counts[state] > 0 && <i key={state} className={`is-${state}`} style={{ flex: plan.counts[state] }} title={`${plan.counts[state]} ${state}`} />)}</div>}</div>}
      </>)}
      {extra}
      {!extra && <div className="ab-hover-foot">Click to open · chat, plan and pages</div>}
    </div>)}
  </>;
}
