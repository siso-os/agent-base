import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { createA0TasksHandler } from "./a0-tasks.ts";

/** Read-only navigation between two owners. A donor task never becomes an a0 task. */
export type DonorWorkRef = {
  sourceId: string; sourceRevision: string; snapshotRevision: string;
  projectId: string; taskId?: string;
};
export type DonorDestination = {
  state: "mapped" | "unmapped" | "missing" | "unavailable";
  projectId?: string; taskId?: string; canonicalStage?: string;
};
export type DonorWorkTask = {
  key: string; ref: DonorWorkRef; title: string; state: "todo" | "doing" | "done";
  owner: string; updatedAt: string | null; destination: DonorDestination;
};
export type DonorWorkProject = {
  key: string; ref: DonorWorkRef; name: string; oneliner: string; goal: string;
  area: "main" | "infra"; priority: number; stage: "active" | "backlog";
  updatedAt: string | null; destination: DonorDestination; tasks: DonorWorkTask[];
};
export type DonorWorkData = {
  schema: 1; state: "unconfigured" | "unavailable" | "ready" | "stale";
  error: string | null; source: null | {
    id: string; revision: string; snapshotRevision: string; capturedAt: string;
  };
  projects: DonorWorkProject[];
};
type TaskMap = { donorTaskId: string; taskId: string };
type ProjectMap = { donorProjectId: string; projectId: string; tasks: TaskMap[] };
type Config = {
  schema: 1; source: { id: string; revision: string };
  snapshot: { path: string; sha256: string }; projects: ProjectMap[]; maxAgeMs?: number;
};
export type DonorWorkTargets = {
  projects: string[] | null;
  tasks: { id: string; stage: string; available: boolean }[] | null;
};
type ReaderOptions = {
  configFile?: string; now?: () => number;
  readTargets?: () => Promise<DonorWorkTargets>;
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TASK = /^t-[A-Za-z0-9_-]{1,61}$/;
const SHA = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const DAY = 86_400_000;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const projectId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200 && v === v.trim() && !/[\u0000-\u001f]/.test(v);
const stamp = (v: unknown): string | null => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null;
const unique = (values: string[]) => new Set(values).size === values.length;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Configuration is server-owned; requests can never choose a filename or remote URL. */
async function readBounded(file: string, limit: number): Promise<Buffer> {
  if (!path.isAbsolute(file)) throw new Error("absolute path required");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("not a bounded regular file");
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size <= limit) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > limit) throw new Error("file too large");
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}

function config(value: unknown): Config {
  if (!object(value) || value.schema !== 1 || !object(value.source) || !id(value.source.id) ||
      !REVISION.test(value.source.revision) || !object(value.snapshot) ||
      typeof value.snapshot.path !== "string" || !path.isAbsolute(value.snapshot.path) ||
      !SHA.test(value.snapshot.sha256) || !Array.isArray(value.projects) || value.projects.length > 200 ||
      (value.maxAgeMs !== undefined && (!Number.isSafeInteger(value.maxAgeMs) || value.maxAgeMs < 60_000 || value.maxAgeMs > 7 * DAY))) throw new Error("invalid mapping");
  let taskCount = 0;
  for (const p of value.projects) {
    if (!object(p) || !id(p.donorProjectId) || !projectId(p.projectId) ||
        !Array.isArray(p.tasks) || !unique(p.tasks.map((t: any) => t?.donorTaskId))) throw new Error("invalid project mapping");
    for (const t of p.tasks) {
      if (!object(t) || !id(t.donorTaskId) || !TASK.test(t.taskId)) throw new Error("invalid task mapping");
      if (++taskCount > 2000) throw new Error("too many task mappings");
    }
  }
  // A many-to-one merge is a separate owner decision, never a navigation side effect.
  if (!unique(value.projects.map((p: ProjectMap) => p.donorProjectId)) ||
      !unique(value.projects.map((p: ProjectMap) => p.projectId)) ||
      !unique(value.projects.flatMap((p: ProjectMap) => p.tasks.map(t => t.taskId)))) throw new Error("ambiguous mapping");
  return value as Config;
}

function projects(value: unknown, c: Config): Record<string, any>[] {
  if (!object(value) || value.schema !== 1 || !object(value.source) || value.source.id !== c.source.id ||
      value.source.revision !== c.source.revision || !stamp(value.capturedAt) ||
      !Array.isArray(value.projects) || value.projects.length > 200) throw new Error("invalid snapshot");
  let taskCount = 0;
  for (const p of value.projects) {
    if (!object(p) || !id(p.id) || !text(p.name, 300) || !p.name.trim() ||
        !text(p.oneliner ?? "", 300) || !text(p.goal ?? "", 4000) ||
        !["main", "infra"].includes(p.area) || ![1, 2, 3].includes(p.priority ?? 2) ||
        !["active", "backlog"].includes(p.stage ?? "active") || !Array.isArray(p.tasks)) throw new Error("invalid project");
    for (const t of p.tasks) {
      if (!object(t) || !id(t.id) || !text(t.title, 300) || !t.title.trim() ||
          !text(t.owner, 300) || !["todo", "doing", "done"].includes(t.state)) throw new Error("invalid task");
      if (++taskCount > 2000) throw new Error("too many tasks");
    }
    if (!unique(p.tasks.map((t: any) => t.id))) throw new Error("duplicate donor task");
  }
  if (!unique(value.projects.map((p: any) => p.id))) throw new Error("duplicate donor project");
  for (const mapping of c.projects) {
    const donor = value.projects.find((p: any) => p.id === mapping.donorProjectId);
    if (!donor || mapping.tasks.some(t => !donor.tasks.some((row: any) => row.id === t.donorTaskId))) throw new Error("mapping outside snapshot");
  }
  return value.projects;
}

/** Reuse the canonical task reader; extract identities/status only, never write its records. */
function targetReader(): () => Promise<DonorWorkTargets> {
  const tasks = createA0TasksHandler();
  return async () => {
    const registry = process.env.AB_REGISTRY ?? path.join(homedir(), ".local/state/agent-base/registry.json");
    const [projectResult, taskResult] = await Promise.allSettled([
      readBounded(registry, 2 * 1024 * 1024).then(bytes => JSON.parse(bytes.toString("utf8"))),
      tasks("/api/a0/tasks"),
    ]);
    const p = projectResult.status === "fulfilled" ? projectResult.value?.projects : null;
    const result = taskResult.status === "fulfilled" ? taskResult.value : null;
    const t = result?.status === 200 && object(result.body) ? result.body.tasks : null;
    return {
      projects: Array.isArray(p) && p.every(row => object(row) && projectId(row.id)) ? p.map(row => row.id) : null,
      tasks: Array.isArray(t) && t.every(row => object(row) && TASK.test(row.id))
        ? t.map(row => ({ id: row.id, stage: String(row.stage), available: row.source === "available" })) : null,
    };
  };
}

/** No disk writes, remote fetch, command execution, last-good cache or independent timer. */
export function createDonorWorkReader(options: ReaderOptions = {}): () => Promise<DonorWorkData> {
  const now = options.now ?? Date.now;
  const readTargets = options.readTargets ?? targetReader();
  const empty = (state: "unconfigured" | "unavailable", error: string | null): DonorWorkData => ({ schema: 1, state, error, source: null, projects: [] });
  return async () => {
    const file = options.configFile ?? process.env.AB_DONOR_WORK_CONFIG;
    if (!file) return empty("unconfigured", null);
    let c: Config;
    try { c = config(JSON.parse((await readBounded(file, 256 * 1024)).toString("utf8"))); }
    catch { return empty("unavailable", "Work mapping is unavailable or invalid."); }
    let source: Record<string, any>, donor: Record<string, any>[];
    try {
      const bytes = await readBounded(c.snapshot.path, 2 * 1024 * 1024);
      if (digest(bytes) !== c.snapshot.sha256) throw new Error("snapshot revision changed");
      source = JSON.parse(bytes.toString("utf8"));
      donor = projects(source, c);
      if (Date.parse(source.capturedAt) > now() + 60_000) throw new Error("future capture");
    } catch { return empty("unavailable", "Work snapshot is unavailable, invalid or differs from its reviewed revision."); }
    const targets: DonorWorkTargets = await readTargets().catch(() => ({ projects: null, tasks: null }));
    const projectIds = targets.projects && unique(targets.projects) ? new Set(targets.projects) : null;
    const tasks = targets.tasks && unique(targets.tasks.map(t => t.id)) ? new Map<string, NonNullable<DonorWorkTargets['tasks']>[number]>(targets.tasks.map(t => [t.id, t])) : null;
    const snapshotRevision = c.snapshot.sha256;
    const ref = (projectId: string, taskId?: string): DonorWorkRef => ({ sourceId: c.source.id, sourceRevision: c.source.revision, snapshotRevision, projectId, ...(taskId ? { taskId } : {}) });
    const result = donor.map((p): DonorWorkProject => {
      const m = c.projects.find(row => row.donorProjectId === p.id);
      const destination: DonorDestination = !m ? { state: "unmapped" } : {
        projectId: m.projectId, state: !projectIds ? "unavailable" : projectIds.has(m.projectId) ? "mapped" : "missing",
      };
      return {
        key: JSON.stringify([c.source.id, p.id]), ref: ref(p.id), name: p.name, oneliner: p.oneliner ?? "", goal: p.goal ?? "",
        area: p.area, priority: p.priority ?? 2, stage: p.stage ?? "active", updatedAt: stamp(p.updated_at), destination,
        tasks: p.tasks.map((t: Record<string, any>): DonorWorkTask => {
          const mapped = m?.tasks.find(row => row.donorTaskId === t.id);
          const canonical = mapped ? tasks?.get(mapped.taskId) : null;
          return {
            key: JSON.stringify([c.source.id, p.id, t.id]), ref: ref(p.id, t.id), title: t.title, state: t.state,
            owner: t.owner, updatedAt: stamp(t.updated_at),
            destination: !mapped ? { state: "unmapped" } : {
              projectId: m!.projectId, taskId: mapped.taskId,
              state: destination.state !== "mapped" ? destination.state : !tasks ? "unavailable" : !canonical ? "missing" : canonical.available ? "mapped" : "unavailable",
              ...(canonical?.available ? { canonicalStage: canonical.stage } : {}),
            },
          };
        }),
      };
    });
    return {
      schema: 1, state: now() - Date.parse(source.capturedAt) > (c.maxAgeMs ?? DAY) ? "stale" : "ready", error: null,
      source: { id: c.source.id, revision: c.source.revision, snapshotRevision, capturedAt: source.capturedAt }, projects: result,
    };
  };
}
