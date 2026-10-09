import { buildingCard, library } from "../library.ts";
import type { Route } from "./registry.ts";

/** The Library's read routes share its existing bounded readers and response contract. */
export function libraryRoute(readLibrary = library, readBuilding = buildingCard): Route {
  return {
    method: "GET",
    path: /^\/api\/library(?:\/(building))?$/,
    async handle(req, res, match) {
      const data = match[1]
        ? await readBuilding(new URL(req.url ?? "/", "http://localhost").searchParams.get("postcode"))
        : await readLibrary();
      const missing = match[1] && !data;
      res.writeHead(missing ? 404 : 200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(missing ? { error: "not a building on this machine" } : data));
    },
  };
}

export const route = libraryRoute();
