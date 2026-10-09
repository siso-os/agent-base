import { tellA0 } from "../a0-tasks.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function taskEventsRoutes(runtime: Pick<HttpRuntime, "a0TaskEvents">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { a0TaskEvents } = runtime;
      if (url.pathname === "/api/a0/tasks/events" && req.method === "GET") return a0TaskEvents(req, res);
      return false;
    },
  };
}

export function tasksRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "a0TaskWrite" | "a0Tasks" | "a0Transcript" | "json" | "readBody" | "taskActions">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const origin = String(req.headers.origin ?? "");
      const { ALLOWED_ORIGINS, a0TaskWrite, a0Tasks, a0Transcript, json, readBody, taskActions } = runtime;
      if (url.pathname === "/api/a0/tell" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { ok: false, error: "not this app" });
        const body = JSON.parse((await readBody(req)) || "{}");
        const told = await tellA0(String(body.text ?? ""), body.project);
        return json(res, told.ok ? 200 : 400, told);
      }
      // R1.17: his edits from an owner's Tasks list (stage, priority, next, drop), through the a0-task CLI only.
      const taskEdit = /^\/api\/a0\/tasks\/([^/]+)$/.exec(url.pathname);
      if (taskEdit && taskEdit[1] !== "events" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let edit: unknown;
        try {
          edit = JSON.parse((await readBody(req)) || "{}");
        } catch {
          return json(res, 400, { ok: false, error: "Not JSON" });
        }
        let id = "";
        try {
          id = decodeURIComponent(taskEdit[1]);
        } catch {}
        const r = await a0TaskWrite(id, edit && typeof edit === "object" ? (edit as Record<string, unknown>) : {});
        return json(res, r.status, r.body);
      }
      // t-0259: his words to Agent Zero, a day at a time (?before=YYYY-MM-DD pages back), and the intent file each became.
      if (url.pathname === "/api/a0/transcript" && req.method === "GET") return json(res, 200, await a0Transcript.page(url.searchParams.get("before")));
      const intent = /^\/api\/a0\/intent\/([^/]+)$/.exec(url.pathname);
      if (intent && req.method === "GET") {
        const hit = a0Transcript.intent(decodeURIComponent(intent[1]));
        return hit ? json(res, 200, hit) : json(res, 404, { error: "no such intent file" });
      }
      const taskAction = /^\/api\/a0\/tasks\/(t-[A-Za-z0-9_-]{1,61})\/(actions|allocate)$/.exec(url.pathname);
      if (taskAction) {
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        if (taskAction[2] === "actions" && req.method === "GET") {
          const result = await taskActions.readiness(taskAction[1]);
          return json(res, result.status, result.body);
        }
        if (taskAction[2] === "allocate" && req.method === "POST") {
          let body: unknown;
          try { body = JSON.parse(await readBody(req, 8192)); } catch { return json(res, 400, { error: "Invalid allocation request" }); }
          const result = await taskActions.allocate(taskAction[1], body);
          return json(res, result.status, result.body);
        }
        return json(res, 405, { error: taskAction[2] === "actions" ? "GET only" : "POST only" });
      }
      if (url.pathname.startsWith("/api/a0/tasks") && req.method === "GET") {
        const r = await a0Tasks(url.pathname);
        if (r) return json(res, r.status, r.body);
      }
      return false;
    },
  };
}
