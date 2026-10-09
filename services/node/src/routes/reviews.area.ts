import { readAsks } from "../asks.ts";
import { markOpened as openedReview, readReviewsCached } from "../reviews.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function reviewsRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json } = runtime;
      // Your asks: ASKS.json (AB_ASKS_FILE) merged with ASKS-STATUS.json beside it, newest first.
      if (url.pathname === "/api/asks" && req.method === "GET") return json(res, 200, await readAsks());
      // Reviews: the console's card list (AB_CONSOLE_URL), unopened first; opening one in the app records it.
      if (url.pathname === "/api/reviews" && req.method === "GET") return json(res, 200, await readReviewsCached());
      const rv = url.pathname.match(/^\/api\/reviews\/([^/]+)\/opened$/);
      if (rv && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        await openedReview(decodeURIComponent(rv[1]));
        return json(res, 200, { ok: true });
      }
      return false;
    },
  };
}
