import { handleProductMap, type SurfaceTask } from "../product-map.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function productMapRoutes(runtime: Pick<HttpRuntime, "a0Tasks">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { a0Tasks } = runtime;
      if (url.pathname === "/api/product-map" || url.pathname.startsWith("/api/product-map/")) {
        const index = await a0Tasks("/api/a0/tasks");
        const body = index?.body as { tasks?: SurfaceTask[]; error?: string } | undefined;
        if (await handleProductMap(req, res, { tasks: index?.status === 200 && Array.isArray(body?.tasks) ? body.tasks : undefined, tasksError: index?.status === 200 ? null : "Task source unavailable" })) return;
      }
      return false;
    },
  };
}
