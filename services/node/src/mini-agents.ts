import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { listServiceHosts as readHosts, type ServiceHost } from "./service-hosts.ts";
import type { HttpRuntime } from "./server.ts";
import type { Route } from "./routes/registry.ts";

const run = promisify(execFile);
const SSH_BIN = process.env.AB_MINI_SSH_BIN ?? "ssh";
const SSH_TIMEOUT = 8000;
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "ControlMaster=auto", "-o", `ControlPath=${process.env.HOME}/.ssh/cm-ab-%C`, "-o", "ControlPersist=10m"];
const CACHE_TTL = 10000;

type MiniAgent = {
  name: string;
  activity: "idle" | "working";
  model: string | null;
  cwd: string | null;
  context: number | null;
  cpu: number;
  rssMb: number;
  startedAt: number | null;
};

type MiniAgentsCache = {
  at: number;
  data: { agents: MiniAgent[]; error: string | null } | null;
};

const agentCache = new Map<string, MiniAgentsCache>();
/** Tests only: forget the 10 s answer. */
export const resetMiniAgentsCache = () => agentCache.clear();
const REMOTE_PATH = "PATH=$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH";
const COLLECT_PROMPT = "Wrap up now: commit and push your work on your branch, write a 3-line report of what is done and what is left, then end your turn.";

/** Send one prompt (delivery 'next') over a host socket; resolves the receipt phase, or null when it was not taken in 5 s. */
export function sendPrompt(host: Pick<ServiceHost, "port" | "token">, text: string): Promise<string | null> {
  return new Promise((resolve) => {
    const key = `collect-${randomUUID()}`;
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${encodeURIComponent(host.token)}`);
    let done = false;
    const finish = (v: string | null) => { if (done) return; done = true; clearTimeout(timer); ws.close(); resolve(v); };
    const timer = setTimeout(() => finish(null), 5000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "prompt", key, messageId: key, text, images: [], delivery: "next", from: "app" })));
    ws.on("message", (raw) => {
      let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === "prompt.receipt" && m.key === key) finish(["failed", "cancelled", "unknown"].includes(m.phase) ? null : String(m.phase));
    });
    ws.on("error", () => finish(null));
  });
}

/** Sum CPU and RSS over each host's whole process tree (the host plus its Claude or Codex child and their tools) from
 * `ps -A -o pid=,ppid=,%cpu=,rss=` lines ("1234 1 5.2 1048576": pid, parent, cpu %, rss in KB on macOS). */
function treeMetrics(lines: string[], roots: number[]): Map<number, { cpu: number; rssMb: number }> {
  const kids = new Map<number, number[]>(), own = new Map<number, { cpu: number; rss: number }>();
  for (const line of lines) {
    const [pid, ppid, cpu, rss] = line.trim().split(/\s+/).map(Number);
    if (![pid, ppid, cpu, rss].every(Number.isFinite)) continue;
    own.set(pid, { cpu, rss });
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid)!.push(pid);
  }
  const result = new Map<number, { cpu: number; rssMb: number }>();
  for (const root of roots) {
    if (!own.has(root)) continue;
    let cpu = 0, rss = 0;
    const stack = [root], seen = new Set<number>();
    while (stack.length) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      const o = own.get(p);
      if (o) { cpu += o.cpu; rss += o.rss; }
      stack.push(...(kids.get(p) ?? []));
    }
    result.set(root, { cpu: Math.round(cpu * 10) / 10, rssMb: Math.round(rss / 1024) });
  }
  return result;
}

/** Fetch CPU and RSS metrics for running mini agents via SSH. */
async function getMiniMetrics(hosts: ServiceHost[]): Promise<{ agents: MiniAgent[]; error: string | null }> {
  const miniHosts = hosts.filter((h) => h.remoteMachine === "mini" && h.remote);
  if (!miniHosts.length) return { agents: [], error: null };

  // Group hosts by SSH alias to minimize SSH calls
  const byAlias = new Map<string, ServiceHost[]>();
  for (const host of miniHosts) {
    const alias = host.remote!.ssh;
    if (!byAlias.has(alias)) byAlias.set(alias, []);
    byAlias.get(alias)!.push(host);
  }

  const agents: MiniAgent[] = [];
  let error: string | null = null;

  for (const [alias, hostsForAlias] of byAlias) {
    try {
      // Reuse the ab-remote bridge's open connection (same ControlPath), so a call is one round trip, not a fresh handshake.
      const { stdout } = await run(SSH_BIN, [...SSH_OPTS, alias, "ps -A -o pid=,ppid=,%cpu=,rss="], {
        timeout: SSH_TIMEOUT,
        shell: false,
        maxBuffer: 4 * 1024 * 1024,
      });

      const metrics = treeMetrics(stdout.split("\n"), hostsForAlias.map((h) => h.remote!.pid));

      for (const host of hostsForAlias) {
        const m = metrics.get(host.remote!.pid);
        agents.push({
          name: host.name,
          activity: host.activity,
          model: host.model,
          cwd: host.cwd,
          context: typeof host.context === "number" ? host.context : null,
          cpu: m?.cpu ?? 0,
          rssMb: m?.rssMb ?? 0,
          startedAt: host.startedAt,
        });
      }
    } catch {
      error = "mini did not answer";
    }
  }

  return { agents, error };
}

export function miniAgentsRoutes(
  runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json"> & { HOSTS_DIR?: string; listServiceHosts?: () => Promise<ServiceHost[]> }
): Route {
  // The node's runtime carries HOSTS_DIR, not a host reader; tests pass their own reader.
  const listServiceHosts = runtime.listServiceHosts ?? (() => readHosts({ dir: runtime.HOSTS_DIR }));
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json } = runtime;

      // GET /api/servers/mini/agents - list running agents on the Mac mini with metrics
      if (url.pathname === "/api/servers/mini/agents" && req.method === "GET") {
        const cacheKey = "mini-agents";
        const now = Date.now();
        let cached = agentCache.get(cacheKey);
        if (!cached || now - cached.at > CACHE_TTL) {
          const hosts = await listServiceHosts();
          cached = { at: now, data: await getMiniMetrics(hosts) };
          agentCache.set(cacheKey, cached);
        }
        const { agents, error } = cached.data!;
        return json(res, 200, { agents: agents.sort((a, b) => a.name.localeCompare(b.name)), ...(error ? { error } : {}) });
      }

      // POST /api/servers/mini/agents/:name/collect - send a wrap-up prompt to the agent
      const collectMatch = url.pathname.match(/^\/api\/servers\/mini\/agents\/([^/]+)\/collect$/);
      if (collectMatch) {
        if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });

        const name = decodeURIComponent(collectMatch[1]);
        try {
          const hosts = await listServiceHosts();
          const host = hosts.find((h) => h.name === name && h.remoteMachine === "mini");
          if (!host) return json(res, 404, { error: "Agent not found on mini" });

          // The mirrored record's port is the bridge's local proxy to the chat's host socket, the path his typed messages take.
          const phase = await sendPrompt(host, COLLECT_PROMPT);
          if (!phase) return json(res, 502, { error: "The chat did not take the message; nothing was sent" });
          return json(res, 202, { sent: true, phase });
        } catch {
          return json(res, 502, { error: "The chat did not take the message; nothing was sent" });
        }
      }

      // POST /api/servers/mini/agents/:name/stop - stop an agent via tmux
      const stopMatch = url.pathname.match(/^\/api\/servers\/mini\/agents\/([^/]+)\/stop$/);
      if (stopMatch) {
        if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });

        const name = decodeURIComponent(stopMatch[1]);
        // Validate name: ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) return json(res, 400, { error: "Invalid agent name" });

        try {
          const hosts = await listServiceHosts();
          const host = hosts.find((h) => h.name === name && h.remoteMachine === "mini");
          if (!host || !host.remote) return json(res, 404, { error: "Agent not found on mini" });

          // Execute: ssh <ssh> tmux kill-window -t ab-owners:<name>
          await run(SSH_BIN, [...SSH_OPTS, host.remote.ssh, `${REMOTE_PATH} tmux kill-window -t ab-owners:${name}`], {
            timeout: SSH_TIMEOUT,
            shell: false,
          });
          return json(res, 200, { stopped: true });
        } catch {
          return json(res, 500, { error: "Failed to stop agent" });
        }
      }

      return false;
    },
  };
}
