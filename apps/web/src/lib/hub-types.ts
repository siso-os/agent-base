// The hub's data (HUB-DESIGN, 2 Oct). hub-1 copies this file to apps/web/src/lib/hub-types.ts and serves it from
// services/node/src/hub.ts; hub-3..hub-7 code against it (and a fixture shaped from hub-design/data.json) from the start.
// Extends org-types.ts; nothing here replaces a field there. Icons are lucide names, never emojis.
import type { PlanItem, PlanState, GroupId } from "./org-types.ts";

export type AgentState = "working" | "done" | "idle" | "off"; // herdr working / done (turn finished) / idle / not running

/** Everything the hover card, the org chart node and the owner card show about one agent. GET /api/hub/agents */
export type HubAgent = {
  name: string; // canonical: the registry name with model prefix and "Title | " stripped (see canon() in SPEC §Data)
  kind: "owner" | "worker" | "zero";
  project: string;
  domain?: string;
  owner?: string; // who it reports to (workers); owners report to Agent Zero
  role?: string;
  icon: string; // lucide name, e.g. "radio-tower"
  accent: string; // project accent, hex
  harness: "claude" | "codex" | "siso" | "herdr";
  model: string; // "Opus 5.5", "GPT Luna", "GPT Sol"
  machine: string; // "laptop", "mac-mini", "halo-vps"
  state: AgentState;
  holding?: { id: string; title: string; status: PlanState } | null; // plan item with to.agent == name, building first
  lastReport?: { at: string; ageMin: number; text: string; log: string } | null; // newest line it wrote in any inbox
  plan?: { checked: number; total: number; counts: Record<PlanState, number> } | null; // owners only
  workers?: { total: number; working: number }; // owners only, counted once per canonical name
  spunUp: boolean; // false = in the org, no session yet (greyed)
};

/** One health cell on a project dashboard: shown with its time, never hidden when stale. */
export type HealthCell = { icon: string; name: string; value: string; level: "ok" | "warn" | "bad" | "unknown"; source: string; at: string };

/** GET /api/hub/project/:id (HALO first). */
export type HubProject = {
  id: string;
  name: string;
  group: GroupId;
  line: string;
  accent: string;
  icon: string;
  owners: HubAgent[]; // with plan + workers
  counts: Record<PlanState, number>; // summed over the owners' plans
  open: (PlanItem & { owner: string })[]; // every open item, furthest along first
  needsYou: { id: string; title: string; owner?: string; link?: string; minutes?: number }[]; // A0 tasks.json needs-shaan for this project
  timeline: { at: string; kind: "board" | "report" | "checked"; who: string; text: string }[]; // newest first
  health: HealthCell[];
  /** Agent Base's research team (4 Oct): the idea farm (his ideas first, then the miners' ranked) and the research base. */
  ideas?: { id: string; text: string; by: string; score: number | null; status: string; size?: string | null; why?: string | null; evidence?: string | null; his?: string | null }[];
  library?: { title: string; path: string; count: number; unit: string; by: string; at: string }[];

  spendToday: null | { claudeUsdEquiv: number; codexCredits: number }; // null until STACK-OPT's meter lands
};

/** GET /api/hub/a0: Agent Zero's memory, made visible. All read-only from siso-agent-zero/.agents/a0/. */
export type HubA0 = {
  current: { session: string; model: string; effort: string; state: AgentState };
  sessions: { id: string; started: string }[];
  goals: { day: string; title: string; quote?: string }[]; // GOALS.md, newest first
  timeline: { at: string; kind: "checkpoint" | "done" | "board"; text: string; points?: string[] }[]; // HANDOFF.md + log.jsonl
  needsYou: { id: string; title: string; link?: string }[];
  tasks: { counts: Record<string, number>; running: { id: string; title: string }[] };
  memory: { title: string; file: string; hook: string }[];
  gaps: string[]; // computed: thin memory, unowned plan items, tasks.json vs A0.json disagreeing
};

/** GET /api/hub/org: Agent Zero -> group -> project -> domain -> owner. */
export type HubOrg = {
  zero: HubAgent;
  top: string[]; // the chain-of-command buttons, in order
  groups: {
    id: GroupId;
    name: string;
    icon: string;
    projects: { name: string; icon: string; accent: string; domains: { name: string; owner: HubAgent | null }[] }[];
  }[];
};

/** One Agent Zero tab and the owners and sub-agents it controls. GET /api/hub/zeros. */
export type HubZero = {
  id: string;
  label: string;
  harness: "claude" | "codex" | "siso" | "herdr";
  model: string;
  cwd: string;
  state: AgentState;
  controls: { owner: HubAgent; activity?: string; subAgents: { name: string; harness: string; state: AgentState; title: string }[] }[];
};
