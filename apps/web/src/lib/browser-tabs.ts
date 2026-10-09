// The fields a remembered tab keeps; agents.ts Page is a superset. Kept local so the node can import safePage.
type Page = { url: string; title: string; at?: number };

const KEY = "agent-base:browser-today";
export type BrowserTabs = Record<string, Page[]>;

/** An agent's console card (console-post, :8891): an agent's page, never one of his Today tabs. */
const agentPage = (url: URL) => /^(127\.0\.0\.1|localhost)$/.test(url.hostname) && url.port === "8891";
// Login URLs are transient. Never persist credentials or OAuth payloads in the tab list.
function safeStoredPage(value: unknown, includeAgentPages: boolean): value is Page {
  if (!value || typeof value !== "object") return false;
  const page = value as Page;
  if (typeof page.url !== "string" || typeof page.title !== "string") return false;
  try {
    const url = new URL(page.url);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      url.hostname !== "accounts.google.com" && (includeAgentPages || !agentPage(url)) && !/(^|\/)(oauth|authorize|login|signin)(\/|$)/i.test(url.pathname) &&
      ![...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some((key) => /^(code|.*token.*|password|state)$/i.test(key));
  } catch { return false; }
}

/** Today excludes agent console cards; a deliberately saved folder may organise those pins. */
export function safePage(value: unknown): value is Page { return safeStoredPage(value, false); }
export function safeFolderPin(value: unknown): value is Page { return safeStoredPage(value, true); }

export function loadBrowserTabs(store: Pick<Storage, "getItem">, now = Date.now()): BrowserTabs {
  try {
    const raw: unknown = JSON.parse(store.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([id, pages]) => id.length <= 160 && Array.isArray(pages))
      .map(([id, pages]) => [id, (pages as unknown[]).filter(safePage).filter((p) => p.at === undefined || (Number.isFinite(p.at) && p.at > now - 12 * 60 * 60 * 1000)).slice(-50).map(({ url, title, at }) => ({ url, title, at: at ?? now }))]));
  } catch { return {}; }
}

export function rememberBrowserTab(tabs: BrowserTabs, profile: string, page: Page): BrowserTabs {
  if (!safePage(page)) return tabs;
  const previous = tabs[profile] ?? [];
  // Preserve Arc's tab order when the active tab is revisited.
  const index = previous.findIndex((p) => p.url === page.url);
  const saved = { url: page.url, title: page.title, at: page.at };
  const next = index < 0 ? [...previous, saved] : previous.map((p, i) => i === index ? saved : p);
  return { ...tabs, [profile]: next.slice(-50) };
}

export function saveBrowserTabs(tabs: BrowserTabs, store: Pick<Storage, "setItem">) {
  store.setItem(KEY, JSON.stringify(tabs));
}

/** A row's name: its title, else the host and the first meaningful path part ("mail.google.com", "github.com · sisodias"),
 * never the raw address with its /u/0/. */
/** A title that is really an address ("www.youtube.com", "127.0.0.1:8891/card/x"): not worth showing as a name. */
export const looksLikeAddress = (t: string) => /^(https?:\/\/)?(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(t.trim());
export function rowTitle(p: { url: string; title?: string }) {
  // "(112) Home / X": the unread count is the site talking, not the page's name.
  const title = p.title?.trim().replace(/^\(\d+\+?\)\s+/, "");
  if (title && !looksLikeAddress(title)) return title;
  try {
    const u = new URL(p.url);
    // The page's own last name in the path ("card/x/html" → "x"), after the site: ":8891 · AGENT-BASE-bell" for this Mac's servers.
    const parts = u.pathname.split("/").filter((x) => x && !/^(u|\d+|mail|index\.html?|html|card|static)$/i.test(x));
    const part = parts.at(-1);
    const site = /^(127\.0\.0\.1|localhost)$/.test(u.hostname) ? `:${u.port || 80}` : u.hostname.replace(/^www\./, "");
    return site + (part ? ` · ${decodeURIComponent(part).replace(/\.[a-z]{2,4}$/i, "").slice(0, 40)}` : "");
  } catch { return p.url; }
}

/** An address as a page, not as it was written: the host's case, a trailing slash and an empty "#" don't make another
 * page (a link to `http://host:5410` lands on `http://host:5410/`). */
export function urlKey(raw: string) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}${u.hash === "#" ? "" : u.hash}`;
  } catch { return raw.trim(); }
}
export const sameUrl = (a: string, b: string) => !!a && !!b && urlKey(a) === urlKey(b);

/** The web tabs to close because another tab of the same agent already shows that page: in each group the tab `keep`
 * (the one on screen) stays, else the first. Tabs with no address yet (a blank new tab) are never duplicates. */
export function duplicateTabs(tabs: { id: string; kind: string; owner: string }[], urlOf: (id: string) => string, keep?: string): string[] {
  const groups = new Map<string, string[]>();
  for (const t of tabs) {
    const url = t.kind === "web" ? urlOf(t.id) : "";
    if (!url) continue;
    const k = `${t.owner}\n${urlKey(url)}`;
    groups.set(k, [...(groups.get(k) ?? []), t.id]);
  }
  return [...groups.values()].flatMap((ids) => {
    const stay = keep && ids.includes(keep) ? keep : ids[0];
    return ids.filter((id) => id !== stay);
  });
}

/** Saved-page organisation is separate from profile/cookie identity and from the pin records themselves.
 * Folder URLs reference the existing pins; removing a folder never deletes a saved page. */
export type BrowserFolder = { id: string; space: string; name: string; parentId?: string; collapsed: boolean; urls: string[] };
export const FOLDERS_KEY = "agent-base:browser-folders";
export const MAX_FOLDER_DEPTH = 8;
export function cleanBrowserFolders(raw: unknown): BrowserFolder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), placed = new Set<string>();
  const rows: BrowserFolder[] = [];
  for (const item of raw.slice(0, 1000)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || r.id.length > 160 || /[\u0000-\u001f\u007f]/.test(r.id) || seen.has(r.id) || typeof r.space !== "string" || !r.space || r.space.length > 160 || /[\u0000-\u001f\u007f]/.test(r.space) || typeof r.name !== "string" || !r.name.trim() || /[\u0000-\u001f\u007f]/.test(r.name)) continue;
    seen.add(r.id);
    const urls = (Array.isArray(r.urls) ? r.urls : []).filter((url): url is string => {
      if (typeof url !== "string" || !safeFolderPin({ url, title: "" }) || placed.has(`${r.space}\n${url}`)) return false;
      placed.add(`${r.space}\n${url}`); return true;
    });
    rows.push({ id: r.id, space: r.space, name: r.name.trim().slice(0, 80), parentId: typeof r.parentId === "string" ? r.parentId : undefined, collapsed: r.collapsed === true, urls });
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  // A missing/cross-space parent, cycle or excessive depth is recovered at the root.
  for (const row of rows) {
    let parent = row.parentId, depth = 1;
    const ancestors = new Set([row.id]);
    while (parent) {
      const p = byId.get(parent);
      if (!p || p.space !== row.space || ancestors.has(parent) || ++depth > MAX_FOLDER_DEPTH) { row.parentId = undefined; break; }
      ancestors.add(parent); parent = p.parentId;
    }
  }
  return rows;
}
export function loadBrowserFolders(store: Pick<Storage, "getItem">): BrowserFolder[] {
  try { return cleanBrowserFolders(JSON.parse(store.getItem(FOLDERS_KEY) ?? "[]")); } catch { return []; }
}
export function saveBrowserFolders(folders: BrowserFolder[], store: Pick<Storage, "setItem">) {
  store.setItem(FOLDERS_KEY, JSON.stringify(cleanBrowserFolders(folders)));
}
export function canMoveBrowserFolder(folders: BrowserFolder[], id: string, parentId?: string): boolean {
  const row = folders.find((f) => f.id === id);
  if (!row) return false;
  let cursor = parentId, depth = 1;
  const seen = new Set([id]);
  while (cursor) {
    const p = folders.find((f) => f.id === cursor);
    if (!p || p.space !== row.space || seen.has(cursor)) return false;
    seen.add(cursor); depth++; cursor = p.parentId;
  }
  const descendants = (parent: string, seen = new Set<string>()): number => {
    if (seen.has(parent)) return MAX_FOLDER_DEPTH;
    const next = new Set(seen).add(parent);
    return Math.max(0, ...folders.filter((f) => f.parentId === parent).map((f) => 1 + descendants(f.id, next)));
  };
  return depth + descendants(id) <= MAX_FOLDER_DEPTH;
}
export function moveBrowserFolder(folders: BrowserFolder[], id: string, parentId?: string): BrowserFolder[] {
  if (!canMoveBrowserFolder(folders, id, parentId)) return folders;
  return folders.map((f) => f.id === id ? { ...f, parentId } : f.id === parentId ? { ...f, collapsed: false } : f);
}
export function fileBrowserPin(folders: BrowserFolder[], space: string, url: string, folderId?: string): BrowserFolder[] {
  if (folderId && !folders.some((f) => f.id === folderId && f.space === space)) return folders;
  return folders.map((f) => f.space !== space ? f : { ...f, urls: [...f.urls.filter((u) => u !== url), ...(f.id === folderId ? [url] : [])], ...(f.id === folderId ? { collapsed: false } : {}) });
}
export function removeBrowserFolder(folders: BrowserFolder[], id: string): BrowserFolder[] {
  const row = folders.find((f) => f.id === id);
  if (!row) return folders;
  return folders.filter((f) => f.id !== id).map((f) => ({ ...f,
    ...(f.parentId === id ? { parentId: row.parentId } : {}),
    ...(f.id === row.parentId ? { urls: [...new Set([...f.urls, ...row.urls])] } : {}),
  }));
}

/** Arc's favourites grid (Shaan, 7 Oct: "two go next to each other and then four go next to each other and then six"): up
 * to four fill one row, five and six make two rows of three, seven and eight two of four, then six a row. */
export function favouriteColumns(n: number) { return n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : n <= 8 ? 4 : 6; }
