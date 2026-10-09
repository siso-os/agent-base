import { openApp, revealBuilding } from "../library.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function libraryActionsRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json, readBody } = runtime;
      // R1.24: the Library rail tool (Built · Live · Works), reusing the live Great Library and template-bank sites.
      if (url.pathname === "/api/library/open-app" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const r = await openApp(JSON.parse((await readBody(req)) || "{}").id);
        return json(res, r.status, r);
      }
      if (url.pathname === "/api/library/reveal" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const r = await revealBuilding(JSON.parse((await readBody(req)) || "{}").postcode);
        return json(res, r.status, r);
      }
      return false;
    },
  };
}
