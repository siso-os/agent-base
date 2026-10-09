import { handleShip } from "../ship.ts";
import { changesSince, changesWithAreas, gitSha, readVersion, readVersionLine } from "../version.ts";
import { handleReleases, noteFor, notesFile, readNotes } from "../releases.ts";
import { handleLanding } from "../landing.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function versionRoutes(runtime: Pick<HttpRuntime, "APP_ROOT" | "BOOT_SHA" | "json">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { APP_ROOT, BOOT_SHA, json } = runtime;
      if (url.pathname === "/api/version" && req.method === "GET") return json(res, 200, { ...readVersion(APP_ROOT, BOOT_SHA), line: readVersionLine(APP_ROOT) });
      if (url.pathname === "/api/version/changes" && req.method === "GET") {
        const since = url.searchParams.get("since") ?? "";
        // `sha`: the commit those changes lead to (the Shipped card's), which /api/version's boot sha is not.
        const to = gitSha(APP_ROOT), note = /^[0-9a-f]{7,40}$/.test(since) ? noteFor(APP_ROOT, readNotes(notesFile(APP_ROOT)), since, to) : undefined;
        return json(res, 200, { subjects: changesSince(APP_ROOT, since), changes: changesWithAreas(APP_ROOT, since), sha: to, ...(note ? { note } : {}) });
      }
      return false;
    },
  };
}

export function releaseLeavesRoutes(runtime: Pick<HttpRuntime, "APP_ROOT">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { APP_ROOT } = runtime;
      if (handleReleases(req, res, url, APP_ROOT)) return; // /api/releases: What's new, from the deploy log (releases.ts)
      if (await handleLanding(req, res, url, APP_ROOT)) return; // /api/not-landed: branches main lacks, live behind main (landing.ts)
      return false;
    },
  };
}

export function shippingRoutes(runtime: Pick<HttpRuntime, never>): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      if (await handleShip(req, res, url)) return; // /api/ship: what went live today, from the ship queue's log (ship.ts)
      return false;
    },
  };
}
