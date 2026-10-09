import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readServiceHosts } from "./service-hosts.ts";
import type { HubA0, HubAgent, HubOrg, HubProject } from "../../../apps/web/src/lib/hub-types.ts";
import type { PlanItem, PlanState } from "../../../apps/web/src/lib/org-types.ts";

const execFile = promisify(execFileCb);
const FLOW: PlanState[] = ["asked", "specced", "allocated", "building", "built", "checked", "parked", "dropped"];
const PROJECTS: Record<string, { file: string; project: string }> = {
  "STREAMING-CLAUDE": { file: "SISO_Agency/partners/halo/oracle/.agents/plan/streaming-go-live.json", project: "HALO" },
  "OPS-BUILD": { file: "SISO_Agency/partners/halo/oracle/.agents/plan/operator.json", project: "HALO" },
  "HALO-UI": { file: "SISO_Agency/partners/halo/.agents/plan/HALO-UI.json", project: "HALO" },
  "AGENT-BASE": { file: "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/plan/agent-base.json", project: "LABS" },
  "EFFICIENCY": { file: "SISO_Agents/siso-harness-lab/.agents/plan/EFFICIENCY.json", project: "LABS" },
  "HEALTH": { file: "SISO_Agents/laptop-health/.agents/plan/HEALTH.json", project: "LABS" },
  "A0": { file: "SISO_Agents/agent-zero/siso-agent-zero/.agents/A0-plan.json", project: "SISO" },
  // Agent Base's research team (4 Oct): no plan file yet; their work is the idea farm and the research base.
  "SCOUT": { file: "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/plan/scout.json", project: "AGENT BASE" },
  "MINER": { file: "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/plan/miner.json", project: "AGENT BASE" },
};
const ICON_MAP: Record<string, { role: string; icon: string }> = {
  "SISO Agency": { role: "Agency", icon: "briefcase-business" },
  "SISO Labs": { role: "Labs", icon: "flask" },
  "SISO Family": { role: "Family", icon: "home" },
  "SISO Internal Labs": { role: "Agent Base", icon: "layout-panel-top" },
  HALO: { role: "HALO", icon: "chess-king" },
  "Agent Base": { role: "Agent Base", icon: "layout-panel-top" },
  Efficiency: { role: "Efficiency", icon: "zap" },
  EFFICIENCY: { role: "Efficiency", icon: "zap" },
  HEALTH: { role: "Health", icon: "stethoscope" },
  Health: { role: "Health", icon: "stethoscope" },
  "Fahmy's agency": { role: "Fahmy's agency", icon: "heart-handshake" },
  BKY: { role: "BKY", icon: "construction" },
  MelanoTresses: { role: "MelanoTresses", icon: "sparkles" },
  "STREAMING-CLAUDE": { role: "Go-live", icon: "radio-tower" },
  "OPS-BUILD": { role: "Operator / Ops Hub", icon: "gauge" },
  "HALO-UI": { role: "CRM", icon: "layout-grid" },
  "AGENT-BASE": { role: "Agent Base", icon: "layout-panel-top" },
  "AGENT BASE": { role: "Agent Base", icon: "layout-panel-top" },
  SCOUT: { role: "Scout", icon: "compass" },
  MINER: { role: "Miner", icon: "search" },
  A0: { role: "Agent Zero", icon: "brain" },
  "AGENT ZERO": { role: "Agent Zero", icon: "brain" },
};
const icon = (name: string, project = name, domain?: string) => ICON_MAP[name]?.icon ?? ICON_MAP[domain ?? ""]?.icon ?? ICON_MAP[project]?.icon ?? "bot";
const accent = (project: string) => project === "HALO" ? "#F5B400" : /efficiency/i.test(project) ? "#A78BFA" : /health/i.test(project) ? "#34D399" : /fahmy/i.test(project) ? "#60A5FA" : "#FFA726";
const homePaths = (home = homedir()) => ({ work: path.join(home, "SISO_Workspace"), home });
const safeJson = async (file: string) => { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } };
const canonical = (raw: string) => raw.split("| ").at(-1)!.trim().replace(/^(luna|sol)-/i, "").toUpperCase();
export function canon(name: string): string { return canonical(name); }

function entries(registry: any): [string, any][] {
  return Array.isArray(registry?.agents) ? registry.agents.map((a: any) => [String(a.name ?? a.id ?? ""), a]) : Object.entries(registry?.agents ?? {});
}
function state(value: string): HubAgent["state"] {
  if (/work|busy|running|streaming/i.test(value)) return "working";
  if (/done|complete|finished/i.test(value)) return "done";
  if (/idle|ready/i.test(value)) return "idle";
  return "off";
}
function counts(items: any[]) {
  const result = Object.fromEntries(FLOW.map((s) => [s, 0])) as Record<PlanState, number>;
  for (const item of items) if (item?.status in result) result[item.status as PlanState]++;
  return result;
}
async function plans(home: string) {
  const result: Record<string, any> = {};
  for (const [owner, cfg] of Object.entries(PROJECTS)) {
    const value = await safeJson(path.join(home, "SISO_Workspace", cfg.file));
    if (value) result[owner] = { ...cfg, data: value };
  }
  return result;
}

/** Build canonical agents from the registry joined to live herdr rows and plans. */
export async function buildAgents(options: { home?: string; herdr?: any[]; now?: Date } = {}): Promise<HubAgent[]> {
  const { home } = homePaths(options.home);
  const work = path.join(home, "SISO_Workspace");
  const registry = await safeJson(path.join(home, ".local/state/agent-base/registry.json")) ?? {};
  let live = options.herdr;
  if (!live) {
    try { const { stdout } = await execFile("herdr", ["agent", "list"], { timeout: 20_000 }); live = JSON.parse(stdout)?.result?.agents ?? []; }
    catch { live = []; }
  }
  // Chats on Agent Base's own host (siso-host, Claude or Codex) run without herdr: their host files say they run (4 Oct).
  live = [...(live ?? []), ...await hostRows(home)];
  const byCanonical = new Map<string, any>();
  for (const row of live) {
    const key = canon(String(row.name ?? row.terminal_title_stripped ?? ""));
    // Two rows of one name (an Agent Zero and a host in its pane): the working one says whether it runs.
    if (key && !(byCanonical.has(key) && state(String(row.agent_status ?? "")) !== "working")) byCanonical.set(key, row);
  }
  const reports = await getLastReports(work, options.now);
  const holds: Record<string, any> = {};
  const planData = await plans(home);
  for (const [owner, plan] of Object.entries(planData)) for (const item of plan.data.items ?? []) {
    const agent = item?.to && typeof item.to === "object" ? item.to.agent : undefined;
    if (!agent || !["building", "allocated"].includes(item.status)) continue;
    const key = canon(agent);
    if (!holds[key] || item.status === "building") holds[key] = { id: item.id, title: item.title, status: item.status };
  }
  const canonicalRows = new Map<string, { name: string; row: any }>();
  for (const [name, row] of entries(registry).filter(([name]) => name)) {
    const key = canon(name), current = canonicalRows.get(key);
    // Prefer the canonical registry entry, while retaining metadata supplied by an alias.
    if (!current || name === key || (!current.row?.domain && row?.domain)) canonicalRows.set(key, { name, row: { ...current?.row, ...row } });
    else canonicalRows.set(key, { ...current, row: { ...row, ...current.row } });
  }
  const all = [...canonicalRows.values()].map(({ name, row }) => {
    const key = canon(name), liveRow = byCanonical.get(key), project = String(row?.project ?? "SISO");
    const kind = name === "A0" || name === "Agent Zero" ? "zero" : row?.kind === "owner" ? "owner" : "worker";
    const ownerName = Object.keys(PROJECTS).find((owner) => canon(owner) === key);
    const planRecord = ownerName ? planData[ownerName] : undefined;
    const plan = planRecord?.data;
    const items = plan?.items ?? [];
    const ownerKey = row?.owner ? canon(row.owner) : undefined;
    return {
      name: key, kind, project, ...(row?.domain ? { domain: row.domain } : {}), ...(ownerKey ? { owner: ownerKey } : {}), ...((ICON_MAP[key]?.role ?? ICON_MAP[row?.domain ?? ""]?.role ?? row?.role) ? { role: ICON_MAP[key]?.role ?? ICON_MAP[row?.domain ?? ""]?.role ?? row.role } : {}),
      icon: icon(key, project, row?.domain), accent: accent(project), harness: (liveRow?.agent ?? "herdr").toLowerCase(), model: String(liveRow?.model ?? row?.model ?? "—"),
      machine: String(liveRow?.machine ?? liveRow?.host ?? "—"), state: liveRow ? state(String(liveRow.agent_status ?? liveRow.status ?? "")) : "off",
      holding: holds[key] ?? null, lastReport: reports[key] ?? null,
      ...(kind === "owner" || kind === "zero" ? { plan: planRecord ? { checked: items.filter((i: any) => i.status === "checked").length, total: items.length, counts: counts(items) } : null, ...(kind === "owner" ? { workers: { total: 0, working: 0 } } : {}) } : {}),
      spunUp: Boolean(liveRow),
    } as HubAgent;
  });
  for (const a of all.filter((agent) => agent.kind === "owner")) {
    const crew = all.filter((agent) => agent.owner === a.name);
    a.workers = { total: crew.length, working: crew.filter((w) => w.state === "working").length };
  }
  return all;
}

const ownerFor = (project: string) => project === "HALO" ? ["STREAMING-CLAUDE", "OPS-BUILD", "HALO-UI"] : project === "LABS" ? ["AGENT-BASE", "EFFICIENCY", "HEALTH"] : project === "SISO" ? ["A0"] : project === "AGENT BASE" ? ["AGENT-BASE", "SCOUT", "MINER"] : [];
export async function buildProject(id: string, options: { home?: string; agents?: HubAgent[]; now?: Date } = {}): Promise<HubProject | null> {
  const name = id.toLowerCase() === "halo" ? "HALO" : id.toLowerCase() === "labs" ? "LABS" : /^agent[ _-]?base$/i.test(id) ? "AGENT BASE" : id.toUpperCase();
  if (!ownerFor(name).length) return null;
  const { home } = homePaths(options.home), work = path.join(home, "SISO_Workspace");
  const allAgents = options.agents ?? await buildAgents(options);
  const owners: HubAgent[] = [];
  const ownerPlanItems = new Map<string, any[]>();
  const open: (PlanItem & { owner: string })[] = [];
  const totalCounts = Object.fromEntries(FLOW.map((s) => [s, 0])) as Record<PlanState, number>;
  for (const owner of ownerFor(name)) {
    const config = PROJECTS[owner], raw = await safeJson(path.join(work, config.file));
    const agent = allAgents.find((a) => a.name === canon(owner));
    if (!agent) continue;
    if (!raw) {
      agent.plan = null;
      owners.push(agent);
      continue;
    }
    const items: any[] = raw.items ?? [], stats = counts(items);
    ownerPlanItems.set(agent.name, items);
    for (const s of FLOW) totalCounts[s] += stats[s];
    Object.assign(agent, { plan: { checked: stats.checked, total: items.length, counts: stats } });
    owners.push(agent);
    for (const item of items) if (!(["checked", "parked", "dropped"].includes(item.status))) open.push({ ...item, owner: agent.name });
  }
  const order = ["building", "built", "allocated", "specced", "asked"];
  open.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const latest: HubProject["timeline"] = [];
  const reports = await getLastReports(work, options.now);
  for (const owner of owners) {
    const report = reports[owner.name];
    if (report) latest.push({ at: report.at, kind: "report", who: owner.name, text: report.text });
  }
  const a0Root = path.join(work, "SISO_Agents/agent-zero/siso-agent-zero/.agents/a0");
  const taskData = await safeJson(path.join(a0Root, "tasks.json"));
  const needsYou = (taskData?.tasks ?? []).filter((task: any) => task.status === "needs-shaan" && String(task.project ?? "").toUpperCase() === name)
    .map((task: any) => ({ id: task.id, title: String(task.title).slice(0,140), ...(task.owner ? { owner: task.owner } : {}), ...(task.link ? { link: task.link } : {}) }));
  const checked = owners.flatMap((owner) => {
    return (ownerPlanItems.get(owner.name) ?? []).filter((item: any) => item.status === "checked").map((item: any) => ({ at: String(item.at ?? ""), kind: "checked" as const, who: owner.name, text: String(item.title ?? item.id) }));
  });
  const base = name === "AGENT BASE" ? await researchBase(work) : {};
  return { ...base, id: name === "AGENT BASE" ? "agent-base" : name.toLowerCase(), name: name === "AGENT BASE" ? "Agent Base" : name, group: name === "HALO" ? "agency" : "labs", line: name === "HALO" ? "HALO project" : name === "AGENT BASE" ? "The app Shaan runs and talks to his agents in, and the team that makes it better" : "SISO Labs", accent: accent(name), icon: icon(name === "LABS" ? "SISO Labs" : name, name), owners, counts: totalCounts, open, needsYou, timeline: [...latest, ...checked].sort((a,b) => b.at.localeCompare(a.at)), health: [], spendToday: null };
}

export async function buildA0(options: { home?: string } = {}): Promise<HubA0> {
  const { home } = homePaths(options.home), base = path.join(home, "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/.agents/a0");
  const json = async (file: string) => safeJson(path.join(base, file));
  const [tasksFile, sessionsFile, logFile] = await Promise.all([json("tasks.json"), jsonl(path.join(base, "sessions.jsonl")), jsonl(path.join(base, "log.jsonl"))]);
  const text = async (file: string) => { try { return await readFile(path.join(base, file), "utf8"); } catch { return ""; } };
  const [goalsText, handoffText, memoryText] = await Promise.all([text("GOALS.md"), text("HANDOFF.md"), text("../../memory/MEMORY.md")]);
  const tasks = tasksFile?.tasks ?? [];
  const goals: HubA0["goals"] = [];
  let day = "";
  for (const block of goalsText.split(/\n(?=## |\*\*)/)) {
    if (block.startsWith("## ")) { day = block.slice(3).split("\n")[0].trim(); continue; }
    const match = block.match(/^\*\*(.+?)\*\*/s);
    if (match && day) goals.push({ day, title: match[1].trim().replace(/\.$/, ""), ...(block.match(/^> "?(.+?)"?$/m)?.[1] ? { quote: block.match(/^> "?(.+?)"?$/m)![1] } : {}) });
  }
  const timeline: HubA0["timeline"] = [];
  for (const part of handoffText.split(/\n## /).slice(1)) {
    const [head, ...body] = part.split("\n");
    timeline.push({ at: head.trim(), kind: "checkpoint", text: head.trim(), points: body.join("\n").match(/^- \*\*(.+?)\*\*/gm)?.slice(0,3).map((line) => line.replace(/^- \*\*|\*\*$/g, "")) ?? [] });
  }
  const sessions = sessionsFile.filter((s) => s.event === "start");
  const current = sessions.at(-1);
  const memory = [...memoryText.matchAll(/^- \[(.+?)\]\((.+?)\)\s*[—-]?\s*(.*)$/gm)].map((m) => ({ title: m[1], file: m[2], hook: m[3] }));
  return { current: { session: String(current?.id ?? "—").slice(0,8), model: String(current?.model ?? "—"), effort: String(current?.effort ?? "—"), state: current ? "working" : "off" },
    sessions: sessions.map((s) => ({ id: String(s.id ?? "").slice(0,8), started: s.started ?? "" })), goals,
    timeline: [...timeline, ...logFile.slice(-20).map((l) => ({ at: String(l.at ?? ""), kind: "done" as const, text: String(l.text ?? l.message ?? "") }))],
    needsYou: tasks.filter((t: any) => t.status === "needs-shaan").map((t: any) => ({ id: t.id, title: String(t.title).slice(0,140), ...(t.link ? { link: t.link } : {}) })),
    tasks: { counts: tasks.reduce((acc: Record<string,number>, t: any) => (acc[t.status] = (acc[t.status] ?? 0) + 1, acc), {}), running: tasks.filter((t: any) => ["running", "in_progress"].includes(t.status)).map((t: any) => ({ id: t.id, title: String(t.title).slice(0,140) })) }, memory, gaps: [] };
}

export async function buildOrg(options: { home?: string; agents?: HubAgent[] } = {}): Promise<HubOrg> {
  const { home } = homePaths(options.home), registry = await safeJson(path.join(home, ".local/state/agent-base/registry.json")) ?? {};
  const agents = options.agents ?? await buildAgents(options);
  const zero = agents.find((a) => a.kind === "zero" || a.name === "A0") ?? { name: "A0", kind: "zero", project: "SISO", icon: icon("A0"), accent: accent("SISO"), harness: "siso", model: "—", machine: "—", state: "off", spunUp: false } as HubAgent;
  const groups: HubOrg["groups"] = [{ id: "agency", name: "SISO Agency", icon: icon("SISO Agency"), projects: [] }, { id: "labs", name: "SISO Labs", icon: icon("SISO Labs"), projects: [] }, { id: "family", name: "SISO Family", icon: icon("SISO Family"), projects: [] }];
  const projectRows = Array.isArray(registry.projects) ? registry.projects : [];
  for (const raw of projectRows) {
    const name = typeof raw === "string" ? raw : String(raw.name ?? raw.id ?? "");
    const group = name === "HALO" || name === "Fahmy's agency" ? "agency" : name === "SISO Family" ? "family" : "labs";
    const domains = [...new Set(entries(registry).filter(([, a]) => a?.project === name).map(([, a]) => String(a?.domain ?? "General")))];
    groups.find((g) => g.id === group)!.projects.push({ name, icon: icon(name), accent: accent(name), domains: domains.map((domain) => ({ name: domain, owner: agents.find((a) => a.kind === "owner" && (a.project === name || canon(a.project) === canon(name)) && a.domain === domain) ?? null })) });
  }
  const top = [...new Set(agents.filter((a) => a.kind === "owner").map((a) => a.name))];
  return { zero, top, groups };
}

async function getLastReports(work: string, now = new Date()) {
  const base = path.join(work, "SISO_Agents/agent-zero/siso-agent-zero/.agents/a0");
  const logs = [path.join(base, "inbox.log"), path.join(work, "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/agent-base-inbox.log"), path.join(work, "SISO_Agency/partners/halo/oracle/.agents/owners.log")];
  const out: Record<string, { at: string; ageMin: number; text: string; log: string; key: string }> = {};
  const pattern = /^(?:(\d{4}-\d\d-\d\d )?(\d\d:\d\d)(?: \+\d{4})?)\s*(?:·\s*)?([A-Z][A-Z0-9-]+)(?: → [A-Z0-9 -]+)?\s*[:·]\s*(.+)/;
  for (const file of logs) {
    let body: string; let mtime: Date;
    try { [body, mtime] = await Promise.all([readFile(file,"utf8"), stat(file).then((s) => s.mtime)]); } catch { continue; }
    let previous = "", roll = 0;
    const parsed: { match: RegExpMatchArray; roll: number }[] = [];
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(pattern); if (!match) continue;
      const clock = match[2]; if (!match[1] && clock < previous) roll++;
      previous = clock; parsed.push({ match, roll });
    }
    const end = new Date(mtime.getFullYear(),mtime.getMonth(),mtime.getDate());
    for (const { match, roll: lineRoll } of parsed) {
      const dated = match[1] ? null : new Date(end.getTime() - (roll - lineRoll) * 86400000);
      const date = match[1]?.trim() ?? `${dated!.getFullYear()}-${String(dated!.getMonth()+1).padStart(2,"0")}-${String(dated!.getDate()).padStart(2,"0")}`;
      const key = `${date} ${match[2]}`, agent = canon(match[3]);
      if (key >= (out[agent]?.key ?? "")) {
        const [year, month, day] = date.split("-").map(Number), [hour, minute] = match[2].split(":").map(Number);
        const parsedDate = new Date(year, month - 1, day, hour, minute);
        out[agent] = { key, at: `${date} ${match[2]}`, ageMin: Math.max(0, Math.floor((now.getTime() - parsedDate.getTime()) / 60000)), text: match[4].slice(0,220), log: path.basename(file) };
      }
    }
  }
  return out;
}

async function jsonl(file: string): Promise<any[]> {
  try { return (await readFile(file, "utf8")).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)); }
  catch { return []; }
}

/** Running chats on Agent Base's own host, shaped like herdr's agent rows (name, agent_status, agent, model): the same live
 * state as /api/agents (t-0569), so a stopped host is not "working" here while it is idle there. */
async function hostRows(home: string): Promise<any[]> {
  const { hosts } = await readServiceHosts({ dir: process.env.AB_HOSTS_DIR ?? path.join(home, ".local/state/agent-base/hosts") });
  return hosts.filter((h) => h.state === "live" || h.state === "asleep").map((h) => ({
    name: h.name, agent_status: h.state === "live" && h.activity === "working" ? "working" : h.state === "live" && h.activity === "needs" ? "blocked" : "idle",
    agent: h.harness ?? "siso", model: h.model ?? "—", machine: "MB",
  }));
}

/** Agent Base's research base (siso-internal-labs-agents/research): the idea farm and the library. Read-only. */
async function researchBase(work: string): Promise<Pick<HubProject, "ideas" | "library">> {
  const root = path.join(work, "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/research");
  let ideas: NonNullable<HubProject["ideas"]> = [];
  try {
    ideas = (await readFile(path.join(root, "ideas.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((i: any) => i.status !== "rejected")
      .map((i: any) => ({ id: String(i.id), text: String(i.text), by: String(i.by ?? ""), score: typeof i.score === "number" ? i.score : null, status: String(i.status ?? "new"), size: i.size ?? null, why: i.why ?? null, evidence: i.evidence ?? null, his: i.his ?? null }));
  } catch { /* no farm yet */ }
  // His ideas first (the training data), then the farmed ones by score.
  ideas.sort((a, b) => Number(b.by === "Shaan") - Number(a.by === "Shaan") || (b.score ?? 0) - (a.score ?? 0));
  const library: NonNullable<HubProject["library"]> = (await safeJson(path.join(root, "..", "LIBRARY.json"))) ?? (await safeJson(path.join(root, "LIBRARY.json"))) ?? [];
  return { ideas, library };
}
