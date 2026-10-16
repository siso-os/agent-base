import { randomUUID } from "node:crypto";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

/**
 * Agents drive the globe's browser in the background (siso-browser, Shaan 16 Oct: what was built for Zen "isn't showing in
 * the OS"). An agent asks the node; the SISO OS window (apps/web/src/lib/browser-agent.ts) long-polls for the request, does
 * it on a hidden native page of the agent's own, and posts the answer back. Nothing shows on his screen: the page lives off
 * the window, never sleeps while the agent holds it, and lights the browser's rim while it works.
 *
 *   POST /api/browser/agent         {op:"open"|"navigate"|"read"|"list"|"close", agent, tab?, url?, signedIn?} (agents:
 *                                   header x-siso-agent: 1, no Origin). Answers when the window has done it, or 504.
 *   GET  /api/browser/agent/next    the window's long poll (this app's page: its Origin, or same-origin)
 *   POST /api/browser/agent/result  {id, ok, data?, error?} (this app's origin)
 */
export type AgentOp = { id: string; op: string; agent: string; tab?: string; url?: string; signedIn?: boolean };
type Answer = { ok: boolean; data?: unknown; error?: string };
const OPS = new Set(["open", "navigate", "read", "list", "close"]);
const queue: AgentOp[] = [];
const waiters = new Set<(ops: AgentOp[]) => void>();
const pending = new Map<string, (a: Answer) => void>();
let polledAt = 0;
const refererOrigin = (r: unknown) => { try { return new URL(String(r)).origin; } catch { return ""; } };

/** A request as the window may receive it, or why not. */
export function agentOp(b: Record<string, unknown>): AgentOp | string {
  const op = String(b.op ?? "");
  if (!OPS.has(op)) return "op is open, navigate, read, list or close";
  const agent = String(b.agent ?? "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(agent)) return "agent: your seat name (letters, digits, _ or -)";
  const out: AgentOp = { id: randomUUID(), op, agent };
  if (b.tab !== undefined) { const tab = String(b.tab); if (!/^[A-Za-z0-9_-]{1,40}$/.test(tab)) return "bad tab"; out.tab = tab; }
  if (op === "open" || op === "navigate") {
    try { const u = new URL(String(b.url ?? "")); if (!/^https?:$/.test(u.protocol)) throw 0; out.url = u.href; } catch { return "url: an http(s) address"; }
  }
  if ((op === "navigate" || op === "read" || op === "close") && !out.tab) return "tab: the id open gave you";
  if (b.signedIn === true) out.signedIn = true;
  return out;
}

function push(op: AgentOp) {
  queue.push(op);
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  for (const w of waiters) w(queue.splice(0));
  waiters.clear();
}

export function browserAgentRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\/api\/browser\/agent(\/|$)/,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json, readBody } = runtime;
      const origin = String(req.headers.origin ?? "");
      // The window's own fetches: a cross-origin one carries its Origin; a same-origin GET carries none, only Sec-Fetch-Site.
      const fromWindow = ALLOWED_ORIGINS.has(origin) || (!origin && (req.headers["sec-fetch-site"] === "same-origin" || ALLOWED_ORIGINS.has(refererOrigin(req.headers.referer))));
      // A web page cannot send the custom header here without a preflight this node never answers.
      const fromAgent = req.headers["x-siso-agent"] === "1" && !origin;
      const body = async () => { try { return JSON.parse((await readBody(req, 1 << 20)) || "{}"); } catch { return {}; } };

      if (url.pathname === "/api/browser/agent" && req.method === "POST") {
        if (!fromAgent) return json(res, 403, { error: "agents only (header x-siso-agent: 1)" });
        const op = agentOp(await body());
        if (typeof op === "string") return json(res, 400, { error: op });
        if (Date.now() - polledAt > 30_000) return json(res, 503, { error: "the SISO OS window is not open, so its browser is not there to drive" });
        const answer = await new Promise<Answer>((resolve) => {
          const t = setTimeout(() => { pending.delete(op.id); resolve({ ok: false, error: "the SISO OS window did not answer in 45 s" }); }, 45_000);
          pending.set(op.id, (a) => { clearTimeout(t); pending.delete(op.id); resolve(a); });
          push(op);
        });
        return json(res, answer.ok ? 200 : 502, answer.ok ? answer.data ?? { ok: true } : { error: answer.error ?? "failed" });
      }
      if (url.pathname === "/api/browser/agent/next" && req.method === "GET") {
        if (!fromWindow) return json(res, 403, { error: "not this app" });
        polledAt = Date.now();
        if (queue.length) return json(res, 200, queue.splice(0));
        const wait = Math.min(25_000, Math.max(0, Number(url.searchParams.get("wait") ?? 20) * 1000));
        const ops = await new Promise<AgentOp[]>((resolve) => {
          const w = (o: AgentOp[]) => { clearTimeout(t); resolve(o); };
          const t = setTimeout(() => { waiters.delete(w); resolve([]); }, wait);
          waiters.add(w);
          req.on("close", () => { waiters.delete(w); clearTimeout(t); });
        });
        polledAt = Date.now();
        return json(res, 200, ops);
      }
      if (url.pathname === "/api/browser/agent/result" && req.method === "POST") {
        if (!fromWindow) return json(res, 403, { error: "not this app" });
        const b = await body();
        const done = pending.get(String(b.id ?? ""));
        if (!done) return json(res, 404, { error: "no such request" });
        done({ ok: b.ok === true, data: b.data, error: typeof b.error === "string" ? b.error.slice(0, 300) : undefined });
        return json(res, 200, { ok: true });
      }
      return false;
    },
  };
}
