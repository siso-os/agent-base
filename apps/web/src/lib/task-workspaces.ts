import { useEffect, useState } from "react";
import { canonName, nameKey, orderTasks, ownerNames, taskRoots } from "./a0-tasks";
import type { TaskSummary } from "../components/widgets/TasksWidget";
import type { NavWorkspace } from "./workspace-nav";

export type TaskWorkspaceRegistry = {
  workspaces: (NavWorkspace & { owner?: string })[];
  taskIdentities?: Record<string, { workspace?: string; project?: string }>;
  taskAliases?: Record<string, string>;
};
export const EMPTY_TASK_REGISTRY: TaskWorkspaceRegistry = { workspaces: [] };

/** Read the same registry as navigation; no task-specific workspace list or colour seeds. */
export function useTaskWorkspaces(revision?: string, navigation?: TaskWorkspaceRegistry["workspaces"]) {
  const [registry, setRegistry] = useState<TaskWorkspaceRegistry>(EMPTY_TASK_REGISTRY);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      void fetch("/api/workspace-registry", { cache: "no-store" })
      .then(async r => { if (!r.ok) throw Error("Registry unavailable"); return r.json() as Promise<TaskWorkspaceRegistry>; })
      .then(value => {
        if (!validTaskRegistry(value)) throw Error("Invalid registry");
        if (active && current === request) { setRegistry(value); setFailed(false); setLoaded(true); }
      })
      .catch(() => { if (active && current === request) { setFailed(true); setLoaded(true); } });
    };
    load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [revision]);
  // The panel opens after navigation has loaded. Use that same live registry immediately,
  // while the request supplies owner aliases/identities; pending data is never a new lane assignment.
  return { registry: navigation?.length ? { ...registry, workspaces: navigation } : registry, failed, loaded };
}

/** Follow registry ancestry only; unknown IDs and cycles never invent a nav root. */
export function taskNavRoot(id: string | null | undefined, registry: TaskWorkspaceRegistry): string | null {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const w = registry.workspaces.find(w => w.id === id);
    if (!w) return null;
    if (w.nav === true) return w.id;
    id = w.parent;
  }
  return null;
}

/** Match registered project names first; retain legacy task project labels without importing server runtime. */
function projectWorkspace(project: unknown, registry: TaskWorkspaceRegistry): string | null {
  if (typeof project !== "string") return null;
  const key = nameKey(project);
  const registered = registry.workspaces.find(w => nameKey(w.id) === key || (w.name && nameKey(w.name) === key));
  if (registered) return taskNavRoot(registered.id, registry);
  const legacy = /halo/i.test(project) ? "halo"
    : /client|fahmy|siso agency/i.test(project) ? "siso-agency"
    : /agent base|siso internal labs/i.test(project) ? "agent-base" : null;
  return taskNavRoot(legacy, registry);
}

export function taskOwner(t: TaskSummary, registry: TaskWorkspaceRegistry): string {
  const names = ownerNames(t.owner);
  const owner = names.find(n => !["A0", "AGENTZERO", "ZEROSOL"].includes(nameKey(n))) ?? names[0];
  if (!owner) return "Unassigned";
  const alias = Object.entries(registry.taskAliases ?? {}).find(([name]) => nameKey(name) === nameKey(owner))?.[1] ?? owner;
  // Display the registered spelling while matching punctuation/seat aliases consistently.
  return registry.workspaces.find(w => w.owner && nameKey(w.owner) === nameKey(alias))?.owner
    ?? Object.keys(registry.taskIdentities ?? {}).find(name => nameKey(name) === nameKey(canonName(alias))) ?? alias;
}

/** Explicit affinity, project, reviewed owner identity, then ancestry. A dispatcher/doer is never ownership. */
export function taskWorkspace(t: TaskSummary, registry: TaskWorkspaceRegistry, all: TaskSummary[] = [], seen = new Set<string>()): string | null {
  if (seen.has(t.id)) return null;
  seen.add(t.id);
  if (t.workspace) return taskNavRoot(t.workspace, registry);
  const owners = ownerNames(t.owner);
  const identities = owners.filter(n => !["A0", "AGENTZERO", "ZEROSOL"].includes(nameKey(n))).map(n => {
    const alias = Object.entries(registry.taskAliases ?? {}).find(([name]) => nameKey(name) === nameKey(n))?.[1] ?? n;
    return Object.entries(registry.taskIdentities ?? {}).find(([name]) => nameKey(name) === nameKey(alias))?.[1];
  });
  const explicit = identities.find(w => w?.workspace)?.workspace;
  if (explicit) return taskNavRoot(explicit, registry);
  const project = projectWorkspace(t.project, registry);
  if (project) return project;
  for (const owner of owners) {
    if (["A0", "AGENTZERO", "ZEROSOL"].includes(nameKey(owner))) continue;
    const w = registry.workspaces.find(w => w.owner && nameKey(w.owner) === nameKey(owner));
    const root = taskNavRoot(w?.id, registry);
    if (root) return root;
  }
  for (const identity of identities) {
    const root = projectWorkspace(identity?.project, registry);
    if (root) return root;
  }
  const parent = all.find(p => p.id === t.parent);
  return parent ? taskWorkspace(parent, registry, all, seen) : null;
}

/** Roots of the selected view, so an open child of a closed/missing parent remains reachable. */
export function workspaceTaskGroups(tasks: TaskSummary[], registry: TaskWorkspaceRegistry, all = tasks) {
  const roots = orderTasks(taskRoots(tasks));
  const reached = new Set<string>();
  const visit = (id: string) => { if (reached.has(id)) return; reached.add(id); tasks.filter(t => t.parent === id).forEach(t => visit(t.id)); };
  roots.forEach(t => visit(t.id));
  for (const t of orderTasks(tasks)) if (!reached.has(t.id)) { roots.push(t); visit(t.id); }
  const workspaces = [...registry.workspaces.filter(w => w.nav === true)].sort((a, b) => a.order - b.order);
  return [...workspaces, { id: "unsorted", name: "Unsorted", color: "", order: Infinity }].map(w => {
    const rows = roots.filter(t => (taskWorkspace(t, registry, all) ?? "unsorted") === w.id);
    const owners = [...new Set(rows.map(t => taskOwner(t, registry)))].sort().map(owner => ({ owner, tasks: rows.filter(t => taskOwner(t, registry) === owner) }));
    return { ...w, tasks: rows, owners };
  });
}

/** Validate before replacing the last readable registry. Empty is a valid, loaded registry. */
export function validTaskRegistry(value: unknown): value is TaskWorkspaceRegistry {
  if (!value || typeof value !== "object") return false;
  const r = value as TaskWorkspaceRegistry;
  if (!Array.isArray(r.workspaces)) return false;
  const ids = new Set<string>();
  for (const w of r.workspaces) {
    if (!w || typeof w.id !== "string" || !w.id || ids.has(w.id) || typeof w.name !== "string" ||
        typeof w.order !== "number" || !Number.isFinite(w.order) ||
        (w.parent != null && typeof w.parent !== "string") || (w.owner != null && typeof w.owner !== "string")) return false;
    ids.add(w.id);
  }
  if (r.taskAliases != null && (typeof r.taskAliases !== "object" || Array.isArray(r.taskAliases) ||
      !Object.values(r.taskAliases).every(v => typeof v === "string"))) return false;
  if (r.taskIdentities != null && (typeof r.taskIdentities !== "object" || Array.isArray(r.taskIdentities) ||
      !Object.values(r.taskIdentities).every(v => v && typeof v === "object" &&
        (v.workspace == null || typeof v.workspace === "string") && (v.project == null || typeof v.project === "string")))) return false;
  return true;
}

/** Restore only ancestor context; siblings outside a filter stay outside it. Never mutate records. */
export function taskAncestorContext(selected: TaskSummary[], all: TaskSummary[]): TaskSummary[] {
  const byId = new Map(all.map(t => [t.id, t]));
  const included = new Set<string>();
  for (const task of selected) {
    let current: TaskSummary | undefined = task;
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
  }
  return all.filter(t => included.has(t.id));
}
