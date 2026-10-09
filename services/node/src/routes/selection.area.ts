import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function selectionRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "SELECTION_LOG" | "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, SELECTION_LOG, json, readBody } = runtime;
      // t-0265: every change of the open agent, as the app records it (lib/selection.ts): names and causes only.
      if (url.pathname === "/api/selection" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: any;
        try {
          b = JSON.parse((await readBody(req)) || "{}");
        } catch {
          return json(res, 400, { error: "not JSON" });
        }
        const name = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : null);
        if (typeof b?.cause !== "string" || !/^[a-z-]{2,24}$/.test(b.cause)) return json(res, 400, { error: "cause is required" });
        const row = { at: typeof b.at === "number" ? new Date(b.at).toISOString() : new Date().toISOString(), from: name(b.from), to: name(b.to), cause: b.cause, ...(["typing", "own-click", "no-click"].includes(b.blocked) ? { blocked: b.blocked } : {}) };
        try {
          mkdirSync(path.dirname(SELECTION_LOG), { recursive: true });
          appendFileSync(SELECTION_LOG, JSON.stringify(row) + "\n");
        } catch (e) {
          return json(res, 500, { error: String((e as Error).message).slice(0, 120) });
        }
        return json(res, 200, { ok: true });
      }
      return false;
    },
  };
}
