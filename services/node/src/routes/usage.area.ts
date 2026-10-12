import { claudeAccounts } from "../claude-accounts.ts";
import { claudeUsage, defaultClaudeDir } from "../claude-usage.ts";
import { handleTokens } from "../tokens.ts";
import { handleTokensMoney } from "../tokens-money.ts";
import { handleUsage } from "../usage.ts";
import { handleUsageTasks } from "../usage-tasks.ts";
import { handleSpend } from "../spend.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function usageRoutes(runtime: Pick<HttpRuntime, "json" | "usageDirectories">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { json, usageDirectories } = runtime;
      if (url.pathname === "/api/claude-accounts" && req.method === "GET") return json(res, 200, claudeAccounts());
      if (url.pathname === "/api/claude-usage" && ["GET", "POST"].includes(req.method ?? "")) {
        const dir = defaultClaudeDir();
        // ↻ in the panel: read every account now, except one read in the last 10 s (a double click is one read).
        if (req.method === "POST") await Promise.all(usageDirectories().filter(profile => (claudeUsage.get(profile)?.ageMs ?? Infinity) >= 10_000).map(profile => claudeUsage.refresh(profile)));
        return json(res, 200, claudeUsage.get(dir) ?? { stale: true, at: null });
      }
      if (await handleTokens(req, res, url)) return; // /api/tokens: spend per account, limits, achievements (tokens.ts)
      if (await handleTokensMoney(req, res, url)) return; // /api/tokens/{money,split,fleet}: grant, Codex credits, Luna/Sol, the VPS rollup
      if (await handleUsageTasks(req, res, url)) return; // /api/usage/tasks: cost per seat and task, waste named (usage-tasks.ts)
      if (await handleUsage(req, res, url)) return; // /api/usage: local burn velocity (usage.ts)
      return false;
    },
  };
}

export function spendRoutes(runtime: Pick<HttpRuntime, never>): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      if (await handleSpend(req, res, url)) return; // /api/spend: today's spend by project, owner and plan item (spend.ts, ab-142)
      return false;
    },
  };
}
