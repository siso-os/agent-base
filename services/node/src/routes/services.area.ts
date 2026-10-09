import { handleServers } from "../servers.ts";
import { handleLaunchd } from "../launchd.ts";
import { handleCodexLanes } from "../codex-lanes.ts";
import { handleA0Now } from "../a0-now.ts";
import { handleResearch } from "../research.ts";
import { handleMiniLanes } from "../mini-lanes.ts";
import { handleDictation } from "../dictation.ts";
import { handleVoice } from "../voice.ts";
import { handleBackendManagement } from './backend-management.ts';
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function serviceLeavesRoutes(runtime: Pick<HttpRuntime, 'ALLOWED_ORIGINS'>): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      if (url.pathname.startsWith('/api/backends') && await handleBackendManagement(req, res, url, runtime.ALLOWED_ORIGINS)) return;
      if (await handleDictation(req, res, url)) return;
      if (await handleVoice(req, res, url)) return; // /api/voice/*: SISO Voice's history, read-only (voice.ts)
      if (await handleMiniLanes(req, res, url)) return; // /api/mini/lanes: the Mac mini's Codex lanes, opt-in ssh reads (mini-lanes.ts)
      if (await handleServers(req, res, url)) return; // /api/servers: every machine's health, agents and tokens (servers.ts)
      if (await handleLaunchd(req, res, url)) return;
      if (await handleCodexLanes(req, res, url)) return;
      if (await handleA0Now(req, res, url)) return;
      if (await handleResearch(req, res, url)) return;
      return false;
    },
  };
}
