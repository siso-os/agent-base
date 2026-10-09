import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function staticRoutes(runtime: Pick<HttpRuntime, "TYPES" | "WEB_DIST" | "sendStatic" | "worldBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { TYPES, WEB_DIST, sendStatic, worldBody } = runtime;
      // The estate world (the Estate Manager's 3D render): one self-contained page built in the estate checkout. Served from
      // there, not copied into this repo, because it names clients (WORLD-SPEC §3). AB_ESTATE_WORLD overrides the path.
      if (url.pathname === "/estate-world" || url.pathname === "/estate-world/") {
        const world = process.env.AB_ESTATE_WORLD ?? path.join(homedir(), "SISO_Workspace/SISO_Agents/siso-estate/plan/world/app/dist/world.html");
        if (existsSync(world)) {
          // A0, 3 Oct: it was served uncached, so every open re-read and re-parsed 2.8 MB. Now /estate-world/ redirects to a
          // URL named by the build (mtime + size), which is cached for a year and sent brotli or gzip, compressed once per build.
          const w = worldBody(world);
          if (url.searchParams.get("v") !== w.key) {
            res.writeHead(302, { location: `/estate-world/?v=${w.key}`, "cache-control": "no-store" });
            return void res.end();
          }
          const enc = String(req.headers["accept-encoding"] ?? "");
          const [body, ce] = /\bbr\b/.test(enc) ? [w.br, "br"] : /\bgzip\b/.test(enc) ? [w.gz, "gzip"] : [w.raw, ""];
          res.writeHead(200, { "content-type": "text/html", "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding", "content-length": body.length, ...(ce ? { "content-encoding": ce } : {}) });
          return void res.end(body);
        }
        res.writeHead(404, { "content-type": "text/html" });
        return void res.end(`<body style="font:15px system-ui;padding:2rem;background:#111;color:#eee">The estate world is not built on this machine (expected ${world}). Build it with <code>npm run build</code> in siso-estate/plan/world/app, or open the live page: <a style="color:#8cf" href="https://siso-estate-world.dtc-storefront.workers.dev" target="_blank">siso-estate-world.dtc-storefront.workers.dev</a>.</body>`);
      }
      // The Great Library reader (LIBRARY's static site: docs, shelves, Pagefind search), the Library half of the Estate
      // space. Served from its build folder, not copied in, because it holds the local-only docs. AB_LIBRARY_SITE overrides it.
      if (url.pathname === "/library-site" || url.pathname.startsWith("/library-site/")) {
        const root = path.resolve(process.env.AB_LIBRARY_SITE ?? path.join(homedir(), "SISO_Workspace/_data/great-library/reader-dist"));
        if (url.pathname === "/library-site") { res.writeHead(301, { location: "/library-site/" }); return void res.end(); }
        let rel = "";
        try { rel = decodeURIComponent(url.pathname.slice("/library-site/".length)); } catch { rel = ""; }
        let file = path.resolve(root, rel);
        if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return void res.end(); }
        if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
        if (existsSync(file) && statSync(file).isFile()) {
          const ext = path.extname(file);
          const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".json" ? "application/json" : ext === ".txt" ? "text/plain; charset=utf-8" : TYPES[ext] ?? "application/octet-stream";
          // Pagefind's index and fragments are named by content hash; pages and catalogue rebuild hourly.
          return sendStatic(req, res, file, type, /^\.pf_(fragment|index|meta)$/.test(ext) ? "public, max-age=31536000, immutable" : "no-cache");
        }
        res.writeHead(404, { "content-type": "text/html" });
        return void res.end(`<body style="font:15px system-ui;padding:2rem;background:#111;color:#eee">${existsSync(root) ? "No such page in the Library." : `The Library is not built on this machine (expected ${root}). Build it with <code>node build.mjs</code> in Great_Library_of_SISO/reader.`}</body>`);
      }
      // Built screens, when the window loads them from this node instead of the dev server.
      const file = path.join(WEB_DIST, url.pathname === "/" ? "index.html" : url.pathname);
      if (file.startsWith(WEB_DIST) && existsSync(file) && statSync(file).isFile()) {
        const hashed = url.pathname.startsWith("/assets/") && /[-.][A-Za-z0-9_-]{8,}\./.test(path.basename(file));
        return sendStatic(req, res, file, TYPES[path.extname(file)] ?? "application/octet-stream", hashed ? "public, max-age=31536000, immutable" : "no-cache");
      }
      if (existsSync(path.join(WEB_DIST, "index.html")) && !url.pathname.startsWith("/api/")) {
        return sendStatic(req, res, path.join(WEB_DIST, "index.html"), "text/html; charset=utf-8", "no-cache");
      }
      return false;
    },
  };
}
