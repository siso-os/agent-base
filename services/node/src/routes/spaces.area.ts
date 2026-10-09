import { agentNavigation, readRunParents } from "../agent-nav.ts";
import { homedir } from "node:os";
import { spaceAgents, resolveSpace } from "../spaces.ts";
import { codexWorkerRows } from "../codex-workers.ts";
import { agencyFolders, migrate as orgMigrate, readers as orgReaders, type Project as OrgProj } from "../org.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function spacesRoutes(runtime: Pick<HttpRuntime, "MACHINE" | "json" | "listAgents" | "readBody" | "registry" | "spaces">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { MACHINE, json, listAgents, readBody, registry, spaces } = runtime;
      const spaceRoute = /^\/api\/spaces\/([^/]+)(?:\/(layout|pins))?$/.exec(url.pathname);
      if (spaceRoute) {
        try {
          const requested = decodeURIComponent(spaceRoute[1]);
          const approved = orgMigrate(registry).projects as OrgProj[];
          let identity: ReturnType<typeof resolveSpace>;
          try { identity = resolveSpace(requested, approved, []); }
          catch (e) {
            if (!(e instanceof TypeError) || e.message !== 'Unknown project') throw e;
            // Only catalog identities need these small metadata reads; never load every owner's plans/logs per poll.
            const read = orgReaders(process.env.AB_ORG_HOME ?? homedir());
            const [clients, industries] = await Promise.all([read.clients!(), read.industries!()]);
            identity = resolveSpace(requested, approved, agencyFolders(clients, industries, approved).flatMap(f => f.items));
          }
          const id = identity.key;
          if (req.method === "GET" && !spaceRoute[2]) {
            const all = agentNavigation(await listAgents(), codexWorkerRows(MACHINE), registry.agents, readRunParents());
            return json(res, 200, { ...spaces.read(id, spaceAgents(identity.id, identity.name, all), identity.repo), project: identity.id });
          }
          if (req.method === "PUT" && (!spaceRoute[2] || spaceRoute[2] === "layout")) return json(res, 200, { layout: spaces.patch(id, JSON.parse(await readBody(req))) });
          if (req.method === "POST" && spaceRoute[2] === "pins") return json(res, 201, spaces.addPin(id, JSON.parse(await readBody(req, 4_000_000))));
          return json(res, 405, { error: "Use GET space, PUT layout or POST pins" });
        } catch (e) { return json(res, e instanceof TypeError || e instanceof SyntaxError ? 400 : 500, { error: (e as Error).message }); }
      }
      return false;
    },
  };
}
