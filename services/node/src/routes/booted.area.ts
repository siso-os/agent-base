import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";
import { recordBooted, recordCrash, bootState } from "../booted.ts";

const SHA_REGEX = /^[0-9a-f]{7,40}$|^dev$/;
const MAX_BODY_SIZE = 4096;

export function bootedRoutes(
  runtime: Pick<HttpRuntime, "json" | "readBody">
): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { json, readBody } = runtime;

      // POST /api/booted - record that a page has booted
      if (url.pathname === "/api/booted" && req.method === "POST") {
        try {
          const body = await readBody(req, MAX_BODY_SIZE);
          const data = JSON.parse(body);
          const sha = String(data.sha ?? "");

          if (!SHA_REGEX.test(sha)) {
            return json(res, 400, { error: "invalid sha" });
          }

          recordBooted(sha);
          return json(res, 200, { ok: true });
        } catch (e) {
          if ((e as Error).message === "body too large") {
            return json(res, 413, { error: "body too large" });
          }
          return json(res, 400, { error: "invalid request" });
        }
      }

      // POST /api/booted/crash - record a crash from a page
      if (url.pathname === "/api/booted/crash" && req.method === "POST") {
        try {
          const body = await readBody(req, MAX_BODY_SIZE);
          const data = JSON.parse(body);
          const sha = String(data.sha ?? "");
          const name = String(data.name ?? "");
          const message = String(data.message ?? "");

          if (!SHA_REGEX.test(sha)) {
            return json(res, 400, { error: "invalid sha" });
          }

          recordCrash(sha, name, message);
          return json(res, 200, { ok: true });
        } catch (e) {
          if ((e as Error).message === "body too large") {
            return json(res, 413, { error: "body too large" });
          }
          return json(res, 400, { error: "invalid request" });
        }
      }

      // GET /api/booted?sha=<sha> - get boot state for a SHA
      if (url.pathname === "/api/booted" && req.method === "GET") {
        const sha = url.searchParams.get("sha") ?? "";

        if (!SHA_REGEX.test(sha)) {
          return json(res, 400, { error: "invalid sha" });
        }

        const state = bootState(sha);
        if (!state) {
          return json(res, 404, { error: "not found" });
        }

        return json(res, 200, state);
      }

      return false;
    },
  };
}
