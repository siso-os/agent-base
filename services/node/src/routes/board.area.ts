import { createBoardWriter, readBoard, readSpec, type BoardWrite } from "../board.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

/** t-0567: the Agent Base task board. GET the five lanes (?days=N widens Landed), GET a card's spec, POST his writes. */
export function boardRoutes(runtime: Pick<HttpRuntime, "APP_ROOT" | "json" | "readBody">): Route {
  const write = createBoardWriter();
  return {
    method: null,
    path: /^\/api\/board\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { APP_ROOT, json, readBody } = runtime;
      if (url.pathname === "/api/board/agent-base" && req.method === "GET") {
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
        return json(res, 200, await readBoard(APP_ROOT, days));
      }
      const spec = /^\/api\/board\/agent-base\/spec\/(t-\d{1,6})$/.exec(url.pathname);
      if (spec && req.method === "GET") {
        const text = await readSpec(spec[1]);
        return text === null ? json(res, 404, { error: "No spec for that task" }) : json(res, 200, { id: spec[1], text });
      }
      if (url.pathname === "/api/board/agent-base" && req.method === "POST") {
        let body: BoardWrite;
        try { body = JSON.parse((await readBody(req, 16_000)) || "{}"); } catch { return json(res, 400, { ok: false, error: "Not JSON" }); }
        const r = await write(body);
        return json(res, r.status, r.body);
      }
      return false;
    },
  };
}
