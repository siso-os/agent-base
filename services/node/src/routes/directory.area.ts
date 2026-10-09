import { compactAtRows } from "../compact-at.ts";
import { readDispatch, fleetJobOutput } from "../fleet-board.ts";
import { fleetManifests, groupFleet } from "../fleet-board.ts";
import { agentNavigation, readRunParents } from "../agent-nav.ts";
import { navFromRecords } from "../agent-records.ts";
import { readFileSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { codexWorkers, codexWorkerRows } from "../codex-workers.ts";
import { fleetRuns, listSubagents } from "../subagents.ts";
import { applyOp as orgApply } from "../org.ts";
import { randomUUID } from "node:crypto";
import { migrateAgentPins, needsPinRows, projectAgentPins, type PinRow } from "../agent-pins.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function directoryRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "HERDR" | "MACHINE" | "MACHINE_KEY" | "addProject" | "json" | "listAgents" | "liveOrg" | "placeNew" | "readBody" | "registry" | "registryStore" | "saveRegistry">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, HERDR, MACHINE, MACHINE_KEY, addProject, json, listAgents, liveOrg, placeNew, readBody, registry, registryStore, saveRegistry } = runtime;
      if (url.pathname === "/api/health") return json(res, 200, { ok: true, herdr: HERDR.join(" "), machine: MACHINE });
      // t-0504: the laptop's free disk for A0's tree: low under 5 GB, full under 256 MB (hosts then keep state in memory).
      if (url.pathname === "/api/disk" && req.method === "GET") {
        try {
          const s = statfsSync(process.env.AB_DISK_PATH ?? homedir());
          const freeBytes = Number(s.bavail) * Number(s.bsize), totalBytes = Number(s.blocks) * Number(s.bsize);
          return json(res, 200, { freeBytes, totalBytes, low: freeBytes < 5 * 1024 ** 3, full: freeBytes < 256 * 1024 ** 2 });
        } catch (e) { return json(res, 500, { error: (e as Error).message }); }
      }
      // Projects in his dragged order, then the table's order for any he has not placed.
      const projects = () => registry.domains;
      const workspaceLogo = url.pathname.match(/^\/api\/workspace-logos\/([a-z0-9-]+)$/);
      if (workspaceLogo && req.method === "GET") {
        registryStore.fresh();
        const logo = registry.workspaces.find(w => w.id === workspaceLogo[1])?.logo;
        const base = path.resolve(process.env.AB_WORKSPACE_LOGOS_DIR ?? path.join(homedir(), "SISO_Workspace/_data/faces/logos"));
        if (!logo || path.dirname(path.resolve(logo)) !== base || !logo.endsWith(".svg")) return json(res, 404, { error: "Logo unavailable" });
        try {
          const svg = readFileSync(logo);
          res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
          return res.end(svg);
        } catch { return json(res, 404, { error: "Logo unavailable" }); }
      }
      if (url.pathname === "/api/workspace-registry" && req.method === "GET") {
        registryStore.fresh();
        return json(res, 200, { workspaces: registry.workspaces,
          taskIdentities: Object.fromEntries(Object.entries(registry.agents).map(([name, who]) => [name, { workspace: who.workspace, project: who.project }])),
          taskAliases: registry.aliases });
      }
      if (url.pathname === "/api/fleet-board/output" && req.method === "GET") {
        const text = await fleetJobOutput(url.searchParams.get("id") || "");
        return text === null ? json(res, 404, { error: "Unknown fleet job" }) : json(res, 200, { text });
      }
      if (url.pathname === "/api/fleet-board" && req.method === "GET") {
        const list = await listAgents();
        const parents = readRunParents();
        const rows = agentNavigation(list, codexWorkerRows(MACHINE), registry.agents, parents);
        // The runs are read once for every parent below (9 Oct: per parent it was ~78k stats per read, every 10 s).
        const runs = fleetRuns();
        // Claude/managed children retain their existing parent-specific drill route.
        for (const parent of list) {
          // One agent's sub-agents at a time, then back to the event loop: on 8 Oct the whole fleet in one go held the node
          // for 9.5 s on the first page load (t-0539), and every terminal and request waited behind it.
          await new Promise(setImmediate);
          for (const child of listSubagents(parent, list, { runs }).rows) {
            if (child.agentId && rows.some(r => r.id === child.agentId) || child.kind === "codex" && rows.some(r => r.name === child.name)) continue;
            rows.push({ id: `crew:${parent.id}:${child.id}`, name: child.name || child.type || "Sub-agent", parentId: parent.id,
              title: child.what || child.title || "Step unreported", status: child.status === "failed" ? "failed" : child.running ? "working" : child.quiet ? "idle" : "done",
              since: Date.parse(child.start || "") || null, machineKey: "laptop", crew: child, crewParentId: parent.id });
          }
        }
        const fleet = await fleetManifests();
        return json(res, 200, { groups: groupFleet(rows, fleet.manifests, registry.workspaces, readDispatch(), parents), miniEnabled: fleet.miniEnabled, miniAt: fleet.miniAt, error: fleet.error, at: Date.now() });
      }
      if (url.pathname === "/api/agents") {
        const list = await listAgents();
        registryStore.fresh();
        placeNew(list);
        const workers = codexWorkerRows(MACHINE);
        const runs = readRunParents();
        const navigation = await compactAtRows(agentNavigation(list, workers, registry.agents, runs));
        navFromRecords(navigation, registry.agents, MACHINE_KEY);
        // Navigation hides name-matched worker projections. Such observations still veto ambiguous pins.
        const identities = agentNavigation([...list, ...workers], [], registry.agents, runs);
        // Keep a same-name terminal's chat route while retaining its role worker's compact projection.
        for (const agent of navigation) {
          const role = workers.find(w => w.infrastructureRole && w.name.toUpperCase() === agent.name.toUpperCase());
          if (role) Object.assign(agent, { infrastructureRole: role.infrastructureRole, infrastructureSummary: role.infrastructureSummary });
        }
        if (migrateAgentPins(registry, identities, () => `pin-${randomUUID()}`)) saveRegistry();
        const projected = projectAgentPins(registry, navigation, identities);
        return json(res, 200, { ...projected, projects: projects(), domains: projects(), workspaces: registry.workspaces, pinnedPages: registry.pinnedPages, recentPages: registry.recentPages, at: Date.now() });
      }
      if (url.pathname.startsWith("/api/codex-workers/") && req.method === "GET") {
        const worker = codexWorkers().find(w => w.id === url.pathname.slice("/api/codex-workers/".length));
        return json(res, worker ? 200 : 404, worker ?? { error: "Worker not found" });
      }
      // The org tree for the three-group side nav and the dashboards (projects-owners/SIDENAV-GROUPS.md).
      if (url.pathname === "/api/org" && req.method === "GET") return json(res, 200, await liveOrg());
      if (url.pathname === "/api/org" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const b = JSON.parse((await readBody(req)) || "{}");
        registryStore.fresh();
        try {
          // Pin to Agency on a client, agency or industry with no project yet makes it a shown agency project (its folder is its id).
          if (b.op === "show" && typeof b.id === "string" && !registry.projects.some((p) => p.id === b.id) && /^SISO_Agency\//.test(b.id)) {
            const name = typeof b.to === "string" && b.to.trim() ? b.to.trim().slice(0, 80) : b.id.split("/").at(-1)!.replace(/[()]/g, "").split(/[-_]/).map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
            addProject(registry, name, { group: "agency", path: b.id, shown: true });
          } else Object.assign(registry, orgApply(registry, b));
          registry.domains = [...registry.projects].sort((a, b2) => a.order - b2.order).map((p) => p.name);
        } catch (e) {
          return json(res, 400, { error: (e as Error).message });
        }
        saveRegistry();
        return json(res, 200, { ok: true });
      }
      return false;
    },
  };
}

export function directoryWritesRoutes(runtime: Pick<HttpRuntime, "MACHINE" | "act" | "edit" | "freshRows" | "json" | "keyOf" | "listAgents" | "readBody" | "rows" | "saveRows">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { MACHINE, act, edit, freshRows, json, keyOf, listAgents, readBody, rows, saveRows } = runtime;
      if (url.pathname === "/api/registry" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'body is a JSON object' });
        let pinRows: PinRow[] | undefined;
        if (needsPinRows(b)) {
          try { pinRows = [...await listAgents(0), ...codexWorkerRows(MACHINE)]; }
          catch {
            // A configured owner slot remains pinnable while its runtime is unavailable.
            if (b.target?.kind !== 'owner') return json(res, 409, { error: 'Agent inventory is unavailable; no pin was changed' });
          }
        }
        const why = pinRows === undefined ? edit(b) : edit(b, pinRows);
        return why ? json(res, 400, { error: why }) : json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/order" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (Array.isArray(body.projects)) {
          if (!body.projects.every((x: unknown) => typeof x === "string")) return json(res, 400, { error: "projects is string[]" });
          freshRows();
          rows.projectOrder = body.projects.slice(0, 200);
          saveRows();
          return json(res, 200, { ok: true });
        }
        const ids = body.ids;
        if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return json(res, 400, { error: "body is {ids: string[]}" });
        if (ids.some((id) => !keyOf.has(id))) await listAgents(1000);
        freshRows();
        // His order is kept by key; agents not in this list (another machine offline) keep their place after it.
        const placed = ids.map((id) => keyOf.get(id)).filter((k): k is string => !!k);
        rows.order = [...new Set([...placed, ...rows.order.filter((k) => !placed.includes(k))])];
        saveRows();
        return json(res, 200, { ok: true });
      }
      const a = url.pathname.match(/^\/api\/agents\/([A-Za-z0-9_:-]+)\/(settle|unsettle|snooze|unsnooze|seen)$/);
      if (a && req.method === "POST") {
        const until = Number(url.searchParams.get("until"));
        if (!keyOf.has(a[1])) await listAgents(1000);
        const key = keyOf.get(a[1]);
        if (!key) return json(res, 404, { error: `no agent ${a[1]}` });
        return act(key, a[2], Number.isFinite(until) ? until : undefined) ? json(res, 200, { ok: true }) : json(res, 400, { error: "snooze needs ?until=<future ms>" });
      }
      return false;
    },
  };
}
