import { sleepSummary, controlSleep } from '../host-sleep.ts';
import { listServiceHosts } from '../service-hosts.ts';
import { listSubagents, subagentEvents } from "../subagents.ts";
import { contextMix } from "../context-mix.ts";
import { sessionFile } from "../transcript.ts";
import { readWorkingBrief } from "../working-brief.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function agentSessionRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "MACHINE_KEY" | "cwdOf" | "forkChat" | "json" | "listAgents" | "listEnded" | "machines" | "readBody" | "sayTo" | "sessionOf" | "talkTo">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, MACHINE_KEY, cwdOf, forkChat, json, listAgents, listEnded, machines, readBody, sayTo, sessionOf, talkTo } = runtime;
      if (url.pathname === '/api/host-sleep' && req.method === 'GET') return json(res, 200, sleepSummary());
      const sleep = url.pathname.match(/^\/api\/agents\/([^/]+)\/sleep$/);
      if (sleep && req.method === 'POST') {
        if (!ALLOWED_ORIGINS.has(String(req.headers.origin ?? ''))) return json(res, 403, { error: 'not this app' });
        let body: any; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'not JSON' }); }
        if (body.action !== 'wake' && !(body.action === 'keep-awake' && typeof body.value === 'boolean')) return json(res, 400, { error: 'Unknown sleep control' });
        const agent = (await listAgents()).find(a => a.id === decodeURIComponent(sleep[1]));
        if (!agent || agent.machineKey !== MACHINE_KEY || !agent.session) return json(res, 404, { error: 'No local hosted chat' });
        const hosts = (await listServiceHosts()).filter(h => h.session === agent.session && (agent.pane ? h.pane === agent.pane : !h.pane && (agent.id === `service-${h.name}` || agent.name === h.name)));
        if (hosts.length !== 1) return json(res, 409, { error: 'Host identity unavailable' });
        try { await controlSleep(hosts[0], body.action === 'keep-awake' ? body.value : undefined); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 503, { error: (e as Error).message }); }
      }
      const brief = url.pathname.match(/^\/api\/agents\/([^/]+)\/working-brief$/);
      if (brief && req.method === 'GET') {
        const agent = (await listAgents()).find(a => a.id === decodeURIComponent(brief[1]));
        if (!agent) return json(res, 404, { error: 'No such agent' });
        res.setHeader('Cache-Control', 'no-store');
        if (agent.machineKey !== MACHINE_KEY) return json(res, 200, { state: 'unavailable', source: null, updated: null, heading: null, text: null, truncated: false });
        return json(res, 200, readWorkingBrief(agent.cwd));
      }
      if (url.pathname === "/api/ended" && req.method === "GET") return json(res, 200, { ended: listEnded(Math.min(500, Number(url.searchParams.get("limit") ?? 200) || 200)) });
      if (url.pathname === "/api/machines") return json(res, 200, { machines: machines(), here: MACHINE_KEY });
      const sa = url.pathname.match(/^\/api\/agents\/([^/]+)\/subagents$/);
      if (sa && req.method === "GET") {
        const agents = await listAgents();
        const parent = agents.find((a) => a.id === decodeURIComponent(sa[1]));
        if (!parent) return json(res, 404, { error: "no such agent" });
        return json(res, 200, { ...listSubagents(parent, agents), session: parent.session ?? null });
      }
      const sx = url.pathname.match(/^\/api\/agents\/([^/]+)\/subagents\/([^/]+)$/);
      if (sx && req.method === "GET") {
        const agents = await listAgents();
        const parent = agents.find((a) => a.id === decodeURIComponent(sx[1]));
        if (!parent) return json(res, 404, { error: "no such agent" });
        const out = subagentEvents(parent, decodeURIComponent(sx[2]));
        return out ? json(res, 200, out) : json(res, 404, { error: "no such sub-agent" });
      }
      // "@CODEX-2 also check 390" from a chat (ui-hub VISION §7B): the message goes to that worker's own chat. A live chat
      // gets it through its socket, as the app sends one; a finished worker is reopened with it as its first message.
      if (url.pathname === "/api/agents/say" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: any;
        try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "not JSON" }); }
        const name = typeof b?.name === "string" ? b.name.trim() : "", text = typeof b?.text === "string" ? b.text.trim().slice(0, 100_000) : "";
        if (!name || !text) return json(res, 400, { error: "say who and what" });
        const r = await sayTo(typeof b.parent === "string" ? b.parent : "", name, text);
        return "error" in r ? json(res, r.code, { error: r.error }) : json(res, 200, r);
      }
      // Talk to a worker (4 Oct: "it should actually open with the SDK so I can actually like message him"): a Sol reopens its
      // Codex thread as a live chat; a Claude sub-agent becomes a chat seeded with its brief and result. The app splits it in.
      const tk = url.pathname.match(/^\/api\/agents\/([^/]+)\/subagents\/([^/]+)\/talk$/);
      if (tk && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const r = await talkTo(decodeURIComponent(tk[1]), decodeURIComponent(tk[2]));
        return "error" in r ? json(res, r.code, { error: r.error }) : json(res, 200, r);
      }
      // Next-move chips (ideas r2 #5): after a reply, Haiku guesses his three likeliest next asks; one call per reply, cached.
      // Fork a chat from one of his turns (ideas r2 #7): a new chat beside it, the old one untouched.
      const fk = url.pathname.match(/^\/api\/agents\/([^/]+)\/fork$/);
      if (fk && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: any = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return json(res, 400, { error: "not JSON" }); }
        const r = await forkChat(decodeURIComponent(fk[1]), Number.isInteger(b.back) && b.back >= 0 ? b.back : 0);
        return "error" in r ? json(res, r.code, { error: r.error }) : json(res, 200, r);
      }
      // What is filling a chat's context, for its ctx ring's card (ui-hub ideas round 2 #2).
      const cm = url.pathname.match(/^\/api\/agents\/([^/]+)\/context$/);
      if (cm && req.method === "GET") {
        const id = decodeURIComponent(cm[1]);
        if (!sessionOf.has(id)) await listAgents();
        const session = sessionOf.get(id);
        if (url.searchParams.has("session") && url.searchParams.get("session") !== session) return json(res, 409, { error: "Context session changed" });
        const file = session ? sessionFile(session, cwdOf.get(id) ?? "") : null;
        const mix = file ? contextMix(file, cwdOf.get(id)) : null;
        return mix ? json(res, 200, mix) : json(res, 404, { error: "no Claude session file for this chat" });
      }
      return false;
    },
  };
}

export function agentReadRoutes(runtime: Pick<HttpRuntime, "herdr" | "json" | "listAgents" | "paneOf" | "readHud" | "sessionOf" | "statsOf">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { herdr, json, listAgents, paneOf, readHud, sessionOf, statsOf } = runtime;
      const st = url.pathname.match(/^\/api\/agents\/([^/]+)\/stats$/);
      if (st) {
        const id = decodeURIComponent(st[1]);
        if (!sessionOf.has(id)) await listAgents(1000);
        const out = await statsOf(sessionOf.get(id) ?? null);
        return json(res, "error" in out ? 404 : 200, { ...out, costUsd: readHud(sessionOf.get(id))?.costUsd ?? null });
      }
      const m = url.pathname.match(/^\/api\/agents\/([^/]+)\/read$/);
      if (m) {
        const lines = Math.min(200, Number(url.searchParams.get("lines") ?? 40));
        const id = decodeURIComponent(m[1]);
        if (!paneOf.has(id)) await listAgents(1000);
        const text = await herdr(["agent", "read", paneOf.get(id) ?? id, "--lines", String(lines)]).catch((e) => `(could not read: ${e.message.split("\n")[0]})`);
        return json(res, 200, { text });
      }
      return false;
    },
  };
}
