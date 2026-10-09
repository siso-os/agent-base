// What Shaan's Arc and Chrome already hold, read in place for the Browser's "Import from Arc and Chrome" (A0 PLAN item 4).
// Reads Arc's StorableSidebar.json, Chrome's Local State (profile names and addresses), each profile's Bookmarks and, for
// address-bar suggestions, a copy of each History database (page addresses and titles only). Never Cookies, Login Data or
// the keychain: no secret is opened, so none can leak.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArcSidebar, type BrowserImport } from "../../../apps/web/src/lib/webview.ts";
import { safePage } from "../../../apps/web/src/lib/browser-tabs.ts";

const SUPPORT = "Library/Application Support";
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const readJson = (file: string): Json | null => {
  try { return obj(JSON.parse(readFileSync(file, "utf8"))); } catch { return null; }
};
const safeUrl = (raw: unknown) => {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};

/** Chrome's bookmark tree (roots.bookmark_bar / other / synced) flattened to web links, folders walked, at most 500. */
export function chromeBookmarks(file: Json | null): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const walk = (node: unknown, depth: number) => {
    const n = obj(node);
    if (out.length >= 500 || depth > 20) return;
    const url = n.type === "url" ? safeUrl(n.url) : null;
    if (url && !out.some((b) => b.url === url)) out.push({ url, title: typeof n.name === "string" && n.name ? n.name : new URL(url).host });
    if (Array.isArray(n.children)) for (const c of n.children) walk(c, depth + 1);
  };
  for (const root of Object.values(obj(obj(file).roots))) walk(root, 0);
  return out;
}

export function readBrowserImport(home = homedir()): BrowserImport {
  let spaces: BrowserImport["arc"]["spaces"] = [];
  let arcFound = false;
  try {
    spaces = parseArcSidebar(readFileSync(path.join(home, SUPPORT, "Arc/StorableSidebar.json"), "utf8")).map((space) => ({
      ...space, pins: space.pins.map((pin) => ({ ...pin, origin: "arc" as const })),
    }));
    arcFound = true;
  } catch { /* no Arc, or a sidebar we cannot read: nothing to import */ }
  const chromeDir = path.join(home, SUPPORT, "Google/Chrome");
  const state = readJson(path.join(chromeDir, "Local State"));
  const cache = obj(obj(state?.profile).info_cache);
  const accounts = Object.entries(cache)
    .filter(([dir]) => /^(Default|Profile \d+)$/.test(dir))
    .map(([dir, info]) => {
      const i = obj(info);
      const email = typeof i.user_name === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.user_name) ? i.user_name : undefined;
      const name = typeof i.name === "string" && i.name ? i.name : dir;
      return { dir, name, email, bookmarks: chromeBookmarks(readJson(path.join(chromeDir, dir, "Bookmarks"))) };
    })
    .sort((a, b) => (a.dir === "Default" ? -1 : b.dir === "Default" ? 1 : Number(a.dir.slice(8)) - Number(b.dir.slice(8))));
  return { arc: { found: arcFound, spaces }, chrome: { found: state !== null, accounts } };
}

/** Counts only, for logs and dry runs: no names, addresses or URLs. */
export function importCounts(data: BrowserImport) {
  const favourites = data.arc.spaces.find((s) => s.id === "arc-favorites")?.pins.length ?? 0;
  const spaces = data.arc.spaces.filter((s) => s.id !== "arc-favorites");
  return {
    arc: { found: data.arc.found, spaces: spaces.length, favourites, pinned: spaces.reduce((n, s) => n + s.pins.length, 0), today: spaces.reduce((n, s) => n + (s.today?.length ?? 0), 0) },
    chrome: { found: data.chrome.found, profiles: data.chrome.accounts.length, signedIn: data.chrome.accounts.filter((a) => a.email).length, bookmarks: data.chrome.accounts.reduce((n, a) => n + a.bookmarks.length, 0) },
  };
}

export type HistoryEntry = { url: string; title: string; visits: number; last: number };
const HISTORY_LIMIT = 5000;
// Chrome stores microseconds since 1601, past JavaScript's safe integers: SQL divides to milliseconds first.
const chromeTime = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, ms - 11644473600000) : 0);

/** Every History database Chrome and Arc keep: one per profile. */
function historyFiles(home: string) {
  const files: string[] = [];
  for (const root of ["Google/Chrome", "Arc/User Data"]) {
    const dir = path.join(home, SUPPORT, root);
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) if (/^(Default|Profile \d+)$/.test(name) && existsSync(path.join(dir, name, "History"))) files.push(path.join(dir, name, "History"));
  }
  return files;
}

/** The most visited safe pages across every profile, merged by address. A running browser locks its database, so each one
 * is copied to a private temp folder, read, and the copy deleted. Sign-in, OAuth and token-bearing addresses are dropped. */
export function readHistory(home = homedir(), limit = HISTORY_LIMIT): HistoryEntry[] {
  const merged = new Map<string, HistoryEntry>();
  const scratch = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-browser-history."));
  try {
    historyFiles(home).forEach((file, i) => {
      const copy = path.join(scratch, `h${i}.sqlite`);
      let db: DatabaseSync | undefined;
      try {
        copyFileSync(file, copy);
        db = new DatabaseSync(copy, { readOnly: true });
        const rows = db.prepare("SELECT url, title, visit_count, last_visit_time / 1000 AS last_ms FROM urls WHERE hidden = 0 ORDER BY visit_count DESC LIMIT ?").all(limit * 2) as { url: unknown; title: unknown; visit_count: unknown; last_ms: unknown }[];
        for (const r of rows) {
          if (typeof r.url !== "string" || r.url.length > 2048 || !safePage({ url: r.url, title: "" })) continue;
          const url = new URL(r.url).href;
          const title = typeof r.title === "string" ? r.title.slice(0, 300) : "";
          const visits = Number(r.visit_count) || 0, last = chromeTime(r.last_ms);
          const old = merged.get(url);
          if (old) { old.visits += visits; old.last = Math.max(old.last, last); if (!old.title) old.title = title; }
          else merged.set(url, { url, title, visits, last });
        }
      } catch { /* an unreadable or foreign database: skip it */ }
      finally { db?.close(); rmSync(copy, { force: true }); }
    });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  return [...merged.values()].sort((a, b) => b.visits - a.visits || b.last - a.last).slice(0, limit);
}

export function saveHistory(file: string, entries: HistoryEntry[]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(entries), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

let cache: { stamp: string; entries: HistoryEntry[] } | undefined;
/** Up to `n` pages whose address or title holds every word typed, most visited first. */
export function suggest(file: string, q: string, n = 8): { url: string; title: string }[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  let stamp = "";
  try { const st = statSync(file); stamp = `${st.mtimeMs}:${st.size}`; } catch { return []; }
  if (cache?.stamp !== stamp) {
    try { cache = { stamp, entries: JSON.parse(readFileSync(file, "utf8")) as HistoryEntry[] }; } catch { return []; }
  }
  const out: { url: string; title: string }[] = [];
  for (const e of cache.entries) {
    const hay = `${e.url} ${e.title}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push({ url: e.url, title: e.title });
    if (out.length >= n) break;
  }
  return out;
}
