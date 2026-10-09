import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Route } from './registry.ts';
import { readBrief } from '../agent-brief.ts';
import { createOwners } from '../owners.ts';

const owners = createOwners();

export function agentBriefRoute(): Route {
  return {
    method: 'GET',
    path: /^\/api\/agents\/([^/]+)\/brief$/,
    async handle(_req: IncomingMessage, res: ServerResponse, match: RegExpMatchArray) {
      const name = decodeURIComponent(match[1]);
      // The name becomes a file name under the owners and hosts dirs: refuse anything that could leave them.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name) || name.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ source: 'none', error: 'bad agent name' }));
        return;
      }
      const snapshot = owners.snapshot();
      const owner = snapshot.owners.find(o => o.name === name);

      try {
        const brief = await readBrief(name, owner);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(brief));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ source: 'none', error: 'Failed to read brief' }));
      }
    },
  };
}

export const route = agentBriefRoute();
