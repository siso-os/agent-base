import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

export type Route = {
  /** null is reserved for explicitly wired areas that retain their own method-specific fall-through. */
  method: string | null;
  path: RegExp;
  /** Explicit areas may decline with false. Loaded string-method routes retain their original return contract. */
  handle: (req: IncomingMessage, res: ServerResponse, match: RegExpMatchArray, url?: URL) => unknown | Promise<unknown>;
};

/** Every `*.route.ts` in the folder (none when it is missing). New node routes go here, not in server.ts (t-0400). */
export async function loadRoutes(directory: string): Promise<Route[]> {
  const files = (await readdir(directory).catch(() => [] as string[])).filter((file) => file.endsWith(".route.ts")).sort();
  const routes: Route[] = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(directory, file)).href) as { route?: Route };
    const route = mod.route;
    if (!route || typeof route.method !== "string" || !(route.path instanceof RegExp) || typeof route.handle !== "function") {
      throw new Error(`invalid route module: ${file}`);
    }
    routes.push(route);
  }
  return routes;
}

export async function dispatchRoute(routes: Route[], req: IncomingMessage, res: ServerResponse, pathname: string, url?: URL) {
  for (const route of routes) {
    if (route.method !== null && req.method !== route.method) continue;
    const match = pathname.match(route.path);
    if (!match) continue;
    const result = await route.handle(req, res, match, url);
    if (route.method === null && result === false) continue;
    return true;
  }
  return false;
}
