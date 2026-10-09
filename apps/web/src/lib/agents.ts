import { useCallback, useEffect, useRef, useState } from "react";
import { every, unchanged, useShared } from "./poll";
import { changedReader } from "./fetch-changed";
import type { IconName } from "./icon-names";
import type { PinTarget, PinView as ServerPinView } from "../../../../services/node/src/agent-pins";
import { pinViewsFromSnapshot } from "./pin-view";
export type { AgentPin, PinTarget } from "../../../../services/node/src/agent-pins";
/** Client-only denial marker: a fabricated recovery ID cannot authorize a registry mutation. */
export type PinView = Omit<ServerPinView, "unresolvedSource"> & { refEditable?: boolean };

/** One agent as the laptop node reports it (services/node/src/server.ts, listAgents). */
export type Agent = { workspace?: string | null; navOwner?: boolean; navParentId?: string | null;
  /** t-0562, from the agent records: running helpers drawn as +N on this face, and an owner whose host stopped. */
  navHelpers?: number; navOffline?: boolean;
  /** Its parent was found (a spawner, a run record, its registry owner); false means Agent Zero by default only. */
  ownershipResolved?: boolean;
  /** herdr's terminal id: what the app sends back. It changes on every herdr restart. */
  codexWorker?: boolean;
  infrastructureRole?: string | null;
  infrastructureSummary?: { line: string; ledger: string } | null;
  workerSummary?: { tickets: string[]; model: string; elapsed: number; state: string; message: string };
  main?: boolean;
  parentId?: string | null;
  /** A chat Agent Zero started for itself (research, sub-agents): shown under Agent Zero, not in the nav list. */
  zeroAgent?: boolean;
  workspaceId?: string;
  branch?: string | null;
  id: string;
  /** Machine + name ("laptop/STREAMING-CLAUDE"): what the node keeps his row state by, so it survives restarts. */
  key: string;
  pane: string;
  name: string;
  /** What the agent's terminal title says it is doing; "" when the title is just its name. */
  title: string;
  status: "working" | "needs" | "done" | "idle" | "failed";
  /** When the node first saw it in this status: the timer in "Working 17m". */
  since: number;
  row: "live" | "settled" | "snoozed";
  /** t-0562: a helper whose host stopped; settled by the node, not by him. */
  finished?: boolean;
  snoozedUntil: number | null;
  settledAt: number | null;
  seenAt: number | null;
  /** His dragged position in the sidebar; null for an agent he has not placed. */
  order: number | null;
  tool: string;
  compactAt?: number;
  cwd: string;
  /** The folder it works in (its basename). */
  folder: string;
  machine: string;
  /** Its machine's estate key ("laptop", "mini", "halo-vps"); `away` when that is not this node's (R1.4). */
  machineKey?: string;
  away?: boolean;
  session: string | null;
  /** When its session file last changed (ms), or null: what "quiet" is measured from. */
  lastEvent?: number | null;
  chatStartedAt?: number | null;
  context: number | null;
  /** The agent's own Claude HUD (siso-hud.mjs, per session); null when herdr reports no session or no HUD file yet. */
  hud: {
    accountId?: string | null;
    context: number | null;
    model: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    tokensPerSecond?: number | null;
    cachePct: number | null;
    costUsd: number | null;
    fiveHour: { pct: number; resetsAt: number | null } | null;
    week: { pct: number; resetsAt: number | null } | null;
    at: number | null;
    /** An SDK seat's effort, from its host file. */
    effort?: string | null;
    models?: { id: string; label: string; description: string; efforts: string[] }[];
    limitsAt?: number | null;
    limitsStale?: boolean;
  } | null;
  zero: boolean;
  /** t-0264: one of his Agent Zeros (the default one is `zero`; the others are listed under it, not as rows). */
  a0?: boolean;
  /** t-0264: the name the Agent Zero switcher shows (his label for the default one, else its name). */
  label?: string;
  /** Run by siso-host (Claude through the SDK): the app draws its chat and owns its input box. */
  host?: boolean;
  serviceHost?: { name: string; state: 'live' | 'asleep' | 'restarting' | 'down'; session?: string | null; asleepAt?: number | null; rssAtSleep?: number | null; keepAwake?: boolean; idleSince?: number | null; idleSleepMin?: number | null };
  /** The app can show its chat: siso-host's live one, or a terminal Claude agent's read from its session file. */
  chat?: boolean;
  /** Projects and owners (projects-owners/SPEC.md): its project, whether it owns a domain or works for an owner. */
  project?: string | null;
  owner?: string | null;
  kind?: "owner" | "worker" | null;
  /** Its mark beside its name in other agents' chats (the agent table; Agent Zero picks). */
  icon?: IconName | null;
  /** From the agent table (POST /api/registry): its domain, the lead it works for, its role. Null until registered. */
  domain: string | null;
  lead: string | null;
  role: string | null;
  pinned: boolean;
  /** Authoritative, durable identity supplied by the node. Never infer a pin from its display name. */
  pinTarget?: PinTarget;
  pinIds?: string[];
  /** Its own pages: saved to it, then what it posted to the console (newest first). */
  pages: Page[];
};

export type Page = { url: string; title: string; at?: number; from?: "saved" | "console"; count?: number };

/** One change to the agent table; see services/node/src/server.ts `edit`. */
export type RegistryEdit =
  | { op: "pin-target"; name: string; target: PinTarget; agentId?: string }
  | { op: "bind-pin"; pinId: string; target: PinTarget; expectedTarget: PinTarget | null; agentId?: string }
  | { op: "unpin-ref"; pinId: string }
  | { op: "pin-ref-order"; ids: string[] }
  | { op: "move"; name: string; project: string }
  | { op: "rename"; name: string; to: string }
  | { op: "describe"; name: string; role?: string; domain?: string }
  | { op: "save-page" | "forget-page" | "hide-page"; name: string; url: string; title?: string }
  | { op: "pin-page" | "unpin-page" | "visit"; url: string; title?: string };

export type RowAction = "settle" | "unsettle" | "snooze" | "unsnooze" | "seen";

/** The agent list: every 5 s while the window is visible (lib/poll.ts; it was 1.5 s, P0 performance 2 Oct). */
const POLL_MS = 5000;

/** Same origin as the node; metadata only, never chat text or host credentials. */
const AGENTS_KEY = "agent-base:agents-last";
type AgentSnapshot = { agents: Agent[]; domains: string[]; pinned: string[]; pins?: PinView[]; pinnedPages: Page[]; recentPages: Page[]; workspaces?: import("./workspace-nav").NavWorkspace[]; at: number };
function lastGoodAgents(): AgentSnapshot | null {
  try {
    const d = JSON.parse(localStorage.getItem(AGENTS_KEY) ?? "null") as AgentSnapshot | null;
    const valid = d && Number.isFinite(d.at) && d.at <= Date.now() && Date.now() - d.at < 24 * 3600_000 &&
      Array.isArray(d.agents) && d.agents.length <= 1000 && d.agents.every(a => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.key === "string" && Array.isArray(a.pages)) &&
      Array.isArray(d.domains) && Array.isArray(d.pinned) && Array.isArray(d.pinnedPages) && Array.isArray(d.recentPages);
    if (!valid || !d) return null;
    // Cached data is untrusted and never a ready projection. Retain damaged entries as blocked placeholders.
    const pins: PinView[] = pinViewsFromSnapshot(d.pins, d.pinned, [], true).map(({ id, name, target, refEditable }) => ({ id, name, target, ...(refEditable === false ? { refEditable: false } : {}), state: target ? "unavailable" : "unresolved", detail: "Checking the saved target…" }));
    return { ...d, pins };
  } catch { return null; }
}

/**
 * Every agent, refreshed every 1.5 s. herdr is the source of truth; this only reads. A failed poll keeps the last
 * list and says so (`error`), rather than blanking the sidebar.
 */
export function useAgents() {
  const [remembered] = useState(lastGoodAgents);
  // A cached display name (including an older name-only cache) cannot authorize opening or editing a pin.
  const [agents, setAgents] = useState<Agent[] | null>(remembered?.agents.map(a => ({ ...a, pinned: false, pinIds: [], pinTarget: undefined })) ?? null);
  // The remembered list paints at once and says nothing: a reload or a deploy's node restart is not an outage (Shaan, 5 Oct:
  // "reconnecting to herdr ... error showing at the bottom" while herdr answered in 15 ms). Only a read failing 15 s says so.
  const [error, setError] = useState<string | null>(null);
  const failingSince = useRef<number | null>(null);
  /**
   * QA #12 (A0, 3 Oct): who is not answering (no answer at all is the node; the node saying herdr failed is herdr) and
   * when the list was last read, so the nav names the right one and marks its states as of then.
   */
  const [down, setDown] = useState<"node" | "herdr" | null>(null);
  const [asOf, setAsOf] = useState<number | null>(remembered?.at ?? null);
  const [workspaces, setWorkspaces] = useState<import("./workspace-nav").NavWorkspace[]>(remembered?.workspaces ?? []);
  const [domains, setDomains] = useState<string[]>(remembered?.domains ?? []);
  const [pinnedPages, setPinnedPages] = useState<Page[]>(remembered?.pinnedPages ?? []);
  /** registry.pinned: the agents he (or Agent Zero) pinned under Agent Zero, in order (R1.2). */
  const [pinned, setPinned] = useState<string[]>(remembered?.pinned ?? []);
  const [pins, setPins] = useState<PinView[]>(() => (remembered?.pins ?? []).map(pin => ({ ...pin, state: pin.target ? "unavailable" : "unresolved", agentId: undefined, detail: "Checking the saved target…" })));
  const [editError, setEditError] = useState<string | null>(null);
  const [recentPages, setRecentPages] = useState<Page[]>(remembered?.recentPages ?? []);
  const snapshot = useRef(remembered);
  const tick = useRef(0);
  const misses = useRef(0);
  const last = useRef("");

  const load = useCallback(async () => {
    const mine = ++tick.current;
    let who: "node" | "herdr" = "node";
    try {
      const r = await fetch("/api/agents", { cache: "no-store" });
      const text = await r.text();
      if (mine !== tick.current) return;
      // The same answer as last time (bar its own clock, `at`): nothing to parse or redraw (t-0237).
      if (r.ok && unchanged(last, text.replace(/,"at":\d+\}$/, "}"))) {
        misses.current = 0;
        setAsOf(Date.now());
        setDown(null);
        if (snapshot.current && Date.now() - snapshot.current.at > 60_000) {
          snapshot.current = { ...snapshot.current, at: Date.now() };
          try { localStorage.setItem(AGENTS_KEY, JSON.stringify(snapshot.current)); } catch { /* This window only. */ }
        }
        failingSince.current = null;
        return setError(null);
      }
      const d = JSON.parse(text);
      who = "herdr";
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      const receivedPins = pinViewsFromSnapshot(d.pins, d.pinned, snapshot.current?.pins ?? []);
      setAsOf(Date.now());
      setDown(null);
      setAgents(d.agents);
      setWorkspaces(d.workspaces ?? []);
      setDomains(d.domains ?? []);
      setPinnedPages(d.pinnedPages ?? []);
      setPinned(d.pinned ?? []);
      setPins(receivedPins);
      setRecentPages(d.recentPages ?? []);
      snapshot.current = { agents: d.agents, domains: d.domains ?? [], pinned: d.pinned ?? [], pins: receivedPins, pinnedPages: d.pinnedPages ?? [], recentPages: d.recentPages ?? [], workspaces: d.workspaces ?? [], at: Date.now() };
      try { localStorage.setItem(AGENTS_KEY, JSON.stringify(snapshot.current)); } catch { /* Storage unavailable: retain this window's list. */ }
      setError(null);
      failingSince.current = null;
      misses.current = 0;
    } catch (e) {
      // One slow or failed read is normal (herdr busy, the node restarting); say so only when it keeps failing.
      if (mine === tick.current) {
        // Keep saved slots visible, but a failed identity read cannot authorize a ready pin.
        setPins(current => current.map(pin => pin.state === "ready" ? { ...pin, state: "unavailable", agentId: undefined, detail: "Agent list unavailable; retrying" } : pin));
        setAgents(current => current?.map(agent => ({ ...agent, pinTarget: undefined })) ?? null);
        // Even an identical successful response must restore the disabled pin projections.
        last.current = "";
        failingSince.current ??= Date.now();
        if (++misses.current >= 3 && Date.now() - failingSince.current >= 15_000) (setError((e as Error).message), setDown(who));
      }
    }
  }, []);

  useEffect(() => every(() => void load(), POLL_MS), [load]);

  const act = useCallback(
    async (id: string, action: RowAction, until?: number) => {
      const q = until ? `?until=${until}` : "";
      await fetch(`/api/agents/${encodeURIComponent(id)}/${action}${q}`, { method: "POST" });
      void load();
    },
    [load],
  );

  /** Save his order of the rows (dragged in the sidebar). The list re-sorts at once; the node keeps it. */
  const reorder = useCallback(
    async (ids: string[]) => {
      setAgents((list) => list && list.map((a) => ({ ...a, order: ids.includes(a.id) ? ids.indexOf(a.id) : a.order })));
      await fetch("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
      // The list was changed here first: the node's answer is drawn even if it matches the last one.
      last.current = "";
      void load();
    },
    [load],
  );

  /** His order of the project folders (dragged), kept by the node in rows.json. */
  const reorderProjects = useCallback(
    async (projects: string[]) => {
      setDomains(projects);
      await fetch("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projects }) });
      // The list was changed here first: the node's answer is drawn even if it matches the last one.
      last.current = "";
      void load();
    },
    [load],
  );

  const edit = useCallback(
    async (e: RegistryEdit) => {
      try {
        const r = await fetch("/api/registry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e) });
        const d = await r.json().catch(() => null);
        if (!r.ok || d?.error) throw new Error(d?.error || `Could not save the change (HTTP ${r.status})`);
        setEditError(null);
        await load();
        return null;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not save the change. Try again.";
        setEditError(message);
        // A stale choice may now be missing or ambiguous. Keep the pin and refresh the chooser.
        void load();
        return message;
      }
    },
    [load],
  );

  return { agents, error, down, asOf, act, reorder, reorderProjects, edit, editError, clearEditError: () => setEditError(null), domains, pinned, pins, pinnedPages, recentPages, workspaces };
}

/** The first `n` words, cut at a word ("Rewrite the side nav from first principles" -> "Rewrite the side nav"). */
export const firstWords = (s: string, n = 4) => s.replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");
/**
 * R1.2: what an agent is doing now, in at most 4 words: the plan item it holds (building), else its herdr title, else
 * its state ("idle", "turn done").
 */
export function doingNow(a: Agent, plan?: { items: { title?: string; status?: string }[] } | null): string {
  const held = plan?.items.find((i) => i.status === "building" && i.title);
  if (held) return firstWords(held.title!);
  if (a.title) return firstWords(a.title);
  return a.status === "working" ? "working" : a.status === "needs" ? "needs you" : a.status === "failed" ? "failed" : a.status === "done" ? "turn done" : "idle";
}

/** Done stays green until Shaan opens the agent after it finished. */
/**
 * The side nav's one state per agent (sidenav spec D1/D3/D4). Derived on read, no timer, no store: done fades to idle
 * after 10 min, and "working" with no event for 10 min reads "quiet" rather than an endless spinner. `needs` holds the
 * names (canonical) an open needs-Shaan task names.
 */
export type NavState = "working" | "needs" | "done" | "idle" | "quiet" | "failed" | "offline";
export const QUIET_MS = 10 * 60_000;
export const DONE_FADE_MS = 10 * 60_000;
const canon = (name: string) => (name.split("| ").pop() ?? name).trim().replace(/^(luna|sol)-/i, "").toUpperCase();
export function navState(a: Pick<Agent, "name" | "status" | "since" | "lastEvent">, needs?: Set<string>, now = Date.now()): NavState {
  if (a.status === "needs" || needs?.has(canon(a.name))) return "needs";
  if (a.status === "failed") return "failed";
  if (a.status === "working") return a.lastEvent && now - a.lastEvent > QUIET_MS ? "quiet" : "working";
  if (a.status === "done" && now - a.since < DONE_FADE_MS) return "done";
  return "idle";
}
/** What the status slot says: one thing ("now", "2m", "needs you", "quiet 14m", "failed", "off"). */
export function slotText(state: NavState, a: Pick<Agent, "since" | "lastEvent">, now = Date.now()): string {
  const age = (t: number) => {
    const s = Math.floor((now - t) / 1000);
    return s < 45 ? "now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  };
  if (state === "needs") return "needs you";
  if (state === "failed") return "failed";
  if (state === "offline") return "off";
  if (state === "quiet") return `quiet ${Math.max(10, Math.round((now - (a.lastEvent ?? a.since)) / 60_000))}m`;
  if (state === "working") return age(Math.max(a.lastEvent ?? 0, a.since));
  return age(a.since);
}

export const isUnseenDone = (a: Agent) => a.status === "done" && (a.seenAt ?? 0) < a.since;

/** His own order, as in herdr: placed agents by position, then the ones he never placed in a fixed order (by id), so rows never jump when a status changes. */
export const byHisOrder = (a: Agent, b: Agent) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id);

/** Who needs you first: needs you, failed, unseen done, working, then the rest; latest change first within each. */
const RANK = (a: Agent) =>
  a.status === "needs" ? 0 : a.status === "failed" ? 1 : isUnseenDone(a) ? 2 : a.status === "working" ? 3 : 4;
export const byWhoNeedsYou = (a: Agent, b: Agent) => RANK(a) - RANK(b) || b.since - a.since;

export function formatWake(until: number): string {
  const d = new Date(until);
  const today = new Date();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === today.toDateString() ? `wakes ${hm}` : `wakes ${d.toLocaleDateString([], { weekday: "short" })} ${hm}`;
}

/** The two snooze presets: an hour, and tomorrow at 09:00. */
export function snoozePresets(now = new Date()): { label: string; until: number }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { label: "For an hour", until: now.getTime() + 3600_000 },
    { label: "Until tomorrow 09:00", until: tomorrow.getTime() },
  ];
}

/** A lead and the crew that works for it (crew only when the lead is live too; otherwise they stand on their own). */
export type Team = { lead: Agent; crew: Agent[] };
export type Layout = { zero: Agent | null; zeros: Agent[]; pinned: Team[]; sections: { domain: string; teams: Team[] }[]; snoozed: Agent[]; settled: Agent[] };

/**
 * The side nav by projects and owners (projects-owners/SPEC.md; Shaan, 2 Oct 14:35: "agent zero above the pinned … the
 * project folders"): Agent Zero on top, his pinned agents, then a folder per project holding its owners, then
 * "Unsorted" for agents nobody has placed. Workers are not rows: each owner carries them (its team's crew), shown as
 * a count that opens them. Every list keeps his dragged order. (`domain` on a section is the project's name.)
 */
export function layout(list: Agent[], projects: string[]): Layout {
  const live = list.filter((a) => a.row === "live").sort(byHisOrder);
  const zero = list.find((a) => a.row === "live" && a.zero) ?? null;
  // t-0264: every Agent Zero sits under the one entry (the default first); none of them is a row of its own.
  const zeros = zero ? [zero, ...live.filter((a) => (a.zero || a.a0) && a !== zero)] : [];
  const rest = live.filter((a) => a !== zero && !(zero && (a.zero || a.a0)));
  const byName = new Map(rest.map((a) => [a.name, a]));
  const crewOf = new Map<string, Agent[]>();
  const top: Agent[] = [];
  for (const a of rest) {
    const owner = a.owner ?? a.lead;
    if (owner && owner !== a.name && byName.has(owner)) crewOf.set(owner, [...(crewOf.get(owner) ?? []), a]);
    else top.push(a);
  }
  const team = (a: Agent): Team => ({ lead: a, crew: crewOf.get(a.name) ?? [] });
  const order = [...projects, ...new Set(top.map((a) => a.project).filter((p): p is string => !!p && !projects.includes(p)))];
  const sections = [...order, "Unsorted"]
    // Every owner sits in its project's folder, a pinned one too (2 Oct: "every owner in a project folder").
    .map((project) => ({ domain: project, teams: top.filter((a) => (a.project ?? "Unsorted") === project).map(team) }))
    .filter((s) => s.teams.length > 0);
  return {
    zero,
    zeros,
    pinned: top.filter((a) => a.pinned).map(team),
    sections,
    snoozed: list.filter((a) => a.row === "snoozed").sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0)),
    // A finished helper (its host stopped; the node marks it) is not one he set aside: the shelf stays his.
    settled: list.filter((a) => a.row === "settled" && !a.finished).sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0)),
  };
}
export function sidebarOrder(list: Agent[], domains: string[]): Agent[] {
  const l = layout(list, domains);
  // Numeric shortcuts follow the rows rendered after Agent Zero. Pinned teams are already present in their project
  // section; prepending l.pinned would duplicate them and move a later-project pin ahead of earlier sections.
  const teams = l.sections.flatMap((s) => s.teams);
  const seen = new Set<string>();
  return [...(l.zero ? [l.zero] : []), ...teams.flatMap((t) => [t.lead, ...t.crew]).filter((a) => !seen.has(a.id) && seen.add(a.id))];
}

/** A chat's totals from its own Claude session file (GET /api/agents/:id/stats). */
export type Stats = {
  error?: string;
  first: string | null;
  last: string | null;
  prompts: number;
  apiCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cachePct: number | null };
  toolCalls: number;
  tools: Record<string, number>;
  skills: Record<string, number>;
  subagents: { count: number; recent: { at: string | null; type: string; what: string }[] };
  models: Record<string, number>;
  hours: { hour: string; output: number }[];
  costUsd: number | null;
};

/** One agent's stats, fetched when wanted and refreshed every 10 s while shown. */
export function useStats(id: string | null, on: boolean) {
  // The HUD and the agent's page show the same stats: one shared read (lib/poll.ts).
  return useShared<Stats>(id && on ? `/api/agents/${encodeURIComponent(id)}/stats` : null, 10_000);
}

/** Every machine on the estate map; `here` is the one this node's herdr runs on. */
export type Machine = { key: string; name: string; role: string; status: string; here: boolean };
export function useMachines(on: boolean) {
  const [list, setList] = useState<Machine[]>([]);
  useEffect(() => {
    if (!on) return;
    fetch("/api/machines").then((r) => r.json()).then((d) => setList(d.machines ?? [])).catch(() => {});
  }, [on]);
  return list;
}

/** 1234 -> "1.2k", 211962200 -> "212M". */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(n);
}

// ---------------------------------------------------------------- the org (three groups → projects → owners)

/** GET /api/org (services/node/src/org-stub.ts; Luna L3's shape). */
export type OrgOwner = { main?: boolean; name: string; domain: string | null; icon: IconName; state: "live" | "planned" | "offline"; working: number; plan: { checked: number; total: number; asked: number; items: { id: string; title: string; his?: string; status: string; evidence?: string[]; at?: string }[] } | null; lastReport?: { at: string; text: string } };
export type OrgProject = { id: string; name: string; group: "agency" | "labs" | "family"; icon?: IconName; shown: boolean; pinned?: boolean; order: number; line?: string; status?: string; path?: string; owners: OrgOwner[]; elsewhere?: string; dormant?: boolean };
/** Where a client sits inside Clients (projects-nav A): Active · Friends · Leads · Not sure · Past. */
export type OrgStage = "active" | "friends" | "leads" | "unsure" | "past";
/** A row inside an Agency folder (a client, an agency, an industry) from CLIENTS.json; `id` is its estate folder. */
export type OrgItem = { id: string; name: string; kind: string; stage?: OrgStage; line: string; note: string; people: string[]; parent?: string; project?: string; pinned: boolean; folder?: string; template?: string; clients?: string[] };
export type OrgFolder = { id: "clients" | "agencies" | "industries"; name: string; items: OrgItem[] };
export type OrgGroup = { id: "agency" | "labs" | "family"; name: string; icon: IconName; order: number; projects: OrgProject[]; folders: OrgFolder[] };
/** `bottom` is Agent Infrastructure (ab-148): HEALTH, EFFICIENCY, ESTATE with their live status. */
export type Org = { top: OrgOwner[]; bottom: (OrgOwner & { status?: string | null; ledger?: string | null })[]; groups: OrgGroup[] };
export const STAGES: { id: OrgStage; name: string }[] = [
  { id: "active", name: "Active" },
  { id: "friends", name: "Friends" },
  { id: "leads", name: "Leads" },
  { id: "unsure", name: "Not sure" },
  { id: "past", name: "Past" },
];
/** A folder's own count: Agencies counts agencies, not the partner-clients under them. */
export const folderCount = (f: OrgFolder) => f.items.filter((i) => !i.parent).length;
/**
 * What a folded group or folder says on its right (spec: "folding never hides attention"): "N working" when anything
 * inside is working, "needs" when an owner inside needs him (an amber dot), else nothing.
 */
export function foldedSummary(names: string[], agents: Agent[], needs?: Set<string>): { working: number; needs: boolean } {
  const inside = new Set(names);
  const mine = agents.filter((a) => a.row === "live" && (inside.has(a.name) || (!!a.lead && inside.has(a.lead))));
  return { working: mine.filter((a) => a.status === "working").length, needs: mine.some((a) => navState(a, needs) === "needs") };
}
export type OrgOp = { op: "pin-project" | "unpin-project" | "show" | "hide" | "rename" | "remove" | "move"; id: string; to?: string } | { op: "order"; id: string; to: string[] };

const ORG_KEY = "agent-base:org-last";
const lastGoodOrg = (): Org | null => {
  try {
    const o = JSON.parse(localStorage.getItem(ORG_KEY) ?? "null") as Org | null;
    return o && Array.isArray(o.groups) ? o : null;
  } catch {
    return null;
  }
};
/**
 * The org tree, refreshed every few seconds and after each of his changes. A failed read keeps the last good tree (this
 * window's, or the one saved before a reload) and says so in `orgDown` (QA #16, A0, 3 Oct: a failing /api/org swapped
 * the nav to the old "Projects" layout and Clients, Agencies, Industries and Family vanished).
 */
export function useOrg() {
  const [org, setOrg] = useState<Org | null>(lastGoodOrg);
  const [orgDown, setOrgDown] = useState(false);
  const last = useRef("");
  const read = useRef(changedReader()).current;
  const load = useCallback(async () => {
    try {
      const r = await read("/api/org");
      if (r === null) return setOrgDown(false);
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const next = JSON.parse(text) as Org;
      if (!Array.isArray(next?.groups)) throw new Error("no groups");
      setOrgDown(false);
      if (unchanged(last, text)) return;
      setOrg(next);
      try {
        localStorage.setItem(ORG_KEY, text);
      } catch {
        /* this window only */
      }
    } catch {
      read.reset();
      setOrgDown(true);
    }
  }, []);
  useEffect(() => every(() => void load(), 5000), [load]);
  const orgOp = useCallback(
    async (op: OrgOp) => {
      await fetch("/api/org", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) });
      void load();
    },
    [load],
  );
  return { org, orgOp, orgDown };
}

export type WorkspaceChoice = { repo: string; workspace: { type: 'isolated' } | { type: 'shared'; reason: string } };
export type WorkspaceStatus = import('../../../../services/host/src/worktree-contract').WorkspaceSnapshot;
export async function requestWorkspace(url: string, body?: unknown): Promise<WorkspaceStatus> {
  const r=await fetch(url,{...(body!==undefined?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store'});
  const d=await r.json();if(!r.ok)throw new Error(d.error??`HTTP ${r.status}`);return d;
}
/** Retain this key until a new draft starts; a lost response never creates a second launch. */
export function draftLaunchId(key: string) {
  const saved=sessionStorage.getItem(`ab-launch:${key}`);if(saved)return saved;
  const id=crypto.randomUUID();sessionStorage.setItem(`ab-launch:${key}`,id);return id;
}

export function completeLaunchDraft(key:string) {sessionStorage.removeItem(`ab-launch:${key}`);}
