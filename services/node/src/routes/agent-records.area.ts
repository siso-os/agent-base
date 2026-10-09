// t-0562: the one API for agent records. GET lists exactly what the nav reads (live and planned agents, each once, with the
// unplaced ones Agent Zero still has to place); POST sets identity and placement, or an owner's own card words.
import { listServiceHosts } from "../service-hosts.ts";
import { archiveShadowed, readCards, reconcile, writeCard, type AgentRecord } from "../agent-records.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

const IDENTITY = ["label", "project", "owner", "kind", "workspace", "machine", "harness", "model", "login", "compactAt", "mode"] as const;
let archivedAt = 0;

export function agentRecordsRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "HOSTS_DIR" | "MACHINE_KEY" | "addProject" | "json" | "listAgents" | "readBody" | "registry" | "registryStore" | "saveRegistry">): Route {
  return {
    method: null,
    path: /^\/api\/agent-records$/,
    async handle(req, res) {
      const { ALLOWED_ORIGINS, HOSTS_DIR, MACHINE_KEY, addProject, json, listAgents, readBody, registry, registryStore, saveRegistry } = runtime;
      const read = async () => {
        registryStore.fresh();
        const rows = await listAgents() as unknown as { name: string }[];
        return reconcile({ registry: registry.agents, rows, cards: readCards(), machine: MACHINE_KEY });
      };
      if (req.method === "GET") {
        // The reconciler's one write: dead copies the resolver already hides go to the archive, at most every 10 minutes.
        if (Date.now() - archivedAt > 10 * 60_000) {
          archivedAt = Date.now();
          const kept = new Set((await listServiceHosts({ dir: HOSTS_DIR })).map(h => h.file));
          registryStore.fresh();
          archiveShadowed(HOSTS_DIR, kept, { registry: registry.agents });
        }
        const { records, stale } = await read();
        return json(res, 200, { records, unplaced: records.filter(r => r.placed === "unplaced").map(r => r.name), conflicts: records.filter(r => r.conflicts.length).map(r => ({ name: r.name, conflicts: r.conflicts })), stale, at: Date.now() });
      }
      if (req.method !== "POST") return json(res, 405, { error: "GET or POST" });
      const origin = String(req.headers.origin ?? "");
      if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
      let b: Record<string, any>;
      try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return json(res, 400, { error: "body must be JSON" }); }
      const { records } = await read();
      const record: AgentRecord | undefined = records.find(r => r.id === String(b.name ?? "").trim().toUpperCase());
      if (!record) return json(res, 404, { error: `no agent named ${String(b.name ?? "").slice(0, 80) || "(none)"}` });
      const set = b.set && typeof b.set === "object" ? b.set as Record<string, unknown> : {}, card = b.card && typeof b.card === "object" ? b.card as Record<string, unknown> : null;
      const unknown = Object.keys(set).filter(k => !(IDENTITY as readonly string[]).includes(k));
      if (unknown.length) return json(res, 400, { error: `cannot set ${unknown.join(", ")}; settable: ${IDENTITY.join(", ")}` });
      // Validate everything before writing anything.
      const text = (k: string, max: number) => set[k] === undefined ? undefined : typeof set[k] === "string" ? (set[k] as string).trim().slice(0, max) : null;
      const values: Record<string, unknown> = {};
      for (const k of ["label", "harness", "model", "login", "mode", "machine"] as const) { const v = text(k, k === "label" ? 300 : 60); if (v === null) return json(res, 400, { error: `${k} must be text` }); if (v !== undefined) values[k] = v || undefined; }
      if (set.project !== undefined) {
        const p = text("project", 60);
        if (p && !registry.projects.some(x => x.name === p)) return json(res, 400, { error: `unknown project ${p}; known: ${registry.projects.map(x => x.name).join(", ")}` });
        values.project = p || undefined;
      }
      if (set.owner !== undefined) {
        const o = text("owner", 80);
        const owner = o ? records.find(r => r.id === o.toUpperCase()) : null;
        if (o && !owner) return json(res, 400, { error: `no agent named ${o} to own it` });
        if (owner && owner.id === record.id) return json(res, 400, { error: "an agent cannot own itself" });
        values.owner = owner?.name;
      }
      if (set.kind !== undefined) { if (set.kind !== "owner" && set.kind !== "worker") return json(res, 400, { error: "kind is owner or worker" }); values.kind = set.kind; }
      if (set.workspace !== undefined) { const w = text("workspace", 80); if (w && !registry.workspaces.some(x => x.id === w)) return json(res, 400, { error: `unknown workspace ${w}` }); values.workspace = w || undefined; }
      if (set.compactAt !== undefined) { const n = set.compactAt; if (n !== null && !(typeof n === "number" && n >= 10 && n <= 95)) return json(res, 400, { error: "compactAt is a percent from 10 to 95, or null" }); values.compactAt = n ?? undefined; }
      const cardFields: { summary?: string; needsYou?: string[]; links?: string[] } = {};
      if (card) {
        if (card.summary !== undefined) { if (typeof card.summary !== "string") return json(res, 400, { error: "card.summary must be text" }); cardFields.summary = card.summary.trim(); }
        for (const k of ["needsYou", "links"] as const) if (card[k] !== undefined) {
          if (!Array.isArray(card[k]) || (card[k] as unknown[]).some(x => typeof x !== "string")) return json(res, 400, { error: `card.${k} must be a list of text` });
          cardFields[k] = (card[k] as string[]).map(s => s.trim()).filter(Boolean);
        }
        if (cardFields.links?.some(l => !/^https?:\/\/\S+$/.test(l))) return json(res, 400, { error: "card.links must be http(s) URLs" });
      }
      if (!Object.keys(values).length && !Object.keys(cardFields).length) return json(res, 400, { error: "nothing to set" });
      if (Object.keys(values).length) {
        registryStore.fresh();
        const cur = (registry.agents[record.name] ??= {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(values)) { if (v === undefined) delete cur[k]; else cur[k] = v; }
        if (typeof values.project === "string") addProject(registry, values.project);
        if (values.owner && !values.kind) cur.kind = "worker";
        // Any placement he or Agent Zero sets is set: the record stops being unplaced or guessed.
        if (["project", "owner", "workspace", "kind"].some(k => k in values)) { delete cur.placed; delete cur.seen; }
        saveRegistry();
      }
      if (Object.keys(cardFields).length) {
        const error = writeCard(record.name, cardFields, { title: record.label ?? record.name });
        if (error) return json(res, 400, { error });
      }
      const after = (await read()).records.find(r => r.id === record.id);
      return json(res, 200, { ok: true, record: after });
    },
  };
}
