import { useSharedState } from "../lib/poll";
import { usageAge } from "../lib/usage-age";
import { LivingIcon, WorkspaceMark, type LivingIconName } from "../../../../packages/halo-face/living-assets";
import { useLive } from "../lib/chatLive";
import {
  AlarmClockOffIcon,
  MoonIcon,
  BotIcon,
  Building2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FactoryIcon,
  FlaskConicalIcon,
  FolderIcon,
  FolderInputIcon,
  LayoutGridIcon,
  ListChecksIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
  UsersIcon,
  NetworkIcon,
  XIcon,
  PaletteIcon,
} from "lucide-react";
import { HaloRim, HoverCard, MenuButton, load, save, useOutsideClose, type MenuItem } from "@siso/shell";
import {
  ProjectGroup,
  Shelf,
  SideNav,
  SideSection,
  SortableRail,
  StatusSlot,
  ThreadRow,
  formatAge,
  type ThreadMark,
} from "@siso/side-nav";
import { Fragment, useMemo, useRef, useState, useCallback, useLayoutEffect, type ReactNode, type CSSProperties, useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtDuration } from "../lib/chat";
import { Icon } from "../lib/Icon";
import {
  type Agent,
  type NavState,
  type PinView,
  type Org,
  type OrgFolder,
  type OrgItem,
  type OrgOp,
  type OrgProject,
  type RegistryEdit,
  type RowAction,
  type Team,
  doingNow,
  formatWake,
  folderCount,
  foldedSummary,
  isUnseenDone,
  layout,
  navState,
  slotText,
} from "../lib/agents";
import { canonName, ownerNames } from "../lib/a0-tasks";
import { AgentFace, faceFor } from "../lib/face";
import { hoverAgent, useHubAgents } from "../lib/hub";
import { MachineGlyph, machineKind } from "./MachineGlyph";
import "./ZeroSwitcher.css";
import { WorkspaceChoices } from "./WorkspaceChoices";
import type { WorkspaceChoice } from "../lib/agents";
import { SayNew, type SaidStart } from "./SayNew";
import { AgentHoverCard, type CardEdit } from "./AgentHoverCard";
import { ProjectMark } from "./ProjectMark";
import { placeStrays } from "../lib/place";
import { WorkerFold } from "./WorkerFold";
import type { Ended } from "../lib/ended";
import { inWorkspace, navHome, type NavWorkspace } from "../lib/workspace-nav";
import { A0Nav } from "./A0Nav";
import "./Ended.css";
import "./PinnedOwner.css";

type FleetBoardData = { groups?: { id: string; rows: { id: string; name: string; title?: string; status: string; crewParentId?: string }[] }[] };
const FLEET_BOARD_MS = 10_000;
import { agentPinLabel, canEditAgentPin, toggleAgentPin } from "../lib/pin-actions";
import { readyPinAgent, pinStateLabel, pinTargetDescription } from "../lib/pin-view";
import type { ConversationPinTarget } from "../../../../services/node/src/conversation-route";

/** The one mark a row shows: the turning ring while working, a dot for needs you, done or failed, nothing when quiet. */
export function markOf(a: Agent): ThreadMark {
  if (a.status === "working") return "working";
  if (a.status === "needs") return "needs";
  if (a.status === "failed") return "failed";
  if (isUnseenDone(a)) return "done";
  return "quiet";
}
export const WORD: Record<ThreadMark, string> = {
  working: "Working",
  needs: "Needs you",
  failed: "Failed",
  done: "Done",
  quiet: "Idle",
};

/** A lead shows the loudest mark of its team, so a crew member waiting on him is never lost in the list. */
const LOUD: ThreadMark[] = ["needs", "failed", "done", "working", "quiet"];
const teamMark = (t: Team): ThreadMark =>
  [t.lead, ...t.crew]
    .map(markOf)
    .sort((x, y) => LOUD.indexOf(x) - LOUD.indexOf(y))[0];

/**
 * Screen 1's side nav, option B (2 Oct): the space switcher (the SISO mark, Agent Base ▾), his pinned agents, then each
 * domain as a folder that opens and closes, each lead with its crew under it, then the shelves. Machines have their own
 * rail page (ServersSpace) since he asked for "servers … its own icon". Hover gives ⋯: Pin, Move to… (the domains), Settle.
 */
export function Sidebar(props: {
  workspaces?: NavWorkspace[];
  onWorkspace?: (id: string) => void;
  onFleet?: (id: string) => void;
  agents: Agent[] | null;
  domains: string[];
  error: string | null;
  /** Who is not answering, and when the list was last read: the banner names it, the rows grey as of then (QA #12). */
  down?: "node" | "herdr" | null;
  asOf?: number | null;
  activeId: string | null;
  onOpen: (a: Agent, conversationTarget?: ConversationPinTarget) => void;
  onAct: (id: string, action: RowAction, until?: number) => void;
  onEdit: (e: RegistryEdit) => void;
  onReorder: (ids: string[]) => void;
  /** His order of the project folders. */
  onReorderProjects: (projects: string[]) => void;
  /** Summary-card worker action, kept for callers that open that panel. */
  onWorkers: (owner: Agent) => void;
  /** Rename: opens the agent with its name ready to edit. */
  onRename: (a: Agent) => void;
  onZeroPage?: (a: Agent) => void;
  /** The org tree (three groups → projects → owners) and his changes to it. */
  org: Org | null;
  /** The last /api/org read failed: the tree shown is the last good one (QA #16). */
  orgDown?: boolean;
  onOrg: (op: OrgOp) => void;
  /** Start a receipt-owned chat. Resolves to why not, or null. */
  onStart?: (s: { name: string; project: string }) => Promise<string | null>;
  /** t-0139: a new agent from his words alone (the node names it and finds its project), or the words to Agent Zero. */
  onNewClaude?: (name: string, choice: WorkspaceChoice) => Promise<string | null>;
  onNewCodex?: (name: string, choice?: WorkspaceChoice, backendCatalogId?: string) => Promise<string | null>;
  onSay?: (words: string, choice?: WorkspaceChoice) => Promise<SaidStart>;
  onAskZero?: (words: string) => Promise<string | null>;
  /** A group's or a project's dashboard in the main area. */
  onPage: (p: { group: string } | { project: string }) => void;
  onProjectDashboard: (id: string) => void;
  onPinboard?: (id: string) => void;
  /** R1.25: agents that left herdr, newest first; a row opens its chat read-only. */
  ended?: Ended[];
  onEndedPage: () => void;
  /** R1.17: open tasks per owner name, and opening one owner's Tasks list from its row's count. */
  taskCounts?: Map<string, number>;
  onTasks?: (a: Agent) => void;
  /** Durable pin references, including offline owner slots and unresolved legacy shortcuts. */
  pins?: PinView[];
  onManagePins?: () => void;
  /** Names (canonical) an open needs-Shaan task names: those rows read "needs you" (sidenav D3). */
  needs?: Set<string>;
  /** ⌥⌘A: the next agent that needs him (Agent Zero's "N need you" does the same). */
  onNeedsYou?: () => void;
  /** Open needs-Shaan tasks (their owner names, upper-cased), and opening the Tasks page from Agent Zero's row. */
  needTasks?: { owner: string | null }[];
  onNeedTasks?: () => void;
  /** The hover card's "Org chart" button. */
  onOrgChart?: () => void;
  onDashboard: () => void;
  onCodexWork?: () => void;
  codexWorkActive?: boolean;
  selectedNowLane?: string | null;
  onNowLane?: (id: string) => void;
}) {
  const { agents, domains, error, activeId, onOpen, onAct, onEdit } = props;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [zeroOpen, setZeroOpen] = useState(false);
  const zeroAnchor = useRef<HTMLButtonElement>(null);
  const zeroPopup = useRef<HTMLDivElement>(null);
  const [zeroPosition, setZeroPosition] = useState<CSSProperties>({});
  const closeZero = useCallback(() => {
    setZeroOpen(false);
    setNamingChat(null);
    zeroAnchor.current?.focus();
  }, []);
  useOutsideClose(zeroAnchor, zeroOpen, closeZero, zeroPopup);
  useLayoutEffect(() => {
    if (!zeroOpen || !zeroAnchor.current) return;
    const rect = zeroAnchor.current.getBoundingClientRect();
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 160));
    setZeroPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - 348)), maxHeight: window.innerHeight - top - 12 });
    zeroPopup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    window.addEventListener('resize', closeZero);
    return () => window.removeEventListener('resize', closeZero);
  }, [zeroOpen, closeZero]);
  const [namingChat, setNamingChat] = useState<'claude' | 'codex' | null>(null);
  const [codexName, setCodexName] = useState("");
  const [backendCatalogId, setBackendCatalogId] = useState("");
  const backends = useSharedState<{ catalog?: { availability: string; reason?: string | null; artifacts: { id: string; provider: string; version: string }[] } }>(zeroOpen && namingChat === 'codex' ? "/api/backends" : null, 30_000);
  const codexVersions = !backends.error && backends.data?.catalog?.availability === 'available' && Array.isArray(backends.data.catalog.artifacts) ? backends.data.catalog.artifacts.filter(a => a.provider === 'codex') : [];
  const versionUnavailable = !!backendCatalogId && !codexVersions.some(a => a.id === backendCatalogId);
  const [saying, setSaying] = useState(false);
  const [addingOwner, setAddingOwner] = useState<NavWorkspace | null>(null);
  const [nowMode, setNowMode] = useState(() => load("nav.a0mode", true));
  const zeroActive = !!agents?.find((a) => a.id === activeId)?.zero;
  // Shaan 3 Oct ~22:40: "the side nav is completely fucked now ... Was there not a cleaner way ... rather than swapping out my
  // whole side nav ... a research fleet item up top ... in the HUD". His side nav stays his; Agent Zero's live view moves up top.
  const a0Mode = false && zeroActive && nowMode;
  const toggleMode = () => setNowMode((v) => { save("nav.a0mode", !v); return !v; });
  const hub = useHubAgents();
  const [codexChoice,setCodexChoice]=useState<WorkspaceChoice>({repo:"",workspace:{type:"isolated"}});
  const navAgents = (agents ?? []).filter(a => a.navOwner && !isInfra(a.name));
  const childrenOf = (a: Agent) => navAgents.filter(child => !child.zero && child.parentId === a.id);
  // Someone else's agents (t-0579, the public repo): no main flag, no parent, no SISO project, so no tree would draw them.
  // Each still gets a row. Shaan's own fleet has none of these (0 of 40 on the 9 Oct tape), so his nav is unchanged.
  const loose = useMemo<Team[]>(() => navAgents.filter(a => a.row === "live" && !a.project && !a.workspace && !a.navParentId && !a.parentId && !a.main && !a.zero && !a.a0).map(a => ({ lead: a, crew: [] })), [navAgents]);
  const l = useMemo(() => {
    const mains = (agents ?? []).filter(a => (a.main || a.zero || a.a0) && !isInfra(a.name));
    const result = layout(mains.map(a => ({ ...a, owner: null, lead: null })), domains);
    for (const team of [...result.pinned, ...result.sections.flatMap(s => s.teams)]) team.crew = (agents ?? []).filter(a => a.navOwner && a.navParentId === team.lead.id && !a.zero && !isInfra(a.name));
    return result;
  }, [agents, domains]);
  const zeroLive = useLive(l.zero?.id ?? "");
  // Each owner's team (its workers), by name, for the org's rows; anything the org does not place stays "Unsorted".
  const teamOf = useMemo(() => new Map([...l.pinned, ...l.sections.flatMap((s) => s.teams)].map((t) => [t.lead.name, t])), [l]);
  const placed = useMemo(() => {
    const org = props.org;
    if (!org) return null;
    return new Set([...org.top, ...org.bottom, ...org.groups.flatMap((g) => g.projects.flatMap((p) => p.owners))].map((o) => o.name));
  }, [props.org]);
  const unsorted = placed ? l.sections.flatMap((s) => s.teams).filter((t) => !placed.has(t.lead.name)) : [];
  // t-0008: nothing stays "Unsorted". Each goes to its project (registry, owner, cwd), else to Agent Zero's buttons.
  const strays = useMemo(() => (props.org ? placeStrays(unsorted, props.org) : null), [unsorted, props.org]);
  const health = props.org?.bottom.map((o) => (agents ?? []).find((a) => a.name === o.name)).filter((a): a is Agent => !!a) ?? [];
  const stateOf = (a: Agent): NavState => navState(a, props.needs);
  const pinBtn = (a: Agent) => (
    <button
      type="button"
      data-testid="slot-pin"
      aria-label={`${agentPinLabel(a, "Pin under Agent Zero")} · ${a.name}`}
      title={agentPinLabel(a, "Pin under Agent Zero")}
      disabled={!canEditAgentPin(a)}
      onClick={(e) => {
        e.stopPropagation();
        toggleAgentPin(a, onEdit, props.onManagePins);
      }}
    >
      {a.pinned ? <PinOffIcon /> : <PinIcon />}
    </button>
  );
  const moreBtn = (a: Agent, extra?: MenuItem[]) => (
    <MenuButton label="More" onOpenChange={(o) => setMenuFor(o ? a.id : null)} menuClassName="siso-rail-menu" items={() => menu(a, extra)}>
      <EllipsisIcon />
    </MenuButton>
  );
  // D1: one status slot per row; on hover or keyboard focus it becomes pin/unpin and ⋯.
  const slotFor = (a: Agent, opts: { small?: boolean; extra?: MenuItem[]; waking?: boolean; asleep?: boolean } = {}) => {
    const st = stateOf(a);
    return <StatusSlot state={opts.waking ? "working" : st} text={opts.waking ? "waking…" : (opts.asleep ?? a.serviceHost?.state === "asleep") ? a.serviceHost?.asleepAt ? new Date(a.serviceHost?.asleepAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "asleep" : slotText(st, a)} small={opts.small} actions={<>{!a.zero && pinBtn(a)}{moreBtn(a, opts.extra)}</>} />;
  };
  const cardExtra = (a: Agent, team?: Team) => <HoverExtra a={a} crew={team?.crew ?? []} stateOf={stateOf} onOpen={onOpen} onEdit={onEdit} onManagePins={props.onManagePins} onOrgChart={props.onOrgChart} tasks={a.zero ? 0 : (props.taskCounts?.get(canonName(a.name)) ?? 0)} onTasks={props.onTasks} />;
  const needAgents = (agents ?? []).filter((a) => !a.zero && a.row === "live" && stateOf(a) === "needs");
  // QA #7 (A0, 3 Oct): the row said "nothing needs you" while Tasks said "1 need you": a needs-Shaan task whose owner
  // has no live row counts here too (one whose owner has a row is that row's "needs").
  const counted = new Set(needAgents.map((a) => canonName(a.name)));
  const taskOnly = (props.needTasks ?? []).filter((t) => !ownerNames(t.owner).some((n) => counted.has(canonName(n)))).length;
  const needCount = needAgents.length + taskOnly;
  // Right-click on any agent row opens its ⋯ menu (Pin under Agent Zero / Unpin, Move, Rename, Settle).
  const onContextMenu = (e: React.MouseEvent) => {
    const more = (e.target as HTMLElement).closest("[data-testid=rail-row]")?.querySelector<HTMLButtonElement>('button[aria-label="More"]');
    if (!more) return;
    e.preventDefault();
    more.click();
  };

  // Dragging reorders leads inside one list; the saved order is every list's leads, top to bottom, then all crew.
  const lists = [l.pinned, ...l.sections.map((s) => s.teams)];
  const reorderIn = (which: Team[], ids: string[]) =>
    props.onReorder([
      ...lists.flatMap((t) => (t === which ? ids : t.map((x) => x.lead.id))),
      ...lists.flat().flatMap((t) => t.crew.map((c) => c.id)),
    ]);

  const sleepControl = async (a: Agent, action: 'wake' | 'keep-awake', value?: boolean) => {
    const response = await fetch(`/api/agents/${encodeURIComponent(a.id)}/sleep`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({action,value}) });
    const result = await response.json();
    setSleepNotice(response.ok ? action === 'wake' ? `${a.name} is awake` : value ? `${a.name} will stay awake` : `${a.name} can sleep when idle` : result.error ?? 'Host control unavailable');
  };
  const [sleepNotice,setSleepNotice] = useState('');
  const hasSleeping = !!agents?.some(a => a.serviceHost?.state === 'asleep');
  useEffect(() => {
    if (!hasSleeping || sessionStorage.getItem('ab-sleep-notice')) return;
    let active = true;
    void fetch('/api/host-sleep').then(r => r.json()).then(s => {
      if (!active || !s.count) return;
      setSleepNotice(`${s.chats} finished chats went to sleep${s.measured === s.count ? ` · ${Math.round(s.rssMB)} MB of process memory released` : ''}`);
      sessionStorage.setItem('ab-sleep-notice','seen');
    }).catch(()=>{});
    return () => { active = false; };
  }, [hasSleeping]);
  const menu = (a: Agent, extra: MenuItem[] = []): MenuItem[] => [
    ...(a.serviceHost ? [{ key:'keep-awake', icon:<PinIcon/>, label:a.serviceHost.keepAwake ? 'Allow idle sleep' : 'Keep awake', onSelect:()=>void sleepControl(a,'keep-awake',!a.serviceHost?.keepAwake).catch(()=>setSleepNotice('Host control unavailable')) }, ...(a.serviceHost.state === 'asleep' ? [{key:'wake',icon:<MoonIcon/>,label:'Wake',onSelect:()=>void sleepControl(a,'wake').catch(()=>setSleepNotice('Host control unavailable'))}] : [])] : []),
    a.pinned
      ? {
          key: "unpin",
          icon: <PinOffIcon />,
          label: agentPinLabel(a),
          disabled: !canEditAgentPin(a),
          onSelect: () => toggleAgentPin(a, onEdit, props.onManagePins),
        }
      : {
          key: "pin",
          icon: <PinIcon />,
          label: agentPinLabel(a, "Pin under Agent Zero"),
          disabled: !canEditAgentPin(a),
          onSelect: () => toggleAgentPin(a, onEdit, props.onManagePins),
        },
    {
      key: "move",
      icon: <FolderInputIcon />,
      label: "Move to…",
      items: domains.map((d) => ({
        key: d,
        icon: <FolderIcon />,
        label: d,
        current: d === a.project,
        onSelect: () => onEdit({ op: "move", name: a.name, project: d }),
      })),
    },
    {
      key: "rename",
      icon: <PencilIcon />,
      label: "Rename",
      onSelect: () => props.onRename(a),
    },
    ...(a.project && props.org
      ? [{ key: "page", icon: <FolderIcon />, label: `Open the ${props.org.groups.flatMap((g) => g.projects).find((p) => p.owners.some((o) => o.name === a.name))?.name ?? a.project} page`, onSelect: () => props.onPage({ project: props.org!.groups.flatMap((g) => g.projects).find((p) => p.owners.some((o) => o.name === a.name))?.id ?? a.project! }) }]
      : []),
    ...(() => {
      const n = a.zero ? 0 : (props.taskCounts?.get(canonName(a.name)) ?? 0);
      return n > 0 && props.onTasks ? [{ key: "tasks", icon: <ListChecksIcon />, label: `Open its tasks · ${n}`, onSelect: () => props.onTasks!(a) }] : [];
    })(),
    ...extra,
    {
      key: "settle",
      icon: <CheckIcon />,
      label: "Settle",
      onSelect: () => onAct(a.id, "settle"),
    },
  ];

  const row = (
    a: Agent,
    /** `label`: what the row says when it stands for its project (a one-owner project shows the project's name). */
    opts: { team?: Team; crew?: boolean; shelf?: boolean; label?: string; menu?: MenuItem[]; glyph?: ReactNode } = {},
  ) => {
    const mark = opts.shelf
      ? "quiet"
      : opts.team
        ? teamMark(opts.team)
        : markOf(a);
    const own = opts.shelf ? "quiet" : markOf(a);
    const timed = own === "working" || own === "needs";
    const snoozedRow = a.row === "snoozed";
    const actions = opts.shelf ? (
      <button
        type="button"
        aria-label={snoozedRow ? "Wake now" : "Un-settle"}
        title={snoozedRow ? "Wake now" : "Un-settle"}
        onClick={(e) => {
          e.stopPropagation();
          onAct(a.id, snoozedRow ? "unsnooze" : "unsettle");
        }}
      >
        {snoozedRow ? <AlarmClockOffIcon /> : <Undo2Icon />}
      </button>
    ) : (
      <MenuButton
        label="More"
        onOpenChange={(o) => setMenuFor(o ? a.id : null)}
        menuClassName="siso-rail-menu"
        items={() => menu(a, opts.menu)}
      >
        <EllipsisIcon />
      </MenuButton>
    );
    const time = a.serviceHost?.state === "asleep" ? `asleep · ${a.serviceHost?.asleepAt ? new Date(a.serviceHost?.asleepAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}` : opts.shelf
      ? snoozedRow && a.snoozedUntil
        ? formatWake(a.snoozedUntil)
        : formatAge(a.settledAt ?? a.since)
      : formatAge(a.since);
    const crewCount = opts.team?.crew.length ?? 0;
    const hasCrew = crewCount > 0;
    const where = [
      [a.project ?? "Unsorted", a.domain].filter(Boolean).join(" › "),
      a.lead && `works for ${a.lead}`,
      crewCount > 0 && `${crewCount} ${crewCount === 1 ? "worker" : "workers"}`,
    ]
      .filter(Boolean)
      .join(" · ");
    // Hovering a row opens its card (hub-5), in place of the old text tooltip.
    const renderThread = (fold?: { open: boolean; count: number; onToggle: () => void }) => (
      <div className={a.main ? "ab-main-agent" : undefined}><AgentHoverCard key={a.id} agent={hoverAgent(a, hub)} edit={cardEdit(a, onEdit)} row extra={opts.shelf ? undefined : cardExtra(a, opts.team)} details={workerDetails(a)}>
      <AgentRowSleep agent={a}>{({asleep,waking}) => <ThreadRow
        id={a.id}
        context={<MobileContext agent={a}/>}
        name={a.branch ? `${opts.label ?? a.name} · ${a.branch}` : opts.label ?? a.name}
        mark={mark}
        lead={
          opts.crew ? (
            <span className={`ab-ring is-${opts.shelf ? "idle" : stateOf(a)}`}>
              <AgentFace {...navFace(a, stateOf(a))} paused={asleep} status={waking ? "working" : FACE_OF[stateOf(a)]} size={16} />
            </span>
          ) : (
            <span className={`ab-ring is-${opts.shelf ? "idle" : stateOf(a)}`}>
              <AgentFace {...navFace(a, stateOf(a))} paused={asleep} status={waking ? "working" : FACE_OF[stateOf(a)]} size={18} />
            </span>
          )
        }
        glyph={
          asleep ? <MoonIcon size={13} aria-label="Asleep" /> : a.serviceHost?.keepAwake ? <PinIcon size={13} aria-label="Kept awake" /> : opts.glyph ? (
            opts.glyph
          ) : (!opts.crew && !opts.shelf && a.pinned && !a.zero) || (a.away && machineKind(a.machineKey)) ? (
            <>
              {!opts.crew && !opts.shelf && a.pinned && !a.zero && (
                <span className="siso-thread__glyph" title="Pinned under Agent Zero too" data-testid="pin-glyph">
                  <PinIcon aria-hidden="true" />
                </span>
              )}
              {/* R1.4: only an agent off this node's machine carries its machine (every other row is on the laptop). */}
              {a.away && machineKind(a.machineKey) && (
                <span className="siso-thread__glyph">
                  <MachineGlyph machineKey={a.machineKey} name={a.machine} />
                </span>
              )}
            </>
          ) : undefined
        }
        slot={opts.shelf ? undefined : slotFor(a, { small: opts.crew, extra: opts.menu, asleep, waking })}
        since={timed && !hasCrew ? a.since : undefined}
        time={hasCrew ? undefined : time}
        active={a.id === activeId}
        // Only a shelved row dims; idle shows in its slot's faint age (PUNCH 2: "only off dims").
        dim={opts.shelf}
        crew={opts.crew && !hasCrew}
        // Sidenav 5b (HUB-DESIGN 20:57): a project's owner row is face · NAME · pin glyph · slot; no counts. Its workers
        // open from the chevron, its tasks from ⋯ ("Open its tasks").
        fold={fold && { ...fold, count: a.main ? undefined : fold.count }}
        actions={actions}
        holdActions={menuFor === a.id}
        onOpen={() => onOpen(a)}
        ariaLabel={`${opts.label ?? a.name}, ${waking ? "Waking" : asleep ? "Asleep" : WORD[mark]}, ${where}`}
      />}</AgentRowSleep>
      </AgentHoverCard></div>
    );
    if (opts.team && opts.team.crew.length > 0) {
      return (
        <WorkerFold
          owner={a.name}
          count={crewCount}
          renderOwner={(fold) => renderThread(fold)}
        >
          {[...opts.team.crew]
            .sort((x, y) => Number(y.status === "working") - Number(x.status === "working"))
            .map((worker) => row(worker, { crew: true, team: { lead: worker, crew: childrenOf(worker) } }))}
        </WorkerFold>
      );
    }
    return renderThread();
  };

  // D3: Agent Zero's line 2 shows what needs attention (⌥⌘A).
  const workerDetails = (a: Agent) => a.codexWorker ? <section className="ab-hover-section" data-testid="worker-hover">
    <div className="ab-hover-label">Ticket</div>
    <p className="ab-codex-hoverline">{a.workerSummary?.tickets.join(" · ") || a.title}</p>
    <p className="ab-codex-hoverline">{a.workerSummary?.model} · {fmtDuration(a.workerSummary?.elapsed ?? 0)} · {a.workerSummary?.state}</p>
    <div className="ab-hover-label">Last message</div>
    <p className="ab-codex-hoverline">{a.workerSummary?.message ?? "No agent message yet"}</p>
  </section> : undefined;

  let savedZeroHue: string | null = null;
  if (l.zero) {
    const key = `agent-base:face-hue:${l.zero.name}`;
    try { savedZeroHue = localStorage.getItem(key); } catch { /* Keep the default colour when storage is unavailable. */ }
  }
  const zeroHue = needCount > 0 ? "#f0b03f" : savedZeroHue !== null && Number.isFinite(Number(savedZeroHue)) ? `hsl(${Number(savedZeroHue)} 85% 62%)` : l.zero?.tool === "codex" ? "#a78bfa" : "#22d3ee";
  const zeroWorking = zeroLive ? zeroLive.state === "working" : l.zero?.status === "working";
  const zeroRow = (seat: Agent) => {
    // The pinned card belongs to the seat; selecting a historical chat never changes its identity.
    const a = seat;
    const st = stateOf(a);
    return (
      <>
      <AgentHoverCard agent={hoverAgent(a, hub)} edit={cardEdit(a, onEdit)} row extra={cardExtra(a)}>
        <div className="ab-zero__rim">
        <div
          role="button"
          tabIndex={0}
          data-testid="rail-row"
          data-item={a.id}
          aria-label={`Agent Zero, ${st}${needCount ? `, ${needCount} need you` : ""}`}
          aria-current={a.id === activeId ? "page" : undefined}
          className={`ab-zero__row${a.id === activeId ? " is-active" : ""}${menuFor === a.id ? " is-held" : ""}`}
          onClick={() => onOpen(a)}
          onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(a))}
        >
          <span className={`ab-ring is-${st}`} data-tree-id="zero">
            <AgentFace {...navFace(a, stateOf(a))} size={40} />
            <HelperCount a={a} />
          </span>
          <span className="ab-pin__text">
            <b className="ab-zero__name" data-testid="zero-name">{a.tool === "codex" ? "Agent Zero · Sol" : "Agent Zero"}</b>
            <span className="ab-zero__line" data-testid="zero-line">
              {/* t-0563 v3: no "N need you" here (his words: "the 4 needs you, you can get rid of that"); ⌥⌘A still goes to the next one. */}

            </span>
          </span>
          <button
            ref={zeroAnchor}
            type="button"
            className="ab-zero__switch"
            data-testid="zero-switch"
            aria-expanded={zeroOpen}
            aria-label="New chat"
            aria-haspopup="dialog"
            title="New chat"
            onFocus={(e) => e.stopPropagation()}
            onClick={(e) => (e.stopPropagation(), setZeroOpen((v) => !v))}
          >
            <PlusIcon size={14} />
          </button>
          <StatusSlot state={st} text={a.serviceHost?.state === "asleep" ? a.serviceHost?.asleepAt ? new Date(a.serviceHost?.asleepAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "asleep" : slotText(st, a)} actions={moreBtn(a, [
            ...(props.onSay ? [{ key: "new-agent", icon: <PlusIcon />, label: "New agent…", onSelect: () => setSaying(true) }] : []),
            ...(props.onOrgChart ? [{ key: "org-chart", icon: <NetworkIcon />, label: "Org chart", onSelect: props.onOrgChart }] : []),
          ])} />
        </div>
        </div>
      </AgentHoverCard>
      {zeroOpen && createPortal(<div ref={zeroPopup} className="ab-zero-popup" style={zeroPosition} role="dialog" aria-label="New chat" data-testid="zero-switcher" onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeZero(); }
      }}>
          <header><b>New chat</b><button type="button" aria-label="Close new chat" onClick={closeZero}><XIcon size={14} /></button></header>
          <div className="ab-zero-popup__actions">
          {props.onNewClaude && <button type="button" data-testid="new-zero-chat" aria-pressed={namingChat === 'claude'} disabled={zeroStarting} onClick={() => { setNamingChat('claude'); setZeroError(null); }}><PlusIcon size={14} />Claude chat</button>}
          {props.onNewCodex && <button type="button" data-testid="new-codex-chat" aria-pressed={namingChat === 'codex'} disabled={zeroStarting} onClick={() => { setNamingChat('codex'); setZeroError(null); }}><PlusIcon size={14} />Codex chat</button>}
          </div>
          {namingChat && <form onSubmit={async e => {
            e.preventDefault();
            if (zeroStartingRef.current) return;
            zeroStartingRef.current = true; setZeroStarting(true); setZeroError(null);
            try { const error = await (namingChat === 'claude' ? props.onNewClaude!(codexName.trim(),codexChoice) : props.onNewCodex!(codexName.trim(),codexChoice,backendCatalogId || undefined)); setZeroError(error); if (!error) { setCodexName(''); closeZero(); } }
            catch { setZeroError("No answer from the node"); }
            finally { zeroStartingRef.current = false; setZeroStarting(false); }
          }}>
            <input className="ab-zsw__rename" aria-label={`${namingChat === 'claude' ? 'Claude' : 'Codex'} chat name`} placeholder="Chat name" autoFocus required maxLength={64} pattern="[A-Za-z0-9_-]+" value={codexName} onChange={e => setCodexName(e.target.value)} />
            <WorkspaceChoices value={codexChoice} onChange={setCodexChoice} disabled={zeroStarting} />
            {namingChat === 'codex' && <label className="flex flex-col gap-1 text-xs">Codex version (optional)
              <select aria-label="Codex version (optional)" className="w-full min-w-0 rounded border border-input bg-background p-2 text-foreground" value={backendCatalogId} disabled={zeroStarting} onChange={e => setBackendCatalogId(e.target.value)}>
                <option value="">Configured default</option>
                {versionUnavailable && <option value={backendCatalogId} disabled>Selected version unavailable</option>}
                {codexVersions.map(a => <option key={a.id} value={a.id}>Codex {a.version} · {a.id}</option>)}
              </select>
              <span role="status">{versionUnavailable ? "Choose the default or an available version to continue." : backends.error ? "Versions could not be refreshed. The configured default is available." : !backends.data ? "Reading available versions…" : backends.data.catalog?.availability !== 'available' && backends.data.catalog?.reason !== 'catalog-not-staged' ? "Version catalog is unavailable. Uses the configured default." : !codexVersions.length ? "No staged Codex versions. Uses the configured default." : "Available installed versions; selection applies to this new chat."}</span>
            </label>}
            <button className="ab-zsw__open" type="submit" disabled={zeroStarting || namingChat === 'codex' && versionUnavailable || !codexName.trim() || !codexChoice.repo || codexChoice.workspace.type==='shared' && !codexChoice.workspace.reason.trim()}><b>{zeroStarting ? `Starting ${namingChat === 'claude' ? 'Claude' : 'Codex'}…` : `Start ${namingChat === 'claude' ? 'Claude' : 'Codex'} chat`}</b></button>
          </form>}
          {zeroError && <span role="alert">{zeroError}</span>}
        </div>, document.body)}
      </>
    );
  };

  // One pane per thing: a crew row opens that agent as the chat, like any other row.
  const teams = (list: Team[]) => (
    <SortableRail
      ids={list.map((t) => t.lead.id)}
      onReorder={(ids) => reorderIn(list, ids)}
    >
      {/* Worker rows stay nested under their owner and appear when that owner is unfolded. */}
      {list.map((t) => (
        <div key={t.lead.id}>{row(t.lead, { team: t })}</div>
      ))}
    </SortableRail>
  );

  const [zeroStarting, setZeroStarting] = useState(false);
  const zeroStartingRef = useRef(false);
  const [zeroError, setZeroError] = useState<string | null>(null);
  return (
    <SideNav
      rootProps={{ "data-ab-comp": "side-nav" }}
      // Both side-nav specs draw it 292 px wide (PUNCH 6); a width he dragged to is kept.
      initial={292}
      label="Agents"
      storeKey="sidebar-width"
      header={
        // The space switcher with the SISO mark (Shaan, 2 Oct: "you got rid of the SISO agency drop down … I like that").
        <div className="siso-headstack" data-stale={error ? "" : undefined}>
        <div className="siso-headstack__space">
        <MenuButton
          label="Switch space"
          align="left"
          menuClassName="siso-rail-menu"
          className="siso-brand"
          items={[
            {
              key: "ab",
              label: "Agent Base",
              icon: <BotIcon />,
              current: true,
            },
            {
              key: "agency",
              label: "Agency Base · later",
              icon: <FolderIcon />,
              disabled: true,
            },
            {
              key: "library",
              label: "Library · later",
              icon: <FolderIcon />,
              disabled: true,
            },
          ]}
        >
          <img src="/siso-mark.png" alt="" />
          <span className="siso-sidenav__title">Agent Base</span>
          <ChevronDownIcon size={14} className="opacity-50" />
        </MenuButton>
          {/* Agent Zero has a fixed slot at the very top (it never scrolls away), as HEALTH has at the bottom. */}
          <button type="button" className="siso-headstack__dash" data-testid="nav-dashboard" aria-label="Dashboard" title="Dashboard" onClick={props.onDashboard}><LayoutGridIcon size={15} /></button>
        </div>
          {false && props.onCodexWork && <HoverCard title="Codex work" line="Codex tabs, pairs and recent jobs">
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Codex work" aria-pressed={props.codexWorkActive} data-testid="codex-work-open" onClick={props.onCodexWork}>
              <BotIcon size={15} aria-hidden /> Codex work
            </button>
          </HoverCard>}
        </div>
      }
      footer={
        <>
          {sleepNotice && <button type="button" role="status" className="ab-asleep-line" onClick={()=>setSleepNotice('')} title="Dismiss">{sleepNotice}</button>}
          {/* HEALTH has a fixed slot at the bottom, as Agent Zero has at the top (2 Oct 14:45). */}
          {a0Mode && <button type="button" className="a0-projects" onClick={toggleMode}>Projects ›</button>}
          {!a0Mode && <div className="siso-health siso-nav-footer">
            {/* t-0570 (Shaan, 9 Oct 02:10: "my three agents efficiency, estate and health ... I liked them"): back as they were. */}
            {props.org && props.org.bottom.length > 0 && <InfraEntry trio={props.org.bottom} agents={agents ?? []} onOpen={onOpen} />}
            <button type="button" className="ab-ended-link" data-testid="ended-open" onClick={props.onEndedPage}>{props.ended?.length ?? 0} ended</button>
          </div>}
          {!a0Mode && !props.org && health.length > 0 && <div className="siso-health">{health.map((a) => row(a))}</div>}
          {error && (
          <div
            role="status"
            className="mx-3 mb-3 rounded-[9px] border border-failed/25 bg-failed/10 px-2.5 py-1.5 text-[11px] text-failed"
          >
            {error === "Reconnecting" ? "Reconnecting to herdr" : props.down === "node" ? "The node is not answering" : "herdr is not answering"}
            {props.asOf ? `; agents as of ${new Date(props.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}; retrying.
          </div>
          )}
        </>
      }
    >
      <HaloRim className="ab-workspace-panel" hue={zeroHue} state={zeroWorking ? "working" : "idle"}>
        <TreeLines>
          {l.zero && (
            <div className="siso-zero">
              {zeroRow(l.zero)}
              {saying && props.onSay && <SayNew onSay={async (words, choice) => {
                const r = await props.onSay!(addingOwner ? `Start a long-running owner in the ${addingOwner.name} workspace: ${words}` : words, choice);
                if (addingOwner && r.name && !r.error) {
                  const saved = await fetch('/api/registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'update', name: r.name, workspace: addingOwner.id, kind: 'owner' }) });
                  if (!saved.ok) return { ...r, error: 'Owner started; workspace registration failed.' };
                }
                return r;
              }} onAskZero={props.onAskZero} onClose={() => { setSaying(false); setAddingOwner(null); }} />}
            </div>
          )}
      <WorkspaceNav workspaces={props.workspaces ?? []} agents={agents ?? []} activeId={activeId} onOpen={onOpen} onWorkspace={props.onWorkspace} onFleet={props.onFleet} onAdd={w => { setAddingOwner(w); setSaying(true); }}
        card={(a, node) => <AgentHoverCard agent={hoverAgent(a, hub)} edit={cardEdit(a, onEdit)} row extra={cardExtra(a)}>{node}</AgentHoverCard>} />
        </TreeLines>
      </HaloRim>
      {/* "Pinned" gave way to an Agents dropdown (Shaan, 6 Oct 21:15: "remove where it says pinned ... one called agents and
          that's where you can just see all of the agents that we have running right now even sub agents ... it's a drop down so
          it's clean"). Pins themselves are untouched; Manage pins stays in each agent's card. */}
      <DiskLine />
      <AgentsGroup agents={agents ?? []} stateOf={stateOf} row={row} onOpen={onOpen} needs={props.needs} />
      {/* 4 Oct: Agent Zero's jobs and souls live only in its fold (agent-nav.ts parents); no loose worker list. */}
      {agents === null && !error && (
        <div className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
          Reading herdr…
        </div>
      )}

      {a0Mode ? <A0Nav selected={props.selectedNowLane} onSelect={props.onNowLane} onNeeds={props.onNeedTasks} /> : <>
      {false && zeroActive && <button type="button" className="a0-projects" onClick={toggleMode}>Agent Zero · Now ›</button>}
      <div style={{ display: "contents" }} data-stale={error ? "" : undefined} data-testid="nav-rows" onContextMenu={onContextMenu}>
      {props.orgDown && (
        <p className="siso-side__note" data-testid="org-down" role="status">
          Org unavailable{props.org ? ": showing the last one read" : ""}
        </p>
      )}
      {props.org ? (
        props.org.groups.filter(g => g.id !== "labs").map((g) => (
          <OrgGroupBlock key={g.id} g={g} labs={g.id === "agency" ? props.org?.groups.find(group => group.id === "labs") : undefined} strays={strays?.byProject} agents={agents ?? []} needs={props.needs} teamOf={teamOf} row={row} onOpen={onOpen} onOrg={props.onOrg} onStart={props.onStart} onPage={props.onPage} onPinboard={props.onPinboard} onReorder={props.onReorder} />
        ))
      ) : (
        l.sections.length > 0 && (
          <SideSection title="Projects">
            {l.sections.map((s) => (
              <ProjectGroup key={s.domain} id={`project:${s.domain}`} name={s.domain} note={agentsWord(s.teams.length)}>
                {teams(s.teams)}
              </ProjectGroup>
            ))}
          </SideSection>
        )
      )}
      {!props.org && unsorted.length > 0 && <SideSection title="Unsorted">{teams(unsorted)}</SideSection>}
      {loose.length > 0 && <SideSection title="Agents">{teams(loose)}</SideSection>}
      {agents !== null && !l.zero && l.pinned.length + l.sections.length + loose.length === 0 && (
        <div className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
          No live agents.
        </div>
      )}
      <Shelf title="Snoozed" count={l.snoozed.length} note={agentsWord(l.snoozed.length)} storeKey="shelf-snoozed">
        {l.snoozed.map((a) => row(a, { shelf: true }))}
      </Shelf>
      <Shelf title="Settled" count={l.settled.length} note={agentsWord(l.settled.length)} storeKey="shelf-settled">
        {l.settled.map((a) => row(a, { shelf: true }))}
      </Shelf>

      </div>
      </>}
    </SideNav>
  );
}

function AgentRowSleep({ agent, children }: { agent: Agent; children: (s: {asleep:boolean;waking:boolean}) => ReactNode }) {
  const live = useLive(agent.id);
  return children({ asleep: live?.sleep !== undefined ? live.sleep === 'asleep' : agent.serviceHost?.state === 'asleep', waking: live?.sleep === 'waking' });
}

const agentsWord = (n: number) => `${n} ${n === 1 ? "agent" : "agents"}`;

/** The face shows the same state as the slot (a done that faded reads idle in both). */
const FACE_OF = { working: "working", quiet: "working", needs: "needs-shaan", done: "done", idle: "waiting", failed: "blocked", offline: "offline" } as const;
const navFace = (a: Agent, st: NavState) => ({ ...faceFor(a), status: FACE_OF[st], ...(a.zero && a.tool === "codex" ? { hue: 260 } : {}) });

const WORD_OF: Record<NavState, string> = { working: "working", needs: "needs you", done: "done", idle: "idle", quiet: "quiet", failed: "failed", offline: "off" };

/** The card's fields he changes in place (t-0269): the name renames it; its role line and domain go to the agent table. */
const cardEdit = (a: Agent, onEdit: (e: RegistryEdit) => void): CardEdit => ({
  name: a.zero ? (a.label ?? a.name) : a.name,
  role: a.role,
  domain: a.domain,
  onSave: (field, value) => onEdit(field === "name" ? { op: "rename", name: a.name, to: value } : { op: "describe", name: a.name, [field]: value }),
});

/** The side nav's part of an agent's hover card: its workers, its limits, and Open chat · Org chart · Pin|Unpin. */
function HoverExtra({ a, crew, stateOf, onOpen, onEdit, onManagePins, onOrgChart, tasks = 0, onTasks }: { a: Agent; crew: Agent[]; stateOf: (a: Agent) => NavState; onOpen: (a: Agent, conversationTarget?: ConversationPinTarget) => void; onEdit: (e: RegistryEdit) => void; onManagePins?: () => void; onOrgChart?: () => void; tasks?: number; onTasks?: (a: Agent) => void }) {
  const sorted = [...crew].sort((x, y) => Number(stateOf(y) === "working") - Number(stateOf(x) === "working"));
  const working = crew.filter((c) => stateOf(c) === "working").length;
  const bar = (label: string, v: number | null | undefined) => {
    if (v === null || v === undefined) return null;
    const pct = Math.max(0, Math.min(100, Math.round(v)));
    return (
      <div key={label} className="ab-hover-limit">
        <span>{label}</span>
        <i>
          <b className={pct >= 80 ? "is-high" : pct >= 50 ? "is-mid" : ""} style={{ width: `${pct}%` }} />
        </i>
        <em>{pct}%</em>
      </div>
    );
  };
  const limits = [bar("Context", a.hud?.context ?? a.context), bar("5 hours", a.hud?.fiveHour?.pct)].filter(Boolean);
  return (
    <>
      {crew.length > 0 && (
        <section className="ab-hover-section" data-testid="card-workers">
          <div className="ab-hover-label">
            Workers · {working} working
          </div>
          <div className="ab-hover-crew">
            {sorted.slice(0, 4).map((c) => {
              const cs = stateOf(c);
              return (
                <div key={c.id}>
                  <AgentFace {...navFace(c, stateOf(c))} size={16} />
                  <b>{c.name}</b>
                  <span>{cs === "working" ? doingNow(c) : [WORD_OF[cs], slotText("idle", c)].filter((w) => w !== "now").join(" ")}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {limits.length > 0 && (
        <section className="ab-hover-section">
          <div className="ab-hover-label">Limits</div>
          {limits}
          {a.hud?.fiveHour && <div>{usageAge(a.hud) || "live Claude usage"}</div>}
        </section>
      )}
      <div className="ab-hover-buttons">
        <button type="button" className="is-brand" onClick={() => onOpen(a)}>
          Open chat
        </button>
        {tasks > 0 && onTasks && (
          // Its tasks open beside its chat, where each one's stage, priority and next step are changed in place.
          <button type="button" data-testid="card-tasks" onClick={() => onTasks(a)}>
            Tasks · {tasks}
          </button>
        )}
        {onOrgChart && (
          <button type="button" onClick={onOrgChart}>
            Org chart
          </button>
        )}
        {!a.zero && (
          <button type="button" data-testid="card-pin" disabled={!canEditAgentPin(a)} title={!canEditAgentPin(a) ? "Pin target unavailable" : undefined} onClick={() => toggleAgentPin(a, onEdit, onManagePins)}>
            {agentPinLabel(a)}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * D5: the closed nav keeps the agents (⌘B). Below the rail's tools: Agent Zero (30, an amber dot when anything needs
 * him), each pinned agent (26) in pin order, then the Agent Infrastructure trio as three small dots. Hover gives the same
 * card as the open nav; a click opens the chat.
 */
export function FaceDock({ agents, pins, workspaces = [], needs, activeId, infra, onOpen, onOrgChart, onManagePins, onEdit }: { agents: Agent[]; pins: PinView[]; workspaces?: NavWorkspace[]; needs?: Set<string>; activeId: string | null; infra: string[]; onOpen: (a: Agent, conversationTarget?: ConversationPinTarget) => void; onOrgChart?: () => void; onManagePins: () => void; onEdit: (e: RegistryEdit) => void }) {
  const hub = useHubAgents();
  const stateOf = (a: Agent) => navState(a, needs);
  const zero = agents.find((a) => a.zero && a.row === "live");
  const anyNeeds = agents.some((a) => !a.zero && a.row === "live" && stateOf(a) === "needs");
  const face = (a: Agent, size: number, dot?: boolean, pin?: PinView) => (
    <AgentHoverCard key={pin?.id ?? a.id} agent={hoverAgent(a, hub)} edit={cardEdit(a, onEdit)} row extra={<>{pin && <p className="px-3 pt-2 text-[10px] break-all text-muted-foreground">{pinTargetDescription(pin, workspaces)}</p>}<HoverExtra a={a} crew={[]} stateOf={stateOf} onOpen={() => onOpen(a, pin?.target?.kind === "conversation" ? pin.target : undefined)} onEdit={onEdit} onManagePins={onManagePins} onOrgChart={onOrgChart} /></>}>
      <button type="button" className={`ab-dock__face${a.id === activeId ? " is-active" : ""}`} data-testid="dock-face" data-name={a.name} data-pin-id={pin?.id} data-agent-id={a.id} title={pin ? pinTargetDescription(pin, workspaces) : undefined} aria-label={`${pin?.name ?? a.name}, ${WORD_OF[stateOf(a)]}${pin ? `, ${pinTargetDescription(pin, workspaces)}` : ""}`} onClick={() => onOpen(a, pin?.target?.kind === "conversation" ? pin.target : undefined)}>
        <span className={`ab-ring is-${stateOf(a)}`}>
          <AgentFace {...navFace(a, stateOf(a))} size={size} />
        </span>
        {dot && <i className="ab-dock__dot" aria-hidden="true" />}
      </button>
    </AgentHoverCard>
  );
  const trio = infra.map((n) => agents.find((a) => a.name === n)).map((a, i) => <i key={infra[i]} className={`ab-dock__infra is-${a ? stateOf(a) : "offline"}`} />);
  return (
    <div className="ab-dock" data-testid="face-dock">
      {zero && face(zero, 30, anyNeeds)}
      {pins.map(pin => {
        const agent = readyPinAgent(pin, agents, workspaces);
        return agent ? face(agent, 26, false, pin) : <HoverCard key={pin.id} title={pin.name} line={pin.detail || pinStateLabel(pin, agent)}>
          <button type="button" className="ab-dock__face ab-dock__face--blocked" data-testid="dock-pin-blocked" data-pin-id={pin.id} aria-label={`${pin.name}, ${pinStateLabel(pin, agent)}. Manage pin`} title={`${pin.name} · ${pinStateLabel(pin, agent)}`} onClick={onManagePins}><PinIcon size={20} aria-hidden /><span>{pinStateLabel(pin, agent)}</span></button>
        </HoverCard>;
      })}
      {trio.length > 0 && (
        <HoverCard title="Agent Infrastructure" line={infra.map((n) => { const a = agents.find((x) => x.name === n); return `${n} ${a ? WORD_OF[stateOf(a)] : "offline"}`; }).join(" · ")}>
          <span className="ab-dock__trio" data-testid="dock-infra" tabIndex={0} aria-label={`Agent Infrastructure: ${infra.join(", ")}`}>
            {trio}
          </span>
        </HoverCard>
      )}
    </div>
  );
}

/**
 * One of the three groups (projects-nav spec A, Shaan 22:20): its header (caret folds, name opens its dashboard; folded,
 * it says "N working" or shows an amber dot), its projects in his dragged order, and for the agency the Clients,
 * Agencies and Industries folders from CLIENTS.json. Nothing is hidden, things are folded. A one-owner project is one
 * row (the owner's face, the project's name); a project with no owner running is an empty dashed seat.
 */
function OrgGroupBlock({
  g,
  agents,
  needs,
  teamOf,
  row,
  onOpen,
  onOrg,
  onStart,
  onPage,
  onReorder,
  strays,
  projectsOnly = false,
  onPinboard,
  labs,
}: {
  g: Org["groups"][number];
  projectsOnly?: boolean;
  onPinboard?: (id: string) => void;
  labs?: Org["groups"][number];
  agents: Agent[];
  needs?: Set<string>;
  teamOf: Map<string, Team>;
  row: (a: Agent, opts?: { team?: Team; crew?: boolean; shelf?: boolean; label?: string; menu?: MenuItem[]; glyph?: ReactNode }) => React.ReactNode;
  onOpen: (a: Agent, conversationTarget?: ConversationPinTarget) => void;
  onOrg: (op: OrgOp) => void;
  onStart?: (s: { name: string; project: string }) => Promise<string | null>;
  onPage: (p: { group: string } | { project: string }) => void;
  onReorder: (ids: string[]) => void;
  /** t-0008: agents the org did not place, filed here by project id (lib/place.ts), never "Unsorted". */
  strays?: Map<string, Team[]>;
}) {
  // SISO Family starts folded (spec); the others open. His choice is remembered either way.
  const [open, setOpen] = useState(() => load(`group-open:${g.id}`, g.id !== "family"));
  const items = g.folders.flatMap((f) => f.items);
  const itemOf = (p: OrgProject) => items.find((i) => i.project === p.id);
  // Agency: HALO and what he pinned sit at the top; its other projects live in their folder. Labs and Family: all.
  // An unpinned agency project with no folder to live in (no CLIENTS.json entry) stays at the top: never lost.
  // PUNCH 11: a project run from another slot (Efficiency and Estate by the footer, SISO by Agent Zero) is not drawn twice;
  // it stays in /api/org and on the dashboards.
  const top = projectsOnly ? g.projects : g.id === 'agency' ? g.projects.filter(p => g.folders.find(f => f.id === 'agencies')?.items.some(i => i.project === p.id && !i.parent)) : g.projects;
  const labNames = new Set(['agentbase', 'mathsinnovations', 'lifelog', 'estate', 'rolodex', 'greatlibraryofsiso', 'sisovoice', 'sisoweb']);
  const labsProjects = labs?.projects.filter(p => labNames.has(p.name.toLowerCase().replace(/[^a-z0-9]/g, ''))) ?? [];
  const pinMenu = (p: OrgProject): MenuItem[] =>
    g.id !== "agency"
      ? []
      : p.shown !== false
        ? [{ key: "unpin", icon: <PinOffIcon />, label: "Unpin from Agency", disabled: p.id === "halo", onSelect: () => onOrg({ op: "hide", id: p.id }) }]
        : [{ key: "pin", icon: <PinIcon />, label: "Pin to Agency", onSelect: () => onOrg({ op: "show", id: p.id }) }];
  // t-0189: a seat being started, and why the last start did not happen (shown in its project until the next try).
  const [newOwner, setNewOwner] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [startErr, setStartErr] = useState<{ name: string; project: string; text: string } | null>(null);
  const start = async (name: string, project: OrgProject) => {
    if (!onStart || starting) return;
    setStarting(name);
    setStartErr(null);
    const why = await onStart({ name, project: project.name }).catch(() => "no answer from the node");
    setStarting(null);
    if (why) setStartErr({ name, project: project.id, text: why });
    else { setNewOwner(null); setOwnerDraft(""); }
  };
  const projectMenu = (p: OrgProject): MenuItem[] => [
    { key: "page", icon: <FolderIcon />, label: "Open its page", onSelect: () => onPage({ project: p.id }) },
    ...(onPinboard ? [{ key: "pinboard", icon: <PinIcon />, label: "Open pinboard", onSelect: () => onPinboard(p.id) }] : []),
    { key: "pin-top", icon: p.pinned ? <PinOffIcon /> : <PinIcon />, label: p.pinned ? "Unpin from top" : "Pin to top", onSelect: () => onOrg({ op: p.pinned ? "unpin-project" : "pin-project", id: p.id }) },
    ...pinMenu(p),
    ...(onStart
      ? [{
          key: "new-agent",
          icon: <PlusIcon />,
          label: "New agent here",
          onSelect: () => { setNewOwner(p.id); setOwnerDraft(""); save(`project-open:project:${p.id}`, true); },
        }]
      : []),
    {
      key: "rename",
      icon: <PencilIcon />,
      label: "Rename",
      onSelect: () => {
        const to = window.prompt(`Rename ${p.name} to`, p.name);
        if (to && to.trim() && to.trim() !== p.name) onOrg({ op: "rename", id: p.id, to: to.trim() });
      },
    },
    { key: "remove", icon: <Trash2Icon />, label: p.owners.length ? "Remove (only when no owner)" : "Remove", danger: true, disabled: p.owners.length > 0, onSelect: () => onOrg({ op: "remove", id: p.id }) },
  ];
  // Projects keep their page door; running agents and recorded owners sit inside their fold.
  const running = (p: OrgProject) => [
    ...p.owners.flatMap((o) => (o.state !== "live" ? [] : [teamOf.get(o.name)].filter((t): t is Team => !!t))),
    ...(strays?.get(p.id) ?? []),
  ];
  const ownerNames = (ps: OrgProject[]) => ps.flatMap((p) => p.owners.map((o) => o.name));
  const pinGlyph = (p: OrgProject) =>
    g.id === "agency" && p.id !== "halo" && p.shown !== false && itemOf(p) ? (
      <span className="siso-thread__glyph" title="Pinned to Agency; it is in its folder too" data-testid="agency-pin">
        <PinIcon aria-hidden="true" />
      </span>
    ) : null;

  // At the top of a group a project drags (op "order"); inside a folder it stays where CLIENTS.json puts it.
  const projectRow = (p: OrgProject, children?: ReactNode, label = p.name): ReactNode => {
    const teams = running(p);
    const sleeping = p.owners.filter(o => o.main && !teamOf.has(o.name));
    const reserved = p.id === 'kikas' || p.path?.endsWith('/kikas') ? 'KIKAS' : p.id === 'actionmodel' || p.path?.endsWith('/actionmodel') ? 'Reserved owner' : null;
    const newOwnerControl = onStart && (newOwner === p.id ? <form className="ab-new-owner" onSubmit={e => { e.preventDefault(); if (ownerDraft.trim()) void start(ownerDraft.trim().toUpperCase(), p); }}>
          <input autoFocus aria-label={`New owner in ${p.name}`} placeholder="Owner name" required maxLength={64} pattern="[A-Za-z0-9_-]+" value={ownerDraft} disabled={!!starting} onChange={e => setOwnerDraft(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { setNewOwner(null); setOwnerDraft(""); } }} />
          <button type="submit" className="siso-start" disabled={!!starting || !ownerDraft.trim()}>{starting ? "Starting…" : "Start"}</button>
        </form> : <button type="button" className="ab-new-owner__add" onClick={() => { setNewOwner(p.id); setOwnerDraft(""); }}><PlusIcon size={12} /> New owner</button>);
    const working = teams.flatMap((t) => [t.lead, ...t.crew]).filter((a) => a.status === "working").length;
    return (
      <ProjectGroup
        key={`${p.id}:${newOwner === p.id ? "naming" : "view"}`}
        id={`project:${p.id}`}
        name={label}
        // PUNCH 8: the project's own tinted mark, not the generic folder the groups also use.
        icon={<BrandOr project={p.name} />}
        note={
          teams.some((t) => [t.lead, ...t.crew].some((a) => navState(a, needs) === "needs")) ? (
            <span className="siso-amber" title="Someone here needs you" />
          ) : working ? (
            <span className="siso-working">{working} working</span>
          ) : (
            pinGlyph(p) ?? undefined
          )
        }
        onName={() => onPage({ project: p.id })}
        actions={
          <MenuButton label="More" menuClassName="siso-rail-menu" items={() => projectMenu(p)}>
            <EllipsisIcon />
          </MenuButton>
        }
      >
        {/* Owners drag inside their project, kept in his agent order. */}
        <SortableRail ids={teams.map((t) => t.lead.id)} onReorder={onReorder}>
          {teams.map((t) => (
            <div key={t.lead.id}>{row(t.lead, { team: t })}</div>
          ))}
        </SortableRail>
        {!teams.length && !sleeping.length && <div className="siso-thread is-dim" data-testid="empty-owner-slot"><span className="siso-seat" aria-hidden="true" /><span className="siso-thread__name">{p.elsewhere ?? reserved ?? 'Empty slot'}</span><small>{p.elsewhere ? 'in its own slot' : reserved ? 'reserved' : ''}</small></div>}
        {sleeping.map(o => <button key={o.name} type="button" className="siso-thread is-dim ab-main-agent" data-testid="offline-row" aria-label={`Start ${o.name}`} disabled={!onStart || !!starting} onClick={() => void start(o.name, p)}><AgentFace name={o.name} project={p.name} status="offline" size={18} /><span className="siso-thread__name">{o.name}</span><small>not open</small></button>)}
        {startErr?.project === p.id && (
          <div className="ab-offline" data-testid="start-error"><em className="ab-offline__err">{startErr.name}: {startErr.text}</em></div>
        )}
        {newOwnerControl}
        {children}
      </ProjectGroup>
    );
  };

  const pinItem = (i: OrgItem) =>
    i.project ? onOrg({ op: i.pinned ? "hide" : "show", id: i.project }) : onOrg({ op: "show", id: i.folder ?? i.id, to: i.name });
  const itemRow = (i: OrgItem, kids: OrgItem[] = []): ReactNode => {
    const project = i.project ? g.projects.find((p) => p.id === i.project) : undefined;

    // An agency with owners that is not pinned to the top is drawn here as its project, so its owners are never lost.
    const client = g.folders.find(f => f.id === 'clients')?.items.some(c => c.id === i.id);
    if (project) return projectRow(project, kids.length ? kids.map(k => itemRow(k, items.filter(c => c.parent === k.id))) : undefined, i.name);
    const body = (
      <ClientRow
        key={i.id}
        i={i}
        locked={i.project === "halo"}
        onOpen={() => onPage({ project: i.project ?? i.id })}
        onPin={() => pinItem(i)}
        onPinboard={onPinboard ? () => onPinboard(i.project ?? i.id) : undefined}
      />
    );
    if ((client || i.kind === 'partner-project') && !project) {
      const reserved = i.kind === 'partner-project' && i.line ? i.line : /(?:^|\/)kikas$/.test(i.id) ? 'KIKAS' : /(?:^|\/)actionmodel$/.test(i.id) ? 'Reserved owner' : 'Empty slot';
      return <ProjectGroup key={i.id} id={`catalog:${i.id}`} name={i.name} icon={<BrandOr project={i.name} />} onName={() => onPage({ project: i.id })} actions={<MenuButton label="More" menuClassName="siso-rail-menu" items={() => [{key:'page',icon:<FolderIcon />,label:'Open its page',onSelect:()=>onPage({project:i.id})},...(onPinboard?[{key:'pinboard',icon:<PinIcon />,label:'Open pinboard',onSelect:()=>onPinboard(i.id)}]:[])]}><EllipsisIcon /></MenuButton>}>
        <div className="siso-thread is-dim" data-testid="catalog-owner-slot"><span className="siso-seat" aria-hidden="true" /><span className="siso-thread__name">{reserved}</span><small>{reserved === 'Empty slot' ? '' : 'not running'}</small></div>
        {kids.map(k => itemRow(k, items.filter(c => c.parent === k.id)))}
      </ProjectGroup>;
    }
    return kids.length ? (
      <div key={i.id}>
        {body}
        <div className="siso-kids">{kids.map((k) => itemRow(k, items.filter(c => c.parent === k.id)))}</div>
      </div>
    ) : (
      body
    );
  };
  if (projectsOnly) return <SortableRail ids={top.map(p => `project:${p.id}`)} onReorder={ids => onOrg({ op: "order", id: "pinned", to: ids.map(i => i.slice(8)) })}>{top.map(p => projectRow(p))}</SortableRail>;
  const groupSum = foldedSummary(ownerNames(g.projects), agents, needs);
  return (
    <div className="siso-group" data-group={g.id}>
      <div className="siso-group__head">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Fold ${g.name}` : `Open ${g.name}`}
          onClick={() => {
            setOpen(!open);
            save(`group-open:${g.id}`, !open);
          }}
        >
          {open ? <ChevronDownIcon className="siso-group__caret" /> : <ChevronRightIcon className="siso-group__caret" />}
        </button>
        <button type="button" onClick={() => onPage({ group: g.id })} title={`${g.name}: its dashboard`}>
          <Icon name={g.icon} size={16} /> {g.id === "agency" ? "Agencies" : g.name}
        </button>
        {!open && <FoldSum sum={groupSum} />}
      </div>
      {open && (
        <>
          {g.id !== 'agency' && <SortableRail ids={top.map((p) => `project:${p.id}`)} onReorder={(ids) => onOrg({ op: "order", id: g.id, to: ids.map((i) => i.slice(8)) })}>{top.map(p => projectRow(p))}</SortableRail>}
          {g.id === 'agency' && <div className="siso-kids">
            {g.folders.find(f => f.id === 'agencies')?.items.filter(i => !i.parent).map(i => itemRow(i, items.filter(k => k.parent === i.id)))}
            <ProjectGroup id="directory:siso-agency" name="SISO Agency" icon={<BrandOr project="SISO Agency" />} onName={() => onPage({group:'agency'})}>
              {g.folders.filter(f => f.id !== 'agencies').map(f => <FolderBlock key={f.id} f={f} sum={foldedSummary(ownerNames(g.projects.filter(p => f.items.some(i => i.project === p.id))), agents, needs)}>{f.id === 'clients' ? <>
                {f.items.filter(i => !i.parent && i.kind === 'friend-favour').map(i => itemRow(i, f.items.filter(k => k.parent === i.id)))}
                {f.items.some(i => !i.parent && i.kind !== 'friend-favour') && <details data-testid="inactive-clients"><summary>Inactive ({f.items.filter(i => !i.parent && i.kind !== 'friend-favour').length})</summary>{f.items.filter(i => !i.parent && i.kind !== 'friend-favour').map(i => itemRow(i, f.items.filter(k => k.parent === i.id)))}</details>}
              </> : f.items.filter(i => !i.parent).map(i => itemRow(i, f.items.filter(k => k.parent === i.id)))}</FolderBlock>)}
              {labs && <FolderBlock f={{id:'labs',name:'SISO Labs',items:labsProjects.map(p=>({id:p.id,name:p.name,kind:'project',line:'',note:'',people:[],pinned:false}))}} sum={foldedSummary(ownerNames(labsProjects),agents,needs)}>
                <OrgGroupBlock projectsOnly g={{...labs,projects:labsProjects}} agents={agents} needs={needs} teamOf={teamOf} row={row} onOpen={onOpen} onOrg={onOrg} onStart={onStart} onPage={onPage} onPinboard={onPinboard} onReorder={onReorder} strays={strays} />
              </FolderBlock>}
            </ProjectGroup>
            {/* t-0457 (AB-10, 6 Oct: "do you not think this is a bit of a stupid way to run the side nav"): no Unsorted group. It
                held registry aliases (SISO Agency a second time, "Agency base", "halo"); they stay in /api/org and the dashboards. */}
          </div>}
          {top.length === 0 && g.folders.length === 0 && <p className="siso-group__empty">Nothing placed yet</p>}
        </>
      )}
    </div>
  );
}

/** The right slot of a folded group or folder: "N working" (working-blue), an amber dot when something needs him. */
function FoldSum({ sum, count }: { sum: { working: number; needs: boolean }; count?: number }) {
  if (sum.needs) return <span className="siso-amber" title="Something inside needs you" data-testid="fold-needs" />;
  if (sum.working) return <span className="siso-fold-sum siso-working">{sum.working} working</span>;
  return count !== undefined ? <span className="siso-fold-sum">{count}</span> : null;
}

/** Every agent running now, its sub-agents under it: folded by default (ab.nav.folder.agents), like Agencies. */
/**
 * t-0504: the disk, at the top of A0's tree, only when it matters. Full (under 256 MB): agents keep their state in memory
 * and retry their saves; low: under 5 GB, warn before it fills.
 */
function DiskLine() {
  const disk = useSharedState<{ freeBytes: number; low: boolean; full: boolean }>("/api/disk", 30_000).data;
  if (!disk?.low) return null;
  const gb = (disk.freeBytes / 1024 ** 3).toFixed(1);
  return (
    <div role="status" data-testid="disk-line" title={disk.full ? "Agents keep working and save again once there is space" : "Free some space before the disk fills"}
      className={disk.full ? "mx-2 mb-1 rounded-[9px] border border-failed/30 bg-failed/10 px-2.5 py-1.5 text-[11.5px] font-medium text-failed" : "mx-2 mb-1 rounded-[9px] border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-300"}>
      {disk.full ? `Disk full · ${gb} GB free · agents are holding their saves` : `Disk low · ${gb} GB free`}
    </div>
  );
}

function AgentsGroup({ agents, stateOf, row, onOpen, needs }: { agents: Agent[]; stateOf: (a: Agent) => NavState; row: (a: Agent) => ReactNode; onOpen: (a: Agent) => void; needs?: Set<string> }) {
  const key = "ab.nav.folder.agents";
  const [open, setOpen] = useState(() => load(key, false));
  // One shared read of the fleet board for the whole side nav (t-0497: two parts each fetched it every 5 s).
  const board = useSharedState<FleetBoardData>("/api/fleet-board", FLEET_BOARD_MS).data;
  const crew = useMemo(() => (board?.groups ?? []).flatMap((g) => (g.rows ?? []).filter((r) => r.crewParentId && r.status === "working")), [board]);
  // Running now = working, quiet or waiting on him (Agent Zero always first); live-but-idle chats fold under one line.
  const live = agents.filter(a => a.row === "live" && !["offline", "done"].includes(stateOf(a)));
  const running = live.filter(a => a.zero || ["working", "quiet", "needs", "failed"].includes(stateOf(a))).sort((x, y) => Number(!!y.zero) - Number(!!x.zero) || Number(stateOf(y) === "working") - Number(stateOf(x) === "working"));
  const idle = live.filter(a => !running.includes(a));
  const sum = foldedSummary(running.map(a => a.name), agents, needs);
  return (
    <div className="siso-group" data-group="agents" data-testid="nav-agents">
      <div className="siso-group__head">
        <button type="button" aria-expanded={open} aria-label={open ? "Fold Agents" : "Open Agents"} onClick={() => { setOpen(!open); save(key, !open); }}>
          {open ? <ChevronDownIcon className="siso-group__caret" /> : <ChevronRightIcon className="siso-group__caret" />}
        </button>
        <button type="button" onClick={() => { setOpen(!open); save(key, !open); }}><BotIcon size={16} aria-hidden /> Agents</button>
        {!open && <FoldSum sum={{ working: sum.working + crew.length, needs: sum.needs }} count={running.length} />}
      </div>
      {open && <div className="siso-kids">
        {running.map(a => <Fragment key={a.id}>
          {row(a)}
          {crew.filter(c => c.crewParentId === a.id).map(c => <button key={c.id} type="button" className="ab-nav-sub" data-testid="nav-sub-agent" title={c.title} onClick={() => onOpen(a)}>
            <span className="ab-nav-sub__br" aria-hidden>└</span><AgentFace name={c.name} project={a.name} status="working" size={16} /><span>{c.name}</span><small>{c.title}</small>
          </button>)}
        </Fragment>)}
        {!running.length && <p className="siso-side__note">No agents running.</p>}
        {idle.length > 0 && <details className="ab-nav-idle" data-testid="nav-agents-idle"><summary>Idle · {idle.length}</summary>{idle.map(a => <Fragment key={a.id}>{row(a)}</Fragment>)}</details>}
      </div>}
    </div>
  );
}

const FOLDER_ICON = { clients: UsersIcon, agencies: Building2Icon, industries: FactoryIcon, labs: FlaskConicalIcon } as const;
/** Clients, Agencies or Industries: folded by default (remembered as ab.nav.folder.<id>), its count on the right. */
function FolderBlock({ f, sum, children }: { f: OrgFolder | { id: "labs"; name: string; items: OrgItem[] }; sum: { working: number; needs: boolean }; children: ReactNode }) {
  const key = `ab.nav.folder.${f.id}`;
  const [open, setOpen] = useState(() => load(key, false));
  const FolderGlyph = FOLDER_ICON[f.id];
  return (
    <div className="siso-folder" data-folder={f.id}>
      <button
        type="button"
        className="siso-folder__row"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          save(key, !open);
        }}
      >
        {open ? <ChevronDownIcon className="siso-folder__caret" aria-hidden="true" /> : <ChevronRightIcon className="siso-folder__caret" aria-hidden="true" />}
        <FolderGlyph className="siso-folder__mark" aria-hidden="true" />
        <span className="siso-folder__name">{f.name}</span>
        {open ? <span className="siso-fold-sum">{(f.id === "labs" ? f.items.length : folderCount(f))}</span> : <FoldSum sum={sum} count={f.id === "labs" ? f.items.length : folderCount(f)} />}
      </button>
      {open && <div className="siso-kids">{children}</div>}
    </div>
  );
}

const initials = (name: string) =>
  (name.match(/[A-Z0-9À-Ý]/g)?.slice(0, 2).join("") || name.slice(0, 2)).toUpperCase();
const hueOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
/** A client, agency or industry: initials tile, name, one faint word; hover shows Pin and its page. Past is dim. */
function ClientRow({ i, locked, onOpen, onPin, onPinboard }: { i: OrgItem; locked: boolean; onOpen: () => void; onPin: () => void; onPinboard?: () => void }) {
  return (
    <div className={`siso-crow${i.stage === "past" ? " is-past" : ""}`} data-testid="client-row" data-id={i.id} title={i.note || i.name}>
      <button type="button" className="siso-crow__main" onClick={onOpen}>
        <span className="siso-crow__tile" style={{ "--tile-h": hueOf(i.name) } as React.CSSProperties}>
          {initials(i.name)}
        </span>
        <span className="siso-crow__name">{i.name}</span>
        {i.pinned && (
          <span className="siso-crow__pin" title="Pinned to Agency">
            <PinIcon aria-hidden="true" />
          </span>
        )}
        <span className="siso-crow__word">{i.line}</span>
      </button>
      {!locked && (
        <button type="button" className="siso-crow__act" aria-label={i.pinned ? `Unpin ${i.name}` : `Pin ${i.name} to Agency`} title={i.pinned ? "Unpin" : "Pin to Agency"} onClick={onPin}>
          {i.pinned ? <PinOffIcon /> : <PinIcon />}
        </button>
      )}
      <span className="siso-crow__act siso-crow__more">
        <MenuButton
          label="More"
          menuClassName="siso-rail-menu"
          items={() => [
            { key: "page", icon: <FolderIcon />, label: "Open its page", onSelect: onOpen },
            ...(onPinboard ? [{key:"pinboard",icon:<PinIcon />,label:"Open pinboard",onSelect:onPinboard}] : []),
            ...(locked ? [] : [{ key: "pin", icon: i.pinned ? <PinOffIcon /> : <PinIcon />, label: i.pinned ? "Unpin from Agency" : "Pin to Agency", onSelect: onPin }]),
          ]}
        >
          <EllipsisIcon />
        </MenuButton>
      </span>
    </div>
  );
}

/**
 * The side nav's bottom slot, "Agent Infrastructure" (ab-148; Shaan, 2 Oct 15:24): one entry with a dot each for HEALTH
 * (machines), EFFICIENCY (the agent stack) and ESTATE (where everything lives). Hover or click opens a popover listing
 * the three; each opens its agent's chat.
 */
/** Agent Infrastructure's three run as codex-run role workers too; they show in the footer, never under Agent Zero (4 Oct). */
const isInfra = (name: string) => ["HEALTH", "EFFICIENCY", "ESTATE"].includes(name.toUpperCase());

/** HEALTH, EFFICIENCY and ESTATE at the bottom of the side nav, a face each (Shaan, 6 Oct 22:35: "I don't need to see all the
 *  text ... if you hover over it then you can see information ... just click on it to go to the chat"). t-0557 took the
 *  block out on 8 Oct; he asked for it back on 9 Oct. */
function InfraEntry({ trio, agents, onOpen }: { trio: Org["bottom"]; agents: Agent[]; onOpen: (a: Agent) => void }) {
  const roleAgent = (name: string) => agents.find(a => a.infrastructureRole === name.toUpperCase()) ?? agents.find(a => a.name.toUpperCase() === name.toUpperCase());
  const roleStatus = (name: string) => roleAgent(name)?.status ?? trio.find(t => t.name.toUpperCase() === name.toUpperCase())?.status ?? null;
  const word = (s?: string | null) => (s === "working" ? "working" : s === "needs" ? "needs you" : s ? "idle" : "not running");
  return (
    <div className="siso-infra" data-testid="nav-infra">
      <span className="siso-infra__label">Agent Infrastructure</span>
      {/* t-0573 (Shaan, 9 Oct ~04:00: "I don't see the efficiency agents anymore"): three faces were not enough. Each role is a
          row again: its name, its live dot, one line of its goal, one click into its chat. */}
      <span className="siso-infra__faces">
        {trio.map((t) => {
          const a = roleAgent(t.name), status = roleStatus(t.name);
          const line = a?.infrastructureSummary?.line ?? t.domain;
          const ledger = t.ledger ?? a?.infrastructureSummary?.ledger ?? null;
          return <HoverCard key={t.name} title={t.name} line={ledger ? `${line} · last: ${ledger}` : line} meta={word(status)}>
            <button type="button" data-role={t.name} className="siso-infra__face" disabled={!a} aria-label={`Open ${t.name}'s chat: ${word(status)}`} onClick={() => a && onOpen(a)}>
              <span className={`ab-ring is-${status ?? "off"}`}><AgentFace {...faceFor({ name: t.name, project: a?.project, status: status as Agent["status"] })} size={20} /></span>
              <b className="siso-infra__name" data-testid="infra-name">{t.name}</b>
              <i className={`siso-infra__dot is-${status ?? "off"}`} data-testid="infra-dot" data-status={status ?? "off"} title={word(status)} aria-hidden />
              {line && <span className="siso-infra__goal" data-testid="infra-goal">{line}</span>}
            </button>
          </HoverCard>;
        })}
      </span>
    </div>
  );
}

/** The side nav v4 (t-0563, approved by Shaan 8 Oct 23:52): Agent Zero starts the tree, each project hangs from it and its
 * sub-projects (a nav workspace whose parent is a nav workspace) hang inside it, then its own owners. No state words: a lit
 * ring is working, a small green number counts who is working. Idle owners stack, 2 x 2 from three, every name written. */
const NAV_FOLDER_ICON: Record<string, LivingIconName> = { clients: "rolodex", research: "web", playground: "estate" };
const CLOSED_BY_DEFAULT = new Set(["playground"]);
const ZERO_LINE = "rgba(34, 211, 238, 0.5)";
const soft = (hex: string, alpha = 0.55) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return ZERO_LINE; const n = parseInt(m[1], 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`; };
/** Playground holds the owners nothing places (no workspace, Unassigned, or an id the registry does not know); never a guess. */
const unplaced = (a: Agent, workspaces: NavWorkspace[]) => !a.workspace || a.workspace === "unassigned" || !workspaces.some(w => w.id === a.workspace);

/** t-0562: from the agent records. A helper is a +N on its owner's face, never a row; the machine shows only off the laptop. */
const HelperCount = ({ a }: { a: Agent }) => a.navHelpers ? <span className="ab-helpers" data-testid="nav-helpers" title={`${a.navHelpers} helper${a.navHelpers === 1 ? "" : "s"} running`}>+{a.navHelpers}</span> : null;
const OffLaptop = ({ a }: { a: Agent }) => a.away && machineKind(a.machineKey) !== "laptop" ? <MachineGlyph machineKey={a.machineKey} name={a.machine} size={11}/> : null;

function WorkspaceNav({ workspaces, agents, activeId, onOpen, onWorkspace, onFleet, onAdd, card }: { workspaces: NavWorkspace[]; agents: Agent[]; activeId: string | null; onOpen: (a: Agent, conversationTarget?: ConversationPinTarget) => void; onWorkspace?: (id: string) => void; onFleet?: (id: string) => void; onAdd: (w: NavWorkspace) => void; card: (a: Agent, node: ReactNode) => ReactNode }) {
  const [opened, setOpened] = useState<Record<string,boolean>>({});
  const groups = useSharedState<FleetBoardData>("/api/fleet-board", FLEET_BOARD_MS).data?.groups ?? [];
  const nav = workspaces.filter(w => w.nav).sort((a, b) => a.order - b.order);
  const isNested = (w: NavWorkspace) => !!w.parent && nav.some(p => p.id === w.parent);
  const live = agents.filter(a => a.navOwner && a.row === "live" && !isInfra(a.name));
  const ownersOf = (id: string) => {
    const own = live.filter(a => id === "playground" ? unplaced(a, workspaces) || navHome(a.workspace, workspaces) === id : navHome(a.workspace, workspaces) === id);
    const roots = own.filter(a => !own.some(p => p.id === a.navParentId));
    return roots.flatMap(a => [a, ...own.filter(c => c.navParentId === a.id)]);
  };
  const node = (w: NavWorkspace, parentTree: string, parentColor: string): ReactNode => {
    const kids = nav.filter(k => k.parent === w.id), owners = ownersOf(w.id), tree = `w:${w.id}`, line = soft(w.color);
    const open = opened[w.id] ?? !CLOSED_BY_DEFAULT.has(w.id), has = kids.length > 0 || owners.length > 0, folder = w.id in NAV_FOLDER_ICON;
    // Agents, not a chat's in-process sub-agents (6 Oct: HALO said "8 working" for its 2 owners and 6 sub-agents of one).
    const working = new Set(groups.filter(g => inWorkspace(g.id, w.id, workspaces)).flatMap(g => g.rows.filter(a => a.status === "working" && !a.crewParentId).map(a => a.id))).size;
    const toggle = () => { onWorkspace?.(w.id); setOpened(s => ({ ...s, [w.id]: !open })); };
    const busy = owners.filter(a => !a.navOffline && ["working", "needs", "failed"].includes(markOf(a))), idle = owners.filter(a => !busy.includes(a)).sort((x, y) => Number(!!x.navOffline) - Number(!!y.navOffline));
    return <div className="ab-workspace" data-workspace={w.id} key={w.id} style={{ "--workspace-color": w.color } as CSSProperties}>
      <div className="ab-workspace__card">
        <button type="button" className="ab-workspace__name" aria-expanded={has ? open : undefined} onClick={toggle}><WorkspaceLogo workspace={w} tree={tree} parent={parentTree} color={parentColor}/>{w.name}</button>
        {working > 0 && <button type="button" className="ab-workspace__working" aria-label={`Open ${w.name} Fleet: ${working} working`} title={`${working} working`} onClick={() => onFleet?.(w.id)}>{working}</button>}
        {has || folder ? <button type="button" aria-label={`Toggle ${w.name} owners`} aria-expanded={open} onClick={toggle}>{open ? <ChevronDownIcon size={14}/> : <ChevronRightIcon size={14}/>}</button>
          : <button type="button" aria-label={`Add an owner to ${w.name}`} onClick={() => { onWorkspace?.(w.id); onAdd(w); }}><PlusIcon size={14}/></button>}
      </div>
      {open && has && <div className="ab-workspace__kids">
        {/* A project's own owners first, then its sub-projects (t-0584, Shaan 9 Oct ~23:20: "Why does AgentBase own the
            SISO landing?": SISO-LANDING drew after UI Hub, under Agent Base's rows). */}
        {busy.map(a => <Fragment key={a.id}>{card(a, <button type="button" className={`ab-workspace__owner${owners.some(p => p.id === a.navParentId) ? " is-child" : ""}${activeId === a.id ? " is-active" : ""}`} data-owner={a.id} onClick={() => { onWorkspace?.(w.id); onOpen(a); }}>
          <span className={`ab-ring is-${a.status}`} data-tree-parent={tree} data-tree-color={line}><AgentFace {...faceFor(a)} size={20}/><HelperCount a={a}/></span><b>{a.name}</b><OffLaptop a={a}/><MobileContext agent={a}/>
        </button>)}</Fragment>)}
        {idle.length > 0 && <div className="ab-workspace__idle" data-testid="workspace-idle">
          <span className={`ab-workspace__idle-faces${idle.length >= 3 ? " is-grid" : ""}`} aria-hidden data-tree-parent={tree} data-tree-color={line}>{idle.slice(0, 4).map(a => <AgentFace key={a.id} {...faceFor(a)} size={18}/>)}</span>
          <span className="ab-workspace__idle-names">{idle.map((a, i) => <Fragment key={a.id}>{i > 0 && ", "}{card(a, <button type="button" data-owner={a.id} className={[activeId === a.id && "is-active", a.navOffline && "is-offline"].filter(Boolean).join(" ") || undefined} title={a.navOffline ? `${a.name} is stopped` : undefined} onClick={() => { onWorkspace?.(w.id); onOpen(a); }}>{a.name}<HelperCount a={a}/><OffLaptop a={a}/></button>)}</Fragment>)}</span>
        </div>}
        {kids.map(k => node(k, tree, line))}
      </div>}
    </div>;
  };
  return <div className="ab-workspaces" data-testid="nav-workspaces">{nav.filter(w => !isNested(w)).map(w => node(w, "zero", ZERO_LINE))}</div>;
}

/** v4's lines (t-0563): one SVG layer drawn from where the faces and icons actually are, so every line meets them exactly and
 * never breaks. An anchor carries data-tree-id (a parent) or data-tree-parent (its parent's id) and data-tree-color. Each
 * child gets an elbow from the bottom edge of its parent's icon to the left edge of its own face or icon: no gaps at either
 * end (his fix on top of v4). Children of one parent share x, so the trunk is continuous by construction. */
export function TreeLines({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null), svg = useRef<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    const el = root.current, layer = svg.current;
    if (!el || !layer) return;
    let frame = 0, drawn = "";
    const draw = () => {
      frame = 0;
      const R = el.getBoundingClientRect(), ids = new Map<string, DOMRect>();
      el.querySelectorAll<HTMLElement>("[data-tree-id]").forEach(n => ids.set(n.dataset.treeId!, n.getBoundingClientRect()));
      const paths: string[] = [];
      el.querySelectorAll<HTMLElement>("[data-tree-parent]").forEach(c => {
        const P = ids.get(c.dataset.treeParent!), C = c.getBoundingClientRect();
        if (!P || !P.width || !C.width) return;
        const x = (P.left + P.right) / 2 - R.left, y0 = P.bottom - R.top, cy = (C.top + C.bottom) / 2 - R.top, x1 = C.left - R.left;
        const k = Math.min(9, (cy - y0) / 2, (x1 - x) / 2);
        if (k <= 0) return;
        paths.push(`<path d="M${x.toFixed(1)} ${y0.toFixed(1)}V${(cy - k).toFixed(1)}Q${x.toFixed(1)} ${cy.toFixed(1)} ${(x + k).toFixed(1)} ${cy.toFixed(1)}H${x1.toFixed(1)}" stroke="${c.dataset.treeColor ?? ZERO_LINE}"/>`);
      });
      const html = paths.join("");
      if (html === drawn) return;
      drawn = html;
      layer.innerHTML = html;
      layer.dataset.lines = String(paths.length);
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(draw); };
    draw();
    const resize = new ResizeObserver(later); resize.observe(el);
    // Rows opening and closing; attributes are left out on purpose (the faces restyle themselves every frame).
    // The layer's own redraw is a childList change too: counting it redrew the lines every frame, forever (t-0586).
    const mutate = new MutationObserver(records => { if (records.some(r => !layer.contains(r.target))) later(); });
    mutate.observe(el, { childList: true, subtree: true });
    void document.fonts?.ready.then(later);
    return () => { resize.disconnect(); mutate.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return <div className="ab-tree" ref={root}>
    <svg ref={svg} className="ab-tree__lines" aria-hidden="true" data-testid="nav-tree-lines" fill="none" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round"/>
    {children}
  </div>;
}

/** Approved marks ship with the app; retain retry support for other workspace artwork. */
function MobileContext({ agent }: { agent: Agent }) {
  const pct = agent.hud?.context ?? agent.context;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const value = Math.round(Math.max(0, Math.min(100, pct)));
  return <span className={`ab-nav-context${value >= 90 ? " is-high" : ""}`} aria-label={`Context ${value}%`} title={`Context ${value}%`}>{value}%</span>;
}

/** The made marks for HALO, Agent Base and SISO Agency in the side nav's groups too (Shaan, 6 Oct 22:35: "the cool icons that
 *  we've made ... put the SISO agency one there"), centred in the row's icon box; any other project keeps its tinted mark. */
const BRAND: Record<string, "halo" | "agent-base" | "siso-agency"> = { halo: "halo", "agent base": "agent-base", "siso agency": "siso-agency" };
function BrandOr({ project }: { project: string }) {
  const brand = BRAND[project.trim().toLowerCase()];
  return brand ? <span className="ab-brand-mark" aria-hidden="true"><WorkspaceMark brand={brand} size={20}/></span> : <ProjectMark project={project} />;
}

function WorkspaceLogo({ workspace, tree, parent, color }: { workspace: NavWorkspace; tree?: string; parent?: string; color?: string }) {
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setMissing(false); setAttempt(0);
  }, [workspace.logo]);
  useEffect(() => {
    if (!missing) return;
    const timer = window.setInterval(() => { setAttempt(n => n + 1); setMissing(false); }, 30000);
    return () => window.clearInterval(timer);
  }, [missing]);
  return <span className="ab-workspace__logo" aria-hidden="true" data-tree-id={tree} data-tree-parent={parent} data-tree-color={color}>
    {workspace.id in NAV_FOLDER_ICON ? <LivingIcon name={NAV_FOLDER_ICON[workspace.id]} size={22} variant="glyph"/>
      : workspace.id === "ui-hub" ? <PaletteIcon size={18}/>
      : workspace.id === "agent-base" || workspace.id === "siso-agency" || workspace.id === "halo"
      ? <WorkspaceMark brand={workspace.id} size={22}/>
      : workspace.logo && !missing ? <img src={`/api/workspace-logos/${workspace.id}?retry=${attempt}`} alt="" onError={() => setMissing(true)}/> : <FolderIcon size={20}/>}
  </span>;
}
