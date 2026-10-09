import { isClaudeAgent, validCompactAt, launchCompactAt } from "../compact-at.ts";
import { list as listNotifications, mark as markNotification, reactText as notificationReact, replyText as notificationReply } from "../notifications.ts";
import { MOVE_TARGETS, MOVE_EFFORTS, type MoveTarget, move as moveAgent, status as moveStatus } from "../move.ts";
import { accountSwitchBlocked, accountSwitchDeps, accountSwitchError, accountSwitchStatus, accountSwitching, switchAccount } from "../account-switch.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function agentActionsRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "attention" | "cwdOf" | "json" | "nameOf" | "readBody" | "listAgents" | "HOSTS_DIR">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, attention, cwdOf, json, nameOf, readBody, listAgents, HOSTS_DIR } = runtime;
      const compactRoute = url.pathname.match(/^\/api\/agents\/([^/]+)\/compact-at$/);
      if (compactRoute) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
        const origin = String(req.headers.origin ?? '');
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: 'not this app' });
        let name: string, body: any;
        try { name = decodeURIComponent(compactRoute[1]); body = JSON.parse(await readBody(req)); }
        catch { return json(res, 400, { error: 'Expected {pct: a whole number from 10 to 90}' }); }
        if (!validCompactAt(body?.pct)) return json(res, 400, { error: 'pct must be a whole number from 10 to 90' });
        const matches = (await listAgents(0)).filter(a => a.name === name);
        if (!matches.length) return json(res, 404, { error: 'Unknown agent' });
        if (matches.length !== 1 || !isClaudeAgent(matches[0])) return json(res, 409, { error: 'Choose one Claude agent' });
        try { await launchCompactAt(name, body.pct); }
        catch { return json(res, 502, { error: 'Could not start compact-at; the compaction point was not changed' }); }
        return json(res, 202, { pending: true, pct: body.pct });
      }
      // Move an agent to another model (ab-131): agent-move by name. POST waits for the move; GET says how it stands.
      const moveRoute = url.pathname.match(/^\/api\/agents\/([^/]+)\/move$/);
      if (moveRoute) {
        const name = decodeURIComponent(moveRoute[1]);
        if (req.method === "GET") return json(res, 200, moveStatus(name) ?? { state: "failed", message: "No move has been requested" });
        if (req.method === "POST") {
          const origin = String(req.headers.origin ?? "");
          if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
          const { to, effort } = JSON.parse((await readBody(req)) || "{}");
          if (!MOVE_TARGETS.includes(to)) return json(res, 400, { error: `to must be one of ${MOVE_TARGETS.join(", ")}` });
          if (effort !== undefined && !MOVE_EFFORTS.includes(effort)) return json(res, 400, { error: "unsupported effort" });
          return json(res, 200, await moveAgent(name, to as MoveTarget, effort));
        }
      }
      // Switch a Claude agent to another Claude login, same conversation (t-0577). POST answers 202 at once and runs the
      // by-hand switch script in the background; GET says how it stands and, before any switch, why this agent can't.
      const accountRoute = url.pathname.match(/^\/api\/agents\/([^/]+)\/claude-account$/);
      if (accountRoute) {
        const name = decodeURIComponent(accountRoute[1]);
        const deps = accountSwitchDeps({ listAgents, hostsDir: HOSTS_DIR });
        if (req.method === "GET") {
          const status = accountSwitchStatus(name);
          const blocked = accountSwitching(name) ? null : await accountSwitchBlocked(name, deps);
          return json(res, 200, { ...(status ?? { state: "idle", message: "No account switch has been requested" }), blocked });
        }
        if (req.method !== "POST") return json(res, 405, { error: "Use GET or POST" });
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let body: any;
        try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return json(res, 400, { error: "Expected {to: a Claude account id}" }); }
        const refused = accountSwitchError(body?.to);
        if (refused) return json(res, 400, { error: refused });
        if (accountSwitching(name)) return json(res, 409, { state: "failed", message: "A switch is already running for this agent", to: body.to });
        void switchAccount(name, body.to, deps);
        return json(res, 202, accountSwitchStatus(name));
      }
      // An agent's notifications (ab-150): its repo's .agents/notifications.jsonl.
      const nt = url.pathname.match(/^\/api\/agents\/([^/]+)\/notifications(?:\/([^/]+)(\/reply)?)?$/);
      if (nt) {
        const id = decodeURIComponent(nt[1]);
        const who = nameOf.get(id) === "Agent Zero" ? "A0" : id;
        if (req.method === "GET" && !nt[2]) return json(res, 200, { notifications: await listNotifications(who, cwdOf.get(id) ?? "") });
        if (req.method === "POST" && nt[2]) {
          const origin = String(req.headers.origin ?? "");
          if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
          const body = JSON.parse((await readBody(req)) || "{}");
          const nid = decodeURIComponent(nt[2]);
          if (nid.startsWith('activity:') && body.read !== undefined) attention.mark(nid, !!body.read);
          let delivery;
          try {
            if (!nt[3]) {
              await markNotification(who, nid, { ...(typeof body.read === "boolean" ? { read: body.read } : {}), ...("react" in body ? { react: body.react ?? null } : {}) });
              // a0-016: a reaction goes back to the agent too; clearing one, or a read mark, says nothing.
              if (typeof body.react !== "string" || !body.react) return json(res, 200, { ok: true });
              const title = (await listNotifications(who, cwdOf.get(id) ?? "")).find((n) => String(n.id) === nid)?.title;
              delivery = notificationReact(who, nid, body.react, title);
            } else delivery = notificationReply(who, nid, String(body.text ?? ""));
          } catch (e) {
            return json(res, 400, { error: (e as Error).message });
          }
          // Agent Zero's answers also land in his console inbox (a0-board), the record his Monitor reads; and, a0-016 (his
          // 15:33: "then it gets pinged to you"), the page puts it into his chat as well, so it reaches him at once.
          if (delivery.target.kind === "console") {
            const r = await fetch(delivery.target.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(delivery.target.body) }).catch(() => null);
            return json(res, 200, { ok: true, sent: r?.ok ? "console" : null, deliver: delivery.text });
          }
          // Any other agent: the page sends it through that agent's chat, the same queue as anything he types there.
          return json(res, 200, { ok: true, deliver: delivery.text });
        }
      }
      return false;
    },
  };
}
