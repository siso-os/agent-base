import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

/**
 * SISO Browser: Zen (Firefox engine) as a SISO OS module. Shaan, 15 Oct: "I like Zen ... integrate it in so it's its own
 * module ... that plugs into the SISO OS". Gecko can't render inside this WebKit window, so the module's screen is a strip
 * of SISO OS chrome with Zen docked under it: the page sends where its frame sits on screen every second, and the SISO
 * extension inside Zen (apps/siso-browser/extension, BROWSER's repo) moves Zen's window there and hides it when the
 * heartbeat stops (another module opened). Zen posts its state (tabs, memory, sleeping tabs) here for the strip to show.
 *
 *   GET  /api/zen/panel      the module's screen (a url module, framed by the shell)
 *   GET  /api/zen/status     Zen's last state, and whether it runs
 *   POST /api/zen/open       {url?} start Zen or open a page in it (open -a Zen; http(s) only)
 *   POST /api/zen/dock       {x,y,width,height} | {off:true}: the panel's heartbeat
 *   POST /api/zen/command    {type:"focus-tab", id} | {type:"new-tab", url}
 *   POST /api/zen/state      from the extension (header x-siso-zen)
 *   GET  /api/zen/commands   the extension's long poll (header x-siso-zen)
 */
type Cmd = Record<string, unknown>;
const queue: Cmd[] = [];
const waiters = new Set<(c: Cmd[]) => void>();
let state: { at: number; data: unknown } | null = null;
let lastDock: { at: number; bounds: Cmd | null } = { at: 0, bounds: null };

function push(cmd: Cmd) {
  queue.push(cmd);
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  for (const w of waiters) w(queue.splice(0));
  waiters.clear();
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const httpUrl = (v: unknown) => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };

export function zenRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json" | "readBody" | "run">): Route {
  return {
    method: null,
    path: /^\/api\/zen\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json, readBody, run } = runtime;
      const origin = String(req.headers.origin ?? "");
      const fromApp = !origin || ALLOWED_ORIGINS.has(origin);
      // The extension's own calls: a custom header, which a web page can't send here without a CORS preflight we never answer.
      // Zen's chrome sends no Origin, or "null" on a POST.
      const fromZen = req.headers["x-siso-zen"] === "1" && (!origin || origin === "null");
      // Agents may still drive Zen on purpose (apps/siso-browser); the app's pages never do.
      const fromZenAgent = req.headers["x-siso-agent"] === "1" && !origin;
      const body = async () => { try { return JSON.parse((await readBody(req, 65536)) || "{}"); } catch { return {}; } };

      // SISO OS never opens or docks Zen's window any more (Shaan, 15 Oct: "it just opens another zen browser ... it's about
      // seamless"): SISO Browser is the native browser inside SISO OS. A window still on the old build gets this page instead.
      if (url.pathname === "/api/zen/panel" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return void res.end(MOVED);
      }
      if ((url.pathname === "/api/zen/open" || url.pathname === "/api/zen/dock") && req.method === "POST" && !fromZenAgent) {
        return json(res, 410, { error: "SISO Browser is inside SISO OS now; reload SISO OS" });
      }
      if (url.pathname === "/api/zen/status" && req.method === "GET") {
        let running = false;
        try { running = (await run("pgrep", ["-f", "Zen.app/Contents/MacOS/zen"])).trim() !== ""; } catch { /* exit 1: none */ }
        const fresh = state && Date.now() - state.at < 90_000;
        return json(res, 200, { running, bridge: Boolean(fresh), at: state?.at ?? null, state: fresh ? state!.data : null });
      }
      if (url.pathname === "/api/zen/open" && req.method === "POST") {
        if (!fromApp) return json(res, 403, { error: "not this app" });
        const b = await body();
        const page = b.url ? httpUrl(b.url) : null;
        if (b.url && !page) return json(res, 400, { error: "only http(s) pages" });
        if (process.env.AB_OPEN_DRY) return json(res, 200, { ok: true, dry: page ?? "Zen" });
        try { await run("open", page ? ["-a", "Zen", page] : ["-a", "Zen"]); } catch { return json(res, 404, { error: "Zen is not installed" }); }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/zen/dock" && req.method === "POST") {
        if (!fromApp) return json(res, 403, { error: "not this app" });
        const b = await body();
        if (b.off) { lastDock = { at: Date.now(), bounds: null }; push({ type: "undock", free: Boolean(b.free) }); return json(res, 200, { ok: true }); }
        const bounds = { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) };
        if (Object.values(bounds).some(v => v === null) || bounds.width! < 200 || bounds.height! < 150) return json(res, 400, { error: "bad bounds" });
        const same = lastDock.bounds && JSON.stringify(lastDock.bounds) === JSON.stringify(bounds);
        const stale = Date.now() - lastDock.at > 2_500; // first beat after a gap: Zen was hidden, bring it back
        lastDock = { at: Date.now(), bounds };
        if (!same || stale) push({ type: "dock", ...bounds });
        else push({ type: "beat" });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/zen/command" && req.method === "POST") {
        if (!fromApp) return json(res, 403, { error: "not this app" });
        const b = await body();
        if (b.type === "focus-tab" && typeof b.id === "string" && b.id.length < 200) push({ type: "focus-tab", id: b.id });
        else if (b.type === "new-tab" && httpUrl(b.url)) push({ type: "new-tab", url: httpUrl(b.url) });
        else return json(res, 400, { error: "unknown command" });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/zen/state" && req.method === "POST") {
        if (!fromZen) return json(res, 403, { error: "not Zen" });
        state = { at: Date.now(), data: await body() };
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/zen/commands" && req.method === "GET") {
        if (!fromZen) return json(res, 403, { error: "not Zen" });
        if (queue.length) return json(res, 200, queue.splice(0));
        const wait = Math.min(25_000, Math.max(0, Number(url.searchParams.get("wait") ?? 20) * 1000));
        const cmds = await new Promise<Cmd[]>((resolve) => {
          const w = (c: Cmd[]) => { clearTimeout(t); resolve(c); };
          const t = setTimeout(() => { waiters.delete(w); resolve([]); }, wait);
          waiters.add(w);
          req.on("close", () => { waiters.delete(w); clearTimeout(t); });
        });
        return json(res, 200, cmds);
      }
      return false;
    },
  };
}

const MOVED = /* html */ `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SISO Browser</title>
<style>html,body{margin:0;height:100%;background:#0a0a0a;color:#f5f5f5;font:14px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;text-align:center}
b{display:block;font-size:17px;margin-bottom:6px}p{margin:0;color:#8a8a8a}kbd{font:inherit;color:#f5f5f5;background:#191919;border:1px solid #2a2a2a;border-radius:6px;padding:1px 6px}</style></head>
<body><div><b>SISO Browser now opens right here, inside SISO OS</b><p>This window is on an older version. Reload it with <kbd>⌘R</kbd> and click the compass again.</p></div></body></html>`;
