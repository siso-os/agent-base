import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { seedWorkspaces } from '../workspace-registry.ts';
import type { OwnersSnapshot } from '../owners.ts';
import type { Route } from './registry.ts';
import { createOwners } from '../owners.ts';
function decorate(s: OwnersSnapshot) {
  let workspaces = [];
  try { workspaces = JSON.parse(readFileSync(process.env.AB_REGISTRY ?? path.join(homedir(), '.local/state/agent-base/registry.json'), 'utf8')).workspaces ?? []; } catch {}
  return { ...s, workspaces: seedWorkspaces(Array.isArray(workspaces) ? workspaces : []).map(w => ({ id: w.id, name: w.name, color: w.color })) };
}
export function ownersRoute(owners = createOwners()): Route { return {
  method: 'GET', path: /^\/api\/owners(?:\/(events))?$/,
  handle(req, res, match) {
    if (!match[1]) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(decorate(owners.snapshot()))); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const stop = owners.subscribe(s => { if (!res.destroyed && !res.write(`data: ${JSON.stringify(decorate(s))}\n\n`)) res.destroy(); }, new URL(req.url ?? "", "http://localhost").searchParams.get("mini") === "1");
    res.on('close', stop);
  },
}; }
export const route = ownersRoute();
