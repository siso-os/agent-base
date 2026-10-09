// The Life space's node side: a narrow proxy to siso-life (Shaan's Life tracker API on siso-vps, over the tailnet;
// repo sisodias/siso-life). The API holds his life log; this file only knows its URL and token and forwards an
// allowlist of routes. It never logs a body, a key's value or a day's contents.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type http from "node:http";

export type LifeConfig = { url: string; token: string };

// Config: AB_LIFE_URL + AB_LIFE_TOKEN (tests), else ~/.config/siso/life.json {"url"} with the token in the login
// Keychain (service siso-life-token, account siso). No config = the rail icon stays hidden.
export function lifeConfig(env = process.env, home = homedir()): LifeConfig | null {
  if (env.AB_LIFE_URL) return env.AB_LIFE_TOKEN ? { url: env.AB_LIFE_URL.replace(/\/$/, ""), token: env.AB_LIFE_TOKEN } : null;
  let url = "";
  try { url = String(JSON.parse(readFileSync(path.join(home, ".config/siso/life.json"), "utf8")).url ?? ""); } catch { return null; }
  if (!/^https?:\/\/[^\s]+$/.test(url)) return null;
  try {
    const token = execFileSync("security", ["find-generic-password", "-s", "siso-life-token", "-a", "siso", "-w"], { encoding: "utf8", timeout: 5000 }).trim();
    return token ? { url: url.replace(/\/$/, ""), token } : null;
  } catch { return null; }
}

// What the app may reach on the API, method by method. Anything else is a 404 here and never leaves the laptop.
const ROUTES: [string, RegExp][] = [
  ["GET", /^\/health$/],
  ["GET", /^\/config$/],
  ["GET", /^\/day\/\d{4}-\d{2}-\d{2}$/],
  ["GET", /^\/xp$/],
  ["GET", /^\/days$/],
  ["POST", /^\/events$/],
];

export function allowed(method: string, sub: string): boolean {
  return ROUTES.some(([m, re]) => m === method && re.test(sub));
}

/** Handles /api/life/*. `fromApp` is the caller's origin check: every POST must come from this app's own page. */
export async function proxy(req: http.IncomingMessage, res: http.ServerResponse, url: URL, cfg: LifeConfig | null, fromApp: boolean, body?: string): Promise<void> {
  const sub = url.pathname.slice("/api/life".length) || "/";
  const send = (code: number, v: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); };
  if (sub === "/status") return send(200, { configured: !!cfg });
  if (!cfg) return send(503, { error: "Life is not set up on this Mac" });
  const method = req.method ?? "GET";
  if (!allowed(method, sub)) return send(404, { error: "not a Life route" });
  if (method !== "GET" && !fromApp) return send(403, { error: "not this app" });
  if (body !== undefined && body.length > 512_000) return send(413, { error: "too large" });
  let up: Response;
  try {
    up = await fetch(cfg.url + "/api" + sub + url.search, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: method === "GET" ? undefined : body ?? "",
    });
  } catch {
    return send(502, { error: "the Life API is not reachable (siso-vps over Tailscale)", offline: true });
  }
  const text = await up.text();
  res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
  res.end(text);
}
