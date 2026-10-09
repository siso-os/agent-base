import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { MAIN_NAMES } from "./agent-nav.ts";

export type Group = { id: "agency" | "labs" | "family"; name: string; icon: string; order: number };
export type Project = {
  id: string;
  name: string;
  group: Group["id"];
  path?: string;
  icon?: string;
  colour?: string;
  shown: boolean;
  pinned?: boolean;
  order: number;
  /** Placed but not being worked on (Shaan 3 Oct 00:05: the property and trading projects). The nav says so. */
  dormant?: boolean;
};

type PlanItem = Record<string, any>;
type Owner = {
  main?: boolean;
  name: string;
  domain: string;
  icon: string;
  state: "live" | "planned" | "offline";
  working: number;
  plan: { checked: number; total: number; asked: number; items: PlanItem[] } | null;
  lastReport?: { at: string; text: string };
};
/** `elsewhere`: a project with no owner of its own whose work reports to an agent in another slot (Agent Zero, Agent
 * Infrastructure); the nav links to that agent rather than drawing an empty seat. */
type OrgProject = Project & { line?: string; status?: string; owners: Owner[]; elsewhere?: string };
/** Where a CLIENTS.json entry sits inside Clients (projects-nav spec A): Active · Friends · Leads · Not sure · Past. */
export type Stage = "active" | "friends" | "leads" | "unsure" | "past";
/** One row inside an Agency folder: a client, an agency (its partner-clients carry `parent`), or an industry. `id` is its
 * folder under SISO_Workspace, which is also what Pin sends (op "show"); `project` is the registry project it is, if any. */
export type FolderItem = {
  id: string; name: string; kind: string; stage?: Stage; line: string; note: string; people: string[]; parent?: string; project?: string; pinned: boolean;
  /** Its folder under SISO_Workspace (what Pin files as a project's path); an industry's id is `industry:<slug>` instead. */
  folder?: string;
  /** An industry's template client folder, and the clients in it (their ids). */
  template?: string;
  clients?: string[];
};
export type Folder = { id: "clients" | "agencies" | "industries"; name: string; items: FolderItem[] };
export type Org = {
  top: Owner[];
  bottom: Owner[];
  /** Every registry project of the group (`shown` = at the top of it; the agency's others live in its folders). */
  groups: (Group & { projects: OrgProject[]; folders: Folder[] })[];
};

const groups: Group[] = [
  { id: "agency", name: "SISO Agency", icon: "briefcase-business", order: 0 },
  { id: "labs", name: "SISO Labs", icon: "flask", order: 1 },
  { id: "family", name: "SISO Family", icon: "home", order: 2 },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const agentEntries = (reg: any): [string, any][] => Array.isArray(reg?.agents)
  ? reg.agents.map((a: any) => [String(a.name ?? a.id ?? ""), a])
  : Object.entries(reg?.agents ?? {});

function projectGroup(name: string): Group["id"] {
  if (name === "HALO" || name === "Fahmy's agency") return "agency";
  if (name === "SISO Family") return "family";
  return "labs";
}

/**
 * Projects he named that the table did not have (Shaan, 3 Oct 00:05): added once each, then his like any other row
 * (rename, move, remove stick, because `seeded` remembers what was added). Paths are under SISO_Workspace; the two
 * Family ones sit in personal/, whose contents the app never reads.
 */
export const SEEDED: Project[] = [
  { id: 'agent-base', name: 'Agent Base', group: 'labs', shown: true, order: 40 },
  { id: 'lifelog', name: 'Lifelog', group: 'labs', shown: true, order: 51 },
  { id: 'estate', name: 'Estate', group: 'labs', shown: true, order: 52 },
  { id: 'rolodex', name: 'Rolodex', group: 'labs', shown: true, order: 53 },
  { id: 'great-library-of-siso', name: 'Great Library of SISO', group: 'labs', shown: true, order: 54 },
  { id: 'siso-voice', name: 'SISO Voice', group: 'labs', shown: true, order: 55 },
  { id: 'siso-web', name: 'SISO Web', group: 'labs', shown: true, order: 56 },
  { id: "maths-innovations", name: "Maths Innovations", group: "labs", path: "Great_Library_of_SISO/works/erdos", shown: true, order: 50 },
  { id: "property", name: "Property", group: "family", path: "personal/goals/uk-house-search", shown: true, order: 60, dormant: true },
  { id: "trading-for-dad", name: "Trading for Dad", group: "family", path: "personal/trading-for-dad", shown: true, order: 61, dormant: true },
];
export function seedProjects(reg: any): any {
  const seeded: string[] = Array.isArray(reg.seeded) ? reg.seeded : (reg.seeded = []);
  reg.projects ??= [];
  for (const p of SEEDED) {
    if (seeded.includes(p.id)) continue;
    seeded.push(p.id);
    if (!reg.projects.some((x: any) => (typeof x === "string" ? x : x?.id) === p.id || (typeof x === "string" ? x : x?.name) === p.name)) reg.projects.push({ ...p });
  }
  return reg;
}
/** A folder the app must not read into a page (his personal files): `door` stays empty for it. */
export const isPrivatePath = (p?: string) => !!p && /(^|\/)personal(\/|$)/.test(p.replace(/\\/g, "/"));

/** Migrate the old string project list into the three-group model. Safe to run repeatedly. */
export function migrate(reg: any): any {
  const next = seedProjects(structuredClone(reg ?? {}));
  const rows = agentEntries(next);
  const oldProjects: any[] = Array.isArray(next.projects) ? next.projects : [];
  const oldToNew = new Map<string, string>();
  const projects: Project[] = [];

  for (const raw of oldProjects) {
    const oldName = typeof raw === "string" ? raw : String(raw?.name ?? raw?.id ?? "");
    if (!oldName || oldName === "Personal") continue;
    // A row already in the three-group model is his: kept as it is. Re-deriving it on every buildOrg is what dropped
    // Efficiency (no agent named it yet) and folded SISO Internal Labs into Agent Base (2 Oct, /api/org lost 4 projects).
    if (raw && typeof raw === "object" && groups.some((g) => g.id === raw.group)) {
      addProject(projects, raw, oldName === "SISO Internal Labs" ? "Agent Base" : oldName, raw.group, typeof raw.shown === "boolean" ? raw.shown : true);
      continue;
    }
    let name = oldName;
    if (oldName === "SISO Internal Labs") name = "Agent Base";
    const agentsHere = rows.filter(([agentName, a]) => agentName !== "agent-base" && a?.project === oldName);
    if (oldName === "Streaming" && agentsHere.length === 0) continue;
    // STACK-OPT and HEALTH were historically attached to the Labs umbrella project.
    // Their registered domains give them stable, real project rows of their own.
    if (oldName === "SISO Internal Labs" && agentsHere.length) {
      const hasBase = agentsHere.some(([, a]) => !/efficiency|health/i.test(`${a?.domain ?? ""} ${a?.role ?? ""}`));
      if (hasBase) addProject(projects, raw, name, "labs", true);
      if (agentsHere.some(([, a]) => /efficiency/i.test(`${a?.domain ?? ""} ${a?.role ?? ""}`))) addProject(projects, raw, "Efficiency", "labs", true);
      if (agentsHere.some(([, a]) => /health/i.test(`${a?.domain ?? ""} ${a?.role ?? ""}`))) addProject(projects, raw, "Estate", "labs", true);
      oldToNew.set(oldName, "Agent Base");
      continue;
    }
    const shown = name === "HALO" || name === "Fahmy's agency" || projectGroup(name) !== "agency";
    const mappedName = name;
    if (mappedName === "Efficiency" && agentsHere.length === 0) continue;
    addProject(projects, raw, mappedName, projectGroup(mappedName), shown);
    oldToNew.set(oldName, mappedName);
  }

  for (const [name, agent] of rows) {
    if (name === "agent-base") {
      if (Array.isArray(next.agents)) next.agents = next.agents.filter((a: any) => a !== agent);
      else delete next.agents[name];
      continue;
    }
    if (!agent || typeof agent !== "object") continue;
    if (agent.project === "Personal") {
      agent.project = /health/i.test(`${name} ${agent.domain ?? ""} ${agent.role ?? ""}`) ? "Estate" : undefined;
    } else if (agent.project === "SISO Internal Labs") {
      // The old umbrella: an agent goes to the project its domain names (ESTATE → Estate), else by what it does.
      const description = `${agent.domain ?? ""} ${agent.role ?? ""}`;
      const named = projects.find((p) => p.name !== "SISO Internal Labs" && p.name.toLowerCase() === String(agent.domain ?? "").toLowerCase());
      agent.project = named ? named.name : /efficiency/i.test(description) ? "Efficiency" : /health/i.test(description) || name === "HEALTH" ? "Estate" : "Agent Base";
    } else if (oldToNew.has(agent.project)) {
      agent.project = oldToNew.get(agent.project);
    }
    if (name === "HEALTH" || /laptop-health/i.test(name) || (/health/i.test(agent.domain ?? "") && agent.kind === "owner")) {
      agent.slot = "bottom";
      if (agent.project && !projects.some((p) => p.name === agent.project)) agent.project = "Estate";
    }
  }

  // De-duplicate projects after remapping and keep deterministic, user-owned ordering.
  const seen = new Set<string>();
  next.projects = projects.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  }).map((p, i) => ({ ...p, order: p.order ?? i }));
  next.groups = structuredClone(groups);
  return next;
}

function addProject(out: Project[], raw: any, name: string, group: Group["id"], shown: boolean) {
  if (out.some((p) => p.name === name)) return;
  const id = typeof raw === "object" && raw?.id ? String(raw.id) : slug(name);
  out.push({
    ...(raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter(([key]) => ["id", "name", "group", "path", "icon", "colour", "shown", "pinned", "order"].includes(key))) : {}),
    id,
    name,
    group,
    ...(typeof raw === "object" && raw?.dormant ? { dormant: true } : {}),
    ...(typeof raw === "object" && raw?.path ? { path: raw.path } : {}),
    ...(typeof raw === "object" && raw?.icon ? { icon: raw.icon } : {}),
    ...(typeof raw === "object" && raw?.colour ? { colour: raw.colour } : {}),
    shown,
    // Keep his order across migrate runs (buildOrg migrates on every call); new projects go last.
    order: typeof raw === "object" && typeof raw?.order === "number" ? raw.order : out.length,
  });
}

export function applyOp(reg: any, op: { op: "pin-project" | "unpin-project" | "show" | "hide" | "order" | "rename" | "remove" | "place"; id: string; to?: any }): any {
  const next = structuredClone(reg);
  const projects: Project[] = next.projects ?? [];
  if (op.op === "order") {
    if (!Array.isArray(op.to)) throw new TypeError("order requires an array of project ids");
    const position = new Map(op.to.map((id: string, i: number) => [id, i]));
    projects.forEach((p) => { if (position.has(p.id)) p.order = position.get(p.id)!; });
    return next;
  }
  const project = projects.find((p) => p.id === op.id);
  if (!project) throw new Error(`unknown project: ${op.id}`);
  if (op.op === "pin-project") project.pinned = true;
  else if (op.op === "unpin-project") project.pinned = false;
  else if (op.op === "show") project.shown = true;
  else if (op.op === "hide") project.shown = false;
  else if (op.op === "rename") {
    const name = typeof op.to === "string" ? op.to : op.to?.name;
    if (!name?.trim()) throw new TypeError("rename requires a project name");
    const old = project.name;
    project.name = name.trim();
    project.id = slug(project.name);
    for (const [, agent] of agentEntries(next)) if (agent?.project === old) agent.project = project.name;
  } else if (op.op === "remove") {
    if (agentEntries(next).some(([, agent]) => agent?.project === project.name)) throw new Error(`project has agents: ${project.name}`);
    next.projects = projects.filter((p) => p.id !== project.id);
  } else if (op.op === "place") {
    const target = typeof op.to === "string" ? { group: op.to } : op.to;
    if (!target || !["agency", "labs", "family"].includes(target.group)) throw new TypeError("place requires a valid group");
    Object.assign(project, target);
  }
  return next;
}

/** What buildOrg reads from the estate; `clients` and `industries` are optional so an older caller still builds. */
export type OrgReaders = {
  doors(): Promise<any>;
  plan(path: string): Promise<any | null>;
  ownersLog(path: string, n: number): Promise<string[]>;
  /** SISO_Agency/clients/CLIENTS.json, the agency's own list of who it works with (one entry per folder, with a kind). */
  clients?(): Promise<any>;
  /** The folder names under SISO_Agency/hq/industries (the verticals with a page). */
  industries?(): Promise<string[]>;
};

export function readers(home: string): OrgReaders {
  const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
  return {
    doors: () => json(path.join(home, "SISO_Workspace/SISO_Agents/siso-estate/plan/doors.json")),
    plan: async (file) => { try { return await json(file); } catch { return null; } },
    ownersLog: async (file, n) => {
      try { return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).slice(-Math.max(0, n)); }
      catch { return []; }
    },
    clients: () => json(path.join(home, "SISO_Workspace/SISO_Agency/clients/CLIENTS.json")),
    industries: async () => (await readdir(path.join(home, "SISO_Workspace/SISO_Agency/hq/industries"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name),
  };
}

/** CLIENTS.json kind → its stage inside Clients. partner → Agencies, partner-client → under its agency, template →
 * Industries, moved → not the agency's (A0 places it). */
const STAGE_OF: Record<string, Stage> = { client: "active", "friend-favour": "friends", lead: "leads", unknown: "unsure", offboarded: "past", declined: "past" };
/** His verticals (15:40: OFM, web dev, restaurants, car rentals, e-commerce) and the four templates' (bike rental, tour guides). */
/** `clients`: CLIENTS.json folders inferred to be in it while CLIENTS.json has no `industry` field (an entry's own
 * `industry` slug, when present, also places it). */
export const INDUSTRIES: { id: string; name: string; dir?: string; template?: string; seen?: RegExp; clients?: string[] }[] = [
  { id: "ofm", name: "OFM", dir: "model_management", clients: ["../partners/halo", "../partners/halo/clients/college-besties"] },
  { id: "web-dev", name: "Web dev" },
  { id: "e-commerce", name: "E-commerce", seen: /e-commerce/i },
  { id: "car-rental", name: "Car rental", template: "five-star-hire" },
  { id: "restaurants", name: "Restaurants", template: "restaurant-app", clients: ["cafe-89"] },
  { id: "bike-rental", name: "Bike rental", template: "bike-rental" },
  { id: "tour-guides", name: "Tour guides", template: "tour-guides" },
];
/** HALO's own projects (Shaan 3 Oct 00:05: "halo ... you have the streaming project in halo and also add the CRM"),
 * rows under HALO in Agencies; `domain` finds the HALO owner who runs each. */
const PARTNER_PROJECTS: { partner: string; folder: string; name: string; domain: RegExp }[] = [
  { partner: "../partners/halo", folder: "../partners/halo/oracle", name: "Streaming", domain: /stream/i },
  { partner: "../partners/halo", folder: "../partners/halo/crm", name: "CRM", domain: /crm/i },
];
const titleCase = (s: string) => s.split(/[-_ ]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
/** A CLIENTS.json folder (relative to SISO_Agency/clients) as its path under SISO_Workspace: the item's id. */
const clientId = (folder: string) => path.posix.normalize(path.posix.join("SISO_Agency/clients", String(folder)));
/** CLIENTS.json has no name field; these folders' names are not their title case (the R1.3 mock's spellings). */
const DISPLAY: Record<string, string> = { kikas: "Kika’s Coffee & Co.", buildstockpro: "BuildStock Pro", "construction-rc": "Construction RC", "cafe-89": "Cà Phê 89", thehrworld: "TheHRworld", actionmodel: "Action Model", "business-to-government": "B2G" };
/** Its display name: a registry project at that folder, else a "Name: …" lead-in of its note, else the folder, title-cased. */
function clientName(entry: any, project?: Project): string {
  if (project) return project.name;
  if (typeof entry.name === "string" && entry.name.trim()) return entry.name.trim();
  const known = DISPLAY[clientId(entry.folder).split("/").at(-1)!];
  if (known) return known;
  const lead = String(entry?.note ?? "").match(/^([A-Z][\w .'&]{1,38}):/)?.[1];
  if (lead) return lead.trim();
  const leaf = clientId(entry.folder).split("/").at(-1)!.replace(/[()]/g, "").replace(/^siso-/, "").replace(/-\d{4}-\d{2}$/, "");
  return titleCase(leaf);
}

/**
 * The Agency's three folders from CLIENTS.json and hq/industries (projects-nav spec A). Clients 12, Agencies 2 and
 * Industries 7 with today's file. A client also on the registry as a shown agency project is pinned.
 */
export function agencyFolders(clientsFile: any, industryDirs: string[], projects: Project[], doors: any = {}, agents: [string, any][] = []): Folder[] {
  const entries: any[] = Array.isArray(clientsFile?.clients) ? clientsFile.clients.filter((c: any) => c && typeof c.folder === "string") : [];
  const agencyProjects = projects.filter((p) => p.group === "agency");
  const projectAt = (id: string) => agencyProjects.find((p) => relativeDoorPath(p.path) === id);
  const doorLine = (id: string) => String(doors?.what?.[id] ?? "");
  const item = (entry: any, extra: Partial<FolderItem> = {}): FolderItem => {
    const id = clientId(entry.folder);
    const project = projectAt(id);
    const people: string[] = Array.isArray(entry.people) ? entry.people.map(String) : [];
    extra = { folder: id, ...extra };
    const stage = STAGE_OF[entry.kind];
    // One faint word: who brought it, or for Past why it is past ("offboarded 24 Sep" when the estate's door dates it).
    const line = entry.kind === "offboarded" ? (doorLine(id).match(/offboarded(?: on)? \d{1,2} \w{3}/i)?.[0] ?? "offboarded")
      : entry.kind === "declined" ? "declined"
      : people[0]?.replace(/\s*\(.*\)$/, "").split(" ")[0] ?? "";
    return { id, name: clientName(entry, project), kind: String(entry.kind), ...(stage ? { stage } : {}), line, note: String(entry.note ?? ""), people, ...(project ? { project: project.id } : {}), pinned: !!project && project.shown !== false, ...extra };
  };
  const clients = entries.filter((e) => STAGE_OF[e.kind]).map((e) => item(e));
  const partners = entries.filter((e) => e.kind === "partner").map((e) => item(e, { line: "" }));
  // Fahmy is a client relationship, with the same identity and children; this is a projection, no data move.
  const isFahmy = (p: FolderItem) => p.id === 'SISO_Agency/partners/fahmy' || p.id === 'SISO_Agency/partners/fahmy/bykonzyard-agents' || /fahmy/i.test(p.name);
  const clientPartners = partners.filter(isFahmy);
  for (const p of clientPartners) p.name = 'Fahmy';
  const partnerClients = entries.filter((e) => e.kind === "partner-client").map((e) => {
    const id = clientId(e.folder);
    const parent = partners.find((p) => id.startsWith(`${p.id}/`));
    return item(e, parent ? { parent: parent.id } : {});
  });
  const partnerProjects = PARTNER_PROJECTS.flatMap((pp): FolderItem[] => {
    const parent = partners.find((p) => p.id === clientId(pp.partner));
    if (!parent) return [];
    const parentProject = agencyProjects.find((p) => p.id === parent.project);
    const owner = agents.find(([, a]) => a?.kind === "owner" && a?.project === parentProject?.name && pp.domain.test(String(a?.domain ?? "")))?.[0];
    return [{ id: clientId(pp.folder), folder: clientId(pp.folder), name: pp.name === "CRM" ? "HALO Agency Base" : "HALO Streaming", kind: "partner-project", line: owner ?? "", note: `${parent.name}'s ${pp.name}`, people: parent.people, parent: parent.id, pinned: false }];
  });
  const templates = entries.filter((e) => e.kind === "template");
  const industries = INDUSTRIES.map((ind): FolderItem => {
    const template = templates.find((t) => clientId(t.folder).endsWith(`/${ind.template}`));
    const hasPage = !!ind.dir && industryDirs.includes(ind.dir);
    // An industry is its own page (`industry:<slug>`); its template is a field (project-pages spec, acceptance 1).
    const folder = hasPage ? `SISO_Agency/hq/industries/${ind.dir}` : template ? clientId(template.folder) : `SISO_Agency/hq/industries/${ind.dir ?? ind.id}`;
    const project = projectAt(folder);
    const seenIn = ind.seen ? entries.find((e) => e.kind !== "template" && ind.seen!.test(String(e.note ?? ""))) : undefined;
    const inIt = entries.filter((e) => e.kind !== "template" && (e.industry === ind.id || ind.clients?.includes(e.folder) || e === seenIn)).map((e) => clientId(e.folder));
    return {
      id: `industry:${ind.id}`, name: ind.name, kind: "industry", folder, clients: inIt,
      ...(template ? { template: clientId(template.folder) } : {}),
      line: hasPage ? "page" : template ? "template" : seenIn ? clientName(seenIn, projectAt(clientId(seenIn.folder))) : "",
      note: template ? String(template.note ?? "") : hasPage ? `hq/industries/${ind.dir}` : "",
      people: template && Array.isArray(template.people) ? template.people.map(String) : [],
      ...(project ? { project: project.id } : {}), pinned: !!project && project.shown !== false,
    };
  });
  return [
    { id: "clients", name: "Clients", items: [...clients, ...clientPartners, ...partnerClients.filter(c => clientPartners.some(p => p.id === c.parent))] },
    { id: "agencies", name: "Agencies", items: [...partners.filter(p => !isFahmy(p)), ...partnerProjects, ...partnerClients.filter(c => !clientPartners.some(p => p.id === c.parent))] },
    { id: "industries", name: "Industries", items: industries },
  ];
}

function planStats(plan: any) {
  if (!plan || !Array.isArray(plan.items)) return null;
  return {
    checked: plan.items.filter((i: any) => i?.status === "checked").length,
    total: plan.items.filter((i: any) => i?.status !== "dropped").length,
    asked: plan.items.filter((i: any) => i?.status === "asked").length,
    items: plan.items,
  };
}

function ownerSlug(name: string) { return slug(name); }
function relativeDoorPath(p?: string) {
  if (!p) return "";
  return p.replace(/^.*?SISO_Workspace\//, "").replace(/^\//, "").replace(/\/$/, "");
}

export async function buildOrg(reg: any, read: OrgReaders): Promise<Org> {
  const migrated = migrate(reg);
  const allAgents = agentEntries(migrated);
  // A missing doors, clients or industries file (a lab HOME, a fresh machine) is empty folders, not a broken nav.
  const [doors, clientsFile, industryDirs] = await Promise.all([
    read.doors().catch(() => ({})),
    read.clients ? read.clients().catch(() => ({})) : Promise.resolve({}),
    read.industries ? read.industries().catch(() => []) : Promise.resolve([]),
  ]);
  const groupsOut: Org["groups"] = [];
  const rowsToOwner = async (name: string, agent: any, project: Project): Promise<Owner> => {
    const projectPath = agent?.path ?? agent?.repoPath ?? project.path;
    const planFile = projectPath ? path.join(projectPath, ".agents/plan", `${ownerSlug(name)}.json`) : "";
    const logFile = projectPath ? path.join(projectPath, ".agents/owners.log") : "";
    const [plan, logLines] = await Promise.all([
      planFile ? read.plan(planFile) : Promise.resolve(null),
      logFile ? read.ownersLog(logFile, 40) : Promise.resolve([]),
    ]);
    const reportLine = logLines.slice().reverse().find((line) => line.includes(`· ${name} ·`));
    const fields = reportLine?.split(" · ") ?? [];
    return {
      name,
      main: typeof agent?.main === "boolean" ? agent.main : MAIN_NAMES.includes(name.toUpperCase()),
      domain: String(agent?.domain ?? name),
      icon: String(agent?.icon ?? "bot"),
      state: agent?.state === "planned" ? "planned" : "live",
      working: Number(agent?.working ?? 0),
      plan: planStats(plan),
      ...(reportLine ? { lastReport: { at: fields[0] ?? "", text: fields[2] ?? reportLine } } : {}),
    };
  };

  const aliases: Record<string, string> = migrated.aliases ?? {};
  for (const group of groups) {
    const projectRows: OrgProject[] = [];
    // Every project of the group, his order; `shown` says whether it sits at the top (the agency's others are in folders).
    const mine = (migrated.projects as Project[]).filter((p) => p.group === group.id).sort((a, b) => a.order - b.order);
    for (const project of mine) {
      const matchingDoor = Object.entries(doors?.what ?? {}).find(([key]) => {
        const projectPath = relativeDoorPath(project.path);
        return projectPath && (relativeDoorPath(key) === projectPath || relativeDoorPath(key).startsWith(`${projectPath}/`));
      });
      const owners = allAgents.filter(([name, a]) => a?.project === project.name && a?.kind === "owner" && !/^\[[^\]]*\]|\||^term_/.test(name));
      const ownerValues = await Promise.all(owners.map(([name, agent]) => rowsToOwner(name, agent, project)));
      // No owner of its own, but its workers report to one (SISO's to Agent Zero): that one is where it is run from.
      const lead = owners.length ? undefined : allAgents.find(([, a]) => a?.project === project.name && a?.owner)?.[1]?.owner;
      projectRows.push({
        ...project,
        ...(matchingDoor ? { line: String(matchingDoor[1]), status: /offboarded/i.test(String(matchingDoor[1])) ? "offboarded" : "active" } : {}),
        owners: ownerValues,
        ...(lead ? { elsewhere: aliases[lead] ?? lead } : {}),
      });
    }
    const folders = group.id === "agency" ? agencyFolders(clientsFile, industryDirs, migrated.projects, doors, allAgents) : [];
    groupsOut.push({ ...group, projects: projectRows, folders });
  }

  const projectFor = (_name: string, agent: any) => (migrated.projects as Project[]).find((p) => p.name === agent?.project);
  const topAgent = allAgents.find(([name, a]) => name === "Agent Zero" || name === "A0" || a?.zero === true || /^A0\b/.test(a?.title ?? ""));
  const healthAgent = allAgents.find(([name, a]) => name === "HEALTH" || a?.slot === "bottom");
  const makePinned = async (entry: [string, any] | undefined, fallback: string): Promise<Owner> => {
    if (!entry) return { name: fallback, domain: fallback, icon: fallback === "Agent Zero" ? "brain" : "stethoscope", state: "live", working: 0, plan: null };
    const [name, agent] = entry;
    const project = projectFor(name, agent);
    return project ? rowsToOwner(name, agent, project) : { name, domain: String(agent?.domain ?? name), icon: String(agent?.icon ?? (name === "Agent Zero" ? "brain" : "bot")), state: agent?.state === "planned" ? "planned" : "live", working: Number(agent?.working ?? 0), plan: null };
  };

  return {
    top: [await makePinned(topAgent, "Agent Zero")],
    bottom: [await makePinned(healthAgent, "HEALTH")],
    groups: groupsOut,
  };
}
