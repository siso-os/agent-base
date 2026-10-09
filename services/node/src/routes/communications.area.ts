import { everyone as rolodexEveryone, list as rolodexList, lookup as rolodexLookup, sources as rolodexSources } from "../rolodex.ts";
import { proxy as whatsappProxy, rolodexContacts, whatsappPeople } from "../whatsapp.ts";
import { change as bookChange, view as bookView } from "../rolodex-book.ts";
import { proxy as lifeProxy } from "../life.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function communicationsRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "LIFE" | "WHATSAPP" | "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, LIFE, WHATSAPP, json, readBody } = runtime;
      if (url.pathname === "/api/rolodex") {
        // Last contact and message counts come from the WhatsApp link when it is set up (names matched exactly; no bodies).
        const home = process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {};
        const names = rolodexList(home).map((p) => p.name);
        const wa = await whatsappPeople(WHATSAPP);
        return json(res, 200, rolodexList({ ...home, contacts: rolodexContacts(names, wa) }));
      }
      // Rolodex v2 (spec rolodex §4-§5): where the answer comes from, the WhatsApp-only tier, and agents' one-line lookup.
      if (url.pathname === "/api/rolodex/sources" && req.method === "GET") {
        return json(res, 200, rolodexSources(process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {}));
      }
      if (url.pathname === "/api/rolodex/everyone" && req.method === "GET") {
        const home = process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {};
        const limit = Number(url.searchParams.get("limit") ?? 200);
        const contacts = rolodexContacts(rolodexList(home).map((p) => p.name), await whatsappPeople(WHATSAPP));
        return json(res, 200, rolodexEveryone({ ...home, contacts }, { q: (url.searchParams.get("q") ?? "").slice(0, 200), limit: Number.isFinite(limit) ? limit : 200 }));
      }
      if (url.pathname === "/api/rolodex/lookup" && req.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q || q.length > 200) return json(res, 400, { error: "q is required, at most 200 characters" });
        const home = process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {};
        const contacts = rolodexContacts(rolodexList(home).map((p) => p.name), await whatsappPeople(WHATSAPP));
        return json(res, 200, rolodexLookup({ ...home, contacts }, q));
      }
      // Rolodex v3 (ROLODEX, 7 Oct): the book. His facts live in a private local file; WhatsApp metadata comes live, no bodies.
      if (url.pathname === "/api/rolodex/book") {
        const home = process.env.AB_ROLODEX_HOME ? { home: process.env.AB_ROLODEX_HOME } : {};
        const wa = await whatsappPeople(WHATSAPP);
        if (req.method === "GET") {
          try { return json(res, 200, bookView(wa, !!WHATSAPP && wa.length > 0, home)); }
          catch (e) { return json(res, 500, { error: (e as Error).message }); }
        }
        if (req.method === "POST") {
          const origin = String(req.headers.origin ?? "");
          if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
          try { return json(res, 200, bookChange(JSON.parse((await readBody(req)) || "{}"), wa, home)); }
          catch (e) { const status = (e as { status?: number }).status; return json(res, status && status >= 400 && status < 500 ? status : 500, { error: (e as Error).message }); }
        }
        return json(res, 405, { error: "GET or POST" });
      }
      // The WhatsApp space: a narrow proxy to siso-whatsapp-link on the Mac mini. Hidden in the app until it is configured.
      if (url.pathname === "/api/whatsapp" || url.pathname.startsWith("/api/whatsapp/")) {
        const origin = String(req.headers.origin ?? "");
        const fromApp = !!origin && ALLOWED_ORIGINS.has(origin);
        const body = req.method === "POST" ? await readBody(req) : undefined;
        return whatsappProxy(req, res, url, WHATSAPP, fromApp, body);
      }
      // The Life space: a narrow proxy to siso-life (his Life tracker API on siso-vps). Hidden in the app until it is configured.
      if (url.pathname === "/api/life" || url.pathname.startsWith("/api/life/")) {
        const origin = String(req.headers.origin ?? "");
        const fromApp = !!origin && ALLOWED_ORIGINS.has(origin);
        const body = req.method === "POST" ? await readBody(req) : undefined;
        return lifeProxy(req, res, url, LIFE, fromApp, body);
      }
      return false;
    },
  };
}
