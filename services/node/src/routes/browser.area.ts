import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { frameable, reach } from "../browser-reach.ts";
import { importCounts, readBrowserImport, readHistory, saveHistory, suggest } from "../browser-import.ts";
import { cleanState, mergeBrowserState, readBrowserState, writeBrowserState } from "../browser-state.ts";
import { canOpen, downloadFile, downloadInfo } from "../browser-downloads.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function browserDiagnosticRoutes(runtime: Pick<HttpRuntime, "json" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { json, readBody } = runtime;
      if (req.method === "POST" && url.pathname === "/api/browser/diagnostic") {
        const b = JSON.parse(await readBody(req, 2048));
        if (!["browser_open", "browser_bounds", "browser_visible", "browser_navigate"].includes(b?.command) ||
            !["started", "ok", "error", "timeout"].includes(b?.status) || typeof b?.tab !== "string" || b.tab.length > 600)
          return json(res, 400, { error: "invalid browser diagnostic" });
        const tab = `browser-page-${createHash("sha256").update(`siso.agent-base.browser.tab.v1:${b.tab}`).digest("hex").slice(0, 20)}`;
        const bounds = [b.x, b.y, b.width, b.height];
        console.log(JSON.stringify({ event: "browser-command", at: new Date().toISOString(), tab, command: b.command, status: b.status,
          ...(bounds.every(v => typeof v === "number" && Number.isFinite(v)) ? { bounds } : {}),
          ...(typeof b.visible === "boolean" ? { visible: b.visible } : {}) }));
        return json(res, 200, { ok: true });
      }
      return false;
    },
  };
}

export function browserRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "BROWSER_HISTORY" | "BROWSER_STATE" | "json" | "readBody" | "run">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, BROWSER_HISTORY, BROWSER_STATE, json, readBody, run } = runtime;
      // A site's own icon for the browser rows, fetched from the site and cached on disk (favicons.ts).
      if (req.method === "GET" && url.pathname === "/api/browser/favicon") {
        const { faviconFor } = await import("../favicons.ts");
        const icon = await faviconFor(url.searchParams.get("url") ?? "");
        if (!icon) { res.writeHead(404, { "cache-control": "max-age=3600" }); res.end(); return true; }
        res.writeHead(200, { "content-type": icon.type, "cache-control": "max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }); res.end(icon.body); return true;
      }
      // The ad and tracker blocker's rules, in WebKit's format, for the desktop app to compile once (adblock.ts).
      if (req.method === "GET" && url.pathname === "/api/browser/adblock") {
        const { adblockRules } = await import("../adblock.ts");
        const built = await adblockRules();
        if (!built) return json(res, 503, { error: "the filter lists have not been fetched yet" });
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ version: built.version, count: built.count, rules: built.rules }));
        return true;
      }
      // A link clicked in the app (ab-152): the desktop window cannot open new windows itself, so the node hands an
      // http(s) URL to macOS, which opens it in his default browser. This app's own page only.
      if (url.pathname === "/api/open" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const target = JSON.parse((await readBody(req)) || "{}").url;
        if (typeof target !== "string" || !/^https?:\/\/[^\s]+$/.test(target)) return json(res, 400, { error: "url must be http(s)" });
        if (process.env.AB_OPEN_DRY) return json(res, 200, { ok: true, dry: target });
        await run("open", [target]);
        return json(res, 200, { ok: true });
      }
      // The Rolodex (ab-145): people and their projects from SISO_Agency/clients/CLIENTS.json, read-only.
      if (url.pathname === "/api/browser/state" && req.method === "GET") return json(res, 200, readBrowserState(BROWSER_STATE));
      if (url.pathname === "/api/browser/state" && req.method === "PUT") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let state;
        try { state = cleanState(JSON.parse((await readBody(req)) || "null")); } catch { state = null; }
        if (!state) return json(res, 400, { error: "a browser state object" });
        try { writeBrowserState(BROWSER_STATE, state); } catch (e) { return json(res, 413, { error: String(e instanceof Error ? e.message : e) }); }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/browser/state" && req.method === "PATCH") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let patch;
        try { patch = JSON.parse((await readBody(req)) || "null"); } catch { patch = null; }
        if (!cleanState(patch)) return json(res, 400, { error: "a browser state patch" });
        try { mergeBrowserState(BROWSER_STATE, patch); } catch (e) { return json(res, 413, { error: String(e instanceof Error ? e.message : e) }); }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/browser/import" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        // His Arc spaces and Chrome accounts, read in place, plus a fresh history index; the log line carries counts only.
        const home = process.env.AB_BROWSER_HOME ?? homedir();
        const data = readBrowserImport(home);
        const history = readHistory(home);
        saveHistory(BROWSER_HISTORY, history);
        console.log(`browser import ${JSON.stringify({ ...importCounts(data), history: history.length })}`);
        return json(res, 200, { ...data, history: history.length });
      }
      // An empty page the desktop loads, hidden, on an account's store to check its sign-in: a real load is what makes
      // WebKit read that store's saved cookies (browser.rs browser_session_state). Nothing in it, nothing sent back.
      if (url.pathname === "/api/browser/blank" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); return void res.end(); }
      // First run, step 1 (A0 browser-UX spec §3): what is on this Mac, as counts only; nothing is copied until the POST above.
      if (url.pathname === "/api/browser/import" && req.method === "GET") return json(res, 200, importCounts(readBrowserImport(process.env.AB_BROWSER_HOME ?? homedir())));
      // First run, step 4: Chrome's own password export page, opened in Chrome, for him to export into Apple Passwords himself.
      // The app never sees a password; it only asks macOS to open this one fixed page.
      if (url.pathname === "/api/browser/chrome-passwords" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const page = "chrome://password-manager/settings";
        if (process.env.AB_OPEN_DRY) return json(res, 200, { ok: true, dry: page });
        try { await run("open", ["-a", "Google Chrome", page]); } catch { return json(res, 404, { error: "Google Chrome is not installed" }); }
        return json(res, 200, { ok: true });
      }
      // The downloads popover's "Show in Finder": reveals (never opens) a file the browser saved, by name and agent only.
      if (url.pathname === "/api/browser/reveal" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: { name?: unknown; agent?: unknown } = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered as missing below */ }
        const home = process.env.AB_BROWSER_HOME ?? homedir();
        const file = downloadFile(home, b.name, b.agent);
        if (!file) return json(res, 404, { error: "That file is no longer in Downloads" });
        if (process.env.AB_OPEN_DRY) return json(res, 200, { ok: true, dry: path.relative(home, file) });
        try { await run("open", ["-R", file]); } catch { return json(res, 500, { error: "Finder could not show it" }); }
        return json(res, 200, { ok: true });
      }
      // The download toast (arc-edges §5.5): the file's size, and whether Open is offered for its kind.
      if (url.pathname === "/api/browser/download-info" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: { name?: unknown; agent?: unknown } = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered as missing below */ }
        const info = downloadInfo(process.env.AB_BROWSER_HOME ?? homedir(), b.name, b.agent);
        return info ? json(res, 200, info) : json(res, 404, { error: "That file is no longer in Downloads" });
      }
      // The toast's "Open": a downloaded document opened by macOS in its own app. Never anything that could run (canOpen).
      if (url.pathname === "/api/browser/open-download" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: { name?: unknown; agent?: unknown } = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered as missing below */ }
        const home = process.env.AB_BROWSER_HOME ?? homedir();
        const file = downloadFile(home, b.name, b.agent);
        if (!file) return json(res, 404, { error: "That file is no longer in Downloads" });
        if (!canOpen(file)) return json(res, 415, { error: "Only shown in Finder" });
        if (process.env.AB_OPEN_DRY) return json(res, 200, { ok: true, dry: path.relative(home, file) });
        try { await run("open", [file]); } catch { return json(res, 500, { error: "macOS could not open it" }); }
        return json(res, 200, { ok: true });
      }
      // A page that never finished loading (arc-edges §5.1): did its site answer at all? One HEAD, no cookies, 5 s cap.
      if (url.pathname === "/api/browser/reach" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: { url?: unknown } = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered as not an address */ }
        return json(res, 200, await reach(String(b.url ?? "")));
      }
      // The web app's iframe (outside the desktop app): can this page show in a frame at all? (9 Oct: GitHub, password sites.)
      if (url.pathname === "/api/browser/frame" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: { url?: unknown } = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered as "try the frame" */ }
        return json(res, 200, await frameable(String(b.url ?? "")));
      }
      // The error page's and the slow strip's "Open in Chrome": a web address only, opened by macOS in Google Chrome.
      if (url.pathname === "/api/browser/open-in-chrome" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let b: { url?: unknown } = {};
        try { b = JSON.parse((await readBody(req)) || "{}"); } catch { /* answered as not an address */ }
        let page: URL;
        try { page = new URL(String(b.url ?? "")); } catch { return json(res, 400, { error: "not an address" }); }
        if (page.protocol !== "http:" && page.protocol !== "https:") return json(res, 400, { error: "not a web address" });
        if (process.env.AB_OPEN_DRY) return json(res, 200, { ok: true, dry: page.href });
        try { await run("open", ["-a", "Google Chrome", page.href]); } catch { return json(res, 404, { error: "Google Chrome is not installed" }); }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/browser/suggest" && req.method === "GET") return json(res, 200, { pages: suggest(BROWSER_HISTORY, (url.searchParams.get("q") ?? "").slice(0, 200)) });
      return false;
    },
  };
}
