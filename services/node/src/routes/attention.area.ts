import { readAttentionRequest, executeAttentionCommand } from "../attention-actions.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function attentionRoutes(runtime: Pick<HttpRuntime, "attention" | "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { attention, json, readBody } = runtime;
      if (url.pathname === '/api/attention/settings') {
        if (req.method === 'GET') return json(res, 200, attention.settings());
        if (req.method === 'POST') { try { return json(res, 200, attention.configure(JSON.parse(await readBody(req)))); } catch { return json(res, 400, { error: 'Use valid notification settings, a private topic and an HTTPS app address' }); } }
      }
      if (url.pathname === '/api/attention' && req.method === 'GET') return json(res, 200, { items: attention.list(), healthy: attention.healthy, settings: attention.settings() });
      const attentionRoute = /^\/api\/attention\/([^/]+)(?:\/(read|command|request))?$/.exec(url.pathname);
      if (attentionRoute) {
        const id = decodeURIComponent(attentionRoute[1]);
        if (!attention.get(id)) return json(res, 404, { error: 'Notification no longer available' });
        if (req.method === 'GET' && attentionRoute[2] === 'request') return json(res, 200, { request: await readAttentionRequest(attention, id) });
        if (req.method === 'GET' && !attentionRoute[2]) return json(res, 200, attention.get(id));
        if (req.method === 'POST' && attentionRoute[2] === 'read') return json(res, 200, { ok: attention.mark(id) });
        if (req.method === 'POST' && attentionRoute[2] === 'command') {
          const ack = await executeAttentionCommand(attention, id, JSON.parse(await readBody(req)));
          return json(res, ['accepted','queued'].includes(ack.status) ? 200 : ack.status === 'stale' ? 409 : ack.status === 'unsupported' || ack.status === 'invalid' ? 422 : 503, ack);
        }
      }
      return false;
    },
  };
}
