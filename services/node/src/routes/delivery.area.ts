import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function deliveryRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "deliveredWork" | "json" | "listAgents">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const origin = String(req.headers.origin ?? "");
      const { ALLOWED_ORIGINS, deliveredWork, json, listAgents } = runtime;
      if (url.pathname === "/api/delight") {
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app", deliveries: [] });
        if (req.method !== "GET") return json(res, 405, { error: "GET only", deliveries: [] });
        const key = url.searchParams.get("agent");
        if (!key || key.length > 600 || url.searchParams.size !== 1) return json(res, 400, { error: "One agent identity is required", deliveries: [] });
        const rows = (await listAgents()).filter(r => r.key === key || r.id === key);
        if (rows.length !== 1 || !rows[0].session) return json(res, 409, { error: "Delivery recipient is unavailable or changed", deliveries: [] });
        return json(res, 200, deliveredWork(key, rows[0].session));
      }
      return false;
    },
  };
}
