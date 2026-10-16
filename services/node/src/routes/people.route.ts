import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Route } from "./registry.ts";

/**
 * People graph's door (modules/people-graph): the frame opens /api/people/, and this route fetches the private SISO library
 * site (Cloudflare Pages siso-library: the people graph, a full doc and transcript per video, who said what) with its
 * credential added here, so Shaan never sees a login in the app. Shaan, 15 Oct: "put a people graph module in the agent OS
 * which loads from the cloudflare auto logged in". The password is read from .credentials on each request and never
 * leaves this process: it is not in the bundle, the URL or any log. The site links from its root ("/graph/"), so HTML has
 * those links moved under /api/people/. Owner: PEOPLE-GRAPH (Great_Library_of_SISO/people-graph, factory/build_site.py).
 */
const SITE = process.env.AB_PEOPLE_SITE ?? "https://siso-library.pages.dev";
const CRED = process.env.AB_PEOPLE_CRED ?? path.join(homedir(), "SISO_Workspace/.credentials/projects/siso-library.env");
const PREFIX = "/api/people";

type Password = () => Promise<string | null>;
const fromFile = (file: string): Password => async () => {
  try {
    const m = /^LIBRARY_PASSWORD=(.+)$/m.exec(await readFile(file, "utf8"));
    return m ? m[1].trim() : null;
  } catch { return null; }
};

/** Root-relative links and sources in the site's HTML are moved under the prefix; protocol-relative ones are left alone. */
export const rebase = (html: string) => html.replace(/(\b(?:href|src|action)=["'])\/(?!\/)/g, `$1${PREFIX}/`);
/** Pages served here sit inside the People hub, so they take its theme (the site's [data-theme=hub] colours). */
export const hubTheme = (html: string) => html.replace(/<html(?![^>]*\bdata-theme=)/i, '<html data-theme="hub"');

function fail(res: Parameters<Route["handle"]>[1], status: number, why: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<body style="font:14px system-ui;color:#ccc;background:#111;padding:24px">People graph could not load: ${why}.</body>`);
}

export function peopleRoute(password: Password = fromFile(CRED), site = SITE, get: typeof fetch = fetch): Route {
  return {
    method: "GET", path: /^\/api\/people(\/.*)?$/,
    async handle(_req, res, match, url) {
      const rest = match?.[1] ?? "";
      if (!rest) { res.writeHead(302, { Location: `${PREFIX}/`, "Cache-Control": "no-store" }); return void res.end(); }
      const pw = await password();
      if (!pw) return fail(res, 503, "no LIBRARY_PASSWORD in .credentials/projects/siso-library.env");
      let r: Response;
      try {
        r = await get(`${site}${rest}${url?.search ?? ""}`, {
          headers: { Authorization: `Basic ${Buffer.from(`siso:${pw}`).toString("base64")}` },
          redirect: "manual", signal: AbortSignal.timeout(15_000),
        });
      } catch { return fail(res, 502, "the library site did not answer"); }
      const type = r.headers.get("content-type") ?? "application/octet-stream";
      const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": "no-store" };
      const loc = r.headers.get("location");
      if (loc) headers.Location = loc.startsWith("/") ? PREFIX + loc : loc.replace(site, PREFIX);
      if (type.includes("text/html")) {
        const body = hubTheme(rebase(await r.text()));
        res.writeHead(r.status, headers);
        return void res.end(body);
      }
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
    },
  };
}
export const route = peopleRoute();
