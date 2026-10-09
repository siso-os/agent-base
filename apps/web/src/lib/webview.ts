import { loadBrowserTabs, saveBrowserTabs, type BrowserFolder, cleanBrowserFolders, loadBrowserFolders, saveBrowserFolders, safePage } from "./browser-tabs.ts";
import { anyMovesLayout } from "./layout-mutations.ts";
/** Native pages get no app IPC. Only the main app can invoke these bounded browser commands. */
type Bridge = { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>; transformCallback?: (cb: (event: { payload: unknown }) => void, once?: boolean) => number };
const bridge = () => (window as unknown as { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__;
const normalize = (raw: string) => { try { return new URL(raw).href; } catch { return raw; } };
export const nativeBrowserAvailable = () => Boolean(bridge());

// Serialize teardown and creation across tab switches (including React StrictMode's mount replay).
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work);
  tail = next.catch(() => undefined);
  return next;
}
function invoke<T = void>(command: string, args?: Record<string, unknown>) {
  const ipc = bridge();
  if (!ipc) return Promise.reject(new Error("Open this page in the Agent Base desktop dev app."));
  if (!["browser_open", "browser_bounds", "browser_visible", "browser_navigate"].includes(command)) return ipc.invoke<T>(command, args);
  // Send only bounded fields; native errors can contain private URLs or account names.
  const report = (status: string) => {
    const { tab, x, y, width, height, visible } = args ?? {};
    void fetch("/api/browser/diagnostic", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, status, tab, x, y, width, height, visible }) }).catch(() => undefined);
  };
  // Only what went wrong is reported (browser v3, 7 Oct): a "started" and an "ok" for every move, show and hide were two
  // requests to the node per command, competing with the chat and owner streams for WebKit's six connections.
  const timeout = window.setTimeout(() => report("timeout"), 10_000);
  return ipc.invoke<T>(command, args).catch((error: unknown) => {
    report("error"); throw error;
  }).finally(() => window.clearTimeout(timeout));
}

/** Native application-menu shortcuts and window transitions. Remote pages receive no IPC or injected key handler. */
export type BrowserShortcut = { tab: string; action: "toggle-sidebar" | "new-tab" | "spotlight" | `space-${number}` };
// Each window hears only what is sent to it (and what is sent to all): a listener on "Any" also hears events aimed at the
// other window, so a link opened from the SISO Browser window would open a tab in Agent Base as well (t-0439).
function browserEvent(event: string, receive: (payload: unknown) => void): () => void {
  const ipc = bridge();
  if (!ipc?.transformCallback) return () => {};
  let disposed = false;
  const handler = ipc.transformCallback(({ payload }) => { if (!disposed) receive(payload); });
  const id = ipc.invoke<number>("plugin:event|listen", { event, target: { kind: "AnyLabel", label: shellWindow() }, handler }).catch(() => null);
  return () => { disposed = true; void id.then((eventId) => { if (eventId !== null) void ipc.invoke("plugin:event|unlisten", { event, eventId }).catch(() => undefined); }); };
}
export function onBrowserShortcut(cb: (shortcut: BrowserShortcut) => void): () => void {
  return browserEvent("browser-shortcut", (payload) => {
    if (!Array.isArray(payload) || typeof payload[0] !== "string" || payload[0].length > 600 || typeof payload[1] !== "string") return;
    if (payload[1] === "toggle-sidebar" || payload[1] === "new-tab" || payload[1] === "spotlight" || /^space-[1-9]$/.test(payload[1])) cb({ tab: payload[0], action: payload[1] as BrowserShortcut["action"] });
  });
}
export function onBrowserWindowChange(cb: (fullscreen: boolean) => void): () => void {
  return browserEvent("browser-window-state", (payload) => { if (typeof payload === "boolean") cb(payload); });
}

/** Start loading what the pointer rests on, hidden and silent, on the profile a click would use (t-0494): a click on that
 * address adopts the page instead of starting from nothing. One per window; not queued behind page work. */
let prefetched = "";
export function prefetchPage(url: string, profile: string) {
  const key = `${normalize(url)}#${profile}`;
  if (!bridge() || key === prefetched || [...awake.values()].some((p) => p.url === normalize(url))) return;
  prefetched = key;
  void invoke("browser_prefetch", { rawUrl: normalize(url), profile, width: Math.max(320, innerWidth - 300), height: Math.max(240, innerHeight - 60) }).catch(() => { prefetched = ""; });
}
/** Which app window this is: Agent Base ("main") or the SISO Browser window it pops tabs out into ("browser", t-0439). */
export function shellWindow(): "main" | "browser" { return new URLSearchParams(location.search).get("window") === "browser" ? "browser" : "main"; }
/** A tab's page moved to the other window (`to`). The window it left stops drawing it; the page itself, live, went across. */
export function onPageMoved(cb: (key: string, to: string) => void): () => void {
  return browserEvent("browser-page-moved", (payload) => {
    if (Array.isArray(payload) && typeof payload[0] === "string" && payload[0].length <= 600 && typeof payload[1] === "string") cb(payload[0], payload[1]);
  });
}
/** The SISO Browser window was asked to show another tab (popped out while it was already open). */
export function onWindowTab(cb: (tab: { tab: string; url: string; title: string }) => void): () => void {
  return browserEvent("browser-window-tab", (payload) => {
    if (Array.isArray(payload) && typeof payload[0] === "string" && typeof payload[1] === "string" && typeof payload[2] === "string") cb({ tab: payload[0], url: payload[1], title: payload[2] });
  });
}
/** Open (or focus) the SISO Browser window with this tab, which carries the tab's live page over; or close it, which brings its
 * pages back. Queued behind this window's own page work, so a hide in flight lands first. */
export function browserWindow(open: true, tab: { tab: string; url: string; title: string }): Promise<void>;
export function browserWindow(open: false): Promise<void>;
export function browserWindow(open: boolean, tab?: { tab: string; url: string; title: string }) {
  return serial(() => invoke("browser_window", { open, tab: tab?.tab ?? null, rawUrl: tab?.url ?? null, title: tab?.title ?? null }));
}

/** A page's download, as it starts and when it finishes (the native side saves it in ~/Downloads, or an agent's tab's in
 * ~/Downloads/Agents/<AGENT>/): the file name only, whether it worked, and the agent, if any. */
export type DownloadNote = { phase: "started" | "finished"; name: string; ok: boolean; agent: string | null };
export function onDownload(cb: (note: DownloadNote) => void): () => void {
  const ipc = bridge();
  if (!ipc?.transformCallback) return () => {};
  const handler = ipc.transformCallback(({ payload }) => {
    if (Array.isArray(payload) && (payload[0] === "started" || payload[0] === "finished") && typeof payload[1] === "string") {
      cb({ phase: payload[0], name: payload[1], ok: payload[2] === true, agent: typeof payload[3] === "string" ? payload[3] : null });
    }
  });
  const id = ipc.invoke<number>("plugin:event|listen", { event: "browser-download", target: { kind: "AnyLabel", label: shellWindow() }, handler }).catch(() => null);
  return () => { void id.then((eventId) => { if (eventId !== null) void ipc.invoke("plugin:event|unlisten", { event: "browser-download", eventId }).catch(() => undefined); }); };
}

/** A site behind a password (HTTP Basic, like the siso-ui-hub worker) asked; the native page waits until he answers. */
export type SiteAuth = { id: number; tab: string; host: string; realm: string; retry: boolean };
const isAuth = (v: unknown): v is SiteAuth => { const a = v as SiteAuth; return !!a && typeof a.id === "number" && typeof a.tab === "string" && typeof a.host === "string" && typeof a.realm === "string" && typeof a.retry === "boolean"; };
export function onSiteAuth(cb: (ask: SiteAuth) => void): () => void {
  return browserEvent("browser-auth", (payload) => { if (isAuth(payload)) cb(payload); });
}
/** What is already waiting on this page (asked before this view was listening). */
export const siteAuthPending = (tab: string) => bridge() ? invoke<unknown[]>("browser_auth_pending", { tab }).then((v) => (Array.isArray(v) ? v.filter(isAuth) : []), () => []) : Promise.resolve([] as SiteAuth[]);
/** His answer: a user and password signs in (WebKit keeps it in the keychain); nothing cancels. Never logged. */
export const answerSiteAuth = (id: number, login?: { user: string; password: string }) =>
  invoke("browser_auth", { id, user: login?.user ?? null, password: login?.password ?? null });

/** A link in one of his pages that asked for a new window with no size (target=_blank, a plain window.open): the native
 * side sends its address here, to open as a Web tab. A sized one (Sign in with Google) stays a popup over the page. */
export function onNewTab(cb: (url: string) => void): () => void {
  const ipc = bridge();
  if (!ipc?.transformCallback) return () => {};
  const handler = ipc.transformCallback(({ payload }) => { if (typeof payload === "string" && /^https?:\/\//i.test(payload)) cb(payload); });
  const id = ipc.invoke<number>("plugin:event|listen", { event: "browser-new-tab", target: { kind: "AnyLabel", label: shellWindow() }, handler }).catch(() => null);
  return () => { void id.then((eventId) => { if (eventId !== null) void ipc.invoke("plugin:event|unlisten", { event: "browser-new-tab", eventId }).catch(() => undefined); }); };
}

/** Web tabs stay alive: each tab (on each account) keeps its own native page. Leaving a tab hides it; beyond AWAKE pages
 * the least recently used sleeps (it rebuilds from its URL when opened again), except a page playing sound or one an
 * agent is driving. Eight, not four (browser v3, Shaan 7 Oct: "pages refresh when i click off of them"): a hidden WebKit
 * page is compressed by macOS, and flipping between a handful of tabs must never reload one. */
export const AWAKE = 8;
type AwakePage = { key: string; tab: string; used: number; mounted: boolean; url: string; agent?: string };
const awake = new Map<string, AwakePage>();
let clock = 0;
/** A tab's page on one account's store: the account, never the space, decides which sign-ins the page sees. */
export const pageKey = (tab: string, account: string) => `${tab}#${account}`;
/** The pages to put to sleep: the least recently used hidden ones beyond `limit`, never one that is on screen, playing, or
 * driven by an agent. */
export function pickSleepers(pages: Pick<AwakePage, "key" | "used" | "mounted" | "agent">[], playing: ReadonlySet<string>, limit = AWAKE): string[] {
  let excess = pages.length - limit;
  const out: string[] = [];
  for (const p of [...pages].filter((p) => !p.mounted && !p.agent && !playing.has(p.key)).sort((a, b) => a.used - b.used)) {
    if (excess <= 0) break;
    out.push(p.key);
    excess--;
  }
  return out;
}
let sleeping: Promise<void> | undefined;
async function enforceAwake() {
  if (awake.size <= AWAKE) return;
  // Audio eval can take three seconds on a throttled hidden page. It must never hold the foreground queue.
  if (sleeping) return sleeping;
  sleeping = (async () => {
    const candidates = [...awake.values()].filter((p) => !p.mounted && !p.agent).map((p) => ({ ...p }));
    const readings = await Promise.all(candidates.map(async (p) => ({ p, playing: await invoke<boolean>("browser_audio", { tab: p.key }).catch(() => null) })));
    await serial(async () => {
      const protectedPages = new Set([...awake.keys()]);
      for (const { p, playing } of readings) {
        const current = awake.get(p.key);
        // Unknown audio, remounted pages and a changed driver remain protected.
        if (playing === false && current && current.used === p.used && !current.mounted && !current.agent) protectedPages.delete(p.key);
      }
      for (const key of pickSleepers([...awake.values()], protectedPages)) {
        await invoke("browser_close", { tab: key });
        awake.delete(key);
      }
    });
  })().finally(() => { sleeping = undefined; });
  return sleeping;
}
/** An explicit tab close: the only thing besides sleep that destroys a tab's pages (every space it was opened in). */
export function closePage(tab: string) {
  const keys = [...awake.values()].filter((p) => p.tab === tab).map((p) => p.key);
  for (const key of keys) awake.delete(key);
  return serial(async () => { for (const key of keys) await invoke("browser_close", { tab: key }); }).catch((e: unknown) => console.error("Browser close failed", e));
}
/** Which pages are awake, for tests and the sleeping-tabs footer. */
export const awakePages = () => [...awake.values()].map((p) => ({ ...p }));
/** Is this page playing sound (unmuted media)? False when it is gone or cannot say. */
/** The ad and tracker blocker (browser v3): on unless he switched it off; the desktop app fetches and compiles the rules. */
const ADBLOCK = "agent-base:browser-adblock";
export const adblockOn = () => { try { return localStorage.getItem(ADBLOCK) !== "0"; } catch { return true; } };
export function setAdblock(on: boolean) {
  try { localStorage.setItem(ADBLOCK, on ? "1" : "0"); } catch { /* this window only */ }
  return bridge() ? invoke("browser_adblock", { enabled: on }) : Promise.resolve();
}
export const pageAudio = (key: string) => invoke<boolean>("browser_audio", { tab: key }).then((v) => v === true, () => false);
/** The speaker on a playing row: mute that page's media. */
export const mutePage = (key: string) => invoke("browser_action", { tab: key, action: "mute" });
/** The mini player's ⏯: pause what the page plays, or play again only what was paused from here. */
export const playPage = (key: string, play: boolean) => invoke("browser_action", { tab: key, action: play ? "play" : "pause" });
/** Today rows as Arc shows them: awake (a live page has that address, or it is on screen) or asleep (rebuilds from its
 * address when opened), and which awake ones are playing sound, by the page to mute. */
export function sleepState(urls: string[], pages: { key: string; url: string }[], playing: readonly string[], current: string) {
  const byUrl = new Map(pages.map((p) => [normalize(p.url), p.key]));
  const awakeRows = new Set<string>(), sound = new Map<string, string>();
  for (const u of urls) {
    const key = byUrl.get(normalize(u));
    if (key || (current && normalize(u) === normalize(current))) awakeRows.add(u);
    if (key && playing.includes(key)) sound.set(u, key);
  }
  return { awake: awakeRows, playing: sound, asleep: urls.length - awakeRows.size };
}

let watchingMoves = false;
function watchMoves() {
  if (watchingMoves || !bridge()) return;
  watchingMoves = true;
  onPageMoved((key, to) => { if (to !== shellWindow()) awake.delete(key); });
  // The desktop app keeps the awake cap too (t-0574): a page it put to sleep rebuilds from its address when shown again.
  browserEvent("browser-page-slept", (key) => {
    if (typeof key !== "string" || key.length > 600) return;
    awake.delete(key);
    slept.get(key)?.();
  });
}
/** A mounted tab whose page the desktop app put to sleep: open it again on the next measure. */
const slept = new Map<string, () => void>();
/** `onLoading` hears when the page starts and stops loading (the native side answers no address until it has finished). */
/** An app from before browser_title says no once; the rows then keep the titles they had. */
let titlesWork = true;
export function mountPage(slot: HTMLElement, initialUrl: string, onUrl: (url: string) => void, onError: (error: string) => void, profile = DEFAULT_ACCOUNT, tabId = "page", agent?: string, onLoading?: (loading: boolean) => void, onTitle?: (title: string) => void) {
  watchMoves();
  let wasLoading: boolean | undefined;
  let lastTitle = "";
  const tab = pageKey(tabId, profile);
  if (prefetched === `${normalize(initialUrl)}#${profile}`) prefetched = "";
  let disposed = false;
  // A page whose driver changed is rebuilt by browser_open (throttling is fixed when a page is made).
  const kept = (awake.get(tab)?.agent ?? null) === (agent ?? null) ? awake.get(tab) : undefined;
  if (kept) { kept.mounted = true; kept.used = ++clock; }
  // A kept page exists natively: show it where it was left, then catch up if the tab's address moved meanwhile.
  let opened = Boolean(kept);
  let dragging = false;
  let scheduled: number | undefined;
  let polling = false;
  let lastBounds = "";
  let shown: boolean | undefined;
  let currentUrl = kept?.url ?? normalize(initialUrl);
  const queuedAt = performance.now();
  const reopen = () => { opened = false; shown = undefined; lastBounds = ""; schedule(); };
  slept.set(tab, reopen);
  const run = (work: () => Promise<void>) => {
    void serial(async () => { if (!disposed) await work(); }).catch((e: unknown) => { if (!disposed) onError(String(e)); });
  };
  const measure = () => {
    const r = slot.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    return { x, y, width: Math.max(0, Math.min(innerWidth, r.right) - x), height: Math.max(0, Math.min(innerHeight, r.bottom) - y) };
  };
  // A card drawn in document.body covers the page only where it overlaps the slot: a rail label over the side nav must not
  // blank the browser (Shaan 7 Oct 07:55: "they also go behind like the url, the layering's kind of weird").
  const overlaps = (el: Element) => {
    const s = slot.getBoundingClientRect();
    return [...el.getClientRects()].some((r) => r.width > 0 && r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom);
  };
  const sync = async () => {
    const bounds = measure();
    // Menus such as Voice options stay mounted while hidden. Only rendered overlays
    // must cover the native child; mere DOM presence otherwise blanks every page.
    const covered = [...document.querySelectorAll('dialog[open], [data-native-overlay="true"], [role="menu"], [role="dialog"], .siso-menu-layer, .siso-drop, .ab-browser[data-narrow] .ab-browser__sidebar:not([hidden])')]
      .some((el) => el.getClientRects().length > 0 && (el.matches('[data-native-overlay="true"]') ? overlaps(el) : !["hidden", "collapse"].includes(getComputedStyle(el).visibility)));
    const visible = bounds.width > 0 && bounds.height > 0 && !dragging && !covered;
    if (!opened && !covered && bounds.width > 0 && bounds.height > 0) {
      performance.clearMeasures("browser:foreground-queue");
      performance.measure("browser:foreground-queue", { start: queuedAt, end: performance.now() });
      const openingAt = performance.now();
      onLoading?.(true);
      await invoke("browser_open", { tab, rawUrl: currentUrl, profile, ...bounds, agent: agent ?? null });
      performance.clearMeasures("browser:open-ipc");
      performance.measure("browser:open-ipc", { start: openingAt, end: performance.now() });
      opened = true;
      shown = true;
      lastBounds = JSON.stringify(bounds);
      awake.set(tab, { key: tab, tab: tabId, used: ++clock, mounted: !disposed, url: currentUrl, agent });
      void enforceAwake().catch(() => undefined);
    }
    if (!opened) return;
    if (!visible && shown !== false) { await invoke("browser_visible", { tab, visible: false }); shown = false; }
    const key = JSON.stringify(bounds);
    if (bounds.width > 0 && bounds.height > 0 && key !== lastBounds) {
      await invoke("browser_bounds", { tab, ...bounds });
      lastBounds = key;
    }
    if (visible && shown !== true) { await invoke("browser_visible", { tab, visible: true }); shown = true; }
  };
  // One measure per frame however many mutations the app makes (a streaming chat changes the DOM many times a second).
  const schedule = () => {
    if (scheduled !== undefined || disposed) return;
    scheduled = requestAnimationFrame(() => { scheduled = undefined; run(sync); });
  };
  const startDrag = () => { dragging = true; schedule(); };
  const endDrag = () => { dragging = false; schedule(); };
  // Hide on the menu trigger itself, before React inserts the menu portal.
  const pointer = (e: PointerEvent) => {
    if (e.target instanceof Element && e.target.closest('[aria-haspopup="menu"]')) {
      run(async () => { if (opened) { await invoke("browser_visible", { tab, visible: false }); shown = false; } });
    }
    schedule();
  };
  // The shell waits for this acknowledgement before painting above a native child.
  const overlay = (event: Event) => {
    const detail = (event as CustomEvent<{ waitUntil: (promise: Promise<unknown>) => void }>).detail;
    detail.waitUntil(serial(async () => {
      // serial() runs after the opener's layout effects, so its card is placed (still hidden) and can be measured.
      const card = [...document.querySelectorAll('[data-native-overlay="true"]')];
      if (!disposed && opened && card.some(overlaps)) { await invoke("browser_visible", { tab, visible: false }); shown = false; }
    }));
  };
  window.addEventListener("siso:overlay-open", overlay);
  const resize = new ResizeObserver(schedule);
  resize.observe(slot);
  // Faces restyle themselves every frame; those writes never move the slot (layout-mutations.ts).
  const mutation = new MutationObserver((records) => { if (anyMovesLayout(records)) schedule(); });
  mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "class", "style", "hidden", "aria-expanded", "data-native-overlay"] });
  const stopWindowChange = onBrowserWindowChange(schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  document.addEventListener("dragstart", startDrag, true);
  document.addEventListener("dragend", endDrag, true);
  document.addEventListener("drop", endDrag, true);
  document.addEventListener("pointerdown", pointer, true);
  run(sync);
  if (kept && normalize(initialUrl) !== currentUrl && initialUrl) {
    currentUrl = normalize(initialUrl);
    kept.url = currentUrl;
    run(async () => { await invoke("browser_navigate", { tab, rawUrl: currentUrl }); });
  }
  // The page's address and whether it is still loading: asked every 200 ms while it loads (so the bar and the address
  // follow the page at once), every second once it has loaded.
  let timer: number | undefined;
  const poll = () => {
    timer = window.setTimeout(() => {
      if (disposed) return;
      if (polling || !opened || document.hidden) { poll(); return; }
      polling = true;
      void (async () => {
        const url = await invoke<string>("browser_url", { tab });
        if (disposed) return;
        if ((url === "") !== wasLoading) { wasLoading = url === ""; onLoading?.(wasLoading); }
        if (url && url !== currentUrl) { currentUrl = url; const p = awake.get(tab); if (p) p.url = url; onUrl(url); }
        // The page's own title once it has loaded (a YouTube video's name, not "www.youtube.com"), read natively.
        if (url && onTitle && titlesWork) {
          const title = (await invoke<string>("browser_title", { tab }).catch(() => { titlesWork = false; return ""; })).trim();
          if (!disposed && title && title !== lastTitle) { lastTitle = title; onTitle(title); }
        }
      })().catch((e: unknown) => { if (!disposed) onError(String(e)); }).finally(() => { polling = false; poll(); });
    }, wasLoading === false ? 1000 : 200);
  };
  poll();
  return {
    navigate(url: string) {
      const next = normalize(url);
      if (next === currentUrl) return;
      currentUrl = next;
      const p = awake.get(tab);
      if (p) p.url = next;
      wasLoading = undefined;
      run(async () => { if (opened) await invoke("browser_navigate", { tab, rawUrl: next }); else await sync(); });
    },
    action(action: "back" | "forward" | "reload") {
      run(async () => { if (opened) await invoke("browser_action", { tab, action }); });
    },
    dispose() {
      disposed = true;
      if (slept.get(tab) === reopen) slept.delete(tab);
      clearTimeout(timer);
      if (scheduled !== undefined) cancelAnimationFrame(scheduled);
      resize.disconnect();
      mutation.disconnect();
      stopWindowChange();
      window.removeEventListener("siso:overlay-open", overlay);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("dragstart", startDrag, true);
      document.removeEventListener("dragend", endDrag, true);
      document.removeEventListener("drop", endDrag, true);
      document.removeEventListener("pointerdown", pointer, true);
      // Leaving the tab hides its page; it stays alive (music keeps playing, a half-done sign-in survives).
      const p = awake.get(tab);
      if (p) { p.mounted = false; p.used = ++clock; }
      // Hidden a moment later, behind the tab he switched to: the next page shows first, so the switch never flashes empty.
      window.setTimeout(() => void serial(async () => {
        const now = awake.get(tab);
        if (now && !now.mounted) await invoke("browser_visible", { tab, visible: false });
        void enforceAwake().catch(() => undefined);
      }).catch((e: unknown) => console.error("Browser teardown failed", e)), 0);
    },
  };
}

/** A Google sign-in: one WebKit data store, keyed by this id (`personal` is the default; `chrome:<dir>`, `google:<uuid>`). */
export type BrowserAccount = {
  id: string; name: string; email?: string; source?: "default" | "chrome" | "google"; chromeDir?: string; chromeName?: string; lastUsed?: number; pendingGoogle?: boolean;
  /** The last sign-in check (cookie names only): signed in or not, when, when Google signed it out, when it survived a restart. */
  signedIn?: boolean; checkedAt?: number; lostAt?: number; restartOkAt?: number;
  /** What the last check saw (t-0242): Google's session cookie names in the store and how many Google cookies it has. Never a value. */
  proof?: SessionProof;
  /** Agents allowed to use this account's session (filled by the agent driver). */
  agents?: string[];
  /** The space he sorted this account into on first run (the hub groups by it); none = Unsorted. */
  space?: string;
  /** The WebKit store its sign-in lives in; absent = its id. "Move it" repoints this (no cookie is copied). */
  store?: string;
  /** When the sign-in sheet saw Google show this address (arc-edges §2.1: enough to go green at once). */
  shownAt?: number;
  /** The sign-in sheet was closed before Google showed the address: at which step, and when. */
  signInStop?: { step: string; at: number };
};
/** The store an account's pages and sign-in checks use. */
export const storeOf = (a: BrowserAccount | undefined, fallback = DEFAULT_ACCOUNT) => a?.store ?? a?.id ?? fallback;
/** A Google sign-in that landed in an account with no address (a tab on "No account"): give that store to the account it
 * belongs to (made from the address if there is no such row yet), and give the no-address account a fresh, empty store.
 * Nothing is copied and nothing signs out. Returns the accounts and the id the sign-in now belongs to. */
export function moveSignIn(store: Pick<Storage, "getItem" | "setItem">, from: string, email: string, named = false): { accounts: BrowserAccount[]; to: string } | null {
  const accounts = loadAccounts(store);
  const src = accounts.find((a) => a.id === from);
  // `named`: the sign-in sheet for one address landed in another ("Keep it as <other>"): the same move, from a named row.
  if (!src || (src.email && !named) || !email || src.email?.toLowerCase() === email.toLowerCase()) return null;
  const held = storeOf(src);
  let to = accounts.find((a) => a.email?.toLowerCase() === email.toLowerCase());
  const next = to ? accounts : [...accounts, (to = { id: `google:${crypto.randomUUID()}`, name: email, email, source: "google" as const })];
  // Both stores changed hands, so neither status still holds: each is checked again.
  const fresh = ({ signedIn: _s, checkedAt: _c, lostAt: _l, restartOkAt: _r, ...a }: BrowserAccount) => a;
  const moved = next.map((a) => a.id === to!.id ? { ...fresh(a), store: held } : a.id === src.id ? { ...fresh(a), store: `store:${crypto.randomUUID()}` } : a);
  saveAccounts(moved, store);
  return { accounts: moved, to: to.id };
}
/** A fresh, empty store for one account ("Try again" after Google signed in someone else, or blocked the sign-in): the
 * old store and its cookies stay where they are, unused by this row. Its status starts over. */
export function freshStore(store: Pick<Storage, "getItem" | "setItem">, id: string): BrowserAccount[] {
  const next = loadAccounts(store).map((a) => {
    if (a.id !== id) return a;
    const { signedIn: _s, checkedAt: _c, lostAt: _l, restartOkAt: _r, shownAt: _w, proof: _p, ...rest } = a;
    return { ...rest, store: `store:${crypto.randomUUID()}` };
  });
  saveAccounts(next, store);
  return next;
}
/** The sign-in sheet's outcome on one account: Google showed its address (signed in, now), or it closed at `stop`. */
export function noteSignIn(store: Pick<Storage, "getItem" | "setItem">, id: string, at: number, stop?: string): BrowserAccount[] {
  const next = loadAccounts(store).map((a) => {
    if (a.id !== id) return a;
    if (stop) return { ...a, signInStop: { step: stop, at } };
    const { lostAt: _l, signInStop: _f, ...rest } = a;
    return { ...rest, signedIn: true, checkedAt: at, shownAt: at };
  });
  saveAccounts(next, store);
  return next;
}
export const DEFAULT_ACCOUNT = "personal";
const ACCOUNTS_KEY = "agent-base:browser-accounts";
const DEFAULT: BrowserAccount = { id: DEFAULT_ACCOUNT, name: "Default", source: "default" };
export function loadAccounts(store: Pick<Storage, "getItem">): BrowserAccount[] {
  let list: BrowserAccount[] = [];
  try { const v: unknown = JSON.parse(store.getItem(ACCOUNTS_KEY) ?? "[]"); if (Array.isArray(v)) list = v.filter((a): a is BrowserAccount => !!a && typeof a.id === "string" && typeof a.name === "string"); } catch { /* none yet */ }
  return list.some((a) => a.id === DEFAULT_ACCOUNT) ? list : [DEFAULT, ...list];
}
export function saveAccounts(accounts: BrowserAccount[], store: Pick<Storage, "setItem">) { store.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }
/** A space still on the no-address store while he has Google accounts, and he has not chosen that: ask which account. */
export const needsAccount = (space: ArcProfile, accounts: BrowserAccount[]) => !space.noAccount && accountFor(space, accounts) === DEFAULT_ACCOUNT && accounts.some((a) => a.email);
/** The store a space's tabs use: its default account if that still exists, else the default store. */
export const accountFor = (space: Pick<ArcProfile, "account"> | undefined, accounts: BrowserAccount[]) =>
  space?.account && accounts.some((a) => a.id === space.account) ? space.account : DEFAULT_ACCOUNT;
/** The space a remembered id now is: itself, or the space it was merged into. */
export const spaceOf = (spaces: ArcProfile[], id: string) => spaces.some((p) => p.id === id) ? id : spaces.find((p) => p.aliases?.includes(id))?.id ?? id;
const BUILT_IN: Record<string, string> = { personal: "personal", halo: "HALO" };
/** One space per name (arc-edges §3.5: no second HALO chip). A space named like Personal or HALO takes that id; otherwise the
 * first of a name is kept. Pins are unioned, the other id becomes an alias, and its Today rows and the accounts sorted into it
 * move across. Arc's favourites are not a space and never merge. Idempotent. */
export function mergeSameName(store: Pick<Storage, "getItem" | "setItem">, spaces: ArcProfile[], accounts: BrowserAccount[]): { spaces: ArcProfile[]; accounts: BrowserAccount[] } {
  const keep: ArcProfile[] = [], moved = new Map<string, string>();
  const key = (p: ArcProfile) => p.name.trim().toLowerCase();
  // The built-in Personal and HALO go first, so they are what the others merge into.
  const ordered = [...spaces].sort((a, b) => Number(Object.values(BUILT_IN).includes(b.id)) - Number(Object.values(BUILT_IN).includes(a.id)));
  for (const space of ordered) {
    const builtIn = space.id !== "arc-favorites" ? BUILT_IN[key(space)] : undefined;
    const into = space.id === "arc-favorites" ? undefined : keep.find((p) => p.id !== "arc-favorites" && (key(p) === key(space) || (builtIn && p.id === builtIn)));
    if (!into) {
      if (!builtIn || space.id === builtIn) { keep.push(space); continue; }
      // The first space named "HALO" that is not the built-in HALO becomes it.
      keep.push({ ...space, id: builtIn, importedFolders: space.importedFolders?.map((f) => ({ ...f, space: builtIn })), aliases: [...new Set([...(space.aliases ?? []), space.id])] });
      moved.set(space.id, builtIn);
      continue;
    }
    into.pins = [...into.pins, ...space.pins.filter((p) => !into.pins.some((o) => o.url === p.url))];
    into.imported = [...(into.imported ?? []), ...(space.imported ?? []).filter((p) => !into.imported?.some((o) => o.url === p.url))];
    into.importedFolders = mergeImportedFolders(into.importedFolders, space.importedFolders, into.id);
    into.aliases = [...new Set([...(into.aliases ?? []), ...(space.aliases ?? []), space.id])].filter((id) => id !== into.id);
    if ((!into.account || into.account === DEFAULT_ACCOUNT) && !into.noAccount && space.account && space.account !== DEFAULT_ACCOUNT) into.account = space.account;
    moved.set(space.id, into.id);
  }
  if (!moved.size) return { spaces, accounts };
  const nextAccounts = accounts.map((a) => (a.space && moved.has(a.space) ? { ...a, space: moved.get(a.space) } : a));
  const today = loadBrowserTabs(store);
  for (const [from, to] of moved) {
    if (!today[from]) continue;
    const rows = [...(today[to] ?? []), ...today[from]];
    today[to] = rows.filter((r, i) => rows.findIndex((x) => x.url === r.url) === i);
    delete today[from];
  }
  saveBrowserTabs(today, store);
  saveBrowserFolders(loadBrowserFolders(store).map((f) => ({ ...f, space: moved.get(f.space) ?? f.space })), store);
  saveArcProfiles(keep, store); saveAccounts(nextAccounts, store);
  return { spaces: keep, accounts: nextAccounts };
}
/** Spaces used to own their own sign-in store. Once: a space that was a Google sign-in (an address, a pending sign-in or a
 * Chrome profile) becomes an account with the SAME id, so its store and any sign-in in it are kept; a Chrome profile stops
 * being a space; every other space points at the default store. Idempotent. */
export function migrateAccounts(store: Pick<Storage, "getItem" | "setItem">): { spaces: ArcProfile[]; accounts: BrowserAccount[] } {
  const spaces = loadArcProfiles(store), accounts = loadAccounts(store);
  let changed = false;
  const keep: ArcProfile[] = [];
  for (const space of spaces) {
    if (space.account !== undefined) { keep.push(space); continue; }
    changed = true;
    const signIn = space.id.startsWith("chrome:") || Boolean(space.email) || Boolean(space.pendingGoogle);
    if (signIn && !accounts.some((a) => a.id === space.id)) {
      accounts.push({ id: space.id, name: space.email ?? space.name, email: space.email, lastUsed: space.lastUsed, pendingGoogle: space.pendingGoogle, source: space.id.startsWith("chrome:") ? "chrome" : "google", chromeDir: space.id.startsWith("chrome:") ? space.id.slice(7) : undefined });
    }
    if (space.id.startsWith("chrome:") || (signIn && !space.pins.length && !space.favorites?.length)) continue;
    const { email: _e, pendingGoogle: _p, source: _s, ...rest } = space;
    keep.push({ ...rest, account: signIn ? space.id : DEFAULT_ACCOUNT });
  }
  if (changed) { saveArcProfiles(keep, store); saveAccounts(accounts, store); }
  return mergeSameName(store, keep, accounts);
}
/** "+ Google account": a new account (its own empty store), named from the signed-in address once Google shows it. */
export function createGoogleAccount(store: Pick<Storage, "getItem" | "setItem">): BrowserAccount {
  const accounts = loadAccounts(store);
  let n = 1;
  while (accounts.some((a) => a.name === `Google account ${n}`)) n++;
  const account: BrowserAccount = { id: `google:${crypto.randomUUID()}`, name: `Google account ${n}`, source: "google", pendingGoogle: true };
  saveAccounts([...accounts, account], store);
  return account;
}
/** One check folded into the account. Signed in at launch after being signed in before = it survived the restart (the
 * Google gate, proven by the product); signed out after being signed in = Google signed it out. */
export function noteSession(a: BrowserAccount, signedIn: boolean, at: number, launch = false, proof?: SessionProof): BrowserAccount {
  const next: BrowserAccount = { ...a, signedIn, checkedAt: at };
  if (proof) next.proof = proof;
  else delete next.proof;
  if (signedIn) {
    delete next.lostAt;
    delete next.signInStop;
    if (launch && a.signedIn) next.restartOkAt = at;
    if (a.pendingGoogle && a.email) next.pendingGoogle = false;
  } else if (a.signedIn) next.lostAt = at;
  return next;
}
/** Checks every account's store in turn and saves what it finds. Outside the desktop app it changes nothing. */
export async function checkSessions(store: Pick<Storage, "getItem" | "setItem">, launch = false, only?: string): Promise<BrowserAccount[]> {
  let accounts = loadAccounts(store);
  for (const a of accounts) {
    if (only && a.id !== only) continue;
    const read = await sessionState(storeOf(a));
    if (read === null) continue;
    accounts = loadAccounts(store).map((x) => (x.id === a.id ? noteSession(x, read.signedIn, Date.now(), launch, read.proof) : x));
    saveAccounts(accounts, store);
  }
  return accounts;
}
/** The hub's queue: the next account with an address that is not signed in, in list order. */
export const signInNext = (accounts: BrowserAccount[]) => accounts.find((a) => a.email && a.signedIn !== true);
export type AccountStatus = { tone: "ok" | "warn" | "lost" | "busy" | "none"; label: string; detail?: string };
const ago = (at: number, now: number) => { const m = Math.max(0, Math.round((now - at) / 60000)); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function accountStatus(a: BrowserAccount, now = Date.now()): AccountStatus {
  if (a.pendingGoogle) return { tone: "busy", label: "Signing in…" };
  if (a.signedIn === true) return { tone: "ok", label: "Signed in", detail: a.restartOkAt ? `Still signed in after restart · ${hhmm(a.restartOkAt)}` : undefined };
  if (a.signInStop) return { tone: "lost", label: "Didn't finish", detail: `stopped at ${a.signInStop.step} · ${hhmm(a.signInStop.at)}` };
  if (a.signedIn === false && a.lostAt) return { tone: "lost", label: "Google signed this out", detail: ago(a.lostAt, now) };
  if (a.signedIn === false) return { tone: "warn", label: "Needs sign-in" };
  return { tone: "none", label: "Not checked" };
}

/** Is this account's store signed in to Google? Cookie names only, read natively; null outside the desktop app. */
export type SessionProof = { names: string[]; count: number };
/** The native answer: [signed in, session cookie names, Google cookie count] (an app built before t-0242 answers a bare boolean). */
export function readSession(raw: unknown): { signedIn: boolean; proof?: SessionProof } | null {
  if (typeof raw === "boolean") return { signedIn: raw };
  if (!Array.isArray(raw) || typeof raw[0] !== "boolean") return null;
  const names = Array.isArray(raw[1]) ? raw[1].filter((n): n is string => typeof n === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(n)).slice(0, 5) : [];
  return { signedIn: raw[0], proof: { names, count: typeof raw[2] === "number" && raw[2] >= 0 ? Math.floor(raw[2]) : 0 } };
}
export async function sessionState(account: string): Promise<{ signedIn: boolean; proof?: SessionProof } | null> {
  if (!bridge()) return null;
  return invoke<unknown>("browser_session_state", { account }).then(readSession, () => null);
}

/** A space: Arc's tinted context (favourites, pinned, Today), pointing at the account whose store its tabs use. */
export type BrowserPin = { url: string; title: string; pinned: true; mine?: true; origin?: "user" | "arc" | "chrome" };
export type ArcProfile = { importedFolders?: BrowserFolder[]; imported?: BrowserPin[]; pinVersion?: number; account?: string; /** Ids merged into this space (an Arc space with the same name), so a re-import, a tab's remembered space and Today rows still find it. */ aliases?: string[]; /** He chose "No account" for this space (so it stops asking). */ noAccount?: boolean; id: string; name: string; email?: string; lastUsed?: number; favorites?: { url: string; title: string; pinned: true }[]; pendingGoogle?: boolean; pins: BrowserPin[]; today?: { url: string; title: string }[]; source?: "chrome" };
const ARC_KEY = "agent-base:arc-profiles";
type JsonRecord = Record<string, unknown>;
const record = (v: unknown): JsonRecord => v !== null && typeof v === "object" && !Array.isArray(v) ? v as JsonRecord : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const unwrap = (v: unknown) => record(record(v).value ?? v);

/** Merge staged folder snapshots without changing existing names, order or parent choices. */
function mergeImportedFolders(first: BrowserFolder[] = [], second: BrowserFolder[] = [], space: string): BrowserFolder[] {
  const rows = first.map((f) => ({ ...f, space, urls: [...f.urls] }));
  for (const folder of second) {
    const old = rows.find((f) => f.id === folder.id);
    if (old) old.urls = [...new Set([...old.urls, ...folder.urls])];
    else rows.push({ ...folder, space, urls: [...folder.urls] });
  }
  return cleanBrowserFolders(rows);
}

export function importedFolderPath(space: ArcProfile, url: string): string {
  const folders = cleanBrowserFolders(space.importedFolders);
  const path: string[] = [];
  for (let row = folders.find((f) => f.urls.includes(url)); row; row = folders.find((f) => f.id === row?.parentId)) path.unshift(row.name);
  return path.join(" / ");
}

/** An explicit Keep reads current staged state. Stale space/page targets have no effect. Only the selected path
 * is materialised; existing saved names, parents and URL placements win over every later import. */
export function keepImportedPage(store: Pick<Storage, "getItem" | "setItem">, space: string, url: string, favourite = false): { profiles: ArcProfile[]; folders: BrowserFolder[] } | null {
  const profiles = loadArcProfiles(store);
  const targetId = favourite ? FAVORITES : spaceOf(profiles, space);
  let target = profiles.find((s) => s.id === targetId);
  if (!target && !["personal", "HALO", FAVORITES].includes(targetId)) return null;
  const source = profiles.find((s) => s.id === spaceOf(profiles, space) && s.imported?.some((p) => p.url === url))
    ?? profiles.find((s) => s.id === FAVORITES && s.imported?.some((p) => p.url === url));
  const shortcut = source?.imported?.find((p) => p.url === url);
  if (!source || !shortcut || !safePage(shortcut)) return null;
  if (!target) { target = { id: targetId, name: targetId === FAVORITES ? "Favourites" : targetId === "personal" ? "Personal" : "HALO", account: DEFAULT_ACCOUNT, pins: [], pinVersion: 2 }; profiles.push(target); }
  const folders = loadBrowserFolders(store);
  if (!target.pins.some((p) => p.url === url)) target.pins.push({ ...shortcut, origin: "user", mine: true });
  source.imported = source.imported?.filter((p) => p.url !== url);
  if (!favourite && !folders.some((f) => f.space === targetId && f.urls.includes(url))) {
    const imported = cleanBrowserFolders(source.importedFolders);
    const leaf = imported.find((f) => f.urls.includes(url));
    const path: BrowserFolder[] = [];
    for (let row = leaf; row; row = imported.find((f) => f.id === row?.parentId)) path.unshift(row);
    // A same-id folder in another space is owned there: keep the page at top level instead of rewriting it.
    if (!path.some((row) => folders.some((f) => f.id === row.id && f.space !== targetId))) {
      for (const row of path) if (!folders.some((f) => f.id === row.id)) folders.push({ ...row, space: targetId, urls: [] });
      const into = folders.find((f) => f.id === leaf?.id);
      if (into) into.urls.push(url);
    }
  }
  saveArcProfiles(profiles, store); saveBrowserFolders(folders, store);
  return { profiles, folders: loadBrowserFolders(store) };
}

/** Arc encodes dictionaries as alternating key/value arrays; Favorites and space pin descendants are imported. */
export function parseArcSidebar(raw: string): ArcProfile[] {
  const root = record(JSON.parse(raw));
  const containers = list(record(root.sidebar).containers).filter((v) => list(record(v).spaces).length > 0 || list(record(v).topAppsContainerIDs).length > 0);
  const sync = record(root.sidebarSyncState);
  if (!containers.length && !Array.isArray(sync.spaceModels)) throw new Error("Not an Arc StorableSidebar file");
  const sources = containers.length ? containers.map(record) : [{ spaces: sync.spaceModels, items: sync.items, topAppsContainerIDs: unwrap(sync.container).topAppsContainerIDs }];
  const profiles = new Map<string, ArcProfile>();
  for (const source of sources) {
    const items = new Map(list(source.items).map(unwrap).filter((v) => typeof v.id === "string").map((v) => [v.id as string, v]));
    const collectPins = (profile: ArcProfile, roots: Iterable<string>, into: { url: string; title: string }[] = profile.pins) => {
      const visited = new Set<string>();
      const folders = profile.importedFolders ??= [];
      const visit = (itemId: string, parentId?: string, depth = 0) => {
        if (visited.has(itemId) || visited.size >= 20000 || depth > 20) return;
        visited.add(itemId);
        const item = items.get(itemId);
        if (!item) return;
        const tab = record(record(item.data).tab);
        let folderId = parentId;
        if (typeof tab.savedURL === "string") {
          const title = typeof tab.savedTitle === "string" ? tab.savedTitle : typeof item.title === "string" ? item.title : "";
          if (safePage({ url: tab.savedURL, title })) {
            const url = new URL(tab.savedURL);
            if (!into.some((p) => p.url === url.href)) {
              if (into === profile.pins) {
                profile.pins.push({ url: url.href, title: title || url.host, pinned: true, origin: "arc" });
                folders.find((f) => f.id === parentId)?.urls.push(url.href);
              } else into.push({ url: url.href, title: title || url.host });
            }
          }
        } else if (depth > 0 && into === profile.pins) {
          // Container roots are invisible in Arc; descendants are ordered folders.
          const id = `arc-folder:${encodeURIComponent(profile.id)}:${encodeURIComponent(itemId)}`;
          const name = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Imported folder";
          if (id.length <= 160 && !folders.some((f) => f.id === id)) folders.push({ id, space: profile.id, name, parentId, collapsed: false, urls: [] });
          if (folders.some((f) => f.id === id)) folderId = id;
        }
        // Explicit children win over dictionary insertion order. parentID recovers missing children only.
        for (const child of list(item.childrenIds)) if (typeof child === "string") visit(child, folderId, depth + 1);
        for (const [childId, child] of items) if (child.parentID === itemId) visit(childId, folderId, depth + 1);
      };
      for (const root of roots) visit(root);
      profile.importedFolders = cleanBrowserFolders(folders);
    };
    const favoriteRoots = list(source.topAppsContainerIDs).filter((v, i): v is string => i % 2 === 1 && typeof v === "string");
    if (favoriteRoots.length) {
      const id = "arc-favorites";
      const profile = profiles.get(id) ?? { id, name: "Arc Favorites", pins: [] };
      collectPins(profile, favoriteRoots);
      profiles.set(id, profile);
    }
    for (const space of list(source.spaces).map(unwrap)) {
      if (typeof space.id !== "string") continue;
      const id = `arc:${space.id}`;
      const profile = profiles.get(id) ?? { id, name: typeof space.title === "string" ? space.title : "Imported Arc space", pins: [] };
      const containers = list(space.newContainerIDs).length ? list(space.newContainerIDs) : list(space.containerIDs);
      const roots = new Set<string>(), todayRoots = new Set<string>();
      for (let i = 0; i < containers.length - 1; i++) {
        if (typeof containers[i + 1] !== "string") continue;
        if ("pinned" in record(containers[i]) || containers[i] === "pinned") roots.add(containers[i + 1] as string);
        if ("unpinned" in record(containers[i]) || containers[i] === "unpinned") todayRoots.add(containers[i + 1] as string);
      }
      collectPins(profile, roots);
      if (todayRoots.size) { profile.today ??= []; collectPins(profile, todayRoots, profile.today); }
      profiles.set(id, profile);
    }
  }
  return [...profiles.values()];
}
export function loadArcProfiles(store: Pick<Storage, "getItem">): ArcProfile[] {
  try {
    const spaces = JSON.parse(store.getItem(ARC_KEY) ?? "[]") as ArcProfile[];
    return spaces.map((s) => s.importedFolders ? { ...s, importedFolders: cleanBrowserFolders(s.importedFolders) } : s).map((s) => s.pinVersion === 2 ? s : { ...s, pinVersion: 2, pins: s.pins.filter((p) => (p.origin === "user" || p.mine === true)), imported: [...(s.imported ?? []), ...s.pins.filter((p) => (p.origin !== "user" && p.mine !== true))] });
  } catch { return []; }
}
/** Explicit imports preserve saved choices; imported shortcuts wait for his choice. */
export function importArcSidebar(raw: string, store: Pick<Storage, "getItem" | "setItem">): ArcProfile[] {
  return applyBrowserImport({ arc: { found: true, spaces: parseArcSidebar(raw) }, chrome: { found: false, accounts: [] } }, store).profiles;
}
/** What the node reads from Arc and Chrome on this Mac (GET /api/browser/import): no cookies, passwords or history. */
export type BrowserImport = {
  arc: { found: boolean; spaces: ArcProfile[] };
  chrome: { found: boolean; accounts: { dir: string; name: string; email?: string; bookmarks: { url: string; title: string }[] }[] };
  /** Pages indexed from his Chrome and Arc history for address-bar suggestions (kept by the node, not here). */
  history?: number;
};
/** Arc spaces (favourites, pins, Today tabs) become spaces on the default account; each Chrome Google profile becomes an
 * ACCOUNT (one store each), never a space; links wait in Imported. Re-running is safe. */
export function applyBrowserImport(data: BrowserImport, store: Pick<Storage, "getItem" | "setItem">): { profiles: ArcProfile[]; accounts: BrowserAccount[]; added: number } {
  const profiles = migrateAccounts(store).spaces;
  const accounts = loadAccounts(store);
  const before = profiles.length + accounts.length;
  const pinsOf = (list: { url: string; title: string }[]) => list.map((p) => ({ url: p.url, title: p.title, pinned: true as const, origin: "chrome" as const }));
  const merge = (next: ArcProfile) => {
    next = { ...next, pins: next.pins.filter((p, i, rows) => safePage(p) && rows.findIndex((r) => r.url === p.url) === i), importedFolders: cleanBrowserFolders(next.importedFolders) };
    const old = profiles.find((p) => p.id === next.id || p.aliases?.includes(next.id) || (next.email && p.email?.toLowerCase() === next.email.toLowerCase()));
    if (!old) { profiles.push({ ...next, pinVersion: 2, pins: [], imported: next.pins }); return next; }
    old.importedFolders = mergeImportedFolders(old.importedFolders, next.importedFolders, old.id);
    old.imported = [...(old.imported ?? []), ...next.pins.filter((p) => !old.pins.some((o) => o.url === p.url) && !old.imported?.some((o) => o.url === p.url))];
    if (next.email && !old.email) old.email = next.email;
    return old;
  };
  // Arc's open tabs are not brought into Today: they filled his Today with old tabs he never opened here (3 Oct).
  for (const space of data.arc.spaces) {
    const { today: _open, ...rest } = space;
    merge({ ...rest, pins: [...rest.pins], account: rest.account ?? DEFAULT_ACCOUNT });
  }
  const bookmarks = data.chrome.accounts.flatMap((a) => a.bookmarks);
  if (bookmarks.length) merge({ ...(profiles.find((p) => p.id === "personal") ?? { id: "personal", name: "Personal" }), pins: pinsOf(bookmarks), account: DEFAULT_ACCOUNT });
  for (const a of data.chrome.accounts) {
    const old = accounts.find((o) => o.id === `chrome:${a.dir}` || (a.email && o.email?.toLowerCase() === a.email.toLowerCase()));
    if (old) { old.chromeDir ??= a.dir; old.chromeName ??= a.name; old.email ??= a.email; continue; }
    accounts.push({ id: `chrome:${a.dir}`, name: a.email ?? a.name, email: a.email, source: "chrome", chromeDir: a.dir, chromeName: a.name });
  }
  saveArcProfiles(profiles, store);
  saveAccounts(accounts, store);
  const merged = mergeSameName(store, profiles, accounts);
  return { profiles: merged.spaces, accounts: merged.accounts, added: merged.spaces.length + merged.accounts.length - before };
}
/** Arc's favourites, global across spaces (Arc's `topAppsContainerIDs`). Never a space's pins: no entry means none yet. */
export const FAVORITES = "arc-favorites";
export const favoritesOf = (spaces: ArcProfile[]) => spaces.find((p) => p.id === FAVORITES)?.pins ?? [];
/** State that lost them (the step-2 sort saved only the spaces it showed) gets them back from a fresh read of Arc, once:
 * the entry is saved even when Arc has none, so this never asks again. */
export function restoreFavorites(data: BrowserImport, store: Pick<Storage, "getItem" | "setItem">): ArcProfile[] {
  const spaces = loadArcProfiles(store);
  if (spaces.some((p) => p.id === FAVORITES)) return spaces;
  const arc = data.arc.spaces.find((p) => p.id === FAVORITES);
  const next = [...spaces, { id: FAVORITES, name: "Arc Favorites", pinVersion: 2, pins: [], imported: arc ? [...arc.pins] : [], account: DEFAULT_ACCOUNT }];
  saveArcProfiles(next, store);
  return next;
}
/** The one-click sign-in for an imported account: Google's account chooser with the address filled in, then Gmail. */
export const signInUrl = (email: string) => `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=${encodeURIComponent("https://mail.google.com/mail/")}`;
export function saveArcProfiles(profiles: ArcProfile[], store: Pick<Storage, "setItem">) { store.setItem(ARC_KEY, JSON.stringify(profiles)); }

/** A new named space (on the default account until he picks another). */
export function createBrowserProfile(rawName: string, store: Pick<Storage, "getItem" | "setItem">): ArcProfile {
  const name = rawName.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Use a space name of 1–80 characters.");
  const profiles = loadArcProfiles(store);
  if (["Personal", "HALO", ...profiles.map((p) => p.name)].some((n) => n.toLowerCase() === name.toLowerCase())) throw new Error("That space name already exists.");
  const profile: ArcProfile = { id: `profile:${crypto.randomUUID()}`, name, pinVersion: 2, pins: [], imported: [], account: DEFAULT_ACCOUNT };
  saveArcProfiles([...profiles, profile], store);
  return profile;
}

export async function readGoogleAccount(tab: string): Promise<string | null> {
  let result: unknown = await invoke<string>("browser_google_account", { tab });
  // Tauri eval callbacks serialize the JS return value; do not return the page payload to callers.
  for (let i = 0; i < 2 && typeof result === "string" && result.startsWith('"'); i++) {
    try { result = JSON.parse(result); } catch { return null; }
  }
  return typeof result === "string" && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(result) ? result : null;
}
