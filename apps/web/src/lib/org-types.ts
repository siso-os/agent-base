// The org tree behind the side nav and the dashboards (ab-112). Served by GET /api/org; built by services/node/src/org.ts
// (buildOrg). Spec: siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/projects-owners/SIDENAV-GROUPS.md.

export type GroupId = "agency" | "labs" | "family";

export type PlanState = "asked" | "specced" | "allocated" | "building" | "built" | "checked" | "parked" | "dropped";

export type PlanItem = {
  id: string;
  title: string;
  his?: string;
  status: PlanState;
  to?: { agent: string; harness?: string; machine?: string } | null;
  evidence?: string[];
  parent?: string | null;
  tasks?: string[];
  at?: string;
};

export type TaskState = "open" | "claimed" | "building" | "review" | "done" | "failed";

export type Task = { id: string; item: string; title: string; state: TaskState; holder?: string; machine?: string; branch?: string };

export type OrgOwner = {
  name: string;
  domain?: string;
  icon: import("./icon-names.ts").IconName;
  state: "live" | "planned" | "offline";
  working: number;
  plan: { checked: number; total: number; asked: number; items: PlanItem[] } | null;
  tasks?: Task[];
  lastReport?: { at: string; text: string };
  spend?: { claude_usd_equiv: number; codex_credits: [number, number]; finished: number };
};

export type OrgProject = {
  id: string;
  name: string;
  group: GroupId;
  path?: string;
  icon?: import("./icon-names.ts").IconName;
  colour?: string;
  shown: boolean;
  order: number;
  line?: string;
  status?: string;
  owners: OrgOwner[];
  /** No owner of its own: the agent in another slot it is run from (SISO → Agent Zero, Estate → ESTATE). */
  elsewhere?: string;
  /** Placed but not being worked on: a dashed seat that says "dormant". */
  dormant?: boolean;
};

/** A row inside an Agency folder, from CLIENTS.json (projects-nav A). `id` is its folder under SISO_Workspace. */
export type OrgItem = {
  id: string;
  name: string;
  kind: string;
  stage?: "active" | "friends" | "leads" | "unsure" | "past";
  line: string;
  note: string;
  people: string[];
  parent?: string;
  project?: string;
  pinned: boolean;
  folder?: string;
  template?: string;
  clients?: string[];
};

export type OrgFolder = { id: "clients" | "agencies" | "industries"; name: string; items: OrgItem[] };

export type OrgGroup = {
  id: GroupId;
  name: string;
  icon: import("./icon-names.ts").IconName;
  order: number;
  projects: OrgProject[];
  /** The agency's Clients, Agencies and Industries; empty for Labs and Family. */
  folders: OrgFolder[];
};

export type OrgRow = { name: string; icon?: import("./icon-names.ts").IconName; state: "live" | "planned" | "offline"; working: number };

export type Org = { top: OrgRow[]; bottom: OrgRow[]; groups: OrgGroup[] };

/** An industry's or client's page (project-pages spec v2), from GET /api/org/project/:id `page`; built by
 * services/node/src/pages.ts. Every value carries `src`; what nothing records is in `missing`. */
export type Tone = "good" | "working" | "needs" | "neutral";
type Src<T> = T & { src: string };
export type EntityPageData = {
  kind: "client" | "industry" | "project";
  id: string;
  name: string;
  kicker: string[];
  line: Src<{ text: string }> | null;
  since: Src<{ date: string }> | null;
  tags: { label: string; tone: Tone }[];
  owner: { mode: "running" | "record" | "domain"; name: string | null; state: "working" | "idle" | "planned" | "none"; sentence: string; why: Src<{ text: string }>; crew: { name: string; state: string }[]; planned: string | null };
  stats: Src<{ label: string; period: string; value: string | null; unit?: string; delta?: { text: string; tone: Tone }; line: string }>[];
  activity: Src<{ days: { date: string; n: number }[] }>;
  live: Src<{ url: string; code: number | null; at: number }>[];
  thumbs: { folder: string; file: string; phone: boolean }[];
  work: Src<{ open: number; total: number; byState: Record<string, number>; items: { id: string; title: string; state: string }[] }>;
  clients: { id: string; name: string; stage?: string; line: string; thumb: string | null }[];
  built: { title: string; line: string; chip: string; tone: Tone }[];
  people: { name: string; note: string; contact: boolean }[];
  happened: Src<{ date: string; text: string }>[];
  assets: { name: string; files: number }[];
  notes: Src<{ text: string }>[];
  missing: { field: string; how: string }[];
};
