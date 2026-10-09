import { applyPad, readPad } from "../scratchpad.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function scratchpadRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json, readBody } = runtime;
      // Agent Zero's scratch pad: today's pinned to-dos, one JSON file he and A0 both write (scratchpad.ts).
      if (url.pathname === "/api/scratchpad" && req.method === "GET") return json(res, 200, readPad());
      if (url.pathname === "/api/scratchpad" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: Record<string, unknown> = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered below */ }
        const r = applyPad(b);
        return json(res, "error" in r ? 400 : 200, r);
      }
      return false;
    },
  };
}
