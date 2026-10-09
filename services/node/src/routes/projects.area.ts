import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readTasks } from "../tasks.ts";
import { list as rolodexList } from "../rolodex.ts";
import { buildEntityPage, thumbPath } from "../pages.ts";
import { isPrivatePath } from "../org.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function projectsRoutes(runtime: Pick<HttpRuntime, "json" | "listAgents" | "liveOrg" | "registry">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { json, listAgents, liveOrg, registry } = runtime;
      // A project's task folders (<its repo>/.agents/tasks/*/; Agent Base's live in the agents repo), T6 OwnerTasks.
      if (url.pathname === "/api/tasks") {
        const id = url.searchParams.get("project") ?? "";
        const p = registry.projects.find((x) => x.id === id || x.name === id);
        if (!p?.path) return json(res, 404, { error: `no project folder for ${id}` });
        const dir = path.isAbsolute(p.path) ? p.path : path.join(homedir(), "SISO_Workspace", p.path);
        return json(res, 200, { project: p.id, tasks: readTasks(dir) });
      }
      const op = url.pathname.match(/^\/api\/org\/project\/(.+)$/);
      if (op) {
        const id = decodeURIComponent(op[1]);
        const org = await liveOrg();
        let p: any = org.groups.flatMap((g: any) => g.projects.map((x: any) => ({ ...x, groupName: g.name }))).find((x: any) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
        // A client he has not shown, or a Rolodex project: its page still opens (its door, no owners yet).
        let client: any = null;
        if (!p) {
          const low = id.toLowerCase();
          client = org.groups.flatMap((g: any) => g.folders.flatMap((f: any) => f.items)).find((c: any) => c.id === id || c.name.toLowerCase() === low || c.id.split("/").at(-1)?.toLowerCase() === low);
          const rolo = client ? null : rolodexList(process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {}).flatMap((r: any) => r.projects).find((x: any) => x.name.toLowerCase() === low || x.id.toLowerCase() === low);
          if (client) p = { id: client.id, name: client.name, group: "agency", groupName: "SISO Agency", path: client.folder ?? client.id, line: client.note, status: client.stage ?? client.kind, client, owners: [], shown: false };
          else if (rolo) p = { id: rolo.id, name: rolo.name, group: "agency", groupName: "SISO Agency", path: path.join(process.env.AB_ROLODEX_HOME ?? homedir(), "SISO_Workspace", "SISO_Agency", "clients", rolo.folder), owners: [], shown: false };
        }
        // A registry-backed client still has the same rich entity page as its catalog identity.
        if (p && !client) client = org.groups.flatMap(g => g.folders.flatMap(f => f.items)).find(c => c.project === p.id || c.id === p.id) ?? null;
        if (!p) return json(res, 404, { error: `no project ${id}` });
        // Its front door: the first table of its AGENTS.md (where it sits, repo, run it, write here), read-only.
        let door: string | null = null;
        try {
          // His personal folders (Family's Property, Trading for Dad) are placed by path only: never read into a page.
          const dir = p.path && !isPrivatePath(p.path) ? (path.isAbsolute(p.path) ? p.path : path.join(homedir(), "SISO_Workspace", p.path)) : "-";
          const md = readFileSync(path.join(dir, "AGENTS.md"), "utf8").split("\n");
          const start = md.findIndex((l) => l.startsWith("|"));
          if (start >= 0) door = md.slice(start, start + 24).filter((l, i, all) => l.startsWith("|") && all.slice(0, i).every((x) => x.startsWith("|"))).join("\n");
        } catch {
          /* no door here */
        }
        // An industry or client gets its page (project-pages spec v2): owner, stats, live pages, work, people, sources.
        let page = null;
        if (client) {
          try {
            const live = (await listAgents()).map((a) => ({ name: a.name, cwd: a.cwd, status: a.status }));
            page = await buildEntityPage(client, { home: process.env.AB_ORG_HOME ?? homedir(), items: org.groups.flatMap((g: any) => g.folders.flatMap((f: any) => f.items)), agents: Object.entries(registry.agents), live, people: rolodexList(process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {}) });
          } catch {
            /* the page falls back to its door */
          }
        }
        return json(res, 200, { ...p, ...(client ? { client } : {}), door, page });
      }
      // A screenshot for an industry or client page: only one `thumbsOf` lists, inside that item's folder.
      if (url.pathname === "/api/org/thumb" && req.method === "GET") {
        const file = thumbPath(process.env.AB_ORG_HOME ?? homedir(), url.searchParams.get("folder") ?? "", url.searchParams.get("file") ?? "");
        if (!file) return json(res, 404, { error: "no such thumbnail" });
        res.writeHead(200, { "content-type": /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png", "cache-control": "max-age=600" });
        return void res.end(readFileSync(file));
      }
      return false;
    },
  };
}
