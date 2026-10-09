import { HomePeek } from "./components/HomePeek";
// uihub: arc:command-palette — shared Spotlight entry points
import { pinTargetKey } from "../../../services/node/src/agent-pins";
import type { ConversationPinTarget } from "../../../services/node/src/conversation-route";
import { EndedPage } from "./components/EndedPage";
import { DashboardPage } from "./components/DashboardPage";
import { WorktreeSetupCard } from "./components/WorktreeSetupCard";
import { completeLaunchDraft, draftLaunchId, requestWorkspace, type WorkspaceChoice, type WorkspaceStatus } from "./lib/agents";
import { ChevronDownIcon, ArrowLeftIcon, LayoutGridIcon, CircleDollarSignIcon, LandmarkIcon, BarChart3Icon, Maximize2Icon, ServerIcon, BookOpenIcon, BookUserIcon, EllipsisIcon, ExpandIcon, GlobeIcon, HouseIcon, LayoutDashboardIcon, ListChecksIcon, MessageCircleIcon, MicIcon, NetworkIcon, PanelLeftIcon, PinIcon, PinOffIcon, PlusIcon, ScrollTextIcon, SparklesIcon, TerminalSquareIcon, Trash2Icon, UsersIcon, HeartPulseIcon } from "lucide-react";
import { workspaceOwners, navHome } from "./lib/workspace-nav";
import { SubagentView } from "./components/panel/SubagentView";
import { FleetBoard } from "./components/FleetBoard";
import { OwnerPage } from "./components/OwnerBoard";
import type { OwnerQuestionConnection } from "./components/OwnerSpaceModel";
import { useOwnerLinkNavigation, useOwnerNavigation } from "./lib/owners";
import { OwnerLinkToast } from "./components/OwnerLinkToast";
import { NotificationsBell } from "./components/NotificationsBell";
import { AppFrame, CHAT_DRAG, HoverCard, MenuButton, PAGE_DRAG, RailButton, TAB_DRAG, RailDivider, SidePanel, TopButton, TopTabs, load, save, setPersistPrefix, type MenuItem, type TopTab } from "@siso/shell";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AgentPanel, type PanelFocus } from "./components/AgentPanel";
import { BankWorkspacePalette } from "./components/BankNavigationAdapters";
import { BankWorkspaceChooser } from "./components/BankWorkspaceChooser";
import { CodexWorkerPage } from "./components/CodexWorkerPage";
import { ChatView, OPEN_PAGE, openLink, type People } from "./components/ChatView";
import { AgentFace, accentRgb, faceFor } from "./lib/face";
import { LivingIcon, WorkspaceMark, type LivingIconName } from "../../../packages/halo-face/living-assets";
import "./components/LivingNavigation.css";
import { AgentZeroPage } from "./components/AgentZeroPage";
import { isLibraryLocation } from "./components/LibraryNavigation";

const livingRailIcon = (name: LivingIconName) => (engaged: boolean) => <LivingIcon name={name} size={30} variant="glyph" active={engaged}/>;

import { ZeroDock } from "./components/ZeroDock";
import { useA0Page } from "./lib/a0-widgets";
import { closePage, nativeBrowserAvailable, onBrowserShortcut, onNewTab } from "./lib/webview";
import { duplicateTabs, sameUrl } from "./lib/browser-tabs";
import { canon, useHubAgents, useHubOrg, useHubProject } from "./lib/hub";
import { TasksAnswer, TasksPage, type TaskFocus } from "./components/TasksPage";
import { PAGE_HUE, PagePop, loadPopped, savePopped, type PoppedPage } from "./components/PagePop";
import { canonName, isDone, isParked, needsNames, openCounts, ownerNames, tasksOf, useA0Tasks } from "./lib/a0-tasks";
import { TasksWidget } from "./components/widgets/TasksWidget";
import { OrgChart } from "./components/OrgChart";
import { AttentionPanel } from './components/AttentionPanel';
import { attentionId, attentionPost, useAttention } from './lib/attention';
import { ProjectSpace } from "./components/ProjectSpace";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { ProjectRoute } from "./components/ProjectPage";
import { AgentBasePeek } from "./components/TaskBoard";
import { ChatHeader } from "./components/ChatHeader";
import { PingStrip } from "./components/PingStrip";
import { type PageRowProps } from "./components/PageRow";
import { needsHim, usePings } from "./lib/pings";
import { ZeroFace } from "./components/ZeroFace";
import { ZeroOrbit, type Need } from "./components/ZeroOrbit";
import { ZeroPipelineMetric } from "./components/DeliveryEvidence";
import type { MoveStatus, MoveTarget } from "../../../services/node/src/move";

/** Where an agent runs now, as Move to… names it (the HUD's model for Claude, Luna unless it says Sol for Codex). */
function modelOf(a: Agent): MoveTarget {
  const m = (a.hud?.model ?? "").toLowerCase();
  if (a.tool === "codex") return /sol/.test(m) ? "sol" : "luna";
  if (a.tool === "opencode" || /deepseek/.test(m)) return "deepseek";
  return /fable/.test(m) ? "fable" : /sonnet/.test(m) ? "sonnet" : "opus";
}
import { type Nav, PageView, hostOf } from "./components/Browser";
import { Hud, type HudMove } from "./components/Hud";
import { RecentOutput } from "./components/RecentOutput";
import { FaceDock, Sidebar, WORD, markOf } from "./components/Sidebar";
import { ServersPage } from "./components/ServersSpace";
import { MiniLanePage } from "./components/MiniLanes";
import { VoiceMain, VoiceSidebar, voiceHealth, type VoiceSelection } from "./components/VoiceSpace";
import { useVoiceStatus } from "@siso/voice";
import { type Agent, type Page, byWhoNeedsYou, isUnseenDone, navState, sidebarOrder, useAgents, useOrg, useStats } from "./lib/agents";
import { OrgPage } from "./components/OrgPage";
const TokensPage = lazy(() => import("./components/UsagePage").then((m) => ({ default: m.UsagePage })));
const StatsPage = lazy(() => import("./components/StatsPage").then((m) => ({ default: m.StatsPage })));
const FleetStatsPage = lazy(() => import("./components/UsagePage").then((m) => ({ default: m.UsagePage })));
const StatsAnswer = lazy(() => import("./components/FleetStats").then((m) => ({ default: m.StatsAnswer })));
const LibrarySpace = lazy(() => import("./components/LibrarySpace").then((m) => ({ default: m.LibrarySpace })));
const LiveStrip = lazy(() => import("./components/LibrarySpace").then((m) => ({ default: m.LiveStrip })));
import { prefill } from "./lib/prefill";
import { RolodexMain, RolodexSidebar, useRolodexBook, type RolodexSelection } from "./components/RolodexSpace";
const WhatsAppSpace = lazy(() => import("./components/WhatsAppSpace").then((m) => ({ default: m.WhatsAppSpace })));
const LifeSidebar = lazy(() => import("./components/LifeSpace").then((m) => ({ default: m.LifeSidebar })));
const LifeMain = lazy(() => import("./components/LifeSpace").then((m) => ({ default: m.LifeMain })));
import { HistoryButtons } from "./components/HistoryButtons";
import "./components/HistoryButtons.css";
import "./components/Phone.css";
import { TasksSheet } from "./components/phone/TasksSheet";
import "./components/ZeroSpot.css";
import { PANEL_DRAG, TopNav, type PanelPage, type TopPage } from "./components/TopNav";
import { SpendChip } from "./components/SpendChip";
import { Boundary } from "./components/Boundary";
import { agentPinLabel, canEditAgentPin, toggleAgentPin } from "./lib/pin-actions";
import { getPage } from "./pages/registry";
import "./pages/load";
import { VersionPill, WhatsNewPage } from "./components/WhatsNew";
import { ScratchpadChip, A0FleetChips } from "./components/Scratchpad";
import { createPageHistory } from "./lib/nav";
import { BY_HIM, isEditable, recordSelection, type SelectCause } from "./lib/selection";
import { useEnded, type Ended } from "./lib/ended";
import { TerminalLoadBoundary } from "./components/TerminalLoadBoundary";
import { recoverPersistedJson } from "./lib/persist";
import { ResearchPage } from "./components/ResearchPage";
import { AgentCanvas } from "./components/AgentCanvas";
import { ProductMap } from "./components/ProductMap";
import { RemoteInventory } from "./components/RemoteInventory";
import { useSharedState } from "./lib/poll";
import type { Research, ResearchSelection } from "../../../services/node/src/research";
import { CodexWorkPage } from "./components/CodexWorkPage";

recoverPersistedJson();
setPersistPrefix("agent-base:");

const TerminalView = lazy(() => import("@siso/terminal").then(({ TerminalView: View }) => ({ default: View })));
const TerminalFallback = () => <div role="status" className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">Loading terminal…</div>;

/** Terminals kept attached so switching back is instant; the least recently opened detaches past this. */
const KEEP_MOUNTED = 8;

/** What fills the frame: the chat (the open agent), or one tab full width (a page, a new tab, a terminal). */
type View = { kind: "chat" } | { kind: "tab"; id: string };
/** Pages of the app itself that open in the main area with a back control: Agent Zero's Tasks and hub-7's org chart. */
type AppPage = "ended-list" | "dashboard" | "tasks" | "orgchart" | "stats" | "starred" | "whatsnew" | "codex-work" | "research" | "canvas" | "product-map";
/** Pages the top row opens (R1.2): no tab of their own. */
const TOP_ROW_PAGES: AppPage[] = ["orgchart", "tasks", "stats"];
const APP_PAGES: Record<AppPage, string> = { "ended-list": "Ended", dashboard: "Dashboard", tasks: "Tasks", orgchart: "Org chart", stats: "Usage", starred: "Starred", whatsnew: "What’s new", "codex-work": "Codex work", research: "Research", canvas: "Canvas", "product-map": "Product map" };
const isAppPage = (id: string): id is AppPage => id in APP_PAGES;
/** Where he is, as back and forward remember it (hub-11): the space, the main area, the dashboard (`a` stays null: QA #11). */
/** What the "org" tab shows: a group's or a project's dashboard, or a Mac mini lane's page (mini-lanes). */
type OrgView = { group: string } | { project: string } | { lane: string };
type Loc = { s: string; v: View; a: string | null; o: OrgView | null; t?: TaskFocus | null };
const encodeLoc = (l: Loc) => `at=${encodeURIComponent(JSON.stringify(l))}`;
const LOC_SPACES = new Set(["agents", "voice", "servers", "tokens", "rolodex", "library", "whatsapp", "estate", "web"]);
const decodeLoc = (h: string): Loc | null => {
  if (!h.startsWith("at=")) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(h.slice(3))) as any;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.s !== "string" || !LOC_SPACES.has(raw.s)) return null;
    const v = raw.v;
    if (!v || typeof v !== "object" || Array.isArray(v) || (v.kind !== "chat" && v.kind !== "tab") || (v.kind === "tab" && typeof v.id !== "string")) return null;
    if (raw.a !== null && typeof raw.a !== "string") return null;
    const o = raw.o;
    if (o !== null) {
      if (!o || typeof o !== "object" || Array.isArray(o)) return null;
      const hasGroup = Object.prototype.hasOwnProperty.call(o, "group");
      const hasProject = Object.prototype.hasOwnProperty.call(o, "project");
      if (hasGroup === hasProject) return null;
      if (hasGroup && typeof o.group !== "string") return null;
      if (hasProject && typeof o.project !== "string") return null;
    }
    const t = raw.t;
    if (t != null && (typeof t !== "object" || Array.isArray(t) || (t.id !== undefined && typeof t.id !== "string") || (t.stages !== undefined && (!Array.isArray(t.stages) || !t.stages.every((s: unknown) => typeof s === "string"))) || (t.needs !== undefined && typeof t.needs !== "boolean"))) return null;
    return { s: raw.s, v: v.kind === "chat" ? { kind: "chat" } : { kind: "tab", id: v.id }, a: raw.a, o, t: t ?? null };
  } catch {
    return null;
  }
};
/**
 * A tab he opened (Codex's new tab, a link he clicked in a chat, a page from the strip): a web tab or a plain terminal.
 * R1.22 (tab bar spec option C): each belongs to the agent it was opened on (`owner`, its name; "web" with no agent
 * open), and the top row shows only the open agent's. A tab whose agent has left herdr shows under "web", never deleted.
 */
/** `by`: "him" when his own click, key or drop opened it (3 Oct: pages never open on their own; a tab without it predates the mark). */
/** `pin`: the browser pin or favourite this tab is (browser v3: `pin:<space>:<url>` or `fav:<url>`), so a pin is one live tab. */
type OpenTab = { id: string; kind: "web" | "term"; title: string; owner: string; by?: "him"; pin?: string };
/** The saved tabs, each one a real tab: a null, a number or a record without an id is dropped (overnight QA, 3 Oct). */
const savedTabs = () =>
  load<unknown[]>("open-tabs", []).filter((t): t is OpenTab => !!t && typeof t === "object" && typeof (t as OpenTab).id === "string" && ((t as OpenTab).kind === "web" || (t as OpenTab).kind === "term"));
/** His gesture is behind this call: a real (trusted) press or key in the last 1.5 s. WebKit's own userActivation reads
 * active with no press at all, so the app keeps its own. */
let gestureAt = 0;
if (typeof window !== "undefined")
  for (const t of ["pointerdown", "keydown"] as const) window.addEventListener(t, (e) => e.isTrusted && (gestureAt = Date.now()), true);
const hisGesture = () => Date.now() - gestureAt < 1500;
/** What a page drag carries (PAGE_DRAG): a top-row tab adds its id, so a split or a move keeps that tab's native page. */
type Dragged = { url: string; title?: string; tab?: string };
/** A tab's name: its page's title; a bare address reads as its last path segment ("a0-link"), else its host. */
const tabLabel = (title: string, url: string) => {
  if (!url || (title && title !== hostOf(url) && title !== url && !/^https?:\/\//.test(title))) return title;
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).at(-1) ?? "") || u.hostname.replace(/^www\./, "");
  } catch {
    return title;
  }
};
const tabId = () => `tab:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
/** `t` placed before the tab `before` (null, or a tab not in the list: at the end). */
const insertBefore = (ts: OpenTab[], t: OpenTab, before: string | null) => {
  const i = before ? ts.findIndex((x) => x.id === before) : -1;
  return i < 0 ? [...ts, t] : [...ts.slice(0, i), t, ...ts.slice(i)];
};
/**
 * One thing beside the chat at a time (Codex's right panel): a page split in, the crew (a list, then one of them with a
 * back arrow), the chat's Stats page, or a card surface.
 */
type Surface = "page" | "output";
type Side = { kind: "split"; page: Page; tab: string } | { kind: "crew"; id: string | null } | { kind: "stats" } | { kind: "surface"; s: Surface } | null;

/**
 * Screen 1, option B (2 Oct): the side nav lists agents by who they work for; the top bar is tabs, the cmux way: the
 * open chat, that agent's own pages, then his pinned pages. A page opens full width; dragged onto the chat it splits.
 * A crew row in the side nav opens that agent as the chat (one pane per thing); from the summary card the crew open
 * in the right panel with a back arrow, as Codex shows sub-agents. Agents opened stay attached (up to 8).
 */
const NARROW = "(max-width: 639px)";
const PANEL_FOLDS_NAV = "(min-width: 640px) and (max-width: 1199px)";
/** t-0263: on a phone the side nav is a full-screen sheet over the chat (Phone.css); on a laptop it is left as it is. */
function PhoneSheet({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? (
    <div className="ab-phone-nav" data-testid="phone-nav">
      {children}
    </div>
  ) : (
    <>{children}</>
  );
}

function CanvasPage(props: Pick<Parameters<typeof AgentCanvas>[0], "agents" | "onOpenAgent" | "onOpenResearch" | "onOpenPage" | "onClose">) {
  const research = useSharedState<Research>("/api/research", 10_000);
  return <AgentCanvas {...props} research={research.data} researchError={research.error} />;
}

export function App() {
  const [ownerQuestions, setOwnerQuestions] = useState<Record<string, OwnerQuestionConnection>>({});
  const onOwnerQuestions = useCallback((id: string, connection: OwnerQuestionConnection | null) => setOwnerQuestions(current => {
    if (connection) return {...current,[id]:connection};
    if (!current[id]) return current;
    const {[id]: _gone,...rest}=current; return rest;
  }), []);
  const [researchSelection, setResearchSelection] = useState<ResearchSelection | null>(null);
  const orbitResearch = useSharedState<Research>("/api/research", 10_000);
  const { agents, error, down, asOf, act, reorder, reorderProjects, edit, editError, clearEditError, domains, pins, pinnedPages, recentPages, workspaces } = useAgents();
  const [navWorkspace, setNavWorkspace] = useState<string | null>(() => {
    const saved = load<unknown>("nav.workspace", null);
    return typeof saved === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(saved) ? saved : null;
  });
  useEffect(() => save("nav.workspace", navWorkspace), [navWorkspace]);
  const [fleetWorkspace, setFleetWorkspace] = useState<string | null>(null);
  const [fleetDrill, setFleetDrill] = useState<{ parent: string; id: string; name: string } | null>(null);
  const [mounted, setMounted] = useState<string[]>(() => load<unknown[]>("open", []).filter((x): x is string => typeof x === "string"));
  const [activeId, setActiveId] = useState<string | null>(() => load("active", null));
  const [pinnedChats, setPinnedChats] = useState<Record<string, { target: ConversationPinTarget; agent: Agent }>>({});
  // Reload must not turn a sealed selection into an ordinary same-ID or same-name open.
  const skipPinRestore = useRef(load<boolean>("active-pin", false));
  const pinnedChatsNow = useRef(pinnedChats);
  pinnedChatsNow.current = pinnedChats;
  // t-0265 ("sometimes I keep auto switching to the efficiency agent"): every change of the open agent goes through
  // select(), which records who it was, who it is now and why (lib/selection.ts). The app never switches on its own
  // while he is typing or within 10 s of his own pick; a back or forward is held only while he types.
  const activeNow = useRef(activeId);
  activeNow.current = activeId;
  const namesNow = useRef(new Map<string, string>());
  namesNow.current = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const pickedAt = useRef(0);
  const typedAt = useRef(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && (e.key.length === 1 || e.key === "Backspace") && isEditable(e.target)) typedAt.current = Date.now();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  const select = useCallback((to: string | null, cause: SelectCause) => {
    const from = activeNow.current;
    if (from && pinnedChatsNow.current[from] && (cause === "seat-follow" || cause === "moved")) return false;
    if (to === from) return true;
    const now = Date.now();
    const typing = now - typedAt.current < 5000 && isEditable(document.activeElement);
    const blocked = cause === "seat-follow" ? undefined : BY_HIM.has(cause) ? (cause === "history" && typing ? "typing" : undefined) : typing ? "typing" : now - pickedAt.current < 10_000 ? "own-click" : undefined;
    const name = (id: string | null) => (id ? namesNow.current.get(id) ?? id : null);
    recordSelection({ from: name(from), to: name(to), cause, at: now, ...(blocked ? { blocked } : {}) });
    if (blocked) return false;
    if (BY_HIM.has(cause) && cause !== "history") pickedAt.current = now;
    activeNow.current = to;
    setActiveId(to);
    return true;
  }, []);
  // R1.23: the right panel, open or closed per agent kind (Agent Zero's opens by default and stays: a0-017). A page that
  // is not an agent's chat (Stats, Servers, Tokens, the Library…) keeps its own, closed until he opens it there (Shaan
  // 3 Oct 05:00: "hide the agent base on the right hand side, I'm not sure why that's needed or why it pops up there").
  const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>(() => ({ zero: load("panel.open.zero", !window.matchMedia(NARROW).matches), agent: load("panel.open.agent", false) }));
  const [selectedNowLane, setSelectedNowLane] = useState<string | null>(null);
  const [panelFocus, setPanelFocus] = useState<PanelFocus>(null);
  const drilled = useRef(false);
  // R1.17: the owner whose Tasks list sits beside its chat, and a task the full board should open on.
  const [tasksFor, setTasksFor] = useState<string | null>(null);
  /** A phone's Tasks sheet over a chat, header to composer, so he talks while he looks (phone spec §3 A): whose, or none. */
  const [phoneTasks, setPhoneTasks] = useState<string | null>(null);
  const closePhoneTasks = useCallback(() => setPhoneTasks(null), []);
  const [taskFocus, setTaskFocus] = useState<TaskFocus | null>(null);
  const { index: taskIndex } = useA0Tasks();
  const taskCounts = useMemo(() => openCounts(taskIndex?.tasks ?? []), [taskIndex]);
  const openTaskCount = useMemo(() => [...taskCounts.values()].reduce((a, b) => a + b, 0), [taskCounts]);
  // Sidenav D3: an open needs-Shaan task naming an agent makes it "needs you", as herdr's own needs state does.
  const needs = useMemo(() => needsNames(taskIndex?.tasks ?? []), [taskIndex]);
  // Landed work waiting for his rating is "Landed · rate it" in the Tasks card, not "needs you" (5 Oct: "it says needs
  // you but there's nothing I can click on which actually leads me to something useful").
  const needTasks = useMemo(() => (taskIndex?.tasks ?? []).filter((t) => t.needs && !isDone(t) && !isParked(t) && t.stage !== "preview" && t.stage !== "feedback"), [taskIndex]);
  // QA #19 (A0, 3 Oct): the open page outlives a reload or relaunch (Tasks was lost): an app page, or a tab still open.
  const [view, setView] = useState<View>(() => {
    const v = load<View | null>("view", null);
    if (v?.kind !== "tab" || typeof v.id !== "string") return { kind: "chat" };
    return isAppPage(v.id) || savedTabs().some((t) => t.id === v.id) ? v : { kind: "chat" };
  });
  const [side, setSide] = useState<Side>(null);
  const [sideFull, setSideFull] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => load("sidebar-open", true));
  // Below 640 px the nav never shares the width with a chat (HUB-DESIGN 21:22): it overlays the chat full width, and
  // picking an agent closes it. A phone's open/closed is not saved, so the laptop's choice survives.
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [panelFoldsNav, setPanelFoldsNav] = useState(() => window.matchMedia(PANEL_FOLDS_NAV).matches);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  useEffect(() => {
    const m = window.matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const media = window.matchMedia(PANEL_FOLDS_NAV);
    const sync = () => setPanelFoldsNav(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  // Tabs saved before R1.22 had no owner: they belong to no agent ("web") until he moves them.
  const [openTabs, setOpenTabs] = useState<OpenTab[]>(() => savedTabs().map((t) => ({ ...t, owner: t.owner ?? "web" })));
  /** Each agent's last tab ("chat" or a tab id): opening the agent goes back to it (tab bar spec §3.3). */
  const [lastTab, setLastTab] = useState<Record<string, string>>(() => load("last-tab", {}));
  /** When he last looked at each agent's dropped-in pages (ms): newer ones carry the orange dot. */
  const [stripSeen, setStripSeen] = useState<Record<string, number>>(() => load("strip-seen", {}));
  /** A page drag is running (a tab, a strip icon, a chat link): the strip shows its zones even when empty. */
  const [pageDragging, setPageDragging] = useState(false);
  /** The agent whose chat is read beside the page he is on (its chat tab dropped on the page). */
  const [chatBeside, setChatBeside] = useState<string | null>(null);
  // Servers or Tokens popped out into the right panel (servers-tokens §4): it stays beside whatever the main pane shows.
  const [panelPage, setPanelPage] = useState<PanelPage | null>(() => load<PanelPage | null>("panel-page", null));
  const [panelDragging, setPanelDragging] = useState(false);
  const [besideDrop, setBesideDrop] = useState(false);
  /** Each tab's address and history, kept here (a framed page's own history cannot be read). */
  const [nav, setNav] = useState<Record<string, Nav>>(() => load("tab-nav", {}));
  const [dropping, setDropping] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  // Why the last "Move to the app's chat" did not happen, per agent id (shown on the menu item until the next try).
  const [moveErr, setMoveErr] = useState<Record<string, string>>({});
  /** New chats use the durable workspace receipt and supervised host lifecycle. */
  const [launchWorkspace,setLaunchWorkspace]=useState<string|null>(()=>sessionStorage.getItem("ab-current-workspace"));
  const acceptWorkspace=(r:WorkspaceStatus)=>{setLaunchWorkspace(r.workspaceId);sessionStorage.setItem("ab-current-workspace",r.workspaceId);};
  const startAgent = async (s: { name: string; project: string }) => {
    const r = await fetch("/api/agents/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({...s,repo:s.project,launchId:draftLaunchId(`agent:${s.name}:${s.project}`),workspace:{type:"isolated"}}) })
      .then((x) => x.json())
      .catch(() => ({ error: "no answer from the node" }));
    if(r.workspaceId){acceptWorkspace(r);completeLaunchDraft(`agent:${s.name}:${s.project}`);}
    return r.error ? String(r.error) : null;
  };
  /** His words name the new agent; the explicit workspace receipt opens its native chat. */
  const [opening, setOpening] = useState<string | null>(null);
  const sayStart = async (say: string, choice?: WorkspaceChoice) => {
    const r = await fetch("/api/agents/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ say,...choice,launchId:draftLaunchId(`say:${say}:${JSON.stringify(choice)}`) }) })
      .then((x) => x.json())
      .catch(() => ({ error: "No answer from the node." }));
    if(r.workspaceId){acceptWorkspace(r);completeLaunchDraft(`say:${say}:${JSON.stringify(choice)}`);}
    else if (r.name && !r.error) setOpening(r.name);
    return r as { name?: string; project?: string | null; why?: string; error?: string };
  };
  const askZero = async (words: string) => {
    const r = await fetch("/api/a0/tell", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Start a new agent for this, in the project it belongs to: ${words}` }) })
      .then((x) => x.json())
      .catch(() => ({ error: "No answer from the node." }));
    return r.ok ? null : String(r.error ?? "Agent Zero did not get it.");
  };
  /** The app pages open as tabs, and where Back returns to (the view and space they were opened from). */
  const [appPages, setAppPages] = useState<AppPage[]>(() => (view.kind === "tab" && isAppPage(view.id) ? [view.id] : []));
  const [backTo, setBackTo] = useState<{ view: View; space: string } | null>(null);
  const { org, orgOp, orgDown } = useOrg();
  /** A group's or a project's dashboard, shown in the main area as its own tab (SIDENAV-GROUPS.md). */
  // R1.25: agents that left herdr, and the one whose chat is open read-only.
  const ended = useEnded();
  const [endedOpen, setEndedOpen] = useState<Ended | null>(null);
  const [orgPage, setOrgPage] = useState<OrgView | null>(null);
  // A "#project/<name>" link (the Rolodex's project links) opens that project's page.
  useEffect(() => {
    const go = () => {
      const m = /^#project\/(.+)$/.exec(location.hash);
      if (!m || !org) return;
      let name: string;
      try { name = decodeURIComponent(m[1]); } catch { return; }
      const p = org.groups.flatMap((g) => g.projects).find((x) => x.name.toLowerCase() === name.toLowerCase() || x.id === name);
      history.replaceState(null, "", location.pathname);
      // Not in the org (a client he has not shown): its page still opens, from the node.
      setOrgPage({ project: p?.id ?? name });
      setSpace("agents");
      setView({ kind: "tab", id: "org" });
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [org]);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Who other agents are, for peer messages in a chat: their mark and project (the colour comes from the project). */
  // Keyed by name and by pane id (R1.20c: an `a0-tell w7:p3 …` resolves to the agent in that pane; he never sees a pane id).
  // The same object while nobody's name, mark, project or state changes, so the mounted chats need not redraw (t-0237).
  const peopleWas = useRef<{ key: string; value: People }>({ key: "", value: {} });
  const people = useMemo(() => {
    const value: People = Object.fromEntries(
      (agents ?? []).flatMap((a) => {
        const who = { name: a.name, icon: a.icon ?? null, project: a.project ?? a.folder, status: a.status };
        return [[a.name.toUpperCase(), who], ...(a.pane ? [[a.pane.toUpperCase(), who]] : [])];
      }),
    );
    const key = JSON.stringify(value);
    if (key !== peopleWas.current.key) peopleWas.current = { key, value };
    return peopleWas.current.value;
  }, [agents]);
  /** Agents he is watching as their terminal rather than the app's chat (any agent with a chat). */
  const [asTerminal, setAsTerminal] = useState<Record<string, boolean>>(() => load("as-terminal", {}));
  useEffect(() => save("as-terminal", asTerminal), [asTerminal]);
  /** Which space fills the frame: the agents, or Voice (his dictation history and stats, from SISO Voice). */
  const [space, setSpace] = useState<"agents" | "pinboard" | "voice" | "servers" | "tokens" | "rolodex" | "library" | "whatsapp" | "estate" | "life" | "web">(() => isLibraryLocation(location.hash) ? "library" : load("space", "agents"));
  const [libraryKey, setLibraryKey] = useState(() => isLibraryLocation(location.hash) ? location.hash.slice(1) : "library/docs");
  useEffect(() => {
    const openLibraryRoute = () => {
      if (!isLibraryLocation(location.hash)) return;
      setLibraryKey(location.hash.slice(1));
      setSpace("library");
      setView({ kind: "chat" });
    };
    openLibraryRoute();
    window.addEventListener("hashchange", openLibraryRoute);
    return () => window.removeEventListener("hashchange", openLibraryRoute);
  }, []);
  // The Estate world mounts on first hover or open, stays mounted while hidden, and unmounts after ten minutes away.
  const [pinProject, setPinProject] = useState<string>(() => load("pin-project", "agent-base"));
  const [spaceFocus, setSpaceFocus] = useState<string | null>(null);
  const openSpace = (project: string, agent: string | null = null) => { setPinProject(project); save("pin-project", project); setSpaceFocus(agent); setSpace("pinboard"); setView({ kind: "chat" }); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (document.querySelector(".wp-dialog[open]")) return; if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (space === "pinboard") setSpace("agents"); else openSpace((agents ?? []).find(a => a.id === activeId)?.project ?? "agent-base", activeId); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [space, agents, activeId]);
  const [estateKept, setEstateKept] = useState(space === "estate");
  // t-0497: Rolodex stays mounted (hidden) after its first visit, like Estate, so going back does not rebuild it.
  const rolodexOn = space === "rolodex" && view.kind === "chat";
  const [rolodexKept, setRolodexKept] = useState(rolodexOn);
  useEffect(() => { if (rolodexOn) setRolodexKept(true); }, [rolodexOn]);
  // The Estate is the land and the Library a building on it (Shaan, 7 Oct): one rail icon, a World | Library | Register switch.
  // World is the 3D estate, Library is LIBRARY's reader (/library-site/), Register is the old Library space (built, live, Works).
  const [estatePane, setEstatePane] = useState<"world" | "library">(() => load("estate-pane", "library"));
  useEffect(() => save("estate-pane", estatePane), [estatePane]);
  const estateArea = (space === "estate" || space === "library") && view.kind === "chat";
  const estateOn = space === "estate" && view.kind === "chat" && estatePane === "world";
  const libraryOn = space === "estate" && view.kind === "chat" && estatePane === "library";
  const [libraryKept, setLibraryKept] = useState(libraryOn);
  useEffect(() => { if (libraryOn) setLibraryKept(true); }, [libraryOn]);
  const [librarySrc, setLibrarySrc] = useState("/library-site/");
  // The world (or any same-origin page) opens the Library with postMessage({ estate: { library: "d/..." } }); "" is its home.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const want = e.origin === location.origin ? e.data?.estate?.library : undefined;
      if (typeof want !== "string") return;
      setLibrarySrc(`/library-site/${want.replace(/^\/+/, "")}`); setEstatePane("library"); setSpace("estate"); setView({ kind: "chat" });
    };
    window.addEventListener("message", onMsg); return () => window.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => {
    if (estateOn) { setEstateKept(true); return; }
    if (!estateKept) return;
    const t = window.setTimeout(() => setEstateKept(false), 10 * 60_000);
    return () => window.clearTimeout(t);
  }, [estateOn, estateKept]);
  // WhatsApp (WA-1): the rail button shows only when this Mac has the link configured (the feature flag is the config).
  const [whatsappOn, setWhatsappOn] = useState(false);
  useEffect(() => {
    fetch("/api/whatsapp/config", { cache: "no-store" }).then((r) => r.json()).then((c) => setWhatsappOn(!!c?.configured)).catch(() => setWhatsappOn(false));
  }, []);
  // Life (LIFE, 3 Oct): his life tracker and XP, from siso-life on siso-vps; the rail icon shows only when this Mac
  // has the API configured. "an icon in the agent space called life and then it's got its own side nav".
  const [lifeOn, setLifeOn] = useState(false);
  useEffect(() => {
    fetch("/api/life/status", { cache: "no-store" }).then((r) => r.json()).then((c) => setLifeOn(!!c?.configured)).catch(() => setLifeOn(false));
  }, []);
  const [lifeSel, setLifeSel] = useState<string>(() => load("life-sel", "today"));
  useEffect(() => save("life-sel", lifeSel), [lifeSel]);
  // The Rolodex v3 (ROLODEX, 7 Oct): six levels, the WhatsApp sort deck and the person page, read when the space opens.
  const rolodexBook = useRolodexBook(space === "rolodex");
  const [rolodexSel, setRolodexSel] = useState<RolodexSelection>(() => load("rolodex-sel", "all"));
  const [rolodexPerson, setRolodexPerson] = useState<string | null>(null);
  useEffect(() => save("rolodex-sel", rolodexSel), [rolodexSel]);
  const [voiceSel, setVoiceSel] = useState<VoiceSelection>(() => load("voice-sel", "home"));
  /** SISO Voice's services (t-0271): the Voice rail button shows a dot while one is down and could not be restarted. */
  const voiceDown = voiceHealth(useVoiceStatus(undefined, 60_000).data) === "down";

  const byId = useMemo(() => {
    const rows = new Map((agents ?? []).map((a) => [a.id, a]));
    for (const [id, selection] of Object.entries(pinnedChats)) rows.set(id, selection.agent);
    return rows;
  }, [agents, pinnedChats]);
  const active = activeId ? byId.get(activeId) ?? null : null;
  const activeConversationTarget = activeId ? pinnedChats[activeId]?.target : undefined;
  const peeked = side?.kind === "crew" && side.id ? byId.get(side.id) ?? null : null;
  // A terminal whose agent herdr no longer lists is dropped; while the list is unknown nothing is. A crew member shown
  // in the right panel is attached there instead (two takeover attaches to one terminal would fight).
  const live = useMemo(() => (agents === null ? mounted : mounted.filter((id) => byId.has(id))).filter((id) => id !== peeked?.id), [agents, mounted, byId, peeked]);
  const order = useMemo(() => sidebarOrder(agents ?? [], domains), [agents, domains]);
  const needsYou = useMemo(() => (agents ?? []).filter((a) => a.row === "live" && !a.zero && navState(a, needs) === "needs"), [agents, needs]);
  const crew = useMemo(() => (active ? (agents ?? []).filter((a) => a.lead === active.name && a.row === "live") : []), [agents, active]);
  // An agent's chat, or the kind of page he is on (its panel remembered per kind: "page.stats", "page.web"…).
  const onChat = space === "agents" && view.kind === "chat";
  const panelKind = onChat
    ? active?.zero
      ? "zero"
      : "agent"
    : `page.${space !== "agents" ? space : view.kind === "tab" && (isAppPage(view.id) || view.id === "zero" || view.id === "org" || view.id === "ended") ? view.id : openTabs.some((t) => view.kind === "tab" && t.id === view.id && t.kind === "term") ? "term" : "web"}`;
  const [dockOpen, setDockOpen] = useState(false);
  const cardOpen = panelOpen[panelKind] ?? load(`panel.open.${panelKind}`, false);
  // One side surface at a time (HUB-DESIGN 00:58): a page, the crew, Stats or A0's news beside the chat hides the right
  // panel, which comes back when that closes, so the chat keeps its width.
  const panelShown = onChat && cardOpen && !side && !dockOpen;
  const navTemporarilyFolded = panelFoldsNav && (panelShown || (!onChat && space !== "pinboard" && cardOpen && !dockOpen && !!active) || (onChat && !!side) || !!panelPage || !!fleetWorkspace);
  const setCardOpen = useCallback(
    (v: boolean | ((was: boolean) => boolean)) =>
      setPanelOpen((p) => {
        const next = typeof v === "function" ? v(p[panelKind] ?? load(`panel.open.${panelKind}`, false)) : v;
        return { ...p, [panelKind]: next };
      }),
    [panelKind],
  );
  // Persist after React commits: updater functions may run twice in StrictMode.
  // Writing inside the updater made the first toggle of a saved page flip twice.
  useEffect(() => {
    for (const [kind, opened] of Object.entries(panelOpen)) save(`panel.open.${kind}`, opened);
  }, [panelOpen]);
  const toggleSidebar = useCallback(() => {
    if (navTemporarilyFolded) {
      setCardOpen(false);
      setSide(null);
      setPanelPage(null);
      setFleetWorkspace(null);
      setSidebarOpen(true);
    } else setSidebarOpen(v => !v);
  }, [navTemporarilyFolded, setCardOpen]);
  // The header's "Tasks · N" and the side nav's task count open the panel at Tasks (rightpanel SPEC §4).
  useEffect(() => {
    if (!active || tasksFor !== active.name) return;
    setSide(null);
    setCardOpen(true);
    setPanelFocus({ section: "tasks", at: Date.now() });
    setTasksFor(null);
  }, [tasksFor, active, setCardOpen]);
  // R1.21 the chat header: its pings, its tasks (how many need him), and what it holds now (the R1.2 doing-now, 8 words).
  const pings = usePings(activeConversationTarget ? null : active?.id ?? null);
  // Each open chat's latest step (ChatView announces it): line 2's doing-now when nothing else says.
  const [lastStep, setLastStep] = useState<Record<string, string>>({});
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ agentId?: string; last?: string }>).detail;
      if (d?.agentId) setLastStep((m) => (m[d.agentId!] === (d.last ?? "") ? m : { ...m, [d.agentId!]: d.last ?? "" }));
    };
    window.addEventListener("siso-chat-activity", on);
    return () => window.removeEventListener("siso-chat-activity", on);
  }, []);
  const headOnIt = (a: Agent) => {
    const plan = org?.groups.flatMap((g) => g.projects).flatMap((p) => p.owners).find((o) => o.name === a.name)?.plan;
    // A title that only repeats its name ("A0" for Agent Zero) says nothing it is doing.
    const title = /^(a0|agent zero)$/i.test(a.title.trim()) || a.title.trim().toUpperCase() === a.name.toUpperCase() ? "" : a.title;
    return plan?.items.find((i) => i.status === "building" && i.title)?.title ?? (title || "");
  };
  const headDoing = (a: Agent) => headOnIt(a) || lastStep[a.id] || "";
  const headTasks = useMemo(() => {
    if (!active) return null;
    const mine = (taskIndex?.tasks ?? []).filter((t) => !isDone(t));
    const own = active.zero ? mine : tasksOf(mine, active.name);
    if (!active.zero && !own.length && !taskCounts.has(canonName(active.name))) return null;
    return { open: own.length, needs: own.filter((t) => t.needs && !isParked(t)).length };
  }, [active, taskIndex, taskCounts]);
  const needText = useMemo(() => {
    if (!active) return null;
    const ping = pings.unread.find(needsHim);
    if (ping?.needs) return ping.needs;
    const open = (taskIndex?.tasks ?? []).filter((t) => t.needs && !isDone(t) && !isParked(t));
    const t = (active.zero ? open : tasksOf(open, active.name)).sort((a, b) => b.updated.localeCompare(a.updated))[0];
    return t ? (t.next ?? t.title).replace(/^\s*NOW:\s*/i, "") : null;
  }, [active, pings.unread, taskIndex]);
  const stats = useStats(active?.id ?? null, cardOpen || side?.kind === "stats");

  useEffect(() => save("open", mounted.filter(id => !pinnedChats[id])), [mounted, pinnedChats]);
  useEffect(() => {
    save("active", activeConversationTarget ? null : activeId);
    save("active-pin", !!activeConversationTarget || skipPinRestore.current);
  }, [activeId, activeConversationTarget]);
  // Restore the open agent after a relaunch (brief 18:41: the app came back on "Pick an agent on the left"). Its terminal
  // id can change across a herdr or app restart, so the agent is found again by its key (machine/NAME). When nothing
  // restores, Agent Zero's chat opens (not on a phone, where the nav is the first screen). The list can arrive in parts
  // (the app's own chats join a beat after herdr's), so a missing agent gets 3 s before the fallback.
  useEffect(() => {
    if (active) save("active-key", activeConversationTarget ? null : active.key);
  }, [active, activeConversationTarget]);
  // t-0265: the open agent left the list (herdr dropped it, a relay): on record, so a switch after it can be read.
  const goneSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!agents || !activeId || active) return void (goneSeen.current = null);
    if (goneSeen.current === activeId) return;
    goneSeen.current = activeId;
    recordSelection({ from: activeId, to: null, cause: "active-gone", at: Date.now() });
  }, [agents, activeId, active]);
  // Follow only the seat he already has open; another selected agent stays selected.
  const [newZeroSession, setNewZeroSession] = useState<string | null>(null);
  const workspaceActive=useCallback((s:WorkspaceStatus)=>{if(s.agentId?.startsWith("service-"))setNewCodexId(s.agentId);else setOpening(s.name);},[]);
  const [newCodexId, setNewCodexId] = useState<string | null>(null);
  useEffect(() => {
    if (!newCodexId || !agents?.some(a => a.id === newCodexId)) return;
    if (select(newCodexId, "click")) {
      setMounted(ids => [newCodexId, ...ids.filter(id => id !== newCodexId)].slice(0, KEEP_MOUNTED));
      setView({ kind: "chat" }); setSpace("agents"); setNewCodexId(null); if (narrow) setSidebarOpen(false);
    }
  }, [agents, newCodexId, select, narrow]);
  const previousZero = useRef<string | null>(null);
  useEffect(() => {
    if (!agents) return;
    const next = agents.find((a) => a.zero && a.row === "live");
    const before = previousZero.current;
    if (next && newZeroSession && newZeroSession === next.session) {
      if (select(next.id, "seat-follow")) {
        setMounted((ids) => [next.id, ...ids.filter((id) => id !== next.id)].slice(0, KEEP_MOUNTED));
        setView({ kind: "chat" }); setSpace("agents"); setNewZeroSession(null);
      }
    }
    if (next && before && before !== next.id && activeNow.current === before) {
      if (select(next.id, "seat-follow")) setMounted((ids) => [next.id, ...ids.filter((id) => id !== next.id && id !== before)].slice(0, KEEP_MOUNTED));
    }
    if (next) previousZero.current = next.id;
  }, [agents, select, newZeroSession]);
  const agentsNow = useRef(agents);
  agentsNow.current = agents;
  const restore = useRef<{ done: boolean; timer?: number }>({ done: false });
  useEffect(() => {
    const r = restore.current;
    if (skipPinRestore.current) return void (r.done = true);
    if (r.done || !agents?.length) return;
    const show = (a: Agent, cause: SelectCause = "restore-key") => {
      r.done = true;
      window.clearTimeout(r.timer);
      const cur = activeNow.current;
      if (cur && agentsNow.current?.some((x) => x.id === cur)) return;
      if (select(a.id, cause)) setMounted((ids) => [a.id, ...ids.filter((x) => x !== a.id)].slice(0, KEEP_MOUNTED));
    };
    if (active) return void ((r.done = true), window.clearTimeout(r.timer));
    const key = load<string | null>("active-key", null);
    const again = key ? agents.find((a) => a.key === key) : undefined;
    if (again) return show(again);
    // A fresh desktop has no previous seat to wait for. Keep the grace period only when
    // restoring an existing identity, and never override the phone's navigation-first screen.
    const firstZero = !key && !activeNow.current && !narrowRef.current ? agents.find((a) => a.zero) : undefined;
    if (firstZero) return show(firstZero, "restore-zero");
    r.timer ??= window.setTimeout(() => {
      const list = agentsNow.current ?? [];
      const back = key ? list.find((a) => a.key === key) : undefined;
      const zero = narrowRef.current ? undefined : list.find((a) => a.zero);
      if (back ?? zero) show((back ?? zero)!, back ? "restore-key" : "restore-zero");
      else r.done = true;
    }, 3000);
  }, [agents, active]);
  useEffect(() => () => window.clearTimeout(restore.current.timer), []);
  useEffect(() => { if (!narrowRef.current) save("sidebar-open", sidebarOpen); }, [sidebarOpen]);
  useEffect(() => save("space", space), [space]);
  useEffect(() => save("view", view), [view]);
  useEffect(() => save("panel-page", panelPage), [panelPage]);
  useEffect(() => save("voice-sel", voiceSel), [voiceSel]);
  useEffect(() => save("open-tabs", openTabs), [openTabs]);
  useEffect(() => save("tab-nav", nav), [nav]);
  useEffect(() => save("last-tab", lastTab), [lastTab]);
  useEffect(() => save("strip-seen", stripSeen), [stripSeen]);
  useEffect(() => {
    const start = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes(PAGE_DRAG)) setPageDragging(true);
      if (e.dataTransfer?.types.includes(PANEL_DRAG)) setPanelDragging(true);
    };
    const end = () => (setPageDragging(false), setPanelDragging(false));
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => (window.removeEventListener("dragstart", start), window.removeEventListener("dragend", end), window.removeEventListener("drop", end));
  }, []);
  // Done stays green until he looks: the open agent counts as looking.
  useEffect(() => {
    if (active && !activeConversationTarget && isUnseenDone(active)) void act(active.id, "seen");
  }, [active, activeConversationTarget, act]);

  const closeSide = useCallback(() => {
    setSide(null);
    setSideFull(false);
  }, []);
  const zeroAgent = (agents ?? []).find((x) => x.zero) ?? null;
  // Agent Zero's own chat is the open page: his floating face would only repeat the page (6 Oct 23:35).
  const zeroHere = onChat && Boolean(active?.zero);
  const openAppPage = useCallback(
    (id: AppPage) => {
      if (!(view.kind === "tab" && isAppPage(view.id))) setBackTo({ view, space });
      setAppPages((ps) => (ps.includes(id) ? ps : [...ps, id]));
      setSpace("agents");
      setView({ kind: "tab", id });
    },
    [view, space],
  );
  // What's new opens from the top bar's version pill, the Shipped card and Stats (lib/releases.ts openWhatsNew).
  // The Starred page is archived (AB-02, Shaan 6 Oct 22:35: "the pinned stuff ... I really don't like it"): an old #at link lands on the chat.
  useEffect(() => { if (view.kind === "tab" && view.id === "starred") setView({ kind: "chat" }); }, [view]);
  const openAppPageRef = useRef(openAppPage);
  openAppPageRef.current = openAppPage;
  useEffect(() => {
    const on = () => openAppPageRef.current("whatsnew");
    window.addEventListener("ab:whats-new", on);
    return () => window.removeEventListener("ab:whats-new", on);
  }, []);
  const leaveAppPage = useCallback(() => {
    const to = backTo ?? { view: { kind: "chat" as const }, space: "agents" };
    setSpace(to.space as typeof space);
    setView(to.view);
  }, [backTo]);
  // SPEC-STATS-TASKS §2: Tasks or Stats popped out beside the side nav (one at a time, remembered across reloads).
  const [popped, setPoppedState] = useState<PoppedPage | null>(loadPopped);
  const setPopped = useCallback((p: PoppedPage | null) => {
    setPoppedState(p);
    savePopped(p);
  }, []);
  /** Pop a page out: if it is the page open now, the view goes back to what was beside it (the chat). */
  const popOut = useCallback(
    (p: PoppedPage) => {
      setPopped(p);
      if (view.kind === "tab" && view.id === p) leaveAppPage();
    },
    [view, leaveAppPage, setPopped],
  );
  // Move to… (ab-131): the move runs in the node (agent-move); while it runs, its status is read every 2 s.
  const [moves, setMoves] = useState<Record<string, MoveStatus>>({});
  const moveTo = useCallback(async (name: string, to: MoveTarget, effort?: string) => {
    const path = `/api/agents/${encodeURIComponent(name)}/move`;
    setMoves((m) => ({ ...m, [name]: { state: "moving", message: "Moving…", to } }));
    const poll = window.setInterval(() => {
      void fetch(path).then((r) => r.json()).then((st: MoveStatus) => ["moving", "waiting-idle", "queued"].includes(st.state) && setMoves((m) => ({ ...m, [name]: st }))).catch(() => {});
    }, 2000);
    const done: MoveStatus = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, effort }) })
      .then((r) => r.json())
      .catch(() => ({ state: "failed", message: "No answer from the node", to }));
    window.clearInterval(poll);
    setMoves((m) => ({ ...m, [name]: done.state ? done : { state: "failed", message: String((done as { error?: string }).error ?? "The move failed"), to } }));
  }, []);
  // Move to… rides in the HUD's model menu (R1.21 took it out of the header).
  const hudModel: HudMove | undefined = active && !activeConversationTarget ? { current: modelOf(active), status: moves[active.name] ?? null, onMove: (to, effort) => void moveTo(active.name, to, effort), agentZero: active.zero } : undefined;
  const a0Page = useA0Page(space === "agents" && view.kind === "tab" && view.id === "zero");
  const hubAgents = useHubAgents();
  const hubProject = useHubProject(view.kind === "tab" && view.id === "org" && orgPage && "project" in orgPage ? orgPage.project : null);
  const hubOrg = useHubOrg(view.kind === "tab" && view.id === "orgchart");
  // Back and forward (hub-11; 2 Oct: "i don't know how to go back"): every move between pages is a history entry, so
  // the buttons, ⌘[ / ⌘] and the mouse's back button all work. A popped entry puts the place back. Picking an agent is
  // not one (QA #11, A0, 3 Oct: a trackpad swipe walked A0 → HALO-UI → AGENT-BASE): only a page an agent owns brings
  // its agent back with it.
  const locKey = space === "library" && view.kind === "chat" ? libraryKey : encodeLoc({ s: space, v: view, a: null, o: orgPage, t: view.kind === "tab" && view.id === "tasks" ? taskFocus : null });
  const lastLoc = useRef(locKey);
  const applyLoc = useRef<(l: Loc) => void>(() => {});
  applyLoc.current = (l) => {
    setSpace(l.s as typeof space);
    setView(l.v);
    setOrgPage(l.o);
    setTaskFocus(l.t ?? null);
    if (l.v.kind === "tab" && isAppPage(l.v.id)) {
      const id = l.v.id;
      setAppPages((ps) => (ps.includes(id) ? ps : [...ps, id]));
    }
    const tab = l.v.kind === "tab" ? l.v.id : null;
    // A page Agent Zero owns (a web tab he opened beside A0) brings Agent Zero back too.
    const owner = tab === "zero" ? (agents ?? []).find((x) => x.zero) : (agents ?? []).find((x) => openTabs.some((t) => t.id === tab && t.owner === x.name));
    const target = owner?.id ?? l.a;
    // No owner means the entry does not say (a place never records its agent): the open agent stays. Clearing it here
    // dropped every click that also changed the page onto "Pick an agent on the left" (Shaan 3 Oct 18:35).
    if (!skipPinRestore.current && !activeConversationTarget && target && target !== activeId && (agents ?? []).some((x) => x.id === target) && select(target, "history")) {
      setMounted((ids) => [target, ...ids.filter((x) => x !== target)].slice(0, KEEP_MOUNTED));
    }
  };
  const router = useRef<ReturnType<typeof createPageHistory<string>> | null>(null);
  const [hist, setHist] = useState({ canBack: false, canForward: false });
  if (!router.current)
    router.current = createPageHistory<string>({
      current: () => lastLoc.current,
      change: (k) => {
        if (k !== lastLoc.current) {
          lastLoc.current = k;
          if (isLibraryLocation(`#${k}`)) {
            setLibraryKey(k);
            setSpace("library");
            setView({ kind: "chat" });
            // pushState does not emit hashchange; keep the Library reader in step with app navigation.
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          } else {
            const l = decodeLoc(k);
            if (l) applyLoc.current(l);
          }
        }
        window.setTimeout(() => router.current && setHist({ canBack: router.current.canBack, canForward: router.current.canForward }), 0);
      },
      encode: (k) => k,
      decode: (h) => { if (isLibraryLocation(`#${h}`)) return h; const loc = decodeLoc(h); return loc ? encodeLoc(loc) : null; },
    });
  const restoringHistory = useRef<string | null>(null);
  useEffect(() => {
    router.current!.start();
    restoringHistory.current = lastLoc.current !== locKey ? lastLoc.current : null;
    return () => router.current!.stop();
  }, []);
  useEffect(() => {
    // Wait for the restored page to render, including StrictMode's effect replay, before recording a new location.
    if (restoringHistory.current) {
      if (locKey === restoringHistory.current) restoringHistory.current = null;
      return;
    }
    if (locKey === lastLoc.current) return;
    const was = lastLoc.current;
    router.current!.push(locKey);
    if (lastLoc.current === was) lastLoc.current = locKey;
  }, [locKey]);
  // Opening an agent goes back to its last tab (R1.22, §3.3); opening the one already open, or `chat`, goes to its chat.
  const open = useCallback(
    (a: Agent, how: { chat?: boolean; cause?: SelectCause; conversationTarget?: ConversationPinTarget } = {}) => {
      if (a.zero) setNavWorkspace(null);
      else if (a.navOwner) setNavWorkspace(navHome(a.workspace, workspaces));
      const last = !how.conversationTarget && !how.chat && a.id !== activeId ? lastTab[a.name] : undefined;
      const back = last && last !== "chat" && (openTabs.some((t) => t.id === last && t.owner === a.name) || (last === "zero" && a.zero));
      if (!select(a.id, how.cause ?? "click")) return;
      skipPinRestore.current = false;
      const nextPinned = { ...pinnedChatsNow.current };
      if (how.conversationTarget) nextPinned[a.id] = { target: { ...how.conversationTarget }, agent: { ...a } };
      else delete nextPinned[a.id];
      pinnedChatsNow.current = nextPinned;
      setPinnedChats(nextPinned);
      if (how.conversationTarget) setAsTerminal(m => ({ ...m, [a.id]: false }));
      setMounted((ids) => {
        if (ids[0] === a.id && ids.length <= KEEP_MOUNTED && ids.indexOf(a.id, 1) < 0) return ids;
        return [a.id, ...ids.filter((x) => x !== a.id)].slice(0, KEEP_MOUNTED);
      });
      setView((current) => {
        if (back) return current.kind === "tab" && current.id === last ? current : { kind: "tab", id: last };
        return current.kind === "chat" ? current : { kind: "chat" };
      });
      setSpace("agents");
      if (narrowRef.current) setSidebarOpen(false);
      if (how.conversationTarget || side?.kind === "crew" && side.id === a.id) closeSide();
    },
    [side, closeSide, activeId, lastTab, openTabs, select, workspaces],
  );
  // t-0532 item 4 (Shaan, 8 Oct ~10:15: "per agent has its own URLs and I kind of like that"): ?agent=<NAME> opens that
  // agent, and the address follows the open chat, so a chat can be linked, bookmarked or opened in a new window. It is a
  // query, not the hash (back and forward own "#at="), and it is replaced, never pushed: picking an agent is not a history
  // entry (QA #11, 3 Oct: a trackpad swipe walked A0 -> HALO-UI -> AGENT-BASE).
  const linkedAgent = useRef<string | null>(new URLSearchParams(location.search).get("agent"));
  useEffect(() => {
    const name = linkedAgent.current?.toUpperCase();
    if (!name || !agents) return;
    linkedAgent.current = null;
    const a = agents.find((x) => x.name.toUpperCase() === name && x.row === "live") ?? agents.find((x) => x.name.toUpperCase() === name);
    if (a && a.id !== activeId) open(a, { chat: true });
  }, [agents === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || linkedAgent.current) return;
    const q = new URLSearchParams(location.search);
    if (q.get("agent") === active.name) return;
    q.set("agent", active.name);
    history.replaceState(history.state, "", `${location.pathname}?${q}${location.hash}`);
  }, [active?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [attentionError, setAttentionError] = useState('');
  const openAttention = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/attention/${encodeURIComponent(id)}`); if (!r.ok) throw Error('Notification no longer available');
      const item = await r.json(); const agent = (agents ?? []).find(a => a.id === item.agentId);
      if (!agent) throw Error('This chat has ended or is unavailable');
      open(agent, { chat: true }); setAttentionOpen(false); setAttentionError('');
      await attentionPost(`/api/attention/${encodeURIComponent(id)}/read`, {});
    } catch (e) { setAttentionOpen(true); setAttentionError((e as Error).message); }
  }, [agents, open]);
  const attention = useAttention(id => void openAttention(id));
  useEffect(() => {
    const go = () => { const id = attentionId(location.hash); if (id && agents?.length) { history.replaceState(null, '', location.pathname); void openAttention(id); } };
    go(); window.addEventListener('hashchange', go); return () => window.removeEventListener('hashchange', go);
  }, [agents, openAttention]);
  // A worker he taps in the agents popup opens as a live chat in the split beside this one (UI, 4 Oct: "it should actually
  // open with the SDK so I can actually like message him"). The node may have just started it, so wait for its row.
  const [splitWanted, setSplitWanted] = useState<{ id?: string; name: string; until: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const detail = (e as CustomEvent<{ id?: string; name?: string }>).detail; if (detail?.name) setSplitWanted({ id: detail.id, name: detail.name, until: Date.now() + 90_000 }); };
    window.addEventListener("siso-open-split", on);
    return () => window.removeEventListener("siso-open-split", on);
  }, []);
  useEffect(() => {
    if (!splitWanted) return;
    if (Date.now() > splitWanted.until) return setSplitWanted(null);
    const a = (agents ?? []).find((x) => splitWanted.id ? x.id === splitWanted.id : x.name === splitWanted.name);
    if (a) {
      if (narrow) { setSide(null); setSideFull(false); open(a, { chat: true, cause: "click" }); }
      else setSide({ kind: "crew", id: a.id });
      setSplitWanted(null);
    }
  }, [agents, splitWanted, narrow, open]);
  /** An owner's chat from a task row (its one orange action). */
  const openAgentByName = useCallback(
    (name: string) => {
      const a = (agents ?? []).find((x) => canonName(x.name) === canonName(name) || (canonName(name) === "A0" && x.zero));
      if (a) open(a, { chat: true });
    },
    [agents, open],
  );
  const taskAgents = useMemo(() => (agents ?? []).map((a) => ({ name: a.name, project: a.project })), [agents]);
  // t-0139: the agent his words started opens as soon as herdr lists it (or is forgotten after a minute).
  useEffect(() => {
    if (!opening) return;
    const a = (agents ?? []).find((x) => x.name === opening && x.row === "live");
    if (a) (open(a, { chat: true, cause: "say-start" }), setOpening(null));
  }, [opening, agents, open]);
  useEffect(() => {
    if (!opening) return;
    const t = window.setTimeout(() => setOpening(null), 60_000);
    return () => window.clearTimeout(t);
  }, [opening]);
  // Narrowing with a chat open folds the nav to the rail's face dock; it comes back as an overlay from the nav button.
  useEffect(() => {
    if (narrow && activeId) setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);
  // A chat's row moved to a new terminal (ab-151): open that one in its place. One stable callback, so the memoised
  // chats are not redrawn for a new one on every render.
  const movedTo = useRef<(nid: string) => void>(() => {});
  movedTo.current = (nid) => {
    if (activeNow.current && pinnedChatsNow.current[activeNow.current]) return;
    const next = (agents ?? []).find((x) => x.id === nid);
    if (next) open(next, { chat: true, cause: "moved" });
  };
  const onChatMoved = useCallback((nid: string) => movedTo.current(nid), []);
  // SPEC-DELIGHT §2: what is waiting on him, for the dots around Agent Zero's face: the open needs-Shaan tasks, then the
  // agents herdr itself says need him (one a task already names is not counted twice).
  const zeroNeeds = useMemo<Need[]>(() => {
    const tasks = (taskIndex?.tasks ?? []).filter((t) => t.needs && !isDone(t) && !isParked(t));
    const named = new Set(tasks.flatMap((t) => ownerNames(t.owner)).map(canonName));
    return [
      ...tasks.map((t) => ({ key: `task:${t.id}`, label: `${t.id} · ${t.title}`, onOpen: () => (setTaskFocus({ id: t.id }), openAppPage("tasks")) })),
      ...needsYou.filter((a) => a.status === "needs" && !named.has(canonName(a.name))).map((a) => ({ key: `agent:${a.id}`, label: `${a.name} needs you`, onOpen: () => open(a, { cause: "needs-dot" }) })),
    ];
  }, [taskIndex, needsYou, open, openAppPage]);
  const close = useCallback(() => {
    if (!activeId) return;
    const rest = mounted.filter((x) => x !== activeId);
    if (!select(rest[0] ?? null, "close")) return;
    setMounted(rest);
  }, [activeId, mounted, select]);
  const nextNeedsYou = useCallback(() => {
    const queue = needsYou.slice().sort(byWhoNeedsYou);
    const i = queue.findIndex((a) => a.id === activeId);
    const next = queue[(i + 1) % queue.length];
    if (next) open(next, { chat: true, cause: "next-needs-you" });
  }, [needsYou, activeId, open]);

  // The tabs (R1.22, option C "split by who put it there"): the chat, the agent's app tabs, then his tabs for this agent.
  // His pinned pages and the pages the agent dropped in live in the strip on the right, and open here as a tab.
  const pinnedUrls = new Set(pinnedPages.map((p) => p.url));
  const ownPages = active?.pages ?? [];
  const dropped = ownPages.filter((p) => !pinnedUrls.has(p.url));
  const agentNames = useMemo(() => new Set((agents ?? []).map((a) => a.name)), [agents]);
  const ownerOf = (t: OpenTab) => (agents && t.owner !== "web" && !agentNames.has(t.owner) ? "web" : t.owner);
  // The Web space (Shaan 3 Oct 14:1x: "when I click on the web ... it navigates back to the other side"): its own tabs,
  // whichever agent is open, so nothing in it hands the view back to an agent.
  const here = space === "web" ? "web" : active?.name ?? "web";
  const mine = openTabs.filter((t) => ownerOf(t) === here);
  const navOf = (id: string): Nav => nav[id] ?? { url: id.startsWith("page:") ? id.slice(5) : "", back: [], fwd: [], n: 0 };
  // Pagestrip R1 (SPEC §0a): his pins, then what this agent dropped in, as a row in the panel card's head; with the panel
  // closed, a "N pages" chip in the chat header. The 44 px column at the window's edge is gone.
  const pageRow: PageRowProps | undefined = active
    ? {
        agent: active.name,
        pinned: pinnedPages,
        dropped,
        // Open here or in the Web space: the icon goes hollow either way.
        open: new Set(openTabs.flatMap((t) => (t.kind === "web" && (ownerOf(t) === active.name || ownerOf(t) === "web") && navOf(t.id).url ? [navOf(t.id).url] : []))),
        seenAt: stripSeen[active.name] ?? null,
        dragging: pageDragging,
        onOpen: (p) => openUrl(p.url, p.title),
        onUnpin: (p) => void edit({ op: "unpin-page", url: p.url }),
        onHide: (p) => void edit({ op: p.from === "saved" ? "forget-page" : "hide-page", name: active.name, url: p.url }),
        onPin: (p) => void edit({ op: "pin-page", url: p.url, title: p.title }),
        onKeep: (p) => void edit({ op: "save-page", name: active.name, url: p.url, title: p.title }),
      }
    : undefined;
  const go = useCallback(
    (id: string, url: string, title?: string, fromPage = false) => {
      setNav((m) => {
        const cur = m[id] ?? { url: id.startsWith("page:") ? id.slice(5) : "", back: [], fwd: [], n: 0 };
        return { ...m, [id]: { url, back: [...cur.back, cur.url].slice(-50), fwd: [], n: cur.n } };
      });
      // The page moved by itself (a link, a YouTube video): its title arrives from the page a moment later (retitle), so
      // the tab keeps its name meanwhile instead of turning into the bare host, and the visit waits for the real title.
      if (fromPage) return;
      setOpenTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title: title ?? hostOf(url) } : t)));
      void edit({ op: "visit", url, title: title ?? hostOf(url) });
    },
    [edit],
  );
  const step = (id: string, dir: -1 | 1) =>
    setNav((m) => {
      const c = m[id] ?? navOf(id);
      if (dir < 0 && c.back.length) return { ...m, [id]: { ...c, url: c.back.at(-1)!, back: c.back.slice(0, -1), fwd: [c.url, ...c.fwd] } };
      if (dir > 0 && c.fwd.length) return { ...m, [id]: { ...c, url: c.fwd[0], fwd: c.fwd.slice(1), back: [...c.back, c.url] } };
      return m;
    });
  const newTab = useCallback((kind: "web" | "term" = "web", owner = here) => {
    const id = tabId();
    setOpenTabs((ts) => [...ts, { id, kind, title: kind === "term" ? "Terminal" : "New tab", owner, by: "him" }]);
    setView({ kind: "tab", id });
  }, [here]);
  /**
   * A page as one of an agent's tabs (a chat link, a strip icon, a page dropped on the row or on an agent): the tab already
   * showing that address if it has one, else a new one before `before` (null: at the end). Shown unless `show` is false.
   */
  // The tabs as of the last openUrl, so a second click before the first tab has rendered finds it too.
  const opened = useRef({ tabs: openTabs, nav });
  opened.current = { tabs: openTabs, nav };
  /** The page's own title (browser v3): the tab and its sidebar row take it, and history records it. */
  const retitle = useCallback((id: string, title: string) => {
    const url = opened.current.nav[id]?.url;
    setOpenTabs((ts) => (ts.some((t) => t.id === id && t.title !== title) ? ts.map((t) => (t.id === id ? { ...t, title } : t)) : ts));
    if (url && /^https?:/.test(url)) void edit({ op: "visit", url, title });
  }, [edit]);
  const openUrl = useCallback(
    (url: string, title?: string, o: { owner?: string; before?: string | null; show?: boolean; drop?: boolean; page?: boolean } = {}) => {
      // Shaan 3 Oct 14:1x: "the URLs which come in from the icons, I don't know why they don't come in". A page he opens
      // from an icon, a link or another page is a tab in the Web space; only a drop on an agent (or its row) is the agent's.
      const owner = o.owner ?? "web";
      // Shaan 3 Oct 04:4x: "why do pages still auto open i don't like them auto opening". A tab opens only on his click,
      // key or drop; a page an agent posts waits in its page row (and Reviews). Anything else is held and on record.
      // `page`: a link in one of his pages that asked for a new window; WebKit only lets a page do that on his click.
      if (!o.drop && !o.page && !hisGesture()) {
        let host = "page";
        try {
          host = new URL(url).host;
        } catch {
          /* not a URL */
        }
        recordSelection({ from: owner, to: `page:${host}`, cause: "auto-open", at: Date.now(), blocked: "no-click" });
        return null;
      }
      const now = opened.current;
      const had = now.tabs.find((t) => t.owner === owner && t.kind === "web" && sameUrl(now.nav[t.id]?.url ?? "", url));
      const id = had?.id ?? tabId();
      if (!had) {
        const tab: OpenTab = { id, kind: "web", title: title || hostOf(url), owner, by: "him" };
        const entry: Nav = { url, back: [], fwd: [], n: 0 };
        opened.current = { tabs: [...now.tabs, tab], nav: { ...now.nav, [id]: entry } };
        setOpenTabs((ts) => insertBefore(ts, tab, o.before ?? null));
        setNav((m) => ({ ...m, [id]: entry }));
        void edit({ op: "visit", url, title: title || hostOf(url) });
      }
      if (o.show !== false) (setSpace(owner === "web" ? "web" : "agents"), setView({ kind: "tab", id }));
      return id;
    },
    [edit],
  );
  /** A chat link in the desktop app (ChatView openLink): this agent's tab on that url, shown at once. */
  useEffect(() => {
    const onPage = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url || !/^https?:/i.test(url)) return;
      e.preventDefault();
      openUrl(url);
    };
    window.addEventListener(OPEN_PAGE, onPage);
    return () => window.removeEventListener(OPEN_PAGE, onPage);
  }, [openUrl]);
  // One-time cleanup (3 Oct, after "i don't like them auto opening"): tabs from before the `by` mark that he did not
  // pin and that are agents' console cards, or a second tab on the same page for the same agent, close once.
  const cleaned = useRef(load<boolean>("tabs-cleaned-0265", false));
  useEffect(() => {
    if (cleaned.current || !agents) return;
    cleaned.current = true;
    save("tabs-cleaned-0265", true);
    const pins = new Set(pinnedPages.map((p) => p.url));
    const cards = new Set(agents.flatMap((a) => a.pages.filter((p) => p.from === "console").map((p) => p.url)));
    const seen = new Set<string>();
    const gone: string[] = [];
    for (const t of openTabs) {
      const url = t.kind === "web" ? nav[t.id]?.url ?? "" : "";
      if (t.by === "him" || !url || pins.has(url)) continue;
      const card = cards.has(url) || /^https?:\/\/(127\.0\.0\.1|localhost):8891\//.test(url);
      if (card || seen.has(`${t.owner}|${url}`)) gone.push(t.id);
      else seen.add(`${t.owner}|${url}`);
    }
    if (!gone.length) return;
    setOpenTabs((ts) => ts.filter((t) => !gone.includes(t.id)));
    setNav((m) => Object.fromEntries(Object.entries(m).filter(([id]) => !gone.includes(id))));
    for (const id of gone) void closePage(id);
    if (view.kind === "tab" && gone.includes(view.id)) setView({ kind: "chat" });
    recordSelection({ from: `${gone.length} tabs`, to: null, cause: "tab-cleanup", at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);
  const reorderTab = (id: string, before: string | null) =>
    setOpenTabs((ts) => {
      const t = ts.find((x) => x.id === id);
      return t ? insertBefore(ts.filter((x) => x.id !== id), t, before) : ts;
    });
  /** A tab dropped on an agent in the side nav: it becomes that agent's (⌥ keeps a copy here). */
  const moveTab = (id: string, to: string, copy: boolean) => {
    const t = openTabs.find((x) => x.id === id);
    if (!t || t.owner === to) return;
    if (copy) {
      const nid = tabId();
      setOpenTabs((ts) => [...ts, { ...t, id: nid, owner: to }]);
      setNav((m) => (m[id] ? { ...m, [nid]: { ...m[id] } } : m));
    } else {
      setOpenTabs((ts) => ts.map((x) => (x.id === id ? { ...x, owner: to } : x)));
      if (view.kind === "tab" && view.id === id) setView({ kind: "chat" });
    }
  };
  // A tab of another agent never shows as the page (⌘W closed its agent, a moved tab): back to this agent's chat.
  useEffect(() => {
    if (!agents || view.kind !== "tab") return;
    const t = openTabs.find((x) => x.id === view.id);
    if (t && ownerOf(t) !== here) setView({ kind: "chat" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, view, openTabs, agents]);
  // Each agent's last tab, for open() to go back to.
  useEffect(() => {
    if (!active || space !== "agents") return;
    const id = view.kind === "chat" ? "chat" : view.id;
    if (id !== "chat" && id !== "zero" && !openTabs.some((t) => t.id === id && t.owner === active.name)) return;
    setLastTab((m) => (m[active.name] === id ? m : { ...m, [active.name]: id }));
  }, [active, view, space, openTabs]);
  // The Web space shows its last tab, else its newest, else a new one: it never stands empty or shows an agent's view.
  const webLast = useRef<string | null>(null);
  if (space === "web" && view.kind === "tab") webLast.current = view.id;
  const ownerInfo = view.kind === "tab" && view.id.startsWith("owner-info:") ? view.id.slice(11) : null;
  const ownerCandidates = ownerInfo ? (agents ?? []).filter(a => canon(a.name) === canon(ownerInfo)) : [];
  const ownerQuestionConnection = ownerCandidates.length === 1 ? ownerQuestions[ownerCandidates[0].id] : undefined;
  // Owner reports can outlive chat availability; a same-name terminal is not a chat destination.
  const ownerChat = ownerInfo ? agents?.find(a => a.chat && canon(a.name) === canon(ownerInfo)) : undefined;
  const showOwner = useCallback((name: string) => {
    setSpace("agents"); setView({ kind: "tab", id: `owner-info:${name}` });
  }, []);
  useOwnerNavigation(showOwner);
  useOwnerLinkNavigation(useCallback((url: string, title: string) => void openUrl(url, title), [openUrl]));
  const webTabs = openTabs.filter((t) => ownerOf(t) === "web" && t.kind === "web");
  // The browser's sidebar rows are these tabs (browser v3, Shaan 7 Oct: "pages refresh when i click off of them"): a row is
  // a tab with its own live page, so going back to it shows the page as he left it, never a reload of its address.
  const browserTabs = webTabs.map((t) => ({ id: t.id, title: t.title, url: navOf(t.id).url, pin: t.pin }));
  const openBrowserTab = useCallback((url: string, title: string, pin?: string) => {
    const id = tabId();
    const tab: OpenTab = { id, kind: "web", title: title || (url ? hostOf(url) : "New tab"), owner: "web", by: "him", ...(pin ? { pin } : {}) };
    setOpenTabs((ts) => [...ts, tab]);
    setNav((m) => ({ ...m, [id]: { url, back: [], fwd: [], n: 0 } }));
    if (url) void edit({ op: "visit", url, title: tab.title });
    setSpace("web");
    setView({ kind: "tab", id });
    return id;
  }, [edit]);
  const bindBrowserTab = useCallback((id: string, pin?: string) => setOpenTabs((ts) => ts.map((t) => (t.id === id ? { ...t, pin } : t))), []);
  const showWeb = () => {
    setSpace("web");
    const t = webTabs.find((x) => x.id === webLast.current) ?? webTabs.at(-1);
    if (t) setView({ kind: "tab", id: t.id });
    else newTab("web", "web");
  };
  useEffect(() => {
    if (space !== "web") return;
    if (view.kind === "chat") showWeb();
    // The org page, a crew page, Tasks or Stats are the agents' pages: opened from here, the rail follows them.
    else if (!openTabs.some((t) => t.id === view.id)) setSpace("agents");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, view, openTabs]);
  // ⌘T and + (Shaan 3 Oct: "a new pop-up where I can put in the URL, same as how Arc works"): the command bar.
  const [workspacePaletteOpen, setWorkspacePaletteOpen] = useState(false);
  const [workspaceChooserOpen, setWorkspaceChooserOpen] = useState(false);
  useEffect(() => onBrowserShortcut(({ action }) => { if (action === "new-tab" || action === "spotlight") setWorkspacePaletteOpen(true); }), []);
  // A link in one of his pages that wants a new window (target=_blank): a Web tab, not a window on his screen.
  const nativeBridge = nativeBrowserAvailable();
  useEffect(() => onNewTab((url) => void openUrl(url, undefined, { page: true })), [openUrl, nativeBridge]);
  // He looked at an agent's dropped-in pages until he left it; the first visit counts as having looked.
  const lookedAt = useRef<string | null>(null);
  useEffect(() => {
    const prev = lookedAt.current;
    const name = active?.name ?? null;
    lookedAt.current = name;
    if (prev === name) return;
    const t = Date.now();
    setStripSeen((m) => ({ ...m, ...(prev ? { [prev]: t } : {}), ...(name && !(name in m) ? { [name]: t } : {}) }));
  }, [active?.name]);
  const closeTab = useCallback(
    (id: string) => {
      setOpenTabs((ts) => ts.filter((t) => t.id !== id));
      setNav(({ [id]: _gone, ...rest }) => rest);
      void closePage(id); // the tab's native pages live until it is closed
      // Functional: a close followed by a select in the same click (the browser closing a blank tab as it shows a favourite's)
      // must land on the tab selected, not on the chat.
      setView((v) => (v.kind === "tab" && v.id === id ? { kind: "chat" } : v));
    },
    [],
  );
  // One page opened twice under one agent (12 tabs piled up on Agent Zero, 3 Oct): the extra tabs close at launch; from
  // then on openUrl shows the tab already on that page.
  useEffect(() => {
    // A pin's or a favourite's tab is that pin, never a duplicate of a Today tab on the same page (browser v3).
    duplicateTabs(openTabs.filter((t) => !t.pin), (id) => nav[id]?.url ?? "").forEach(closeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The new-tab page's Terminal: the empty tab becomes a shell, as Codex's does. */
  const toTerminal = (id: string) => {
    if (openTabs.some((t) => t.id === id)) setOpenTabs((ts) => ts.map((t) => (t.id === id ? { ...t, kind: "term", title: "Terminal" } : t)));
    else newTab("term");
  };
  const orgLabel = orgPage ? ("lane" in orgPage ? orgPage.lane : "group" in orgPage ? org?.groups.find((g) => g.id === orgPage.group)?.name ?? "Group" : org?.groups.flatMap((g) => g.projects).find((p) => p.id === orgPage.project)?.name ?? org?.groups.flatMap((g) => g.folders.flatMap((f) => f.items)).find((i) => i.id === orgPage.project)?.name ?? orgPage.project) : "";
  const workspaceTabs = navWorkspace ? workspaceOwners(agents ?? [], workspaces, navWorkspace) : [];
  // The last web page stays up top beside Agent Zero when he goes back to the agents (Shaan, 6 Oct 21:15: "I like to keep my
  // agent zero up there ... so I can flip between the two relatively quickly"): one click each way.
  const browserBack = space !== "web" ? webTabs.find((x) => x.id === webLast.current) ?? webTabs.at(-1) : undefined;
  // Browser v3: in the Web space the browser's sidebar is the tab list (as in Arc), so its tabs are not repeated up here.
  const stripTabs = space === "web" ? mine.filter((t) => t.kind !== "web") : mine;
  const tabs: TopTab[] = [
    ...(browserBack ? [{ kind: "page" as const, id: "browser-return", label: tabLabel(browserBack.title, navOf(browserBack.id).url), title: `Back to the browser: ${navOf(browserBack.id).url || "New tab"}`, icon: <GlobeIcon aria-hidden="true" /> }] : []),
    ...workspaceTabs.map((a): TopTab => ({ kind: "chat", id: `owner:${a.id}`, label: a.name, icon: <AgentFace {...faceFor(a)} size={16} /> })),
    // Agent Zero's own page (hub-6) has no tab since 3 Oct (A0: retire it): "Where things stand ›" in his panel opens it.
    ...(orgPage && space !== "web"
      ? [
          {
            kind: "page" as const,
            id: "org",
            label: orgLabel,
            title: orgPage && "lane" in orgPage ? `${orgLabel} · Mac mini lane` : `${orgLabel} · dashboard`,
            icon: <ListChecksIcon aria-hidden="true" />,
            close: () => {
              setOrgPage(null);
              setView({ kind: "chat" });
            },
          },
        ]
      : []),
    // The top row's pages (Org chart, Tasks, Stats) light their button there and get no tab (R1.2 review fix 1).
    ...(space === "web" ? [] : appPages).filter((id) => !TOP_ROW_PAGES.includes(id)).map(
      (id): TopTab => ({
        kind: "page",
        id,
        label: APP_PAGES[id],
        title: { "ended-list": "Ended agents on record", dashboard: "The five fleet pages at a glance", tasks: "Agent Zero's tasks, live", orgchart: "Who runs what: Agent Zero, owners, workers", stats: "Fleet and plan totals", starred: "Agents and pages you starred", whatsnew: "Every build that went live", "codex-work": "Codex tabs, pairs and recent jobs", research: "Agent Zero’s research fleet and findings", canvas: "Arrange agents and research on your canvas", "product-map": "Review every surface and its evidence" }[id],
        icon: id === "codex-work" ? <TerminalSquareIcon aria-hidden="true" /> : id === "tasks" ? <ListChecksIcon aria-hidden="true" /> : id === "stats" ? <BarChart3Icon aria-hidden="true" /> : id === "starred" ? <PinIcon aria-hidden="true" /> : id === "whatsnew" ? <SparklesIcon aria-hidden="true" /> : <NetworkIcon aria-hidden="true" />,
        close: () => {
          setAppPages((ps) => ps.filter((x) => x !== id));
          if (view.kind === "tab" && view.id === id) leaveAppPage();
        },
      }),
    ),
    ...(stripTabs.length > 0 ? [{ kind: "gap" as const, id: "gap-open" }] : []),
    ...stripTabs.map((t): TopTab => {
      const url = t.kind === "web" ? navOf(t.id).url : "";
      return {
        kind: "page",
        id: t.id,
        label: tabLabel(t.title, url),
        title: t.kind === "term" ? "A terminal on this Mac" : url || "New tab",
        icon: t.kind === "term" ? <TerminalSquareIcon aria-hidden="true" /> : undefined,
        drag: url ? JSON.stringify({ url, title: t.title, tab: t.id } satisfies Dragged) : undefined,
        reorder: true,
        close: () => closeTab(t.id),
        // ⋯: what a drag does, for when a drag is awkward (pin it, keep it for this agent).
        actions: url ? (
          <MenuButton
            label="More"
            menuClassName="siso-rail-menu"
            items={(): MenuItem[] => [
              pinnedUrls.has(url)
                ? { key: "unpin", icon: <PinOffIcon />, label: "Unpin", onSelect: () => void edit({ op: "unpin-page", url }) }
                : { key: "pin", icon: <PinIcon />, label: "Pin for every agent", onSelect: () => void edit({ op: "pin-page", url, title: t.title }) },
              ...(active ? [{ key: "keep", icon: <LayoutDashboardIcon />, label: `Keep for ${active.name}`, onSelect: () => void edit({ op: "save-page", name: active.name, url, title: t.title }) }] : []),
              { key: "close", icon: <Trash2Icon />, label: "Close", danger: true, onSelect: () => closeTab(t.id) },
            ]}
          >
            <EllipsisIcon />
          </MenuButton>
        ) : undefined,
      };
    }),
  ];
  const allPages = [...ownPages, ...pinnedPages];
  const activeTab = view.kind === "chat" ? (space === "agents" ? active?.zero ? "zero" : `owner:${active?.id}` : null) : view.id;
  const selectTab = useCallback(
    (id: string) => {
      const owner = (agents ?? []).find(a => `owner:${a.id}` === id);
      if (owner) return open(owner, { chat: true });
      const zero = (agents ?? []).find(a => a.zero && `zero:${a.id}` === id);
      if (zero) return open(zero, { chat: true });
      if (id === "chat") return setView({ kind: "chat" }), setSpace("agents");
      setView({ kind: "tab", id });
      const p = allPages.find((x) => `page:${x.url}` === id);
      if (p && !nav[id]) void edit({ op: "visit", url: p.url, title: p.title });
    },
    [allPages, nav, edit, agents, open],
  );
  const stepTab = useCallback(
    (by: number) => {
      const ids = tabs.filter((t) => t.kind !== "gap").map((t) => t.id);
      const i = activeTab === null ? -1 : ids.indexOf(activeTab);
      if (ids.length) selectTab(ids[(i + by + ids.length) % ids.length]);
    },
    [tabs, activeTab, selectTab],
  );
  const pinnedUrlSet = pinnedUrls;
  const suggested = (() => {
    const seen = new Set<string>();
    return [...pinnedPages, ...(active?.pages ?? []), ...recentPages.slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0))].filter((p) => !seen.has(p.url) && seen.add(p.url));
  })();

  // Keys are caught before the terminal sees them (capture phase); everything else goes to the agent unchanged.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (document.querySelector(".wp-dialog[open]")) return; // Spotlight owns keyboard input while modal.
      // A popover that closes on Esc itself (the page row's +N list) keeps the key: this one listener's place among the
      // window's capture listeners changes whenever its deps do, so it cannot rely on running second.
      if (e.key === "Escape" && document.querySelector("[data-esc-own]")) return;
      if (!dockOpen && e.key === "Escape" && ((onChat && side) || cardOpen)) {
        if (onChat && side) closeSide();
        // Drilled in, Esc steps back inside the panel (AgentPanel's own handler).
        else if (!drilled.current) setCardOpen(false);
        return;
      }
      if (!e.metaKey) return;
      let handled = true;
      if (!e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const t = order[Number(e.code.slice(5)) - 1]; // ⌘1-9: the side nav's rows, top to bottom
        if (t) open(t, { cause: "key" });
      } else if (e.altKey && e.code === "KeyA") nextNeedsYou(); // Codex's own key
      else if (e.altKey && e.code === "KeyN") window.dispatchEvent(new CustomEvent("siso-pings-toggle")); // R1.21 the ping stack
      else if (e.shiftKey && e.code === "KeyB") setCardOpen((v) => !v);
      else if (!e.shiftKey && !e.altKey && e.code === "KeyB") {
        // ⌘B: close or open the side nav; closed, the rail keeps the agents' faces (sidenav D5).
        if (space === "web") (setSpace("agents"), setView({ kind: "chat" }), setSidebarOpen(true));
        else if (view.kind !== "chat" && view.id !== "zero" && !isAppPage(view.id)) (setView({ kind: "chat" }), setSidebarOpen(true));
        else toggleSidebar();
      }
      else if (e.shiftKey && e.code === "BracketLeft") stepTab(-1); // ⌘⇧[ ⌘⇧]: the tabs, as in a browser
      else if (e.shiftKey && e.code === "BracketRight") stepTab(1);
      else if (!e.shiftKey && !e.altKey && e.code === "KeyT") setWorkspacePaletteOpen(true); // ⌘T (Arc's command bar) and ⌘W, as in a browser
      else if (!e.shiftKey && !e.altKey && e.code === "KeyK") setWorkspacePaletteOpen(true);
      else if (!e.shiftKey && !e.altKey && e.code === "KeyW") view.kind === "tab" && openTabs.some((t) => t.id === view.id) ? closeTab(view.id) : close();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [order, open, nextNeedsYou, close, side, onChat, cardOpen, setCardOpen, closeSide, stepTab, newTab, closeTab, view, openTabs, dockOpen, space, toggleSidebar]);

  // A page tab dropped on the chat opens beside it (Shaan: "if you want to drag and drop it, it can go split-screen").
  const isPageDrag = (e: DragEvent) => e.dataTransfer.types.includes(PAGE_DRAG);
  const onDrop = (e: DragEvent) => {
    setDropping(false);
    // The panel's page row sits inside the chat; a drop one of its zones took (pin, keep) is not a split.
    if (!isPageDrag(e) || e.defaultPrevented) return;
    e.preventDefault();
    try {
      splitPage(JSON.parse(e.dataTransfer.getData(PAGE_DRAG)) as Dragged);
    } catch {
      /* not one of ours */
    }
  };
  /**
   * A page beside the chat. A tab keeps its own page (native in the desktop app, so a sign-in or a video carries on); a
   * strip icon or a chat link gets the agent's split page. Either way it is the browser's page, no longer a bare frame.
   */
  const splitPage = (d: Dragged) => {
    if (!d.url || !/^https?:/i.test(d.url)) return;
    const id = d.tab && openTabs.some((t) => t.id === d.tab) ? d.tab : `split:${active?.id ?? "web"}`;
    if (!d.tab || id !== d.tab) setNav((m) => ({ ...m, [id]: { url: d.url, back: [], fwd: [], n: (m[id]?.n ?? 0) + 1 } }));
    setSide({ kind: "split", page: { url: d.url, title: d.title || hostOf(d.url) }, tab: id });
    setSideFull(false);
  };
  // A tab or strip icon dropped on an agent in the side nav (or its face in the rail): that agent's tab now. Caught on
  // the window, so the nav's own markup (and its `.siso-app__frame > .siso-sidenav` layout) stays as it is.
  const agentAt = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest(".siso-sidenav [data-item], [data-testid=face-dock] [data-testid=dock-face]") : null;
    const id = el?.getAttribute("data-item");
    const a = el ? ((id ? byId.get(id) : (agents ?? []).find((x) => x.name === el.getAttribute("data-name"))) ?? null) : null;
    return a && el ? { a, el } : null;
  };
  const marked = useRef<Element | null>(null);
  const navDrop = useRef<(e: globalThis.DragEvent) => void>(() => {});
  navDrop.current = (e) => {
    const dt = e.dataTransfer;
    if (!dt?.types.includes(PAGE_DRAG)) return;
    const hit = agentAt(e.target);
    if (e.type === "dragleave") {
      if (marked.current && !(e.relatedTarget instanceof Node && marked.current.contains(e.relatedTarget))) (marked.current.removeAttribute("data-tabdrop"), (marked.current = null));
      return;
    }
    if (marked.current && marked.current !== hit?.el) (marked.current.removeAttribute("data-tabdrop"), (marked.current = null));
    if (!hit) return;
    e.preventDefault();
    const isTab = dt.types.includes(TAB_DRAG);
    if (e.type === "dragover") {
      dt.dropEffect = isTab && !e.altKey ? "move" : "copy";
      hit.el.setAttribute("data-tabdrop", isTab && !e.altKey ? `Move to ${hit.a.name}` : `Open in ${hit.a.name}`);
      marked.current = hit.el;
      return;
    }
    hit.el.removeAttribute("data-tabdrop");
    marked.current = null;
    const id = dt.getData(TAB_DRAG);
    if (id && openTabs.some((t) => t.id === id)) return moveTab(id, hit.a.name, e.altKey);
    try {
      const d = JSON.parse(dt.getData(PAGE_DRAG)) as Dragged;
      if (d.url) openUrl(d.url, d.title, { owner: hit.a.name, show: false, drop: true });
    } catch {
      /* not one of ours */
    }
  };
  useEffect(() => {
    const on = (e: globalThis.DragEvent) => navDrop.current(e);
    for (const t of ["dragover", "dragleave", "drop"] as const) window.addEventListener(t, on);
    return () => ["dragover", "dragleave", "drop"].forEach((t) => window.removeEventListener(t, on as EventListener));
  }, []);

  // R1.2 B: the top row's five pages. Servers and Tokens are spaces; the other three are app pages.
  const topPage: TopPage | null =
    view.kind === "tab" ? (view.id === "orgchart" ? "org" : view.id === "tasks" || view.id === "stats" ? view.id : null) : space === "servers" || space === "tokens" ? space : null;
  const openTop = (p: TopPage) => {
    if (p === "servers" || p === "tokens") {
      setView({ kind: "chat" });
      setSpace(p);
      if (narrowRef.current) setSidebarOpen(false); // a phone shows one thing: the page, as it does a chat
    } else {
      if (p === popped) setPopped(null); // one component, one host at a time
      if (p === "tasks") setTaskFocus(null);
      openAppPage(p === "org" ? "orgchart" : p);
    }
  };
  const popTop = (p: TopPage) => (p === "tasks" || p === "stats" ? (popOut(p), true) : false);
  /** Servers or Tokens into the right panel; from its own page, the main pane goes back to the chat it came from. */
  const panelOut = (p: PanelPage, fromPage = false) => {
    setPanelPage(p);
    if (fromPage && space === p) (setSpace("agents"), setView({ kind: "chat" }));
  };

  // A page fills the frame and the side nav steps aside; a dashboard keeps it (he moves between projects from it).
  // While a tab or page drags, the side nav comes back (if he keeps it open) so its agents take the drop (R1.22 §3.4).
  // Servers and Tokens keep it too: since 3 Oct 00:30 its icon row is the only way between the five pages.
  // Agent Zero's own page keeps it too (3 Oct): hidden there, its five pages could not be reached from A0's page.
  const showSidebar = sidebarOpen && !navTemporarilyFolded && (space === "agents" || space === "pinboard" || space === "servers" || space === "tokens") && (view.kind === "chat" || view.id === "org" || view.id === "ended" || view.id === "zero" || isAppPage(view.id) || pageDragging);
  // t-0497: once shown, the side nav stays mounted on a desktop window and is only hidden, so going back to Home does not
  // rebuild its ~3,700 nodes (Home measured ~250 ms per return). A phone's sheet still mounts when it opens.
  const [navKept, setNavKept] = useState(false);
  useEffect(() => { if (showSidebar && !narrow) setNavKept(true); if (narrow) setNavKept(false); }, [showSidebar, narrow]);
  const navMounted = showSidebar || (navKept && !narrow);
  const chip =
    side?.kind === "split"
      ? { Icon: GlobeIcon, label: side.page.title }
      : side?.kind === "crew"
        ? { Icon: UsersIcon, label: "Crew" }
        : side?.kind === "stats"
          ? { Icon: BarChart3Icon, label: "Stats" }
          : side?.kind === "surface" && side.s === "page"
            ? { Icon: GlobeIcon, label: "Agent Zero's news and tasks" }
            : { Icon: ScrollTextIcon, label: "Recent output" };

  return (
    <AppFrame
      topProps={{ "data-ab-comp": "top-strip" }}
      side={
        <Boundary name="The agent panel" kind="card" resetKey={active?.id}>
          {/* t-0532 item 5: the companion spans the shell's two rows, beside the bar and chat.
              Keep the retained chat instance separate from the page instance and its callbacks. */}
          <div style={{ display: onChat && !(side && sideFull) ? "contents" : "none" }}>
            {/* t-0497: keep the chat panel mounted while away from Home; the shell slot hides it without rebuilding its tree. */}
            {space !== "pinboard" && active && !active.codexWorker && !activeConversationTarget && (
              <AgentPanel
                open={onChat ? panelShown : cardOpen && !side && !dockOpen}
                // Its width is remembered per agent kind, so Agent Zero's and the others' panels keep their own.
                key={active.zero ? "zero" : "agent"}
                a={active}
                agents={agents ?? []}
                workspaces={workspaces}
                org={org}
                stats={stats}
                people={people}
                focus={panelFocus}
                onDrilled={(d) => (drilled.current = d)}
                onOpenAgent={open}
                onStatsPage={() => {
                  setSide({ kind: "stats" });
                  setSideFull(false);
                }}
                onOrgChart={() => openAppPage("orgchart")}
                onPage={(page) => splitPage({ url: page.url, title: page.title })}
                onBoard={() => openAppPage("tasks")}
                onStanding={() => (setSpace("agents"), setView({ kind: "tab", id: "zero" }))}
                onClose={() => setCardOpen(false)}
                pages={pageRow}
              />
            )}
          </div>
          {/* Opened by hand (⌘⇧B) on a page that is not a chat: the open agent's panel beside it, remembered per page kind. */}
          {space !== "pinboard" && !onChat && active && !activeConversationTarget && (
            <AgentPanel
              open={cardOpen && !dockOpen}
              key={`page-${active.zero ? "zero" : "agent"}`}
              a={active}
              agents={agents ?? []}
              workspaces={workspaces}
              org={org}
              stats={stats}
              people={people}
              focus={panelFocus}
              onDrilled={(d) => (drilled.current = d)}
              onOpenAgent={open}
              onStatsPage={() => openAppPage("stats")}
              onOrgChart={() => openAppPage("orgchart")}
              onPage={(page) => openUrl(page.url, page.title)}
              onBoard={() => openAppPage("tasks")}
              onClose={() => setCardOpen(false)}
              pages={pageRow}
            />
          )}
        </Boundary>
      }
      top={
        <>
          <TopButton
            label="Show or hide the side nav"
            Icon={PanelLeftIcon}
            pressed={showSidebar}
            onClick={() => {
              if (view.kind !== "chat" && view.id !== "zero" && !isAppPage(view.id)) {
                setView({ kind: "chat" });
                setSidebarOpen(true);
              } else toggleSidebar();
            }}
          />
          <HistoryButtons canBack={hist.canBack} canForward={hist.canForward} onBack={() => router.current?.back()} onForward={() => router.current?.forward()} />
          {!narrow && !showSidebar && (space === "agents" || space === "pinboard" || space === "servers" || space === "tokens") && <TopNav active={topPage} onOpen={openTop} counts={{ tasks: openTaskCount ? `${openTaskCount} open` : undefined }} popped={popped} hue={popped ? PAGE_HUE[popped] : undefined} onPop={popTop} onPanel={panelOut} />}
          {/* On a web page the browser's own sidebar lists the tabs: here they fold into "⌄ N more" (HUB-DESIGN 22:18, one home). */}
          {/* The pill's body opens Agent Zero; only the chevron opens its chats (Shaan, 6 Oct 21:15: "I can't just click the
              body of the pill and it takes me to agent zero"). */}
          <span className="ab-zero-pill" data-testid="zero-pill">
            <button type="button" className="ab-zero-tab" data-testid="zero-pill-open" aria-label="Open Agent Zero" disabled={!zeroAgent} onClick={() => zeroAgent && open(zeroAgent, { chat: true })}>
              <AgentFace {...(zeroAgent ? faceFor(zeroAgent) : { name: "Agent Zero" })} size={18}/><span>Agent Zero</span>
            </button>
            <MenuButton label="Agent Zero chats" className="ab-zero-tab ab-zero-tab--menu" items={(agents ?? []).filter(a => a.zero).map(a => ({ key: a.id, label: <span style={{ color: a.tool === "codex" ? "#a78bfa" : "#22d3ee" }}>{`Agent Zero · ${a.tool === "codex" ? "Sol" : "Claude"}`}</span>, icon: <AgentFace {...faceFor(a)} hue={a.tool === "codex" ? 260 : 190} size={18}/>, onSelect: () => open(a, { chat: true }) }))}>
              <ChevronDownIcon size={12}/>
            </MenuButton>
          </span>
          <TopTabs tabs={tabs} activeId={activeTab} onSelect={(id) => id === "browser-return" ? showWeb() : selectTab(id)} onReorder={reorderTab} onDropPage={(p, before) => openUrl(p.url, p.title, { owner: here, before, drop: true })} fold={view.kind === "tab" && mine.some((t) => t.id === view.id && t.kind === "web")} />

          <div data-tauri-drag-region className="ab-top-drag h-full min-w-6 flex-none" />
          {/* t-0570 (Shaan, 9 Oct: "notification, new tab should be swap sides"): + first, then the bell. */}
          <TopButton label="New tab · ⌘T" Icon={PlusIcon} onClick={() => setWorkspacePaletteOpen(true)} />
          <NotificationsBell items={attention.items} open={attentionOpen} onToggle={() => setAttentionOpen(v => !v)} />
          {/* not-landed (3 Oct 14:15): the version pill opens What's new in one click. */}
          <Boundary name="The version pill" kind="inline">
            <VersionPill />
          </Boundary>
          {/* R1.15: today's fleet spend sits at the top bar's right end, not in the bottom HUD. */}
          <Boundary name="Today's spend" kind="inline">
            <SpendChip />
          </Boundary>
          {/* t-0570: the three dots moved from beside the tabs, where they read as one more tab, to the far right end, where an
              overflow menu lives in every toolbar (Chrome, VS Code); the tab strip now ends at the drag area. */}
          <MenuButton label="More views" items={[
            { key: "workspace-search", label: "Find a workspace · ⌘K", icon: <LayoutDashboardIcon />, onSelect: () => setWorkspacePaletteOpen(true) },
            { key: "workspace-chooser", label: "Agent workspaces", icon: <UsersIcon />, onSelect: () => setWorkspaceChooserOpen(true) },
            // t-0532 item 10 (Shaan, 8 Oct ~10:15: "that space dashboard pop up ... could go into the three dots"): out of the chat header.
            { key: "space", label: "Space · ⌘⇧S", icon: <LayoutGridIcon />, onSelect: () => openSpace(active?.project ?? "agent-base", active?.id ?? null) },
            { key: "canvas", label: "Canvas", icon: <NetworkIcon />, onSelect: () => openAppPage("canvas") },
            { key: "product-map", label: "Product map", icon: <LayoutDashboardIcon />, onSelect: () => openAppPage("product-map") },
            { key: "research", label: "Research", icon: <BookOpenIcon />, onSelect: () => openAppPage("research") },
            { key: "whatsnew", label: "What’s new", icon: <SparklesIcon />, onSelect: () => openAppPage("whatsnew") },
          ]}><EllipsisIcon size={16}/></MenuButton>
        </>
      }
      rail={
        <>
          {/* R1.2 C: the rail keeps only the tools; Org chart, Tasks, Servers and Tokens are in the top row. */}
          <RailButton label="Home" peek={({ close }) => <HomePeek close={close} projects={org?.groups.flatMap(group => group.projects).filter(project => project.shown) ?? []} agents={agents ?? []} loading={(!org && !orgDown) || (agents === null && !down)} unavailable={!!(orgDown || down)} currentProject={active?.project} onProject={id => { setOrgPage({ project: id }); setSpace("agents"); setView({ kind: "tab", id: "org" }); }} onAgent={agent => open(agent, { chat: true })} onHome={() => { setSpace("agents"); setView({ kind: "chat" }); }}/>} renderIcon={() => <WorkspaceMark brand="agent-base" size={32}/>} line="The agents: Agent Zero, the owners and their crews" meta={needsYou.length ? `${needsYou.length} need you · ⌥⌘A` : "⌘B side nav"} Icon={HouseIcon} active={space === "agents" && view.kind === "chat"} dot={needsYou.length > 0} onClick={() => (setSpace("agents"), setView({ kind: "chat" }))} />
          <RailDivider />
          {/* t-0541: Agent Base's own icon, its own group under the main one; its page is the three-lane task list. */}
          <RailButton label="Agent Base" peek={({ close }) => <AgentBasePeek onOpen={() => { close(); location.hash = "#project/agent-base"; }}/>} line="Agent Base: the task board (building, to do, specced, ideas, landed)" Icon={ListChecksIcon} active={view.kind === "tab" && view.id === "org" && !!orgPage && "project" in orgPage && orgPage.project === "agent-base"} onClick={() => { location.hash = "#project/agent-base"; }} />
          <RailDivider />
          <RailButton label="Voice" renderIcon={livingRailIcon("siso-voice")} line={voiceDown ? "SISO Voice is down" : "Talk anywhere: the bar, your history and stats"} meta={voiceDown ? "down" : undefined} Icon={MicIcon} active={space === "voice"} dot={voiceDown && "alert"} onClick={() => setSpace("voice")} />
          <RailButton label="Rolodex" renderIcon={livingRailIcon("rolodex")} line="Everyone you know, on six levels" meta={rolodexBook.data ? `${rolodexBook.data.people.filter((p) => p.level !== "off").length} people` : undefined} Icon={BookUserIcon} active={space === "rolodex"} onClick={() => setSpace("rolodex")} />
          {lifeOn && <RailButton label="Life" renderIcon={livingRailIcon("lifelog")} line="Your day: morning routine, counters, checkout and XP" Icon={HeartPulseIcon} active={space === "life" && view.kind === "chat"} onClick={() => (setSpace("life"), setView({ kind: "chat" }))} />}
          {whatsappOn && <RailButton label="WhatsApp" onWarm={() => { void import("./components/WhatsAppSpace").then((m) => m.warmWhatsApp()); }} renderIcon={livingRailIcon("whatsapp")} line="Your chats and groups" Icon={MessageCircleIcon} active={space === "whatsapp" && view.kind === "chat"} onClick={() => (setSpace("whatsapp"), setView({ kind: "chat" }))} />}
          <RailButton label="Browser" renderIcon={livingRailIcon("web")} line="Web pages as tabs beside the agents" meta={webTabs.length ? `${webTabs.length} open · ⌘T` : "⌘T"} Icon={GlobeIcon} active={space === "web"} onClick={showWeb} />
          <span style={{ display: "contents" }} onPointerOver={() => setEstateKept(true)}>
            <RailButton label="Estate" onWarm={() => { void import("./components/LibrarySpace"); }} renderIcon={livingRailIcon("estate")} line="The land and its Library: every repo, agent, machine and doc" Icon={LandmarkIcon} active={estateArea} onClick={() => (setSpace("estate"), setView({ kind: "chat" }))} />
          </span>
          {!showSidebar && (space === "agents" || space === "web") && agents && (
            <FaceDock agents={agents} pins={[] /* no pins in the rail either (Shaan, 6 Oct 22:35: "the pinned stuff ... I really dont like it") */} onManagePins={() => {} /* Starred is archived (AB-02) */} workspaces={workspaces} needs={needs} activeId={activeId} infra={org?.bottom.map((o) => o.name) ?? []} onOpen={(a, conversationTarget) => open(a, { cause: "dock", conversationTarget })} onOrgChart={() => openTop("org")} onEdit={edit} />
          )}
        </>
      }
      railFooter={
        <HoverCard title="Shaan · MacBook" line={error ? `${down === "node" ? "the node" : "herdr"} is not answering; retrying` : "This machine: herdr answers for its agents"} meta={error ? "down" : `${agents?.length ?? "…"} agents`}>
          <span className={`siso-app__orb${error ? " is-down" : ""}`} tabIndex={0} aria-label={error ? `Shaan · MacBook · ${down === "node" ? "the node" : "herdr"} is not answering` : `Shaan · MacBook · ${agents?.length ?? "…"} agents`}>
            SS
          </span>
        </HoverCard>
      }
    >
      {editError && <div role="alert" className="fixed bottom-4 left-1/2 z-[100] flex max-w-[min(90vw,600px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-red-400/30 bg-background p-3 text-[12px] text-red-400 shadow-lg"><span className="min-w-0 break-words">{editError}</span><button type="button" onClick={clearEditError} className="shrink-0 rounded px-2 py-1 hover:bg-white/[0.08]" aria-label="Dismiss save error">Dismiss</button></div>}
      {/* QA #13 (A0, 3 Oct): each space, the side nav, the chat, a page and the side panel fail on their own. */}
      <Boundary name={`The ${space} space`} resetKey={`${space}:${view.kind}`}>
      {(rolodexOn || rolodexKept) && (
        <div style={{ display: rolodexOn ? "contents" : "none" }}>
          {sidebarOpen && <RolodexSidebar book={rolodexBook} selected={rolodexSel} onSelect={(s) => { setRolodexSel(s); setRolodexPerson(null); }} onOpen={(id) => { setRolodexSel("all"); setRolodexPerson(id); }} />}
          <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Rolodex">
            <RolodexMain
              book={rolodexBook}
              selected={rolodexSel}
              onSelect={setRolodexSel}
              person={rolodexPerson}
              onPerson={setRolodexPerson}
              projectHref={(p) => `#project/${encodeURIComponent(p.name)}`}
              onAsk={(words) => {
                // A0's chat with the person's words typed, as the Library's "Ask keeper" does.
                const a = (agents ?? []).find((x) => x.row === "live" && (x.zero || canonName(x.name) === canonName("A0")));
                if (!a) return;
                setSpace("agents");
                open(a, { chat: true });
                prefill(a.id, words);
              }}
            />
          </section>
        </div>
      )}
      {space === "whatsapp" && whatsappOn && view.kind === "chat" && (
        <section className="relative flex min-w-0 flex-1 flex-col" aria-label="WhatsApp">
          <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading WhatsApp…</p>}><WhatsAppSpace /></Suspense>
        </section>
      )}
      {(estateArea || estateKept || libraryKept) && (
        <div className="flex min-w-0 flex-1 flex-col" style={estateArea ? undefined : { display: "none" }}>
          {estateArea && (
            <nav aria-label="Estate" className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
              {([["world", "World", LandmarkIcon], ["library", "Library", BookOpenIcon], ["register", "Register", ListChecksIcon]] as const).map(([k, label, Icon]) => {
                const on = k === "register" ? space === "library" : space === "estate" && estatePane === k;
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => { if (k === "register") setSpace("library"); else { setEstatePane(k); setSpace("estate"); } }}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] ${on ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                    <Icon className="size-3.5" aria-hidden />{label}
                  </button>
                );
              })}
              {libraryOn && <a href="https://siso-library.dtc-storefront.workers.dev" target="_blank" rel="noreferrer" className="ml-auto text-[12px] text-muted-foreground hover:text-foreground" title="The same Library on Cloudflare (private), for the phone">On the phone ↗</a>}
            </nav>
          )}
          {(estateOn || estateKept) && (
            // Keep Estate's bottom controls above Agent Zero's face and orbit on a phone.
            <section className={`relative flex min-w-0 flex-1 flex-col ${zeroAgent ? "pb-24 sm:pb-0" : ""}`} aria-label="Estate world" style={estateOn ? undefined : { display: "none" }}>
              <iframe title="Estate world" src="/estate-world/" className="min-h-0 w-full flex-1 border-0 bg-black" />
            </section>
          )}
          {(libraryOn || libraryKept) && (
            <section className={`relative flex min-w-0 flex-1 flex-col ${zeroAgent ? "pb-24 sm:pb-0" : ""}`} aria-label="Library" style={libraryOn ? undefined : { display: "none" }}>
              <iframe title="The Great Library" src={librarySrc} className="min-h-0 w-full flex-1 border-0 bg-background" />
            </section>
          )}
          {space === "library" && view.kind === "chat" && (
            <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Library register">
              <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Library…</p>}><LibrarySpace
                onOpenProject={id => { setOrgPage({ project: id }); setSpace("agents"); setView({ kind: "tab", id: "org" }); }}
                onOpenTask={id => { openAppPage("tasks"); setTaskFocus({ id }); }}
                onOpenUrl={(url, title) => openUrl(url, title)}
                keeperLive={(seat) => (agents ?? []).some((a) => a.row === "live" && (canonName(a.name) === canonName(seat) || (seat === "A0" && a.zero)))}
                onAsk={(seat, words) => {
                  const a = (agents ?? []).find((x) => x.row === "live" && (canonName(x.name) === canonName(seat) || (seat === "A0" && x.zero)));
                  if (!a) return;
                  setSpace("agents");
                  open(a, { chat: true });
                  if (words) prefill(a.id, words);
                }}
              /></Suspense>
            </section>
          )}
        </div>
      )}
      {space === "life" && lifeOn && view.kind === "chat" && (
        <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Life…</p>}>
          {sidebarOpen && <LifeSidebar selected={lifeSel} onSelect={setLifeSel} />}
          <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Life">
            <LifeMain selected={lifeSel} onSelect={setLifeSel} />
          </section>
        </Suspense>
      )}
      {space === "voice" && view.kind === "chat" && (
        <div className="vx-space">
          {sidebarOpen && <VoiceSidebar selected={voiceSel} onSelect={setVoiceSel} />}
          <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Voice">
            <VoiceMain selected={voiceSel} />
          </section>
        </div>
      )}
      </Boundary>
      {narrow && active && phoneTasks === active.name && view.kind === "chat" && space === "agents" && !showSidebar && (
        <TasksSheet key={active.id} a={active} agents={agents ?? []} onClose={closePhoneTasks} />
      )}
      {/* t-0263: on a phone the nav is a full-screen sheet over the chat (Phone.css), opened from the top-left button. */}
      {navMounted && <div style={{ display: showSidebar ? "contents" : "none" }}><PhoneSheet on={narrow}><Boundary name="The side nav" kind="card"><Sidebar workspaces={workspaces} onWorkspace={setNavWorkspace} onFleet={() => { if (!zeroAgent) return; open(zeroAgent, { chat: true }); setSide(null); setCardOpen(true); setPanelFocus({ section: "team", at: Date.now() }); }} onPinboard={id => openSpace(id)} onProjectDashboard={id => { setOrgPage({ project: id }); setSpace("agents"); setView({ kind: "tab", id: "org" }); if (narrow) setSidebarOpen(false); }} selectedNowLane={selectedNowLane} onNowLane={setSelectedNowLane} onCodexWork={() => { openAppPage("codex-work"); if (narrow) setSidebarOpen(false); }} codexWorkActive={view.kind === "tab" && view.id === "codex-work"} onDashboard={() => { openAppPage("dashboard"); if (narrow) setSidebarOpen(false); }} pins={pins} onManagePins={() => { openAppPage("starred"); if (narrow) setSidebarOpen(false); }} needs={needs} onNeedsYou={nextNeedsYou} onOrgChart={() => openTop("org")} agents={agents} domains={domains} error={error} down={down} asOf={asOf} activeId={activeId} onOpen={(a, conversationTarget) => !conversationTarget && space === "pinboard" ? openSpace(a.project ?? pinProject, a.id) : open(a, { chat: true, conversationTarget })} onAct={act} onEdit={edit} onReorder={reorder} onReorderProjects={reorderProjects} org={org} orgDown={orgDown} onOrg={orgOp} onNewCodex={async (name,choice,backendCatalogId) => { try {const key=`codex:${name}:${JSON.stringify(choice)}`+(backendCatalogId ? `:backend:${backendCatalogId}` : "");const r=await requestWorkspace("/api/agents/start-codex",{name,model:"gpt-6.1-sol",...choice,...(backendCatalogId ? {backendCatalogId} : {}),launchId:draftLaunchId(key)});acceptWorkspace(r);completeLaunchDraft(key);return null;}catch(e){return (e as Error).message;} }} onNewClaude={async (name,choice) => { try {const key=`claude:${name}:${JSON.stringify(choice)}`;const r=await requestWorkspace("/api/agents/start",{name,model:"opus",...choice,launchId:draftLaunchId(key)});acceptWorkspace(r);completeLaunchDraft(key);return null;}catch(e){return (e as Error).message;} }} onStart={startAgent} onSay={sayStart} onAskZero={askZero} taskCounts={taskCounts} needTasks={needTasks} onNeedTasks={() => openAppPage("tasks")} onTasks={(a) => (open(a, { chat: true }), setTasksFor(a.name))}
          ended={ended}
          onEndedPage={() => { openAppPage("ended-list"); if (narrow) setSidebarOpen(false); }}
          onPage={(p) => {
            if (narrow) setSidebarOpen(false);
            setOrgPage(p);
            setSpace("agents");
            setView({ kind: "tab", id: "org" });
          }}
          onWorkers={(a) => {
            // The owner's workers in the Codex-style pane (Active · N / Done · N); each opens its chat.
            open(a, { chat: true });
            setSide({ kind: "crew", id: null });
            setSideFull(false);
          }}
          onZeroPage={(a) => {
            open(a, { chat: true });
            setSide({ kind: "surface", s: "page" });
            setSideFull(false);
          }}
          onRename={(a) => {
            open(a, { chat: true });
            setRenaming(a.name);
          }}
        /></Boundary></PhoneSheet></div>}
      <Boundary name={`The ${space} space`} resetKey={`${space}:${view.kind}`}>
      {space === "pinboard" && <ProjectSpace key={pinProject} project={pinProject} focusId={spaceFocus} people={people} org={org} onAppPage={page => page === "zero" ? (setSpace("agents"), setView({ kind: "tab", id: "zero" })) : openAppPage(page)} onClose={() => setSpace("agents")} onPage={page => openUrl(page.url, page.title)} />}
      {launchWorkspace && <div className="fixed bottom-4 right-4 z-40 w-[min(28rem,calc(100vw-2rem))]"><WorktreeSetupCard id={launchWorkspace} onActive={workspaceActive} onClose={()=>{setLaunchWorkspace(null);sessionStorage.removeItem("ab-current-workspace");}} /></div>}
      {attentionOpen && <div className="ab-attention-anchor">{attentionError && <p role="alert" className="siso-card p-2">{attentionError}</p>}<AttentionPanel {...attention} onOpen={id => void openAttention(id)} onClose={() => setAttentionOpen(false)} refresh={attention.load}/></div>}
      {/* QA #9 (A0, 3 Oct): Servers and Tokens render after the side nav, so it stays on the left as on every other page. */}
      {space === "tokens" && view.kind === "chat" && (
        <section className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Usage">
          <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Usage…</p>}><TokensPage onPopOut={() => panelOut("tokens", true)} /></Suspense>
        </section>
      )}
      {space === "servers" && view.kind === "chat" && (
        <section className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Servers">
          <ServersPage
            agents={agents ?? []}
            onOpenAgent={(id) => {
              const a = byId.get(id);
              if (a) open(a);
            }}
            onOpenUrl={(url) => openUrl(url)}
            onPopOut={() => panelOut("servers", true)}
          />
          <RemoteInventory />
        </section>
      )}
      </Boundary>
      <Boundary name="This chat" resetKey={activeId} hidden={view.kind !== "chat" || space !== "agents"}>
      {popped && (
        <PagePop
          page={popped}
          title={popped === "tasks" ? "Tasks" : "Stats"}
          answer={popped === "tasks" ? <TasksAnswer /> : <Suspense fallback={null}><StatsAnswer /></Suspense>}
          onExpand={() => {
            setPopped(null);
            openAppPage(popped);
          }}
          onClose={() => setPopped(null)}
        >
          {popped === "tasks" ? <TasksPage host="pop" agents={taskAgents} onOpenAgent={openAgentByName} /> : <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Usage…</p>}><FleetStatsPage host="pop" /></Suspense>}
        </PagePop>
      )}
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        aria-label="Chat"
        style={{ display: view.kind !== "chat" || space !== "agents" || (side && sideFull) ? "none" : undefined }}
        onDragOver={(e) => {
          if (!isPageDrag(e)) return;
          if (e.defaultPrevented) return setDropping(false); // over a page-row zone
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={onDrop}
      >
        {space !== "pinboard" && active?.codexWorker && !activeConversationTarget ? <CodexWorkerPage agent={active} /> : <>
        {/* The header and chat share one column; the companion reserves its width in AppFrame's side slot. */}
        <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {active && (
          <ChatHeader
            key={`head-${active.id}-${activeConversationTarget ? pinTargetKey(activeConversationTarget) : ""}`}
            a={active}
            conversationTarget={activeConversationTarget}
            state={navState(active, needs)}
            org={org}
            agents={agents ?? []}
            onOpenAgent={(a) => open(a)}
            onOrgChart={() => openTop("org")}
            doingOf={headDoing}
            doing={headDoing(active)}
            onIt={headOnIt(active)}
            needText={needText}
            move={activeConversationTarget ? null : moves[active.name] ?? null}
            tasks={headTasks}
            tasksOpen={narrow ? phoneTasks === active.name : tasksFor === active.name}
            onTasks={() => (narrow ? setPhoneTasks((v) => (v === active.name ? null : active.name)) : setTasksFor((v) => (v === active.name ? null : active.name)))}
            view={activeConversationTarget ? null : active.chat ? (asTerminal[active.id] ? "terminal" : "chat") : null}
            onView={(v) => { if (!activeConversationTarget) setAsTerminal((m) => ({ ...m, [active.id]: v === "terminal" })); }}
            cardOpen={panelShown}
            onCard={() => (side ? (closeSide(), setCardOpen(true)) : setCardOpen((v) => !v))}
            scratch={active.zero && view.kind === "chat" && space === "agents" && !(side && sideFull) ? <>{!narrow && <ScratchpadChip />}<A0FleetChips hide={["codex", "research"]} onResearch={() => openAppPage("research")} onLane={() => openAppPage("codex-work")} onCodexWork={() => openAppPage("codex-work")} /></> : null}
            pageCount={pageRow ? pageRow.pinned.length + pageRow.dropped.length : 0}
            renaming={renaming === active.name}
            onRenameStart={() => setRenaming(active.name)}
            onRename={(to) => {
              if (to && to !== active.name) {
                void edit({ op: "rename", name: active.name, to });
                // Its tabs and its last tab go with the name.
                setOpenTabs((ts) => ts.map((t) => (t.owner === active.name ? { ...t, owner: to } : t)));
                setLastTab(({ [active.name]: last, ...m }) => (last ? { ...m, [to]: last } : m));
              }
              setRenaming(null);
            }}
            pinned={active.pinned}
            pinUnavailable={!canEditAgentPin(active)}
            pinLabel={agentPinLabel(active, "Pin under Agent Zero")}
            onPin={() => toggleAgentPin(active, edit)}
            toHost={
              // The file-read chat is for agents already running in the terminal; this moves one under siso-host
              // (2 Oct 14:10), same pane, same session, at a clean break.
              !activeConversationTarget && active.chat && !active.host && active.tool === "claude"
                ? {
                    busy: moving === active.id,
                    why: active.status === "working" ? "Wait until it stops working" : null,
                    error: moveErr[active.id] ?? null,
                    go: async () => {
                      const id = active.id;
                      setMoving(id);
                      setMoveErr(({ [id]: _, ...rest }) => rest);
                      const r = await fetch(`/api/agents/${encodeURIComponent(id)}/to-host`, { method: "POST" }).then((x) => x.json()).catch(() => ({ error: "no answer" }));
                      if (r.error) setMoving(null), setMoveErr((m) => ({ ...m, [id]: String(r.error) }));
                      else window.setTimeout(() => setMoving(null), 15000);
                    },
                  }
                : null
            }
            onOpenPage={() => {
              setSide({ kind: "surface", s: "page" });
              setSideFull(false);
            }}
            onAnswer={() => {
              setAsTerminal((m) => ({ ...m, [active.id]: false }));
              window.dispatchEvent(new CustomEvent("siso-chat-jump", { detail: { agentId: active.id } }));
            }}
            now={Date.now()}
          />
        )}
        {active && !activeConversationTarget && (
          <PingStrip
            agent={active}
            pings={pings}
            onBoard={() => {
              setSpace("agents");
              setView({ kind: "tab", id: "zero" });
            }}
          />
        )}
        <div className="relative min-h-0 min-w-0 flex-1">
          {space !== "pinboard" && live.filter(id => pinnedChats[id] || !byId.get(id)?.codexWorker).map((id) => (
            <div key={JSON.stringify([id, pinnedChats[id] ? pinTargetKey(pinnedChats[id].target) : null])} className="absolute inset-0" style={{ display: id === activeId ? undefined : "none" }}>
              {pinnedChats[id] || byId.get(id)?.chat && !asTerminal[id] ? (
                <ChatView
                  agentId={id}
                  conversationTarget={pinnedChats[id]?.target}
                  onQuestionConnection={onOwnerQuestions}
                  agentKey={byId.get(id)?.key}
                  agentName={byId.get(id)?.name}
                  active={id === activeId && view.kind === "chat"}
                  // R1.19: the HUD row lives inside the chat's halo rim; a terminal keeps it as the strip below.
                  hud={id === activeId && active && !pinnedChats[id] ? <Hud a={active} crew={crew} onOpenCrew={open} variant="rim" model={hudModel} /> : undefined}
                  people={people}
                  accent={accentRgb(byId.get(id)?.project)}
                  onMoved={onChatMoved}
                />
              ) : (
                <TerminalLoadBoundary>
                  <Suspense fallback={<TerminalFallback />}>
                    <TerminalView socketPath={`/term/${encodeURIComponent(id)}/ws`} active={id === activeId && view.kind === "chat"} background="#171715" />
                  </Suspense>
                </TerminalLoadBoundary>
              )}
            </div>
          ))}
          {!active && (
            <div className="ab-pick-empty flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>{skipPinRestore.current ? "Reopen your pinned conversation from the sidebar." : "Pick an agent on the left."}</span>
              {needsYou.length > 0 && (
                <span className="text-xs">
                  <span className="text-needs">{needsYou.length} need you</span> · <kbd className="font-sans">⌥⌘A</kbd> opens the first
                </span>
              )}
            </div>
          )}
        </div>
        </div>
          {dropping && <div className="siso-drop">Drop to open beside the chat</div>}
        </div>
        {/* R1.19: a chat carries its HUD inside its halo rim; only a terminal keeps the strip. */}
        {active && !activeConversationTarget && !(active.chat && !asTerminal[active.id]) && <Hud a={active} crew={crew} onOpenCrew={open} model={hudModel} />}
        </>}
      </section>
      </Boundary>
      {/* Terminals he opened stay alive while their tab exists, shown only when picked. */}
      {openTabs
        .filter((t) => t.kind === "term")
        .map((t) => (
          <section key={t.id} className="relative min-w-0 flex-1" aria-label="Terminal" style={{ display: view.kind === "tab" && view.id === t.id ? undefined : "none" }}>
            <TerminalLoadBoundary>
              <Suspense fallback={<TerminalFallback />}>
                <TerminalView socketPath={`/shell/${encodeURIComponent(t.id.replace(/[^A-Za-z0-9_-]/g, "-"))}/ws`} active={view.kind === "tab" && view.id === t.id} background="#171715" />
              </Suspense>
            </TerminalLoadBoundary>
          </section>
        ))}
      <Boundary name="This page" resetKey={view.kind === "tab" ? view.id : "chat"}>
      {view.kind === "tab" && view.id === "zero" && (
        <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label="Agent Zero's page">
          {zeroAgent?.key && <div className="px-6"><ZeroPipelineMetric agentKey={zeroAgent.key}/></div>}
          {a0Page.error && <p role="status" className="px-6 py-3 text-[13px] text-muted-foreground">Could not refresh {a0Page.error}. {a0Page.page ? "Showing the last available data." : "Trying again shortly."}</p>}
          {a0Page.loading && <p role="status" className="px-6 py-3 text-[13px] text-muted-foreground">{a0Page.loading}</p>}
          {a0Page.page ? <AgentZeroPage data={a0Page.page.data} widgets={a0Page.page.widgets} sources={a0Page.sources} onTasksPage={() => openAppPage("tasks")} /> : null}
        </section>
      )}
      {view.kind === "tab" && view.id === "ended" && endedOpen && (
        <section className="relative flex min-w-0 flex-1 flex-col" aria-label={`${endedOpen.name}, ended`} data-testid="ended-chat">
          <header className="flex shrink-0 items-baseline gap-2 px-5 pb-2 pt-3 text-[13px]">
            <b className="font-semibold">{endedOpen.name}</b>
            <span className="text-muted-foreground">
              ended {new Date(endedOpen.ended).toLocaleString()}
              {endedOpen.project ? ` · ${endedOpen.project}` : ""}
              {endedOpen.task ? ` · ${endedOpen.task}` : ""}
            </span>
          </header>
          {endedOpen.session ? (
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0">
                <ChatView key={`ended-${endedOpen.id}`} agentId={endedOpen.id} active ended people={people} accent={accentRgb(endedOpen.project)} />
              </div>
            </div>
          ) : (
            <p className="p-6 text-[13px] text-muted-foreground">No session was recorded for {endedOpen.name}, so there is no chat to read back.</p>
          )}
        </section>
      )}
      {view.kind === "tab" && view.id === "ended-list" && <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label="Ended">
        <EndedPage ended={ended} activeId={endedOpen?.id} onOpen={e => { setEndedOpen(e); setView({ kind: "tab", id: "ended" }); }} />
      </section>}
      {view.kind === "tab" && view.id === "dashboard" && (
        <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label="Dashboard">

          <DashboardPage org={org} orgDown={orgDown} agents={agents ?? []} onOpen={openTop} onOpenAgent={(agent) => open(agent, { chat: true })} onTasks={(focus) => {
            openTop("tasks");
            setTaskFocus(Object.keys(focus).length ? focus : null);
            setBackTo({ view, space });
          }} />
        </section>
      )}
      {view.kind === "tab" && view.id === "tasks" && (
        <section className="relative min-w-0 flex-1" aria-label="Tasks">
          <TasksPage focus={taskFocus} onClearFocus={() => setTaskFocus(null)} agents={taskAgents} onOpenAgent={openAgentByName} onPop={() => popOut("tasks")} onBack={leaveAppPage} backLabel={backTo?.view.kind === "tab" && backTo.view.id === "dashboard" ? "Dashboard" : backTo?.view.kind === "tab" && backTo.view.id === "zero" ? "Where things stand" : backTo?.view.kind === "chat" && active ? active.name : "Back"} />
        </section>
      )}
      {/* A page module (pages/*.page.tsx, docs/WIRING.md) renders itself; the built-in pages keep their own flows. */}
      {view.kind === "tab" && getPage(view.id)?.render({ onBack: leaveAppPage, backLabel: backTo?.view.kind === "chat" && active ? active.name : "Back" })}
      {view.kind === "tab" && view.id === "canvas" && <section className="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Canvas"><CanvasPage agents={agents ?? []} onOpenAgent={a => open(a, { chat: true })} onOpenPage={(p) => void openUrl(p.url, p.title)} onOpenResearch={selection => { setResearchSelection(selection ?? null); openAppPage("research"); }} onClose={leaveAppPage} /></section>}
      {view.kind === "tab" && (view.id === "stats" || view.id === "whatsnew" || view.id === "codex-work" || view.id === "research" || view.id === "product-map") && (
        <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label={APP_PAGES[view.id]}>
          <div className="siso-apppage__crumb">
            <button type="button" onClick={leaveAppPage}>
              <ArrowLeftIcon size={14} /> {backTo?.view.kind === "chat" && active ? active.name : "Back"}
            </button>
            <span aria-hidden="true">›</span>
            <b>{APP_PAGES[view.id]}</b>
          </div>
          {view.id === "product-map" ? <ProductMap onOpenUrl={(url, title) => void openUrl(url, title)} /> : view.id === "research" ? <ResearchPage initialSelection={researchSelection} /> : view.id === "codex-work" ? <CodexWorkPage /> : view.id === "stats" ? (
            <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Usage…</p>}><FleetStatsPage onPop={() => popOut("stats")} /></Suspense>
          ) : (
            <WhatsNewPage />
          )}
        </section>
      )}
      {view.kind === "tab" && view.id === "orgchart" && (
        <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label="Org chart">
          <div className="siso-apppage__crumb">
            <button type="button" onClick={leaveAppPage}>
              <ArrowLeftIcon size={14} /> {backTo?.view.kind === "chat" && active ? active.name : "Back"}
            </button>
            <span aria-hidden="true">›</span>
            <b>Org chart</b>
          </div>
          {hubOrg ? (
            <OrgChart
              org={hubOrg}
              agents={agents ?? []}
              roster={org ?? undefined}
              onOpenAgent={(id) => { const a = agents?.find(a => a.id === id); if (a) open(a); }}
              onOpen={(name) => {
                const a = (agents ?? []).find((x) => canon(x.name) === canon(name) || (canon(name) === "A0" && x.zero));
                if (a) open(a);
              }}
            />
          ) : (
            <p className="p-6 text-[13px] text-muted-foreground">{hubOrg === null ? "The org chart is unavailable." : "Reading the org…"}</p>
          )}
        </section>
      )}
      {view.kind === "tab" && view.id.startsWith("owner-info:") && ownerInfo && <OwnerPage name={ownerInfo} workspaces={workspaces} questions={ownerQuestionConnection} onBack={() => setView({ kind: "chat" })} onPage={(url, title) => void openUrl(url, title, { owner: "web" })} chatAvailable={!!ownerChat} onChat={() => { if (ownerChat) { setAsTerminal(m => ({ ...m, [ownerChat.id]: false })); open(ownerChat, { chat: true }); } }} />}
      {view.kind === "tab" && view.id === "org" && orgPage && (
        <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label="Dashboard">
          {"lane" in orgPage ? (
            <MiniLanePage key={orgPage.lane} name={orgPage.lane} onBack={() => (setOrgPage(null), setView({ kind: "chat" }))} />
          ) : "project" in orgPage ? (
            <ProjectRoute key={orgPage.project} id={orgPage.project} org={org} agents={agents ?? []}
              onStart={startAgent}
              overview={hubProject?.id === orgPage.project ? <ProjectDashboard embedded project={hubProject} agents={[...hubAgents.values()]} onNeed={n => n.link && openLink(n.link)} onOpen={name => { const a = (agents ?? []).find(x => canon(x.name) === canon(name)); if (a) { open(a); setView({kind:"chat"}); } }} /> : undefined}
              live={hubProject?.id === orgPage.project ? <Suspense fallback={null}><LiveStrip key={hubProject.id} project={hubProject} onOpenUrl={(url, title) => openUrl(url, title)} /></Suspense> : undefined}
              onCrumb={() => setOrgPage({ group: org?.groups.find(g => g.projects.some(p => p.id === orgPage.project))?.id ?? "agency" })}
              onTask={id => { openAppPage("tasks"); setTaskFocus({ id }); }}
              onOpen={name => { const a = (agents ?? []).find(x => canon(x.name) === canon(name)); if (a) { open(a); setView({ kind: "chat" }); } }}
            />
          ) : (
          <OrgPage
            key={"group" in orgPage ? orgPage.group : "org"}
            org={org}
            page={orgPage as { group: string } | { project: string }}
            onPage={setOrgPage}
            onOrg={orgOp}
            onStart={startAgent}
            onOpen={(name) => {
              const a = (agents ?? []).find((x) => x.name === name);
              if (a) {
                open(a);
                setView({ kind: "chat" });
              }
            }}
          />
          )}
        </section>
      )}
      {view.kind === "tab" && view.id !== "org" && view.id !== "zero" && view.id !== "ended" && !ownerInfo && !isAppPage(view.id) && !openTabs.some((t) => t.id === view.id && t.kind === "term") && (
        <div
          className="relative flex min-w-0 flex-1"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(CHAT_DRAG)) return;
            e.preventDefault();
            setBesideDrop(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setBesideDrop(false)}
          onDrop={(e) => {
            setBesideDrop(false);
            const id = e.dataTransfer.getData(CHAT_DRAG);
            if (!id || !byId.has(id)) return;
            e.preventDefault();
            setChatBeside(id);
          }}
        >
        <PageView
          tabId={view.id}
          key={view.id}
          web={openTabs.some((t) => t.id === view.id && t.owner === "web")}
          nav={navOf(view.id)}
          title={openTabs.find((t) => t.id === view.id)?.title ?? allPages.find((p) => `page:${p.url}` === view.id)?.title ?? "Page"}
          pinned={pinnedUrlSet.has(navOf(view.id).url)}
          suggested={suggested}
          recents={recentPages}
          onGo={(url, title, fromPage) => go(view.id, url, title, fromPage)}
          onTitle={(title) => retitle(view.id, title)}
          onBack={() => step(view.id, -1)}
          onForward={() => step(view.id, 1)}
          onReload={() => setNav((m) => ({ ...m, [view.id]: { ...navOf(view.id), n: navOf(view.id).n + 1 } }))}
          onPin={(pin) => {
            const url = navOf(view.id).url;
            void edit(pin ? { op: "pin-page", url, title: openTabs.find((t) => t.id === view.id)?.title ?? hostOf(url) } : { op: "unpin-page", url });
          }}
          onBeside={
            active
              ? () => {
                  const url = navOf(view.id).url;
                  splitPage({ url, title: openTabs.find((t) => t.id === view.id)?.title ?? allPages.find((p) => p.url === url)?.title ?? hostOf(url), tab: view.id });
                  setSpace("agents");
                  setView({ kind: "chat" });
                }
              : undefined
          }
          onTerminal={() => toTerminal(view.id)}
          onNewTab={() => setWorkspacePaletteOpen(true)}
          tabs={browserTabs}
          onSelectTab={(id) => (setSpace("web"), setView({ kind: "tab", id }))}
          onCloseTab={closeTab}
          onOpenTab={openBrowserTab}
          onBindTab={bindBrowserTab}
        />
        {besideDrop && <div className="siso-drop">Drop to read {active?.name ?? "the chat"} beside this page</div>}
        </div>
      )}
      {/* The chat tab dropped on a page (§3.4 last row): the agent's chat beside the page he is reading. */}
      {!dockOpen && view.kind === "tab" && chatBeside && (pinnedChats[chatBeside] || byId.get(chatBeside)?.chat) && space === "agents" && (
        <SidePanel
          onClose={() => setChatBeside(null)}
          storeKey="chat-beside-width"
          title={
            <span className="flex min-w-0 items-center gap-2" data-testid="chat-beside">
              <AgentFace {...faceFor(byId.get(chatBeside)!)} size={16} />
              <span className="truncate">{byId.get(chatBeside)!.name}</span>
              <button type="button" className="text-[11.5px] font-normal text-muted-foreground hover:text-foreground" onClick={() => (open(byId.get(chatBeside)!, { chat: true, conversationTarget: pinnedChats[chatBeside]?.target }), setChatBeside(null))}>
                Open the chat
              </button>
            </span>
          }
        >
          <ChatView key={`beside-${chatBeside}-${pinnedChats[chatBeside] ? pinTargetKey(pinnedChats[chatBeside].target) : ""}`} conversationTarget={pinnedChats[chatBeside]?.target} agentId={chatBeside} agentKey={byId.get(chatBeside)?.key} agentName={byId.get(chatBeside)?.name} active people={people} accent={accentRgb(byId.get(chatBeside)?.project)} />
        </SidePanel>
      )}
      </Boundary>
      {fleetWorkspace && <SidePanel title={`Fleet · ${workspaces.find(w => w.id === fleetWorkspace)?.name ?? fleetWorkspace}`} onClose={() => setFleetWorkspace(null)} storeKey="workspace-fleet-width">{fleetDrill && byId.has(fleetDrill.parent) ? <><button type="button" className="p-3 text-xs" onClick={() => setFleetDrill(null)}>← Fleet · {fleetDrill.name}</button><SubagentView parent={byId.get(fleetDrill.parent)!} id={fleetDrill.id} onGo={(url, title) => void openUrl(url, title)} /></> : <FleetBoard workspace={fleetWorkspace} onOpen={a => open(a, { chat: true })} onCrew={r => { if (r.crewParentId) setFleetDrill({ parent: r.crewParentId, id: r.crew?.toolUseId ?? r.crew?.id ?? r.id, name: r.name }); }} />}</SidePanel>}
      <Boundary name="The side panel" kind="card" resetKey={side ? JSON.stringify(side) : null}>
      {!dockOpen && side && view.kind === "chat" && space === "agents" && (
        <SidePanel
          full={sideFull}
          onClose={closeSide}
          storeKey={side.kind === "split" ? "split-width" : "side-panel-width"}
          title={
            <span className="flex min-w-0 items-center gap-3">
              <span className="siso-side__chip">
                <chip.Icon aria-hidden="true" />
                <span className="truncate">{chip.label}</span>
              </span>
              {side.kind === "split" && (
                <button type="button" className="text-[11.5px] font-normal text-muted-foreground hover:text-foreground" onClick={() => (side.tab.startsWith("split:") ? openUrl(navOf(side.tab).url || side.page.url, side.page.title) : setView({ kind: "tab", id: side.tab }), closeSide())}>
                  Full width
                </button>
              )}
              {(side.kind === "surface" || side.kind === "stats") && (
                <button type="button" className="text-[11.5px] font-normal text-muted-foreground hover:text-foreground" onClick={() => setSideFull((v) => !v)}>
                  {sideFull ? "Beside the chat" : "Full screen"}
                </button>
              )}
            </span>
          }
        >
          {side.kind === "split" && (
            <PageView
              key={`split-${side.tab}`}
              slim
              tabId={side.tab}
              web={openTabs.some((t) => t.id === side.tab && t.owner === "web")}
              nav={navOf(side.tab).url ? navOf(side.tab) : { url: side.page.url, back: [], fwd: [], n: 0 }}
              title={side.page.title}
              pinned={pinnedUrls.has(navOf(side.tab).url || side.page.url)}
              suggested={suggested}
              recents={recentPages}
              onGo={(url, title, fromPage) => go(side.tab, url, title, fromPage)}
              onTitle={(title) => retitle(side.tab, title)}
              onBack={() => step(side.tab, -1)}
              onForward={() => step(side.tab, 1)}
              onReload={() => setNav((m) => ({ ...m, [side.tab]: { ...navOf(side.tab), n: navOf(side.tab).n + 1 } }))}
              onPin={(pin) => {
                const url = navOf(side.tab).url || side.page.url;
                void edit(pin ? { op: "pin-page", url, title: side.page.title } : { op: "unpin-page", url });
              }}
              onTerminal={() => {}}
            />
          )}
          {side.kind === "crew" && !side.id && (
            <div className="flex h-full flex-col">
              <div className="siso-subhead">
                <span className="siso-subhead__name">{active?.name}'s crew</span>
                <span className="siso-subhead__meta">{crew.length}</span>
              </div>
              <div className="p-2">
                {crew.length === 0 && <p className="p-3 text-sm text-muted-foreground">No crew in herdr.</p>}
                {crew.map((c) => (
                  <button key={c.id} type="button" className="siso-card__row" onClick={() => setSide({ kind: "crew", id: c.id })}>
                    <span className={`siso-dot is-${markOf(c)}`} aria-hidden="true" />
                    <span className="siso-card__label">{c.name}</span>
                    <span className="siso-card__detail">{WORD[markOf(c)]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {side.kind === "crew" && side.id && (
            <div className="flex h-full flex-col">
              <div className="siso-subhead">
                <button type="button" className="siso-subhead__back" aria-label="Back to the crew" title="Back to the crew" onClick={() => setSide({ kind: "crew", id: null })}>
                  <ArrowLeftIcon />
                </button>
                <span className="siso-subhead__name">{peeked?.name ?? "Gone from herdr"}</span>
                {peeked && (
                  <button type="button" className="flex flex-none items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground" title="Make it the open chat" onClick={() => open(peeked, { conversationTarget: pinnedChats[peeked.id]?.target })}>
                    <ExpandIcon size={12} /> Open as the chat
                  </button>
                )}
                {peeked && <span className="siso-subhead__meta">{[peeked.hud?.model, WORD[markOf(peeked)]].filter(Boolean).join(" · ")}</span>}
              </div>
              {/* A worker opens as its chat, never a raw terminal (ab-126): Claude's or Codex's session, read from its file. */}
              <div className="relative min-h-0 flex-1">
                {peeked?.codexWorker && !pinnedChats[peeked.id] ? (
                  <CodexWorkerPage agent={peeked} />
                ) : peeked && (pinnedChats[peeked.id] || peeked.chat) ? (
                  <ChatView key={`${peeked.id}-${pinnedChats[peeked.id] ? pinTargetKey(pinnedChats[peeked.id].target) : ""}`} conversationTarget={pinnedChats[peeked.id]?.target} agentId={peeked.id} agentKey={peeked.key} agentName={peeked.name} active people={people} accent={accentRgb(peeked.project)} />
                ) : peeked ? (
                  <p className="p-6 text-[13px] text-muted-foreground">Its chat shows once it has written its first message. “Open as the chat” switches to it.</p>
                ) : null}
              </div>
            </div>
          )}
          {side.kind === "stats" && <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Stats…</p>}><StatsPage stats={stats} /></Suspense>}
          {side.kind === "surface" && side.s === "page" && (
            // Agent Zero's page: his tasks board.
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <TasksWidget size="L" onTasksPage={() => openAppPage("tasks")} />
              </div>
            </div>
          )}
          {side.kind === "surface" && side.s === "output" && active && (activeConversationTarget ? <p className="p-4 text-muted-foreground">Terminal output is unavailable for a pinned conversation. Read its verified chat instead.</p> : <RecentOutput id={active.id} />)}
        </SidePanel>
      )}
      </Boundary>
      <Boundary name="The Servers or Tokens panel" kind="card" resetKey={panelPage}>
      {/* Servers or Tokens popped out (servers-tokens §4): the same page in its compact density, beside any space. */}
      {!dockOpen && panelPage && !(side && view.kind === "chat" && space === "agents") && !(view.kind === "tab" && chatBeside && space === "agents") && (
        <SidePanel
          onClose={() => setPanelPage(null)}
          storeKey="panel-page-width"
          title={
            <span className="flex min-w-0 items-center gap-3" data-testid="panel-page" data-page={panelPage}>
              <span className="siso-side__chip">
                {panelPage === "servers" ? <ServerIcon aria-hidden="true" /> : <CircleDollarSignIcon aria-hidden="true" />}
                <span className="truncate">{panelPage === "servers" ? "Servers" : "Usage"}</span>
              </span>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-normal text-muted-foreground hover:text-foreground" title="Back to the main pane" data-testid="panel-expand" onClick={() => (openTop(panelPage), setPanelPage(null))}>
                <Maximize2Icon size={12} aria-hidden="true" /> Expand
              </button>
            </span>
          }
        >
          {panelPage === "servers" ? (
            <>
            <ServersPage
              density="panel"
              agents={agents ?? []}
              onOpenAgent={(id) => {
                const a = byId.get(id);
                if (a) open(a);
              }}
              onOpenUrl={(url) => openUrl(url)}
            />
            <RemoteInventory />
            </>
          ) : (
            <Suspense fallback={<p role="status" className="p-4 text-muted-foreground">Loading Usage…</p>}><TokensPage density="panel" /></Suspense>
          )}
        </SidePanel>
      )}
      {/* A Servers or Tokens icon dragged here opens it in the right panel. */}
      {panelDragging && (
        <div
          className="fixed bottom-0 right-0 top-0 z-50 flex w-24 items-center justify-center border-l-2 border-dashed border-[var(--crm-color-brand)] bg-[rgb(0_0_0/0.35)] text-center text-[11.5px] text-foreground"
          data-testid="panel-drop"
          onDragOver={(e) => e.dataTransfer.types.includes(PANEL_DRAG) && (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"))}
          onDrop={(e) => {
            const p = e.dataTransfer.getData(PANEL_DRAG);
            if (p === "servers" || p === "tokens") (e.preventDefault(), setPanelPage(p));
            setPanelDragging(false);
          }}
        >
          Drop to open beside
        </div>
      )}
      </Boundary>
      {/* The update pop-up (ab-149): a new build on disk; Reload keeps the tab and the scroll. */}
      <OwnerLinkToast />
      {/* Agent Zero's spot (16:35): one face at the bottom right that follows the pointer, his live state; a click opens him. */}
      {/* 6 Oct 23:35: not on his own page ("we don't need him when he's on the Agent Zero page"); everywhere else he stays. */}
      {zeroAgent && !zeroHere && (
        <button type="button" className="siso-zero-face" aria-label={`Agent Zero, ${WORD[markOf(zeroAgent)].toLowerCase()}`} data-testid="zero-face" aria-expanded={dockOpen} onClick={() => (zeroAgent.chat ? setDockOpen((v) => !v) : open(zeroAgent))}>
          <ZeroFace agent={zeroAgent} size={60} />
        </button>
      )}
      {/* SPEC-DELIGHT §2: his open needs as dots around his face, and the limit arc. */}
      {zeroAgent && !zeroHere && <ZeroOrbit zero={zeroAgent} needs={zeroNeeds} size={60} research={orbitResearch.data} researchError={orbitResearch.error} onOpenResearch={selection => { setResearchSelection(selection); openAppPage("research"); }} />}
      {/* t-0216: his face docks Agent Zero's chat over this page (a terminal-only A0 still opens as the chat). */}
      {space !== "pinboard" && zeroAgent?.chat && dockOpen && (
        <ZeroDock
          zero={zeroAgent}
          people={people}
          hud={<Hud a={zeroAgent} crew={(agents ?? []).filter((a) => a.lead === zeroAgent.name && a.row === "live")} onOpenCrew={open} variant="rim" model={{ current: modelOf(zeroAgent), status: moves[zeroAgent.name] ?? null, onMove: (to) => void moveTo(zeroAgent.name, to), disabled: "Agent Zero's model is set by his seat" }} />}
          onClose={() => setDockOpen(false)}
          onOpenFull={() => (setDockOpen(false), open(zeroAgent))}
        />
      )}
      <div data-esc-own={workspacePaletteOpen ? '' : undefined}>
        <BankWorkspacePalette agents={agents ?? []} workspaces={workspaces ?? []} connected={!error && agents !== null}
          browserTabs={webTabs.map(t => ({ id: t.id, title: t.title, url: navOf(t.id).url }))} browserPages={suggested}
          onBrowserTab={id => { setSpace("web"); setView({ kind: "tab", id }); }} onGo={(url, title) => void openUrl(url, title)} onTerminal={() => newTab("term")}
          visitedWorkspaceId={navWorkspace}
          visitedId={view.kind === "tab" && webTabs.some(t => t.id === view.id) ? `browser-tab:${view.id}` : view.kind === "tab" && isAppPage(view.id) ? `page:${view.id}` : space !== "agents" ? `page:${space}` : activeId ? `agent:${activeId}` : navWorkspace ? `workspace:${navWorkspace}` : undefined}
          open={workspacePaletteOpen} onOpenChange={setWorkspacePaletteOpen} hideTrigger
          onOpenAgent={a => open(a, { chat: true })}
          onOpenWorkspace={id => { setNavWorkspace(id); setSpace("agents"); setView({ kind: "chat" }); setSidebarOpen(true); }}
          pages={[
            { id: "next-attention", label: "Next agent needing you", description: "Jump to the next agent waiting for your input", icon: "agent-base", shortcut: ["⌥", "⌘", "A"], onSelect: nextNeedsYou },
            { id: "agent-panel", label: "Toggle agent panel", description: "Show or hide the current agent's details", icon: "agent-base", shortcut: ["⇧", "⌘", "B"], onSelect: () => setCardOpen(v => !v) },
            { id: "notifications", label: "Toggle notifications", description: "Show or hide the ping stack", icon: "agent-base", shortcut: ["⌥", "⌘", "N"], onSelect: () => window.dispatchEvent(new CustomEvent("siso-pings-toggle")) },
            { id: "previous-tab", label: "Previous tab", description: "Move left through your open tabs", icon: "web", shortcut: ["⇧", "⌘", "["], onSelect: () => stepTab(-1) },
            { id: "next-tab", label: "Next tab", description: "Move right through your open tabs", icon: "web", shortcut: ["⇧", "⌘", "]"], onSelect: () => stepTab(1) },
            { id: "agents", label: "Agent workspaces", description: "Choose an owner or worker", icon: "agent-base", onSelect: () => setWorkspaceChooserOpen(true) },
            { id: "tasks", label: "Tasks", description: "Tasks grouped by workspace", icon: "agent-base", onSelect: () => openAppPage("tasks") },
            { id: "library", label: "Library", description: "Every doc, project, page and Foundry record, searchable", icon: "library", onSelect: () => { setEstatePane("library"); setSpace("estate"); setView({ kind: "chat" }); } },
            { id: "register", label: "Library register", description: "Everything built, every live page, the Works", icon: "library", onSelect: () => { setSpace("library"); setView({ kind: "chat" }); } },
            { id: "estate", label: "Estate world", description: "The 3D world of every repo, agent and machine", icon: "estate", onSelect: () => { setEstatePane("world"); setSpace("estate"); setView({ kind: "chat" }); } },
            { id: "voice", label: "Voice", description: "Talk anywhere: the bar, your history and stats", icon: "siso-voice", onSelect: () => setSpace("voice") },
          ]} />
      </div>
      <BankWorkspaceChooser open={workspaceChooserOpen} onOpenChange={setWorkspaceChooserOpen}
        agents={agents ?? []} activeId={activeId} connected={!error && agents !== null} org={org} observedAt={asOf}
        onOpenAgent={a => open(a, { chat: true })} />
    </AppFrame>
  );
}
