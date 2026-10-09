import type { ConversationPinTarget } from "../../../../services/node/src/conversation-route";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDownIcon, ChevronDownIcon, DicesIcon, PanelRightIcon, PencilIcon } from "lucide-react";
import { HaloRim, MenuButton, type MenuItem } from "@siso/shell";
import type { MoveStatus } from "../../../../services/node/src/move";
import type { Agent, NavState, Org } from "../lib/agents";
import { AgentFace, faceFor, projectHue } from "../lib/face";
import { MOVE_OPTIONS } from "./MoveMenu";
import { MachineGlyph, machineKind } from "./MachineGlyph";
import { useLive } from "../lib/chatLive";
import "./ChatHeader.css";

/**
 * The chat header as a capsule, the input bar's twin (ui-hub/chat-header; Shaan 4 Oct 14:26: "it could be redesigned so
 * much nicer ... wrapped in its own circular thing like the input chat"). It answers two questions at a glance: whose
 * chat this is, and what it is doing right now (from the chat's own host, the same source as the input bar). Line 2 says
 * what it is on, in the agent's own words (its terminal title or plan item), so the description follows its work. The
 * rim is @siso/shell's HaloRim in the agent's colour: turning while it works, amber while it needs him, still when idle.
 * Name and state are centred on line 1; line 2 is the current step or plan/title, then project. Never reply text.
 * No Tasks pill: that is the panel's.
 * ✎ opens its card (name, Randomize). Rare actions (terminal, pin, move, its page, session id) are a right-click away.
 */
export type HeaderProps = {
  a: Agent;
  conversationTarget?: ConversationPinTarget;
  state: NavState;
  /** What it holds now (plan item, else its herdr title), at most 8 words; "" when nothing says. */
  doing: string;
  /** Plan item or meaningful terminal title only; never chat reply text. */
  onIt: string;
  /** When it needs him: the newest needing ping's or task's `needs`. */
  needText: string | null;
  move: MoveStatus | null;
  tasks: { open: number; needs: number } | null;
  tasksOpen: boolean;
  onTasks: () => void;
  /** null: no chat for this agent (terminal only). */
  view: "chat" | "terminal" | null;
  onView: (v: "chat" | "terminal") => void;
  cardOpen: boolean;
  onCard: () => void;
  /** With the panel closed: its pages as one "N pages" chip (pagestrip SPEC §0a, R1). */
  pagesChip?: ReactNode;
  /** Pages in its panel (dropped + pinned): shown as a count on the panel button (Shaan 3 Oct: '30 pages' alone read as nothing). */
  pageCount?: number;
  /** Agent Zero only: today's scratch pad chip (Scratchpad.tsx). */
  scratch?: ReactNode;
  renaming: boolean;
  onRenameStart: () => void;
  onRename: (to: string | null) => void;
  pinned: boolean;
  pinUnavailable?: boolean;
  pinLabel?: string;
  onPin: () => void;
  /** Move to the app's chat (CLI Claude agents only). */
  toHost: { busy: boolean; why: string | null; error?: string | null; go: () => void } | null;
  onOpenPage: () => void;
  onAnswer: () => void;
  now: number;
  /** R1.7 the chain of command: who stands above it and who it commands. */
  org: Org | null;
  agents: Agent[];
  onOpenAgent: (a: Agent) => void;
  onOrgChart: () => void;
  /** Doing-now for any agent (the header's own line 2 rule): its plan item, else a title that says something. */
  doingOf: (a: Agent) => string;
};

/**
 * t-0532 item 3 / t-0530 (Shaan, 8 Oct ~10:05: "an arrow ... where they can see the other agents in the fleet ... click on
 * them and it like swaps to them"): the fleet this chat belongs to, owner first, then its running helpers. A helper's fleet
 * is its owner's. Only parents the node actually found count (an unowned job is not Agent Zero's crew by default).
 */
export function fleetOf(a: Agent, agents: Agent[]): { lead: Agent; crew: Agent[] } | null {
  const lead = (a.parentId && agents.find(x => x.id === a.parentId && !x.zero && a.ownershipResolved !== false)) || a;
  const crew = agents.filter(x => x.id !== lead.id && x.parentId === lead.id && x.ownershipResolved !== false && x.row === "live" && !x.finished);
  return crew.length ? { lead, crew } : null;
}

const ago = (ms: number) => {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};
/** Markdown as he would read it: a link is its text, no **, backticks or heading marks (line 2 is plain text). */
export const plain = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/(\*\*|__|`+)/g, "")
    .replace(/^\s*(#{1,6}|>)\s*/gm, "");
const words = (s: string, n = 8) => {
  const w = plain(s).replace(/\s+/g, " ").trim().split(" ");
  return w.length > n ? `${w.slice(0, n).join(" ")}…` : w.join(" ");
};
const moveLabel = (to?: string) => (MOVE_OPTIONS.find((o) => o.id === to)?.label ?? "the new model").replace(/^Claude /, "");

/** The state line: [tone, word, rest]. */
function stateLine(p: HeaderProps): [string, string, string] {
  const { a, state, needText, move, now } = p;
  if (p.conversationTarget) return ["idle", "Pinned conversation", ""];
  const doing = p.onIt ? words(p.onIt) : "";
  if (move && (move.state === "moving" || move.state === "queued" || move.state === "waiting-idle"))
    return ["moving", `Moving to ${moveLabel(move.to)}…`, move.state === "waiting-idle" ? "once this turn ends" : ""];
  if (move?.state === "failed") return ["failed", "Move failed", move.message ?? ""];
  const since = a.since ? now - a.since : 0;
  switch (state) {
    case "needs":
      return ["needs", "Needs you", needText ? words(needText, 12) : "waiting on you"];
    case "working":
      return ["working", "Working", doing];
    case "quiet":
      return ["quiet", `Quiet · ${ago(now - (a.lastEvent ?? now))}`, doing];
    case "done":
      return ["done", `Turn done · ${ago(since)}${ago(since) === "now" ? "" : " ago"}`, doing];
    case "failed":
      return ["failed", "Stuck", doing];
    case "offline":
      return ["idle", "Off", ""];
    default:
      return ["idle", a.since ? `Idle · ${ago(since)}` : "Idle", doing];
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
// The agent's own colour (its card's Randomize), kept per name on this machine; projectHue until he picks one.
const hueKey = (name: string) => `agent-base:face-hue:${name}`;
const readHue = (name: string) => {
  const key = hueKey(name);
  let saved: string | null;
  try { saved = localStorage.getItem(key); } catch { return null; }
  const v = Number(saved);
  return saved !== null && Number.isFinite(v) ? v : null;
};
// Red, orange and amber mean "blocked" and "needs you" (halo-face's rule), so a random colour never lands there.
const randomHue = () => (55 + Math.floor(Math.random() * 285)) % 360;

export function ChatHeader(p: HeaderProps) {
  const { a } = p;
  const observedLive = useLive(a.id);
  const live = p.conversationTarget ? null : observedLive;
  const [hue, setHue] = useState<number | null>(() => readHue(a.name));
  const [card, setCard] = useState(false);
  const [draft, setDraft] = useState(a.name);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [archived, setArchived] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setHue(readHue(a.name)); setCard(false); setMenu(null); setDraft(a.name); }, [a.id, a.name]);
  useEffect(() => {
    if (!card && !menu) return;
    const away = (e: PointerEvent) => !root.current?.querySelector(".ab-cap__pop, .ab-cap__menu")?.contains(e.target as Node) && (setCard(false), setMenu(null));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setCard(false), setMenu(null));
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => (window.removeEventListener("pointerdown", away), window.removeEventListener("keydown", esc));
  }, [card, menu]);

  // What it is doing: the chat's live state when the chat is open (the host), else herdr's row (stateLine).
  let [tone, word] = stateLine(p);
  const fleet = p.conversationTarget ? null : fleetOf(a, p.agents);
  const fleetRow = (x: Agent, note: string) => <span className="ab-fleet__row"><AgentFace {...faceFor(x)} size={16} /><b>{x.name}</b><small>{note}</small></span>;
  const fleetItems = (): MenuItem[] => !fleet ? [] : [
    { key: fleet.lead.id, label: fleetRow(fleet.lead, `owner · ${fleet.crew.length + 1}`), current: fleet.lead.id === a.id, onSelect: () => p.onOpenAgent(fleet.lead) },
    ...fleet.crew.slice(0, 12).map((x): MenuItem => ({ key: x.id, label: fleetRow(x, x.status === "working" ? "working" : x.status === "needs" ? "needs you" : ""), current: x.id === a.id, onSelect: () => p.onOpenAgent(x) })),
    ...(fleet.crew.length > 12 ? [{ key: "more", label: `+${fleet.crew.length - 12} more in the Agents list`, disabled: true }] : []),
  ];
  let since = tone === "working" && a.since ? clock(p.now - a.since) : "";
  const moving = p.move && p.move.state !== "done";
  if (live && !moving && p.state !== "needs") {
    if (live.state === "working") (tone = "working"), (word = "Working"), (since = live.turnAt ? clock(p.now - live.turnAt) : "");
    else if (live.state === "blocked") (tone = "needs"), (word = "Needs you"), (since = "");
    else (tone = "idle"), (word = a.lastEvent ? `Idle · ${ago(p.now - a.lastEvent)}` : "Idle"), (since = "");
  }
  const answer = tone === "needs";
  const rimHue = `hsl(${hue ?? projectHue(a.project ?? a.name)} 85% 62%)`;
  const face = faceFor(a);
  // Use the live tool step while working, otherwise the plan/title supplied by App. Replies never enter here.
  // Claude Code titles carry a spinner glyph (✳, ⠂) in front; needs-you shows its question instead.
  const about = p.conversationTarget ? `${p.conversationTarget.machine} · ${p.conversationTarget.harness} · session ${p.conversationTarget.session}` : plain(tone === "needs" && p.needText ? words(p.needText, 12) : tone === "working" && live?.step ? live.step : p.onIt).replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
  const where = about ? [about, a.project].filter(Boolean).join(" · ") : "";
  const save = () => {
    const to = draft.trim();
    if (!p.conversationTarget && !a.zero && to && to !== a.name) p.onRename(to);
    setCard(false);
  };
  const roll = () => { const h = randomHue(); setHue(h); localStorage.setItem(hueKey(a.name), String(h)); };
  const item = (label: string, on: () => void, extra: Record<string, unknown> = {}) => (
    <button type="button" role="menuitem" className="ab-cap__mi" onClick={() => (setMenu(null), on())} {...extra}>{label}</button>
  );

  return (
    <div className="ab-cap-strip" data-testid="chat-head" data-state={tone} ref={root}>
      <HaloRim
        state={tone === "working" || tone === "moving" ? "working" : "idle"}
        hue={answer ? "#f5b544" : rimHue}
        className={`ab-cap is-${tone}`}
        data-ab-comp="chat-header"
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <button type="button" className="ab-cap__face" title={a.zero ? a.name : "Its card: name and colour"} onClick={() => setCard((v) => !v)}>
          <AgentFace {...face} hue={hue ?? undefined} status={answer ? "needs-shaan" : face.status} size={34} />
        </button>
        <div className="ab-cap__text">
          <div className="ab-cap__l1">
            <span className="ab-cap__identity">
              <span className="ab-head__name" title={[a.name, a.branch].filter(Boolean).join(" · ")}>{a.name}</span>
              <button type="button" className="ab-cap__pen" aria-label="Rename, new colour" title="Rename · new colour" onClick={() => setCard((v) => !v)}><PencilIcon size={12} /></button>
              {fleet && <MenuButton label={`${fleet.lead.name}'s fleet: ${fleet.crew.length + 1} agents`} className="ab-cap__fleet" menuClassName="ab-fleet__menu" items={fleetItems}><ChevronDownIcon size={14} aria-hidden /></MenuButton>}
            </span>
            {/* t-0549 (Shaan via Agent Zero, 8 Oct: "make your chat header and fleet row say 'Mac mini' so one click tells him"):
                a chat running off this machine names where it runs. */}
            {a.away && machineKind(a.machineKey) && (
              <span className="ab-cap__machine" data-testid="chat-head-machine" title={`Runs on ${a.machine || a.machineKey}`}>
                <MachineGlyph machineKey={a.machineKey} name={a.machine} size={12} />{a.machine || a.machineKey}
              </span>
            )}
            {/* t-0532 item 2 (Shaan, 8 Oct ~10:15: "get rid of where it says idle seven minutes"): calm says nothing, like Codex;
                working, needs you and failures still show, and the face carries the state either way. */}
            {tone !== "idle" && <span className="ab-cap__state" data-testid="chat-head-state">
              <i className="ab-cap__dot" aria-hidden />
              <span className="ab-cap__word">{word}{since && ` · ${since}`}</span>
            </span>}
          </div>
          {where && <div className="ab-cap__l2"><span className="ab-cap__on" title={where}>{where}</span></div>}
          {archived && <span className="ab-cap__rest" role="status">{archived}</span>}
        </div>
        <div className="ab-cap__right">
          {answer && (
            <button type="button" className="ab-cap__answer" data-testid="chat-answer" aria-label="Answer" title="Answer: jump to its question" onClick={p.onAnswer}>
              <ArrowDownIcon size={13} aria-hidden /> Answer
            </button>
          )}
          {!p.conversationTarget && p.scratch}
          {!p.conversationTarget && p.pagesChip}
          {!p.conversationTarget && <button type="button" className="ab-cap__icon" data-testid="chat-panel-toggle" aria-pressed={p.cardOpen} aria-label="Side panel · ⌘⇧B" title="Side panel · ⌘⇧B" onClick={p.onCard}>
            <PanelRightIcon size={15} />
          </button>}
        </div>
      </HaloRim>
      {card && (
        <div className="ab-cap__pop" role="dialog" aria-label={`${a.name}'s card`} style={{ "--cap-hue": rimHue } as CSSProperties}>
          <div className="ab-cap__big"><AgentFace {...face} hue={hue ?? undefined} status="waiting" size={84} /></div>
          <input className="ab-cap__input" value={draft} disabled={a.zero || !!p.conversationTarget} aria-label="Name" autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          <div className="ab-cap__foot">
            <button type="button" className="ab-cap__roll" onClick={roll}><DicesIcon size={14} /> Randomize</button>
            <button type="button" className="ab-cap__done" onClick={save}>Done</button>
          </div>
          <p className="ab-cap__soon">Colour for now. Heads, eyes and ears come when the face kit has parts.</p>
        </div>
      )}
      {menu && (
        <div className="ab-cap__menu" role="menu" aria-label={`${a.name} menu`} style={{ left: menu.x, top: menu.y }}>
          <div className="ab-cap__menu-head">{a.name}{a.branch && <> · <span className="ab-cap__branch" data-testid="chat-head-branch" title={a.branch}>{a.branch}</span></>}</div>
          {p.tasks && item(`Tasks · ${p.tasks.needs > 0 ? `${p.tasks.needs} need you` : `${p.tasks.open} open`}`, p.onTasks, { "data-testid": "chat-tasks" })}
          {p.view && item(p.view === "chat" ? "Show the terminal" : "Show the chat", () => p.onView(p.view === "chat" ? "terminal" : "chat"), { "data-testid": "chat-view-toggle" })}
          {!a.zero && item(p.pinLabel ?? (p.pinUnavailable ? "Pin target unavailable" : p.pinned ? "Unpin" : "Pin under Agent Zero"), p.onPin, { disabled: p.pinUnavailable })}
          {p.toHost && item(p.toHost.busy ? "Moving…" : p.toHost.error ? `Move to the app's chat · ${p.toHost.error}` : "Move to the app's chat", p.toHost.go, { disabled: p.toHost.busy || !!p.toHost.why, title: p.toHost.why ?? undefined })}
          {!p.conversationTarget && a.workspaceId && item("Archive worktree", () => void fetch(`/api/workspaces/${a.workspaceId}/archive`, { method: "POST" }).then(async (r) => { const d = await r.json(); setArchived(r.ok ? "Archived worktree" : d.error); }).catch(() => setArchived("No answer from the node")))}
          {item("Open its page", p.onOpenPage)}
          {a.session && item(copied ? "Copied" : "Copy session id", () => void navigator.clipboard?.writeText(a.session ?? "").then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1500))))}
        </div>
      )}
    </div>
  );
}
