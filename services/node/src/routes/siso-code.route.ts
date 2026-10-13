import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import type { Route } from "./registry.ts";

/**
 * SISO Code's door (modules/siso-code): the frame opens /api/code/open, which sends it on to T3 Code. T3's server runs on
 * this laptop (launchd com.siso.code, 127.0.0.1:5490, a production build in ~/.local/share/siso-code/app synced from the
 * fork sisodias/siso-code). It ran on the mini first; at ~300 ms away every file and call crawled (13 Oct: "surely we
 * should be running T3 code on my laptop"). Its SameSite=lax session cookie is same-site with the app and, since cookies
 * ignore the port, reaches this route too: with a live session the frame goes straight to T3. Without one, or with
 * `?pair=1`, T3's own CLI makes a one-time pairing link and the frame goes there; the token goes from the CLI straight into
 * the redirect and is never logged or stored.
 */
const CODE_URL = process.env.AB_CODE_URL ?? "http://127.0.0.1:5490";
const APP = process.env.AB_CODE_APP ?? path.join(homedir(), ".local/share/siso-code/app/t3");
const BASE_DIR = process.env.AB_CODE_BASE_DIR ?? path.join(homedir(), ".local/state/siso-code");

type Pair = () => Promise<string>;
const cliPair: Pair = () => new Promise((resolve, reject) => {
  const args = [path.join(APP, "dist/bin.mjs"), "auth", "pairing", "create", "--base-dir", BASE_DIR, "--label", "Agent Base", "--ttl", "10m", "--json"];
  execFile(process.execPath, args, { timeout: 30_000, maxBuffer: 1 << 20, env: { ...process.env, SHELL: "/bin/sh" } }, (error, stdout) => {
    if (error) return reject(new Error("T3 Code's pairing command failed"));
    try {
      const { credential } = JSON.parse(stdout) as { credential?: string };
      if (!credential) throw new Error();
      resolve(credential);
    } catch { reject(new Error("no pairing link from T3 Code")); }
  });
});

type SignedIn = (cookie: string | undefined) => Promise<boolean>;
const t3Session = (base: string): SignedIn => async (cookie) => {
  if (!cookie) return false;
  try {
    const r = await fetch(`${base}/api/auth/session`, { headers: { cookie }, signal: AbortSignal.timeout(10_000) });
    return r.ok && (await r.json() as { authenticated?: boolean }).authenticated === true;
  } catch { return false; }
};

export function sisoCodeRoute(pair: Pair = cliPair, base = CODE_URL, signedIn: SignedIn = t3Session(base)): Route {
  return {
    method: "GET", path: /^\/api\/code\/open$/,
    async handle(req, res, _match, url) {
      const again = url?.searchParams.get("pair") === "1";
      if (!again && await signedIn(req.headers?.cookie)) { res.writeHead(302, { Location: `${base}/`, "Cache-Control": "no-store" }); res.end(); return; }
      try {
        const token = await pair();
        res.writeHead(302, { Location: `${base}/pair#token=${encodeURIComponent(token)}`, "Cache-Control": "no-store" });
        res.end();
      } catch (e) {
        res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(`<body style="font:14px system-ui;color:#ccc;background:#111;padding:24px">SISO Code could not pair: ${(e as Error).message}. <a style="color:#5eead4" href="/api/code/open?pair=1">Try again</a></body>`);
      }
    },
  };
}
export const route = sisoCodeRoute();
