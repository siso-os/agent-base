import { remoteInventoryRoute } from "../remote-inventory.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function remoteInventoryRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "remoteInventory">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, remoteInventory } = runtime;
      if (await remoteInventoryRoute(remoteInventory, ALLOWED_ORIGINS)(req, res, url)) return;
      return false;
    },
  };
}
