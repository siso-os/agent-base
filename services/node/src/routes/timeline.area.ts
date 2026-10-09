import path from "node:path";
import { dayMoments, pipelineMoments, galleryFile, taskMoves, timelineOf } from "../timeline.ts";
import { DEFAULT_ROOT as A0_TASKS_ROOT } from "../a0-tasks.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function timelineRoutes(runtime: Pick<HttpRuntime, "TYPES" | "findSession" | "json" | "listAgents" | "sendStatic" | "sessionOf">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { TYPES, findSession, json, listAgents, sendStatic, sessionOf } = runtime;
      if (req.method === "GET" && url.pathname.startsWith("/api/timeline/gallery/")) {
        const relative = decodeURIComponent(url.pathname.slice("/api/timeline/gallery/".length));
        const file = galleryFile(relative);
        if (!file) return json(res, 404, { error: "Gallery evidence not found" });
        return sendStatic(req, res, file, (path.extname(file) === ".webp" ? "image/webp" : path.extname(file) === ".jpg" ? "image/jpeg" : TYPES[path.extname(file)] ?? "application/octet-stream"), "no-cache");
      }
      if (req.method === "GET" && ["/api/pipeline", "/api/timeline"].includes(url.pathname)) {
        const id = url.searchParams.get("agent");
        const agent = (await listAgents()).find(a => id ? a.id === id : a.zero);
        if (!agent) return json(res, 404, { error: "no such agent" });
        // A seat renamed by a suffix ("AGENT BASE UI" → "AGENT BASE") keeps its own ships and runs.
        const bare = (agent.name.split("| ").pop() ?? agent.name).trim();
        const who = agent.zero ? ["A0", "AGENT ZERO", agent.name] : [agent.name, bare, `${bare} UI`, bare.replace(/ UI$/i, "")];
        const scope = { all: !!agent.zero, who, session: sessionOf.get(agent.id), pane: agent.pane };
        if (url.pathname === "/api/pipeline") {
          const { pending, landed, unavailable } = pipelineMoments(scope);
          const midnight = new Date();
          midnight.setHours(0, 0, 0, 0);
          return json(res, 200, { pending, landed: landed.filter(m => Date.parse(m.t) >= midnight.getTime()), unavailable });
        }
        const day = url.searchParams.get("day") ?? new Date().toISOString().slice(0, 10);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) || !Number.isFinite(offset) || Math.abs(offset) > 840) return json(res, 400, { error: "invalid day or timezone offset" });
        const since = new Date(Date.parse(`${day}T00:00:00Z`) - offset * 60000).toISOString();
        return json(res, 200, dayMoments(day, offset, scope, await timelineOf(scope.session ? findSession(scope.session) : null, since, 2000), agent.pages ?? []));
      }
      // The right panel's Timeline (rightpanel SPEC §2.6): today's events from the agent's own session file, newest first.
      const tl = url.pathname.match(/^\/api\/agents\/([^/]+)\/timeline$/);
      if (tl && req.method === "GET") {
        const id = decodeURIComponent(tl[1]);
        const agent = (await listAgents()).find((a) => a.id === id);
        if (!agent) return json(res, 404, { error: "no such agent" });
        const session = sessionOf.get(id);
        const since = url.searchParams.get("since") ?? new Date(Date.now() - 24 * 3600_000).toISOString();
        // Its own steps, plus the tasks it moved (a0-task history, by its name; Agent Zero writes as A0).
        // A seat renamed by a suffix ("AGENT BASE UI" → "AGENT BASE") keeps its own ships and runs.
        const bare = (agent.name.split("| ").pop() ?? agent.name).trim();
        const who = agent.zero ? ["A0", "AGENT ZERO", agent.name] : [agent.name, bare, `${bare} UI`, bare.replace(/ UI$/i, "")];
        const events = [...await timelineOf(session ? findSession(session) : null, since), ...taskMoves(process.env.AB_A0_TASKS ?? A0_TASKS_ROOT, who, since)];
        return json(res, 200, { events: events.sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 250) });
      }
      return false;
    },
  };
}
