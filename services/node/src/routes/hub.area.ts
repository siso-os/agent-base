import { spend as spendToday } from "../spend.ts";
import { buildA0 as buildHubA0, buildAgents as buildHubAgents, buildProject as buildHubProject, buildOrg as buildHubOrg } from "../hub.ts";
import { buildOrgTour } from "../org-tour.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function hubRoutes(runtime: Pick<HttpRuntime, "hubCached" | "hubHome" | "hubRows" | "json">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { hubCached, hubHome, hubRows, json } = runtime;
      // hub-1's data (HUB-DESIGN): the hover cards (hub-5) and Agent Zero's page (hub-6). Read-only.
      const hubAgents = () => hubCached("agents", async () => buildHubAgents({ ...hubHome, herdr: await hubRows() }));
      if (url.pathname === "/api/hub/agents") return json(res, 200, { agents: await hubAgents() });
      // A project's dashboard (hub-4); null for a project hub-1 has no plan map for (the org page shows those).
      const hp = url.pathname.match(/^\/api\/hub\/project\/([^/]+)$/);
      if (hp) {
        const id = decodeURIComponent(hp[1]);
        const project = await hubCached(`project:${id}`, async () => buildHubProject(id, { ...hubHome, agents: await hubAgents() }));
        if (!project) return json(res, 404, { error: "no dashboard for this project" });
        // Its share of today's spend (ab-142), when the meter has it; Codex credits as the top of the meter's range.
        const report = await spendToday().catch(() => null);
        const rows = report?.source === "stack-opt" ? ((report.data as { projects?: { project: string; claude_usd_equiv: number; codex_credits: [number, number] }[] }).projects ?? []) : [];
        const mine = rows.find((r) => r.project.toLowerCase() === project.name.toLowerCase() || r.project.toLowerCase() === id.toLowerCase());
        return json(res, 200, mine ? { ...project, spendToday: { claudeUsdEquiv: mine.claude_usd_equiv, codexCredits: mine.codex_credits[1] } } : project);
      }
      if (url.pathname === "/api/org/tour" && req.method === "GET") {
        const agents = await hubAgents();
        const org = await hubCached("org-tour-org", () => buildHubOrg({ ...hubHome, agents }));
        const a0 = await hubCached("a0", () => buildHubA0(hubHome));
        return json(res, 200, buildOrgTour(org, a0.needsYou.length));
      }
      if (url.pathname === "/api/hub/a0") return json(res, 200, await hubCached("a0", () => buildHubA0(hubHome)));
      // hub-7's org chart, opened from Agent Zero's summary card.
      if (url.pathname === "/api/hub/org") return json(res, 200, await hubCached("org", async () => buildHubOrg({ ...hubHome, agents: await hubAgents() })));
      return false;
    },
  };
}
