import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function feedbackRoutes(runtime: Pick<HttpRuntime, never>): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      if (req.method === "POST" && url.pathname === "/api/feedback") return (await import("../feedback.ts")).feedback(req, res);
      return false;
    },
  };
}
