// uihub: arc:command-palette — shared Spotlight entry points
import { ArrowLeftIcon, EllipsisIcon, ArrowRightIcon, DownloadIcon, GlobeIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PinIcon, PinOffIcon, PlusIcon, RotateCwIcon, SquareArrowDownLeftIcon, SquareArrowOutUpRightIcon, TerminalSquareIcon, Volume2Icon } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SearchIcon } from "@siso/icons/search";
import { loadBrowserTabs, looksLikeAddress, rememberBrowserTab, rowTitle, saveBrowserTabs, loadBrowserFolders, saveBrowserFolders, fileBrowserPin, sameUrl, favouriteColumns } from "../lib/browser-tabs";
import "./Browser.css";
import { SavedFolders } from "./browser/SavedFolders";
import { browserWindow, onPageMoved, prefetchPage, shellWindow, accountFor, onBrowserShortcut, onBrowserWindowChange, keepImportedPage, applyBrowserImport, type BrowserImport, createBrowserProfile, createGoogleAccount, DEFAULT_ACCOUNT, importArcSidebar, loadAccounts, loadArcProfiles, migrateAccounts, mountPage, nativeBrowserAvailable, onDownload, pageKey, readGoogleAccount, saveAccounts, saveArcProfiles, checkSessions, signInUrl, awakePages, pageAudio, mutePage, playPage, sleepState, accountStatus, type BrowserAccount, storeOf, moveSignIn, needsAccount, noteSignIn, freshStore, FAVORITES, favoritesOf, spaceOf, type ArcProfile, type BrowserPin, adblockOn, setAdblock, onSiteAuth, siteAuthPending, answerSiteAuth, type SiteAuth } from "../lib/webview";
import { downloadsNow, subscribeDownloads } from "../lib/browser-downloads";
import { browserStore, useBrowserStore } from "../lib/browser-store";
import { AccountsHub, type Filter } from "./browser/AccountsHub";
import { SetupSheet } from "./browser/SetupSheet";
import { accountGroups, createNamedBrowserProfile, applySort, importDone, loadSetup, saveSetup, type Setup, setupChip, setupDue, spaceChips, spaceColour, statusOrder } from "../lib/browser-setup";
import { clock } from "../lib/poll";
import { SpaceMenu } from "./browser/SpaceMenu";
import { SignInSheet } from "./browser/SignInSheet";
import { DownloadToast, type Finished } from "./browser/DownloadToast";
import { MiniPlayer } from "./browser/MiniPlayer";
import { type Line, StatusLines } from "./browser/StatusLines";
import { type LivePage, type NowPlaying, nowPlaying } from "../lib/browser-player";
import { ErrorPage, type PageFailure } from "./browser/ErrorPage";
import { SiteAuthSheet } from "./browser/SiteAuthSheet";
import type { Page } from "../lib/agents";

/** Saved tab address and preview history; the native page owns its own Back/Forward history while visible. */
/** The profile he last chose in any page tab; a new tab (a chat link's, too) opens in it. */
/** The site's own icon (Shaan, 6 Oct 22:10: "urls they load their own icons ... we're faking the icons"): the node fetches
 *  it from the site (services/node/src/favicons.ts), never a third-party favicon service. The letter mark shows until it arrives. */
// What each icon turned out to be, for this window: a row that remounts (every tab switch) shows its icon at once instead
// of its letter first.
const ICONS = new Map<string, "ok" | "failed">();
function useFavicon(url: string) {
  let src: string | null = null;
  try { const u = new URL(url); if (/^https?:$/.test(u.protocol)) src = `/api/browser/favicon?url=${encodeURIComponent(u.origin)}`; } catch { /* no address yet */ }
  const [state, setState] = useState<"loading" | "ok" | "failed">(() => (src && ICONS.get(src)) || "loading");
  useEffect(() => setState((src && ICONS.get(src)) || "loading"), [src]);
  const settle = (next: "ok" | "failed") => { if (src) ICONS.set(src, next); setState(next); };
  // The letter shows until the icon has actually arrived, so a slow or missing icon is never an empty box.
  const img = (size: number) => src && state !== "failed" ? <img src={src} alt="" width={size} height={size} className="ab-browser__favicon" onLoad={(e) => settle(e.currentTarget.naturalWidth > 1 ? "ok" : "failed")} onError={() => settle("failed")} /> : null;
  return { ok: state === "ok", img };
}
function FavouriteIcon({ title, url = "" }: { title: string; url?: string }) {
  const icon = useFavicon(url);
  const label = /chatgpt/i.test(title) ? "GPT" : /youtube/i.test(title) ? "YT" : /cloudflare/i.test(title) ? "CF" : /perplexity/i.test(title) ? "P" : title.split(/[ ·]/)[0].slice(0, 4).toUpperCase();
  return <span className={`ab-browser__letter${icon.ok ? " is-icon" : ""}`} aria-hidden="true" style={icon.ok ? undefined : { "--ab-tile-rgb": spaceColour(title) } as CSSProperties}>{icon.img(22)}{!icon.ok && label}</span>;
}
/** A tab row's site mark: the site's own icon, else (as in Arc) a small square in the site's colour with its first letter. */
function SiteMark({ url, title }: { url: string; title: string }) {
  const icon = useFavicon(url);
  let host = title;
  try { host = new URL(url).hostname.replace(/^www\./, "") || title; } catch { /* a title-only row */ }
  return <span className={`ab-browser__site${icon.ok ? " is-icon" : ""}`} aria-hidden="true" style={icon.ok ? undefined : { "--ab-tile-rgb": spaceColour(host) } as CSSProperties}>{icon.img(16)}{!icon.ok && (title || host).trim().charAt(0).toUpperCase()}</span>;
}
const LAST_PROFILE = "agent-base:browser-profile:last";
/** The sign-in check on every launch (spec §2): each account's store, in turn, once the node's state is loaded. Signed in now
 * after signed in before records "Still signed in after restart"; signed out after signed in records "Google signed this out". */
// Browser v3 (7 Oct): 8 s after launch, and only the accounts a space uses. Each check of an account with no open page
// starts a hidden page on its store; 22 of them in a row, right as the first page loaded, slowed every launch.
const launchCheck: Promise<unknown> = nativeBrowserAvailable() ? browserStore.load().then((loaded) => loaded ? new Promise((done) => window.setTimeout(done, 8000)).then(() => {
  const used = new Set(loadArcProfiles(browserStore).map((s) => s.account).filter(Boolean));
  const ids = loadAccounts(browserStore).filter((a) => a.email && (used.has(a.id) || used.size === 0)).map((a) => a.id);
  return ids.reduce<Promise<unknown>>((prev, id) => prev.then(() => checkSessions(browserStore, true, id)), Promise.resolve());
}) : undefined).catch(() => undefined) : Promise.resolve();
// The ad blocker goes on a few seconds after launch, once the first page has had the machine to itself (an old app
// without the command just says no).
if (nativeBrowserAvailable() && adblockOn()) window.setTimeout(() => void setAdblock(true).catch(() => undefined), 5000);
/** A tab's space, as the browser stamped it the first time it showed the tab. */
const tabSpaceKey = (id: string) => `agent-base:browser-profile:${id}`;
/** The tab he last looked at in each space, for this window (a space switch goes back to it). */
const spaceTabKey = (space: string) => `agent-base:browser-space-tab:${space}`;
const local = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* kept for this window */ } } };
const setChoice = (key: string, value: string) => { if (browserStore.getItem(key) !== value) browserStore.setItem(key, value); };
export type BrowserTab = { id: string; title: string; url: string; pin?: string };
const pinKey = (space: string, url: string) => `pin:${space}:${url}`;
const favKey = (url: string) => `fav:${url}`;
let sidebarScroll = 0;
/** Arc's archive: a Today tab he has not opened for 12 hours closes by itself (its page stays in Recent and the address
 * bar's answers). Pins, favourites, the tab on screen and a playing page never archive. Checked once per window. */
const ARCHIVE_MS = 12 * 3600e3;
const SEEN = "agent-base:browser-tab-seen";
let archived = false;
const seenTabs = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(SEEN) ?? "{}") as Record<string, number>; } catch { return {}; } };
/** Up to three rows of six; more fold behind "+N". */
const FAV_MAX = 18;
export type Nav = { url: string; back: string[]; fwd: string[]; n: number };

/** What he typed into the address box, as a URL: a web address, a local one, or a search. */
export function toUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(t)) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}
export const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + (u.pathname.length > 1 ? u.pathname : "");
  } catch {
    return url;
  }
};
/** ⌘S: the sidebar hidden for a full-width page ("usually, I like it full-width"); a window preference, not browser state. */
const SIDEBAR_HIDDEN = "agent-base:browser-sidebar-hidden";
const who = (a?: BrowserAccount) => a?.email ?? a?.name ?? "Default";
const initials = (a?: BrowserAccount) => (a?.email ?? a?.name ?? "D").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
const siteOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
/** How long a page loads before the "Still loading" strip and the reach check. */
const SLOW_MS = 8000;
const when = (at?: number) => (at ? new Date(at).toLocaleDateString([], { day: "numeric", month: "short" }) : "");

/** A tab retains its native page across switches; hidden pages may sleep beyond the awake budget. */
type PageProps = {
  nav: Nav;
  tabId?: string;
  title: string;
  pinned: boolean;
  suggested: Page[];
  recents: Page[];
  /** `fromPage`: the page moved by itself; its title follows through onTitle. */
  onGo: (url: string, title?: string, fromPage?: boolean) => void;
  onTitle?: (title: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onPin: (pin: boolean) => void;
  onBeside?: () => void;
  onTerminal: () => void;
  /** + New tab: the app's command bar (⌘T); without it, this tab's own new-tab page. */
  onNewTab?: () => void;
  /** Beside the chat (split): the top row is the tab list, so the sidebar starts folded and its toggle sits on the page's toolbar (HUB-DESIGN R1.22b). */
  slim?: boolean;
  /** A tab the Web space owns: only these go in its Today (QA #20). */
  web?: boolean;
  /** Browser v3: the Web tabs, and how to show, close, open and pin them; the sidebar's rows are these tabs. */
  tabs?: BrowserTab[];
  onSelectTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onOpenTab?: (url: string, title: string, pin?: string) => string;
  onBindTab?: (id: string, pin?: string) => void;
};

/** The browser waits for its state from the node (spaces, accounts, Today), then renders. */
export function PageView(props: PageProps) {
  const ready = useBrowserStore();
  // Agent Base and the SISO Browser window (t-0439) each hold a copy of the sidebar: coming to the front re-reads what the
  // other saved, and redraws only if something did change.
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!ready || !nativeBrowserAvailable()) return;
    let live = true;
    const focus = () => void browserStore.refresh().then((changed) => { if (live && changed) setGeneration((n) => n + 1); });
    window.addEventListener("focus", focus);
    return () => { live = false; window.removeEventListener("focus", focus); };
  }, [ready]);
  if (ready === null) return <div className="ab-browser" aria-busy="true" />;
  if (!ready) return <div className="ab-browser" role="alert"><p>Browser state is unavailable.</p><button type="button" onClick={() => window.location.reload()}>Reload</button></div>;
  return <BrowserPage key={generation} {...props} />;
}

function BrowserPage(props: PageProps) {
  const { nav } = props;
  const profileKey = `agent-base:browser-profile:${props.tabId ?? "page"}`;
  // Spaces and accounts are separate: a space only points at the Google account whose store its tabs use.
  const [initial] = useState(() => migrateAccounts(browserStore));
  // A tab remembered on an Arc space that has since merged into one of the same name opens that space.
  const [profile, setProfile] = useState(() => spaceOf(initial.spaces, browserStore.getItem(profileKey) || browserStore.getItem(LAST_PROFILE) || "personal"));
  const [arc, setArc] = useState(initial.spaces);
  const [accounts, setAccounts] = useState(initial.accounts);
  const accountKey = `agent-base:browser-account:${props.tabId ?? "page"}`;
  const [override, setOverride] = useState(() => browserStore.getItem(accountKey) || null);
  const pickAccount = (id: string | null) => { setOverride(id); browserStore.setItem(accountKey, id ?? ""); };
  const [menuOpen, setMenuOpen] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [hubFilter, setHubFilter] = useState<Filter>("all");
  const openHub = (filter: Filter = "all") => { setHubFilter(filter); setAccountsOpen(true); };
  const [dotOpen, setDotOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  // Re-subscribed if the desktop bridge turns up after the first render (it is there from the start in the app).
  const native = nativeBrowserAvailable();
  const subscribe = useMemo(() => (cb: () => void) => subscribeDownloads(cb), [native]);
  const downloads = useSyncExternalStore(subscribe, downloadsNow);
  const container = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => innerWidth <= 620);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 620));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(SIDEBAR_HIDDEN) === "1" || innerWidth <= 620; } catch { return innerWidth <= 620; } });
  const [peek, setPeek] = useState(false);
  const sidebarArea = useRef<HTMLDivElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const pointerInside = useRef(false), draggingSidebar = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = undefined; };
  const closePeekLater = () => {
    clearTimeout(openTimer.current); cancelClose();
    closeTimer.current = setTimeout(() => {
      const side = sidebarArea.current;
      if (!pointerInside.current && !draggingSidebar.current && !side?.contains(document.activeElement) && !side?.querySelector('[role="menu"], [role="dialog"]')) setPeek(false);
    }, 220);
  };
  const peekLater = () => { cancelClose(); clearTimeout(openTimer.current); if (!narrow) openTimer.current = setTimeout(() => setPeek(true), 120); };
  const setSidebarPinned = (pinned: boolean) => {
    cancelClose(); clearTimeout(openTimer.current); setPeek(false); setHidden(!pinned);
    if (!pinned) requestAnimationFrame(() => restoreButton.current?.focus());
    if (!narrow) { try { localStorage.setItem(SIDEBAR_HIDDEN, pinned ? "0" : "1"); } catch { /* kept for this window */ } }
  };
  const toggleSidebar = () => setSidebarPinned(hidden);
  useEffect(() => {
    setPeek(false);
    if (narrow) setHidden(true);
    else { try { setHidden(localStorage.getItem(SIDEBAR_HIDDEN) === "1"); } catch { setHidden(false); } }
  }, [narrow]);
  useEffect(() => { if (narrow) { setHidden(true); setPeek(false); } }, [nav.url]);
  useEffect(() => {
    const close = () => { setPeek(false); clearTimeout(openTimer.current); cancelClose(); };
    document.addEventListener("fullscreenchange", close);
    const stopNativeWindow = onBrowserWindowChange(close);
    return () => { close(); stopNativeWindow(); document.removeEventListener("fullscreenchange", close); };
  }, []);
  // First run (spec §3): the import sheet opens by itself while there is no Google account yet, or part way through.
  const [setup, setSetup] = useState(() => loadSetup(browserStore));
  const [setupOpen, setSetupOpen] = useState(() => !props.nav.url && setupDue(loadSetup(browserStore), initial.accounts));
  // A navigation always shows the page: a link he clicked (from a chat, a row, the address bar) closes the sheet.
  useEffect(() => { if (props.nav.url) setSetupOpen(false); }, [props.nav.url]);
  const updateSetup = (next: Setup) => { setSetup(next); saveSetup(next, browserStore); };
  // Signed in to his main account = the import is done: the chip goes, and the rest wait under "Add accounts".
  useEffect(() => { if (importDone(setup, accounts, arc)) updateSetup({ ...setup, doneAt: Date.now() }); }, [setup, accounts, arc]);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountError, setAccountError] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileError, setProfileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const profiles = [{ ...arc.find((p) => p.id === "personal"), id: "personal", name: "Personal", pins: arc.find((p) => p.id === "personal")?.pins ?? [] }, { ...arc.find((p) => p.id === "HALO"), id: "HALO", name: "HALO", pins: arc.find((p) => p.id === "HALO")?.pins ?? [] }, ...arc.filter((p) => !["personal", "HALO", FAVORITES].includes(p.id))];
  const profilePins = profiles.find((p) => p.id === profile)?.pins ?? [];
  const currentProfile = profiles.find((p) => p.id === profile) ?? profiles[0];
  const chips = spaceChips(profiles, profile, narrow ? 3 : 4);
  const account = override && accounts.some((a) => a.id === override) ? override : accountFor(currentProfile, accounts);
  const currentAccount = accounts.find((a) => a.id === account);
  // The WebKit store this tab's page uses (an account's sign-in can live in a store it was moved to).
  const store = storeOf(currentAccount, account);
  // Browser v3, once: his Arc favourites are the icons along the top (Shaan, 7 Oct: "pinned things could just show the icon up
  // top like Arc does"), not 11 rows waiting under Imported.
  useEffect(() => {
    if (local.get("agent-base:browser-v3-favourites")) return;
    local.set("agent-base:browser-v3-favourites", String(Date.now()));
    const waiting = arc.find((p) => p.id === FAVORITES)?.imported ?? [];
    let last: ReturnType<typeof keepImportedPage> = null;
    for (const p of waiting) last = keepImportedPage(browserStore, FAVORITES, p.url, true) ?? last;
    if (last) { setArc(last.profiles); setFolders(last.folders); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Arc's favourites, the same in every space; none yet shows an empty line, never this space's pins again.
  const favorites = favoritesOf(arc);
  // Browser v3: the tabs. A Today row is one of the app's Web tabs with its own live page, and a pin or a favourite is the
  // tab bound to it, so going back to any of them shows the page as he left it. Without the tab list (the split beside a
  // chat) rows navigate this tab, as before.
  const tabsMode = Boolean(props.tabs && props.onSelectTab && props.onOpenTab && props.onCloseTab);
  const allTabs = props.tabs ?? [];
  const myTab = allTabs.find((t) => t.id === props.tabId);
  const spaceOfTab = (id: string) => spaceOf(arc, browserStore.getItem(tabSpaceKey(id)) || profile);
  useEffect(() => {
    if (!tabsMode || !props.tabId) return;
    // Tabs from before v3 belong to the space they were opened in, which is this one until he says otherwise.
    for (const t of allTabs) if (!browserStore.getItem(tabSpaceKey(t.id))) setChoice(tabSpaceKey(t.id), profile);
    setChoice(tabSpaceKey(props.tabId), profile);
    setChoice(LAST_PROFILE, profile);
    local.set(spaceTabKey(profile), props.tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsMode, props.tabId, profile]);
  const boundTo = (key: string) => allTabs.find((t) => t.pin === key);
  useEffect(() => {
    if (!tabsMode || !props.tabId) return;
    const seen = seenTabs(), now = Date.now(), ids = new Set(allTabs.map((t) => t.id));
    seen[props.tabId] = now;
    // A tab from before the archive gets a full 12 hours from now; a closed tab's stamp goes.
    for (const t of allTabs) seen[t.id] ??= now;
    for (const id of Object.keys(seen)) if (!ids.has(id)) delete seen[id];
    if (!archived) {
      archived = true;
      // A pin in any space, not just this one, keeps its tab.
      const pinned = (key?: string) => !!key && (key.startsWith("fav:") ? favorites.some((f) => favKey(f.url) === key) : arc.some((sp) => sp.pins.some((p) => pinKey(sp.id, p.url) === key)));
      const old = allTabs.filter((t) => t.id !== props.tabId && !pinned(t.pin) && t.url && now - (seen[t.id] ?? now) > ARCHIVE_MS);
      // Asked of each page itself: one still playing sound stays.
      if (old.length) void Promise.all(old.map(async (t) => ({ t, playing: native && (await Promise.all(awakePages().filter((p) => p.tab === t.id).map((p) => pageAudio(p.key)))).some(Boolean) }))).then((rows) => {
        const gone = rows.filter((r) => !r.playing).map((r) => r.t.id);
        for (const id of gone) callbacks.current.onCloseTab?.(id);
        if (gone.length) setNotice(`Archived ${gone.length} ${gone.length === 1 ? "tab" : "tabs"} not opened for 12 hours. They are under Recent, or type to find them.`);
      });
    }
    try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch { /* kept for this window */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsMode, props.tabId]);
  // A pin or favourite saved under its address ("www.youtube.com") takes its page's real title once its tab has one.
  useEffect(() => {
    if (!tabsMode) return;
    let changed = false;
    const next = arc.map((space) => ({ ...space, pins: space.pins.map((p) => {
      if (!looksLikeAddress(p.title || p.url)) return p;
      const t = boundTo(space.id === FAVORITES ? favKey(p.url) : pinKey(space.id, p.url));
      if (!t?.title || looksLikeAddress(t.title) || t.title === "New tab" || siteOf(t.url) !== siteOf(p.url)) return p;
      changed = true;
      return { ...p, title: t.title };
    }) }));
    if (changed) { saveArcProfiles(next, browserStore); setArc(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsMode, allTabs.map((t) => `${t.pin}\n${t.title}`).join("\n")]);
  const pinAlive = (key?: string) => !!key && (key.startsWith("fav:") ? favorites.some((f) => favKey(f.url) === key) : profilePins.some((p) => pinKey(profile, p.url) === key));
  const showTab = (id: string) => { if (id !== props.tabId) props.onSelectTab?.(id); };
  const openTabIn = (space: string, url: string, title: string, pin?: string) => { const id = props.onOpenTab!(url, title, pin); setChoice(tabSpaceKey(id), space); return id; };
  const openBound = (key: string, url: string, title: string) => { const had = boundTo(key); if (had) showTab(had.id); else openTabIn(profile, url, title, key); };
  const openPin = (p: { url: string; title: string }) => (tabsMode ? openBound(pinKey(profile, p.url), p.url, p.title) : props.onGo(p.url, p.title));
  const openFavourite = (p: { url: string; title: string }) => (tabsMode ? openBound(favKey(p.url), p.url, p.title) : props.onGo(p.url, p.title));
  const pinActive = (key: string, url: string) => (tabsMode ? myTab?.pin === key : nav.url === url);
  const [allFavorites, setAllFavorites] = useState(false);
  const [folders, setFolders] = useState(() => loadBrowserFolders(browserStore));
  const updateFolders = (next: typeof folders) => { saveBrowserFolders(next, browserStore); setFolders(next); };
  const shownFavorites = allFavorites || favorites.length <= FAV_MAX ? favorites : favorites.slice(0, FAV_MAX - 1);
  const [today, setToday] = useState(() => loadBrowserTabs(browserStore));
  const switchingProfile = useRef(false);
  useEffect(() => {
    if (switchingProfile.current) { switchingProfile.current = false; return; }
    // QA #20 (A0, 3 Oct): an agent's page (the console's 8891 cards) opened here is not the Web space's browsing.
    if (!nav.url || !props.web) return;
    setToday((tabs) => {
      const next = rememberBrowserTab(tabs, profile, { url: nav.url, title: props.title || hostOf(nav.url), at: Date.now() });
      saveBrowserTabs(next, browserStore);
      return next;
    });
  }, [profile, nav.url, props.title, props.web]);
  const pinned = profilePins.some((p) => p.url === nav.url);
  const chooseProfile = (id: string) => { setAccountsOpen(false); setMenuOpen(false); setSpacesOpen(false); if (id === profile) return;
    // Browser v3: a space switch shows that space's own tab (the one he last had there), else a new tab in it; the tab on
    // screen stays in its space.
    if (tabsMode) {
      setChoice(LAST_PROFILE, id);
      const last = local.get(spaceTabKey(id));
      const target = allTabs.find((t) => t.id === last && spaceOfTab(t.id) === id) ?? [...allTabs].reverse().find((t) => spaceOfTab(t.id) === id);
      if (target) showTab(target.id); else openTabIn(id, "", "New tab");
      return;
    }
    switchingProfile.current = true; setProfile(id); pickAccount(null); const last = [...(today[id] ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]; props.onGo(last?.url ?? "", last?.title ?? "New tab"); browserStore.setItem(profileKey, id); browserStore.setItem(LAST_PROFILE, id); };
  const [rail, setRail] = useState(!props.slim);
  const imported = [...(currentProfile.imported ?? []), ...(arc.find((p) => p.id === FAVORITES)?.imported ?? [])].filter((p, i, rows) => rows.findIndex((r) => r.url === p.url) === i);
  const [pinMenu, setPinMenu] = useState<{ space: string; pin: BrowserPin } | null>(null);
  useEffect(() => {
    if ((hidden && !peek) || !rail) setPinMenu(null);
  }, [hidden, peek, rail]);
  const removePin = (space: string, shortcut: BrowserPin) => {
    const next = arc.map((s) => s.id === space ? { ...s, pins: s.pins.filter((p) => p.url !== shortcut.url) } : s);
    saveArcProfiles(next, browserStore); setArc(next); setPinMenu(null);
    // Its tab stays open, now one of Today's.
    const bound = boundTo(space === FAVORITES ? favKey(shortcut.url) : pinKey(space, shortcut.url));
    if (bound) props.onBindTab?.(bound.id, undefined);
    if (space === "personal" && shortcut.url === nav.url && props.pinned) props.onPin(false);
  };
  const keepImported = (shortcut: BrowserPin, favourite = false) => {
    const next = keepImportedPage(browserStore, profile, shortcut.url, favourite);
    if (next) { setArc(next.profiles); setFolders(next.folders); }
  };
  const pin = () => {
    if (profile === "personal") props.onPin(!pinned);
    const existing = arc.find((p) => p.id === profile) ?? { id: profile, name: currentProfile.name, pins: [], account: DEFAULT_ACCOUNT };
    const next = { ...existing, pins: pinned ? existing.pins.filter((p) => p.url !== nav.url) : [...existing.pins, { url: nav.url, title: props.title, pinned: true as const, origin: "user" as const }] };
    const profiles = [...arc.filter((p) => p.id !== profile), next];
    saveArcProfiles(profiles, browserStore); setArc(profiles);
    if (tabsMode && props.tabId) props.onBindTab?.(props.tabId, pinned ? undefined : pinKey(profile, nav.url));
  };
  // Shaan 3 Oct 14:1x: "I've got these 19 pinned and there's no way to easily just close them from the side nav". A pin's ×
  // unpins it; dragging it to Today unpins it into Today, and a Today row dragged up pins it.
  const setPins = (pins: ArcProfile["pins"]) => {
    const existing = arc.find((p) => p.id === profile) ?? { id: profile, name: currentProfile.name, pins: [], account: DEFAULT_ACCOUNT };
    const profiles = [...arc.filter((p) => p.id !== profile), { ...existing, pins }];
    saveArcProfiles(profiles, browserStore); setArc(profiles);
  };
  const filePin = (shortcut: { url: string; title: string; id?: string }, folderId?: string) => {
    if (!profilePins.some((p) => p.url === shortcut.url)) setPins([...profilePins, { url: shortcut.url, title: shortcut.title, pinned: true, origin: "user" }]);
    updateFolders(fileBrowserPin(folders, profile, shortcut.url, folderId));
    // The tab he pinned becomes the pin's tab: it moves up out of Today with its page as it is.
    const tab = shortcut.id ? allTabs.find((t) => t.id === shortcut.id) : allTabs.find((t) => !pinAlive(t.pin) && spaceOfTab(t.id) === profile && sameUrl(t.url, shortcut.url));
    if (tab && tabsMode) props.onBindTab?.(tab.id, pinKey(profile, shortcut.url));
    // A Today tab pinned or dropped onto a folder moves there; it does not stay in Today as well.
    if (today[profile]?.some((tab) => tab.url === shortcut.url)) { const next = { ...today, [profile]: today[profile].filter((tab) => tab.url !== shortcut.url) }; setToday(next); saveBrowserTabs(next, browserStore); }
  };
  const unpin = (urls: string[]) => { setPins(profilePins.filter((p) => !urls.includes(p.url))); };
  const toToday = (p: { url: string; title: string }) => { const next = { ...today, [profile]: [{ url: p.url, title: p.title, at: Date.now() }, ...(today[profile] ?? []).filter((t) => t.url !== p.url)] }; setToday(next); saveBrowserTabs(next, browserStore); };
  const PIN_DRAG = "application/x-ab-pin", TODAY_DRAG = "application/x-ab-today";
  const [draft, setDraft] = useState(nav.url);
  const [addressFocused, setAddressFocused] = useState(false);
  let displayHost = nav.url;
  try { displayHost = new URL(nav.url).host; } catch { /* a blank new tab */ }
  const input = useRef<HTMLInputElement>(null);
  // Focusing the address selects it, and the first thing typed or pasted replaces it, as Chrome and Arc do (9 Oct: "I can't
  // open up URLs": a typed address landed after the old one, "example.comhttps://…"). Placing the caret (a second click, an
  // arrow key) edits in place instead.
  const fresh = useRef(false), focusingClick = useRef(false);
  useLayoutEffect(() => { if (addressFocused) input.current?.select(); }, [addressFocused]);
  // Address-bar suggestions from his imported Chrome and Arc history (the node's index), while he types.
  const [suggestions, setSuggestions] = useState<{ url: string; title: string }[]>([]);
  useEffect(() => {
    const q = draft.trim();
    if (!addressFocused || q.length < 2 || q === nav.url) { setSuggestions([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/browser/suggest?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { pages: [] })).then((d: { pages?: { url: string; title: string }[] }) => setSuggestions(d.pages ?? [])).catch(() => undefined);
    }, 60);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [draft, addressFocused, nav.url]);
  const slot = useRef<HTMLDivElement>(null);
  const page = useRef<ReturnType<typeof mountPage> | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [error, setError] = useState("");
  const pendingGoogle = Boolean(currentAccount?.pendingGoogle);
  useEffect(() => {
    if (!native || !pendingGoogle) return;
    let stopped = false, busy = false;
    const timer = window.setInterval(async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      try {
        const email = await readGoogleAccount(pageKey(props.tabId ?? "page", store));
        if (email && !stopped) setAccounts(() => {
          const next = loadAccounts(browserStore).map((a) => a.id === account ? { ...a, name: email, email, lastUsed: Date.now(), pendingGoogle: false } : a);
          saveAccounts(next, browserStore);
          return next;
        });
      } catch { /* A loading Google page has no account avatar yet. */ }
      finally { busy = false; }
    }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [native, pendingGoogle, account, store, props.tabId]);
  const addGoogleAccount = () => {
    setMenuOpen(false); setAccountsOpen(false);
    const next = createGoogleAccount(browserStore);
    setAccounts(loadAccounts(browserStore));
    pickAccount(next.id);
    props.onGo("https://accounts.google.com/?hl=en", next.name);
  };
  const [notice, setNotice] = useState("");
  const [blocking, setBlocking] = useState(adblockOn);
  const importBrowsers = async (): Promise<boolean> => {
    setMenuOpen(false); setNotice("Importing from Arc and Chrome…");
    try {
      const r = await fetch("/api/browser/import", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as BrowserImport;
      const result = applyBrowserImport(data, browserStore);
      setArc(result.profiles); setAccounts(result.accounts); setToday(loadBrowserTabs(browserStore));
      const google = data.chrome.accounts.filter((a) => a.email).length;
      setNotice(!data.arc.found && !data.chrome.found ? "No Arc or Chrome data found on this Mac." : `Imported ${data.arc.spaces.filter((s) => s.id !== "arc-favorites").length} Arc spaces and ${google} Google accounts from Chrome${data.history ? ` and ${data.history} history pages` : ""}. ${result.added} new. Sign in to your main account; the rest wait in Accounts.`);
      return true;
    } catch { setNotice("Could not import from Arc and Chrome."); return false; }
  };
  // A finished download shows as a 6 s toast above the space bar; a running one turns the ring on the download icon.
  const [finished, setFinished] = useState<Finished | null>(null);
  const finishedSeq = useRef(0);
  useEffect(() => onDownload(({ phase, name, ok, agent }) => { if (phase === "finished") setFinished({ id: ++finishedSeq.current, name, ok, agent }); }), [native]);
  // Open a page in a given account: switch the tab to that account FIRST, and navigate only once the page on that
  // account's store is the one mounted (the effect below), so a sign-in can never land in the previous account's store.
  const [goAs, setGoAs] = useState<{ id: string; url: string; title: string } | null>(null);
  const openIn = (id: string, url: string, title: string) => { setAccountsOpen(false); pickAccount(id); setGoAs({ id, url, title }); };
  const signIn = (id: string, email: string) => openIn(id, signInUrl(email), email);
  // The hub's Sign in opens the sign-in sheet in the hub (arc-edges §2.1) in the desktop app; the web build has no native
  // page to inset, so it keeps the tab. The first-run sheet's Sign in also keeps the tab (its chip brings him back).
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const sheetAccount = accountsOpen ? accounts.find((a) => a.id === sheetFor && a.email) : undefined;
  const signedInHere = (id: string) => {
    setAccounts(noteSignIn(browserStore, id, Date.now()));
    // The avatar is enough to go green; the store read then adds the cookie names behind it (t-0242).
    window.setTimeout(() => void checkSessions(browserStore, false, id).then(setAccounts), 800);
  };
  const keepAs = (id: string, email: string) => {
    const moved = moveSignIn(browserStore, id, email, true);
    if (moved) setAccounts(noteSignIn(browserStore, moved.to, Date.now()));
    setSheetFor(null);
  };
  const hubSignIn = (id: string, email: string) => (native ? setSheetFor(id) : signIn(id, email));
  const makeDefault = (id: string, noAccount = false) => {
    const existing = arc.find((p) => p.id === profile) ?? { id: profile, name: currentProfile.name, pins: currentProfile.pins ?? [] };
    const next = [...arc.filter((p) => p.id !== profile), { ...existing, account: id, noAccount: noAccount || undefined }];
    saveArcProfiles(next, browserStore); setArc(next); pickAccount(null);
  };
  // Signed in or not, per account, from cookie NAMES read natively (never a value): on launch (below), when the hub opens,
  // and on "Check now". The result lives on the account, in the node.
  const [checking, setChecking] = useState(false);
  const recheck = async () => { setChecking(true); try { setAccounts(await checkSessions(browserStore)); } finally { setChecking(false); } };
  // Every write starts from the node's copy, so a tab opened before the launch check never writes back stale statuses.
  useEffect(() => { void launchCheck.then(() => setAccounts(loadAccounts(browserStore))); }, []);
  useEffect(() => { if (accountsOpen || (setupOpen && setup.step === 3)) void launchCheck.then(() => recheck()); }, [accountsOpen, setupOpen, setup.step]);
  const openAs = (id: string, url: string, title: string) => { setAccounts(() => { const next = loadAccounts(browserStore).map((a) => (a.id === id ? { ...a, lastUsed: Date.now() } : a)); saveAccounts(next, browserStore); return next; }); openIn(id, url, title); };
  const hasUrl = Boolean(nav.url);
  // Page states (arc-edges §5.1-5.2): a hairline while loading; after 8 s a "Still loading" strip, and the node is asked
  // once whether the site answers at all; if not, the page is hidden and our error page shows in its place.
  const [loadingSince, setLoadingSince] = useState<number | null>(null);
  const [failed, setFailed] = useState<PageFailure | null>(null);
  const [tick, setTick] = useState(0);
  // A password site's question for this page (the desktop app asks WebKit's question here), and a sign-in he cancelled.
  const [siteAuth, setSiteAuth] = useState<SiteAuth | null>(null);
  const [authOff, setAuthOff] = useState<string | null>(null);
  // In a plain browser (his phone) a page is an iframe: a site that refuses frames (GitHub) or asks for a password (the
  // siso-ui-hub worker) would show nothing there, so it gets a way out instead of a dead frame.
  const [frameBlock, setFrameBlock] = useState<{ url: string; why: "frames" | "password" } | null>(null);
  const afterMount = useRef<"reload" | "back" | null>(null);
  const tries = useRef<{ url: string; n: number }>({ url: "", n: 0 });
  const asked = useRef("");
  // This tab's live page is in the other window (popped out to the SISO Browser window, or brought back to Agent Base).
  const [away, setAway] = useState(false);
  const here = shellWindow();
  useEffect(() => { setAway(false); if (!native) return; const key = pageKey(props.tabId ?? "page", store); return onPageMoved((moved, to) => { if (moved === key) setAway(to !== here); }); }, [native, store, props.tabId, here]);
  // Hovering a row starts its page loading (t-0494); a short dwell, so sweeping the pointer past rows loads nothing.
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverRow = (target: EventTarget) => {
    clearTimeout(hoverTimer.current);
    const url = native && target instanceof Element ? target.closest<HTMLElement>("[data-url]")?.dataset.url : undefined;
    if (url && url !== nav.url) hoverTimer.current = window.setTimeout(() => prefetchPage(url, store), 70);
  };
  const popOut = () => { if (nav.url) void browserWindow(true, { tab: props.tabId ?? "page", url: nav.url, title: props.title }).catch((e: unknown) => setError(String(e))); };
  useEffect(() => {
    if (!native || !hasUrl || accountsOpen || failed || away || !slot.current) return;
    setError("");
    const controller = mountPage(slot.current, callbacks.current.nav.url, (url) => callbacks.current.onGo(url, undefined, true), setError, store, callbacks.current.tabId ?? "page", undefined, (l) => setLoadingSince((since) => (l ? since ?? Date.now() : null)), (title) => callbacks.current.onTitle?.(title));
    page.current = controller;
    if (afterMount.current) { controller.action(afterMount.current); afterMount.current = null; }
    return () => { controller.dispose(); page.current = null; setLoadingSince(null); };
  }, [native, hasUrl, store, accountsOpen, Boolean(failed), away]);
  useEffect(() => { page.current?.navigate(nav.url); setFailed((f) => (f && f.url !== nav.url ? null : f)); setAuthOff(null); }, [nav.url]);
  useEffect(() => {
    setSiteAuth(null);
    if (!native) return;
    const key = pageKey(props.tabId ?? "page", store);
    let live = true;
    void siteAuthPending(key).then((asks) => { if (live && asks.length) setSiteAuth(asks[asks.length - 1]); });
    const off = onSiteAuth((ask) => { if (ask.tab === key) { setAuthOff(null); setSiteAuth(ask); } });
    return () => { live = false; off(); };
  }, [native, store, props.tabId]);
  const answerAuth = (login?: { user: string; password: string }) => {
    const ask = siteAuth; if (!ask) return;
    setSiteAuth(null);
    if (!login) setAuthOff(ask.host);
    void answerSiteAuth(ask.id, login).catch((e: unknown) => setError(String(e)));
  };
  useEffect(() => {
    if (native || !nav.url) return;
    const url = nav.url, ctl = new AbortController();
    void fetch("/api/browser/frame", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), signal: ctl.signal })
      .then((r) => (r.ok ? r.json() as Promise<{ frame?: boolean; why?: "frames" | "password" }> : null))
      .then((r) => { if (r?.frame === false && r.why) setFrameBlock({ url, why: r.why }); })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [native, nav.url]);
  useEffect(() => {
    if (loadingSince === null) return;
    return clock(() => setTick((n) => n + 1));
  }, [loadingSince]);
  const loadingFor = loadingSince === null ? 0 : Date.now() - loadingSince;
  const slow = loadingFor >= SLOW_MS;
  useEffect(() => {
    if (!slow || failed) return;
    const url = nav.url, key = `${url}#${loadingSince}`;
    if (asked.current === key) return;
    asked.current = key;
    if (tries.current.url !== url) tries.current = { url, n: 0 };
    tries.current.n += 1;
    void (async () => {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const r = offline ? { ok: false as const, kind: "offline" as const, detail: "no connection" } : await fetch("/api/browser/reach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).then((x) => x.json() as Promise<{ ok: boolean; kind?: PageFailure["kind"]; detail?: string }>).catch(() => null);
      if (!r || r.ok || asked.current !== key) return;
      setFailed({ url, host: siteOf(url), kind: r.kind ?? "other", detail: r.detail ?? "no answer", at: Date.now(), tries: tries.current.n });
    })();
  }, [slow, tick, failed, nav.url, loadingSince]);
  // Offline: try again by itself when the connection is back.
  useEffect(() => {
    if (failed?.kind !== "offline") return;
    const back = () => { afterMount.current = "reload"; setFailed(null); };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [failed?.kind]);
  const openInChrome = (url: string) => { void fetch("/api/browser/open-in-chrome", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => (r.ok ? undefined : r.json().then((b: { error?: string }) => setError(b.error ?? "Chrome could not open it.")))).catch(() => setError("Chrome could not open it.")); };
  useEffect(() => {
    if (!goAs) return;
    if (!accounts.some((a) => a.id === goAs.id)) { setGoAs(null); setError("That account is no longer here."); return; }
    if (account !== goAs.id) return;
    setGoAs(null);
    props.onGo(goAs.url, goAs.title);
  }, [goAs, account, accounts]);
  // Signed in? Ask again the moment the page leaves Google's sign-in pages for a Google app (Gmail after the account
  // chooser), instead of only when Accounts reopens.
  let host = "";
  try { host = new URL(nav.url).hostname; } catch { /* a blank new tab */ }
  const needsCheck = Boolean(currentAccount?.email) && currentAccount?.signedIn !== true;
  useEffect(() => {
    if (!native || !needsCheck || !/(^|\.)google\.com$/.test(host) || host === "accounts.google.com") return;
    const t = window.setTimeout(() => { void checkSessions(browserStore, false, account).then(setAccounts); }, 1500);
    return () => clearTimeout(t);
  }, [native, needsCheck, host, account]);
  // Which Today rows have a live page, and which of those play sound (spec §1 #5): looked at every 3 s while shown.
  const [live, setLive] = useState<{ pages: LivePage[]; playing: string[] }>({ pages: [], playing: [] });
  useEffect(() => {
    if (!native) return;
    let stopped = false;
    const look = async () => {
      if (document.hidden) return;
      const pages = awakePages().map((p) => ({ key: p.key, tab: p.tab, url: p.url, mounted: p.mounted }));
      const playing: string[] = [];
      for (const p of pages) if (await pageAudio(p.key)) playing.push(p.key);
      if (!stopped) setLive((prev) => (JSON.stringify(prev) === JSON.stringify({ pages, playing }) ? prev : { pages, playing }));
    };
    void look();
    const t = window.setInterval(() => void look(), 4000);
    return () => { stopped = true; clearInterval(t); };
  }, [native, nav.url, account, props.tabId]);
  const mute = (key: string) => { void mutePage(key).catch(() => undefined).then(() => setLive((l) => ({ ...l, playing: l.playing.filter((k) => k !== key) }))); };
  // The mini player (arc-edges §5.6): a page still playing after he left it (another space or account), until it stops.
  const [paused, setPaused] = useState<string[]>([]);
  const now = native ? nowPlaying({ pages: live.pages, playing: live.playing, paused: paused.filter((k) => live.pages.some((p) => p.key === k)), tab: props.tabId ?? "page", spaces: profiles, today, accounts }) : null;
  const togglePlay = (key: string, play: boolean) => {
    void playPage(key, play).then(() => {
      setPaused((p) => (play ? p.filter((k) => k !== key) : [...p.filter((k) => k !== key), key]));
      setLive((l) => ({ ...l, playing: play ? [...l.playing.filter((k) => k !== key), key] : l.playing.filter((k) => k !== key) }));
    }, () => setNotice("Pause and play arrive with the next app update."));
  };
  const goToPlaying = (n: NowPlaying) => {
    if (n.space && n.space.id !== profile) chooseProfile(n.space.id);
    const space = profiles.find((s) => s.id === n.space?.id) ?? currentProfile;
    if (n.account) pickAccount(n.account === accountFor(space, accounts) ? null : n.account);
    props.onGo(n.url, n.title);
  };
  // ⌘S hides the sidebar for a full-width page, and brings it back (spec §1 #9). ⌃1 to ⌃9 switch space (arc-edges §3.1;
  // ⌘1 to ⌘9 are the app's side nav).
  const spaceKey = useRef<(n: number) => void>(() => undefined);
  spaceKey.current = (n) => { const s = profiles[n - 1]; if (s) chooseProfile(s.id); };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!container.current?.contains(e.target as Node)) return;
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); spaceKey.current(Number(e.code.slice(5))); return; }
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.code !== "KeyS") return;
      e.preventDefault();
      if (!rail) { setRail(true); setSidebarPinned(true); } else toggleSidebar();
    };
    const stopNativeShortcut = onBrowserShortcut(({ tab, action }) => {
      if (action === "new-tab" || action === "spotlight") return; // The shell owns Spotlight.
      if (tab !== pageKey(props.tabId ?? "page", store)) return;
      if (action.startsWith("space-")) { spaceKey.current(Number(action.slice(6))); return; }
      if (!rail) { setRail(true); setSidebarPinned(true); } else toggleSidebar();
    });
    window.addEventListener("keydown", down);
    return () => { stopNativeShortcut(); window.removeEventListener("keydown", down); };
  }, [rail, hidden, narrow, props.tabId, store]);
  // The address bar's account dot: this tab moves to another account; its space's default stays as it was.
  const moveTabTo = (id: string) => {
    setDotOpen(false);
    setAccounts(() => { const next = loadAccounts(browserStore).map((a) => (a.id === id ? { ...a, lastUsed: Date.now() } : a)); saveAccounts(next, browserStore); return next; });
    pickAccount(id === accountFor(currentProfile, accounts) ? null : id);
  };
  // Only an account Google signed out needs him; the ones not signed in yet wait under "Add accounts" (Shaan, 3 Oct 01:00).
  const signedOut = accounts.filter((a) => a.email && a.signedIn !== true && a.lostAt).length;
  const running = downloads.some((d) => d.state === "running");
  const reveal = async (name: string, agent: string | null) => {
    const r = await fetch("/api/browser/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agent }) }).catch(() => null);
    if (!r?.ok) setNotice(r?.status === 404 ? `${name} is no longer in Downloads.` : `Could not show ${name} in Finder.`);
  };
  // A Google sign-in made on a tab with no account lands in the no-account store (A0 arc-edges §2.2). Seen on a Google
  // page (its avatar names the address), it is offered to the account it belongs to: "Move it" repoints that account's store.
  const [stray, setStray] = useState<string | null>(null);
  const [leftAlone, setLeftAlone] = useState<string[]>([]);
  const noAddress = Boolean(currentAccount) && !currentAccount?.email && !pendingGoogle;
  useEffect(() => {
    setStray(null);
    if (!native || !noAddress || !/(^|\.)google\.com$/.test(host)) return;
    let stopped = false;
    const t = window.setTimeout(async () => {
      const email = await readGoogleAccount(pageKey(props.tabId ?? "page", store)).catch(() => null);
      if (!stopped && email && !loadAccounts(browserStore).some((a) => a.email?.toLowerCase() === email.toLowerCase() && a.signedIn === true)) setStray(email);
    }, 1500);
    return () => { stopped = true; clearTimeout(t); };
  }, [native, noAddress, host, nav.url, store, props.tabId]);
  const moveHere = (email: string) => {
    const moved = moveSignIn(browserStore, account, email);
    setStray(null);
    if (!moved) return;
    setAccounts(moved.accounts);
    pickAccount(moved.to);
    void checkSessions(browserStore, false, moved.to).then(setAccounts);
  };
  // Back and Forward walk this tab's own history (the app keeps it), in the desktop app too: the native page's history
  // is empty after a restart and has nothing ahead after a click, so asking it made both buttons do nothing (P0, 3 Oct).
  // In the Accounts hub there is no page: Back returns to it. Reload on our error page tries the page again.
  const reload = () => {
    if (native && failed) { afterMount.current = "reload"; setFailed(null); }
    else if (native) page.current?.action("reload");
    else props.onReload();
  };
  useEffect(() => {
    setDraft(nav.url);
    if (!nav.url) input.current?.focus();
  }, [nav.url]);
  const todayRows = (today[profile] ?? []).filter((p) => !profilePins.some((pin) => pin.url === p.url));
  const states = native ? sleepState(todayRows.map((p) => p.url), live.pages, live.playing, nav.url) : null;
  // Browser v3: Today is this space's open tabs that are not a pin's or a favourite's, newest first.
  const todayTabs = tabsMode ? allTabs.filter((t) => spaceOfTab(t.id) === profile && !pinAlive(t.pin)).reverse() : [];
  const tabState = (id: string) => {
    const pages = live.pages.filter((p) => p.tab === id);
    return { awake: id === props.tabId || pages.length > 0, sound: live.playing.find((k) => pages.some((p) => p.key === k)) };
  };
  type Row = { key: string; id?: string; url: string; title: string; current: boolean; asleep: boolean; sound?: string; open: () => void; close: () => void };
  const closeTabRow = (id: string) => {
    const i = todayTabs.findIndex((r) => r.id === id);
    const next = id === props.tabId ? (todayTabs[i + 1] ?? todayTabs[i - 1])?.id : undefined;
    props.onCloseTab!(id);
    if (id !== props.tabId) return;
    if (next) props.onSelectTab!(next); else openTabIn(profile, "", "New tab");
  };
  const rows: Row[] = tabsMode
    ? todayTabs.map((t) => { const st = native ? tabState(t.id) : { awake: true, sound: undefined }; return { key: t.id, id: t.id, url: t.url, title: t.title, current: t.id === props.tabId, asleep: !st.awake, sound: st.sound, open: () => showTab(t.id), close: () => closeTabRow(t.id) }; })
    : todayRows.map((p) => ({ key: p.url, url: p.url, title: p.title, current: nav.url === p.url, asleep: Boolean(states && !states.awake.has(p.url)), sound: states?.playing.get(p.url), open: () => props.onGo(p.url, p.title),
      close: () => { const next = { ...today, [profile]: today[profile].filter((tab) => tab.url !== p.url) }; setToday(next); saveBrowserTabs(next, browserStore); if (nav.url === p.url) props.onGo("", "New tab"); } }));
  const awakeCount = rows.filter((r) => !r.asleep).length;
  const clearToday = () => {
    if (tabsMode) {
      const gone = todayTabs.map((t) => t.id);
      for (const id of gone) props.onCloseTab!(id);
      if (props.tabId && gone.includes(props.tabId)) openTabIn(profile, "", "New tab");
      return;
    }
    const next = { ...today, [profile]: (today[profile] ?? []).filter((t) => profilePins.some((pin) => pin.url === t.url)) }; setToday(next); saveBrowserTabs(next, browserStore);
  };
  const go = (raw: string) => {
    const url = toUrl(raw);
    if (url) { setError(""); props.onGo(url); }
  };
  // Browser v3: what he types, answered as he types (Shaan, 7 Oct: "searching stuff ... it just takes so long"): the typed
  // address or search first, then his open tabs, pins and history. Enter takes the highlighted one at once.
  const [pick, setPick] = useState(0);
  type Hit = { key: string; kind: "go" | "tab" | "pin" | "page"; title: string; url: string; id?: string };
  const q = draft.trim(), ql = q.toLowerCase();
  const typing = addressFocused && q.length > 0 && q !== nav.url;
  const matches = (t: { title: string; url: string }) => t.title.toLowerCase().includes(ql) || t.url.toLowerCase().includes(ql);
  const hits: Hit[] = !typing ? [] : (() => {
    const typed = toUrl(q);
    const out: Hit[] = typed ? [{ key: "go", kind: "go", title: typed.startsWith("https://www.google.com/search?") ? `Search Google for “${q}”` : `Go to ${hostOf(typed)}`, url: typed }] : [];
    const seen = new Set(out.map((h) => h.url));
    // One line per page: the same address, or the same title on the same site, shows once.
    const add = (h: Hit) => { const same = `${h.title}\n${siteOf(h.url)}`; if (out.length < 8 && !seen.has(h.url) && !seen.has(same)) { seen.add(h.url); seen.add(same); out.push(h); } };
    if (tabsMode) for (const t of allTabs) if (t.id !== props.tabId && t.url && matches(t)) add({ key: `tab:${t.id}`, kind: "tab", title: t.title, url: t.url, id: t.id });
    for (const p of [...favorites, ...profilePins]) if (matches(p)) add({ key: `pin:${p.url}`, kind: "pin", title: p.title, url: p.url });
    for (const p of suggestions) add({ key: `page:${p.url}`, kind: "page", title: p.title || hostOf(p.url), url: p.url });
    return out;
  })();
  useEffect(() => setPick(0), [q]);
  const take = (h: Hit) => {
    setError(""); input.current?.blur();
    if (h.kind === "tab" && h.id) showTab(h.id);
    else if (h.kind === "pin" && tabsMode) (favorites.some((f) => f.url === h.url) ? openFavourite(h) : openPin(h));
    else props.onGo(h.url, h.kind === "go" ? undefined : h.title);
  };
  const steps = <>
    <button type="button" aria-label="Back" title="Back" disabled={!accountsOpen && !nav.back.length} onClick={() => (accountsOpen ? setAccountsOpen(false) : props.onBack())}><ArrowLeftIcon size={14} /></button>
    <button type="button" aria-label="Forward" title="Forward" disabled={accountsOpen || !nav.fwd.length} onClick={props.onForward}><ArrowRightIcon size={14} /></button>
    <button type="button" aria-label="Reload" title="Reload" disabled={accountsOpen || !nav.url} onClick={reload}><RotateCwIcon size={14} /></button>
  </>;
  const inBar = !rail || (hidden && !peek) || narrow;
  const address = <form className="ab-browser__address" onSubmit={(e) => { e.preventDefault(); const h = hits[pick]; if (h) take(h); else { go(draft); input.current?.blur(); } }}>
    <SearchIcon size={14} aria-hidden="true" />
    <input ref={input} className="siso-page__address" aria-label="Search or enter a URL" role="combobox" aria-expanded={hits.length > 0} aria-controls="ab-browser-hits" aria-activedescendant={hits[pick] ? `ab-hit-${pick}` : undefined} autoComplete="off" data-url={nav.url} value={addressFocused ? draft : displayHost} placeholder="Search or enter a URL" spellCheck={false}
      onChange={(e) => {
        let v = e.target.value;
        // Typed or pasted onto the whole address before the selection took: what was added is the new address.
        if (fresh.current) for (const old of [nav.url, displayHost]) if (old && v.length > old.length && v.startsWith(old)) { v = v.slice(old.length); break; }
        fresh.current = false;
        if (!addressFocused) setAddressFocused(true);
        setDraft(v);
      }}
      onFocus={() => { fresh.current = true; setDraft(nav.url); setAddressFocused(true); }}
      onMouseDown={() => { focusingClick.current = !addressFocused; }}
      onMouseUp={(e) => {
        const el = e.currentTarget;
        if (focusingClick.current) { focusingClick.current = false; e.preventDefault(); el.select(); }
        else if (el.selectionStart === el.selectionEnd) fresh.current = false;
      }}
      onBlur={() => { fresh.current = false; setAddressFocused(false); }}
      onKeyDown={(e) => {
        if (/^(Arrow(Left|Right)|Home|End)$/.test(e.key)) fresh.current = false;
        if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); setPick((i) => (i + 1) % hits.length); }
        else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); setPick((i) => (i - 1 + hits.length) % hits.length); }
        else if (e.key === "Escape") { setDraft(nav.url); input.current?.blur(); }
      }} />
    {/* Over the page (the bar) the native page steps aside while the list is open; in the sidebar it never covers the page. */}
    {hits.length > 0 && <ul id="ab-browser-hits" role="listbox" aria-label="Suggestions" className={`ab-browser__hits${inBar ? " siso-menu-layer" : ""}`} onPointerDown={(e) => e.preventDefault()}>
      {hits.map((h, i) => <li key={h.key} id={`ab-hit-${i}`} role="option" aria-selected={i === pick} data-kind={h.kind} onPointerEnter={() => setPick(i)} onClick={() => take(h)}>
        {h.kind === "go" ? <span className="ab-browser__hit-mark" aria-hidden="true">{h.url.startsWith("https://www.google.com/search?") ? <SearchIcon size={13} /> : <ArrowRightIcon size={13} />}</span> : <SiteMark url={h.url} title={h.title} />}
        <span>{h.kind === "go" ? h.title : rowTitle(h)}</span>{h.kind !== "go" && <small>{h.kind === "tab" ? "Switch to tab" : h.kind === "pin" ? "Pinned" : siteOf(h.url)}</small>}
      </li>)}
    </ul>}
    {nav.url && <button type="button" aria-label={pinned ? "Unpin" : "Pin"} title={pinned ? "Unpin" : "Pin in this space"} onClick={pin}>{pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}</button>}
    {native && (here === "browser"
      ? <button type="button" aria-label="Back into Agent Base" title="Back into Agent Base (closes this window; its tabs go back)" onClick={() => void browserWindow(false)}><SquareArrowDownLeftIcon size={14} /></button>
      : nav.url && !away && <button type="button" aria-label="Open in its own window" title="Open in its own window (full-screen it, then swipe between it and Agent Base)" onClick={popOut}><SquareArrowOutUpRightIcon size={14} /></button>)}
    <button type="button" className="ab-browser__dot" aria-label={`Open as… (now ${who(currentAccount)})`} title={`Profile: ${who(currentAccount)}. Choose another profile for this tab`} aria-haspopup="menu" aria-expanded={dotOpen} onClick={() => { setMenuOpen(false); setDownloadsOpen(false); setSpacesOpen(false); setDotOpen((v) => !v); }}>{initials(currentAccount)}</button>
    {dotOpen && <div className="ab-browser__menu ab-browser__openas" role="menu" aria-label="Open as" onKeyDown={(e) => { if (e.key === "Escape") setDotOpen(false); }}>
      <p className="ab-browser__profile-help">Profiles keep separate sign-ins. Choose the one for this page.</p>
      {[...accountGroups(accounts, profiles)].map(([space, list]) => (
        <div key={space} role="group" aria-label={space}>
          <span className="ab-browser__menu-label" aria-hidden="true">{space}</span>
          {list.map((a) => (
            <button key={a.id} type="button" role="menuitemradio" aria-checked={a.id === account} aria-label={who(a)} onClick={() => moveTabTo(a.id)}>
              <span className={`ab-hub__status is-${accountStatus(a).tone}`} aria-hidden="true" /><span>{who(a)}</span>{a.id === accountFor(currentProfile, accounts) && <small>{currentProfile.name} default</small>}
            </button>
          ))}
        </div>
      ))}
      <button type="button" role="menuitem" onClick={() => { setDotOpen(false); setCreatingAccount(true); setAccountName(""); setAccountError(""); }}>New browser profile</button>
    </div>}
  </form>;
  return (
    <div ref={container} className="ab-browser" data-ab-comp="browser" data-narrow={narrow || undefined} data-native={native || undefined} data-sidebar={hidden ? (peek ? "peek" : "hidden") : "pinned"} onKeyDown={(e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (dotOpen || menuOpen || downloadsOpen || spacesOpen || pinMenu) { e.stopPropagation(); setDotOpen(false); setMenuOpen(false); setDownloadsOpen(false); setSpacesOpen(false); setPinMenu(null); }
      else if (peek || (narrow && !hidden)) { e.stopPropagation(); setPeek(false); if (narrow) setHidden(true); restoreButton.current?.focus(); }
    }}>
      {narrow && rail && !hidden && <button type="button" className="ab-browser__scrim" aria-label="Close browser sidebar" onClick={() => { setHidden(true); restoreButton.current?.focus(); }} />}
      {rail && <div ref={sidebarArea} className="ab-browser__side"
        onPointerEnter={() => { pointerInside.current = true; cancelClose(); }}
        onPointerLeave={() => { pointerInside.current = false; if (hidden) closePeekLater(); }}
        onFocusCapture={cancelClose} onBlurCapture={() => { if (hidden) closePeekLater(); }}
        onDragStartCapture={() => { draggingSidebar.current = true; cancelClose(); }}
        onDragEndCapture={() => { draggingSidebar.current = false; if (hidden) closePeekLater(); }}
        onDropCapture={() => { draggingSidebar.current = false; }}>
      {hidden && !narrow && <div className="ab-browser__edge" aria-hidden="true" onPointerEnter={peekLater} />}
      {/* Browser v3: the sidebar is a card in Agent Base's halo rim, lit in the space's colour; the ring turns while the page loads. */}
      <aside onPointerOver={(e) => hoverRow(e.target)} onPointerLeave={() => clearTimeout(hoverTimer.current)} className={`ab-browser__sidebar siso-rim ${loadingSince !== null ? "is-working" : "is-idle"}`} aria-label="Browser sidebar" hidden={hidden && (!peek || narrow)} ref={(el) => { if (el && el.dataset.scrollKept !== "1") { el.dataset.scrollKept = "1"; const list = el.querySelector<HTMLElement>(".ab-browser__scroll"); if (list) list.scrollTop = sidebarScroll; } }} style={{ "--ab-space-rgb": spaceColour(profile), "--rim-hue": `rgb(${spaceColour(profile)})` } as CSSProperties}>
        <div className="ab-browser__top">
          <span className="ab-browser__steps">{steps}</span>
          {/* Beside the chat (R1.22b) the sidebar folds into the page's bar; full width, ⌘S hides it and the edge peeks it. */}
          {props.slim ? <button type="button" aria-label="Hide sidebar" title="Hide sidebar" onClick={() => setRail(false)}><PanelLeftCloseIcon size={14} /></button>
            : <button type="button" aria-label={hidden ? "Keep the sidebar open" : "Hide the sidebar"} title={`${hidden ? "Keep the sidebar open" : "Hide the sidebar"} (⌘S)`} onClick={toggleSidebar}>{hidden ? <PanelLeftOpenIcon size={14} /> : <PanelLeftCloseIcon size={14} />}</button>}
        </div>
        {(!narrow || !hidden) && address}
        {creatingAccount && <form className="ab-browser__folder-edit" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setCreatingAccount(false); } }} onSubmit={(e) => {
          e.preventDefault();
          try { const created = createNamedBrowserProfile(accountName, browserStore); setAccounts(loadAccounts(browserStore)); pickAccount(created.id); setCreatingAccount(false); }
          catch (error) { setAccountError(error instanceof Error ? error.message : "Could not create the profile."); }
        }}>
          <p>Start with two or three profiles. Each keeps separate sign-ins; sign in on each site yourself.</p>
          <input autoFocus aria-label="New browser profile name" placeholder="e.g. Work or Personal" maxLength={80} value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          <div><button type="submit">Create profile</button><button type="button" onClick={() => setCreatingAccount(false)}>Cancel</button></div>
          {accountError && <p role="alert">{accountError}</p>}
        </form>}
        <div className="ab-browser__scroll" onScroll={(e) => { sidebarScroll = e.currentTarget.scrollTop; }}>
        {favorites.length > 0 && <div className="ab-browser__favorites" aria-label="Favourites" data-count={Math.min(favorites.length, FAV_MAX)} style={{ "--ab-fav-cols": favouriteColumns(Math.min(favorites.length, FAV_MAX)) } as CSSProperties}>
          {shownFavorites.map((p) => { const key = favKey(p.url), bound = tabsMode ? boundTo(key) : undefined; return <div key={p.url} className="ab-browser__favourite" data-open={bound ? (native && !tabState(bound.id).awake ? "asleep" : "awake") : undefined} onContextMenu={(e) => { e.preventDefault(); setPinMenu({ space: FAVORITES, pin: p }); }}>
            <button type="button" title={rowTitle(p)} aria-label={`Favourite: ${p.title}`} data-url={p.url} aria-current={pinActive(key, p.url) ? "page" : undefined} onClick={() => openFavourite(p)}><FavouriteIcon title={p.title} url={p.url} /></button>
            <button type="button" className="ab-browser__close" aria-label={`Unpin favourite ${p.title}`} onClick={() => removePin(FAVORITES, p)}>×</button>
          </div>; })}
          {favorites.length > FAV_MAX && <button type="button" className="ab-browser__more" aria-expanded={allFavorites} aria-label={allFavorites ? "Fewer favourites" : `${favorites.length - FAV_MAX + 1} more favourites`} onClick={() => setAllFavorites((v) => !v)}>{allFavorites ? "Less" : `+${favorites.length - FAV_MAX + 1}`}</button>}
        </div>}

        <section className="ab-browser__pinned" aria-label="Saved pages">
          <SavedFolders key={profile} space={profile} folders={folders} pins={profilePins} onFolders={updateFolders} onFile={filePin} renderPin={(p) => <div className="ab-browser__tab" draggable onDragStart={(e) => { e.dataTransfer.setData(PIN_DRAG, JSON.stringify({ url: p.url, title: p.title })); e.dataTransfer.effectAllowed = "move"; }} onContextMenu={(e) => { e.preventDefault(); setPinMenu({ space: profile, pin: profilePins.find((pin) => pin.url === p.url)! }); }}>
            <button className="ab-browser__row" type="button" aria-current={pinActive(pinKey(profile, p.url), p.url) ? "page" : undefined} data-open={tabsMode && boundTo(pinKey(profile, p.url)) ? "1" : undefined} data-url={p.url} onClick={() => openPin(p)}><SiteMark url={p.url} title={p.title} /><span>{rowTitle(p)}</span></button>
            <button className="ab-browser__close" type="button" aria-label={`Unpin ${p.title}`} onClick={() => removePin(profile, profilePins.find((pin) => pin.url === p.url)!)}>×</button>
          </div>} />
        </section>
        <section className="ab-browser__today" aria-label="Today section">
          <header className="ab-browser__head">
            <h3>Today</h3>{rows.length > 0 && <span className="ab-browser__footer" aria-label="Today tabs" title={native ? `${awakeCount} awake, ${rows.length - awakeCount} asleep` : undefined}>{rows.length}</span>}
            {rows.length > 0 && <button type="button" className="ab-browser__clear" aria-label="Close all Today tabs" title="Close every Today tab in this space (pinned pages stay)" onClick={clearToday}>Clear</button>}
          </header>
        <div className="ab-browser__tabs" aria-label="Today"
          onDragOver={(e) => { if (e.dataTransfer.types.includes(PIN_DRAG)) e.preventDefault(); }}
          onDrop={(e) => { const raw = e.dataTransfer.getData(PIN_DRAG); if (!raw) return; e.preventDefault(); const p = JSON.parse(raw) as { url: string; title: string }; const pin = profilePins.find((x) => x.url === p.url); if (tabsMode) { const bound = boundTo(pinKey(profile, p.url)); if (pin) removePin(profile, pin); if (!bound) openTabIn(profile, p.url, p.title); } else { unpin([p.url]); toToday(p); } }}>
          {/* On a blank tab already: a second "New tab" row beside it is noise. */}
          {!(tabsMode && !nav.url) && <button className="ab-browser__row ab-browser__new" type="button" title="New tab (⌘T)" onClick={() => (props.onNewTab ? props.onNewTab() : props.onGo("", "New tab"))}><PlusIcon size={15} /><span>New tab</span><kbd>⌘T</kbd></button>}
          {rows.map((r) => <div key={r.key} className="ab-browser__tab" draggable onDragStart={(e) => { e.dataTransfer.setData(TODAY_DRAG, JSON.stringify({ url: r.url, title: r.title, id: r.id })); e.dataTransfer.effectAllowed = "move"; }} data-state={r.sound ? "playing" : r.asleep ? "asleep" : native ? "awake" : undefined}>
            {r.sound && <button type="button" className="ab-browser__sound" aria-label={`Mute ${r.title}`} title="Playing. Click to mute" onClick={() => mute(r.sound!)}><Volume2Icon size={14} /></button>}
            <button className="ab-browser__row" type="button" title={r.asleep ? `${r.title} (asleep: reopens from its address)` : r.url} aria-current={r.current ? "page" : undefined} data-url={r.url || undefined} onClick={r.open}>{!r.sound && (r.url ? <SiteMark url={r.url} title={r.title} /> : <span className="ab-browser__site ab-browser__blank" aria-hidden="true"><GlobeIcon size={13} /></span>)}<span>{r.url ? rowTitle(r) : r.title || "New tab"}</span></button>
            {/* A pin on every tab (6 Oct 22:10: "there's no buttons to pin any of the browsers"): it moves to Saved pages. */}
            {r.url && <button className="ab-browser__pin" type="button" aria-label={`Pin ${r.title}`} title="Pin to Saved pages (or drag it onto a folder)" onClick={() => filePin({ url: r.url, title: r.title, id: r.id })}><PinIcon size={13} /></button>}
            <button className="ab-browser__close" type="button" aria-label={`Close ${r.title}`} onClick={r.close}>×</button>
          </div>)}
        </div>
        </section>
        </div>
        <StatusLines lines={statusOrder({ lost: signedOut > 0, stray: Boolean(stray && !leftAlone.includes(stray)), error: Boolean(error), setup: !setupOpen && setupChip(setup), notice: Boolean(notice) }).map((id): Line => {
          if (id === "lost") return { id, tone: "lost", body: <button type="button" onClick={() => { setMenuOpen(false); openHub(); }}>Google signed out {signedOut} {signedOut === 1 ? "account" : "accounts"} →</button> };
          if (id === "stray") return { id, tone: "warn", body: <span role="status" aria-label="Sign-in in the wrong place" title={`${stray} is signed in on this tab, which has no Google account, so Google saved the sign-in there.`}>
            <span>Wrong place · <b>{stray}</b></span>
            <button type="button" aria-label={`Move it to ${stray}`} onClick={() => moveHere(stray!)}>Move it</button>
            <button type="button" aria-label="Leave it" title="Leave it" onClick={() => setLeftAlone((l) => [...l, stray!])}>×</button>
          </span> };
          if (id === "error") return { id, tone: "lost", body: <span role="alert" title={error}><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError("")}>×</button></span> };
          if (id === "setup") return { id, tone: "info", body: <button type="button" onClick={() => { setAccountsOpen(false); setSetupOpen(true); }}>Finish import · {setup.step - 1} of 4 done</button> };
          return { id, tone: "info", body: <span role="status" title={notice}><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice("")}>×</button></span> };
        })} />
        {!stray && needsAccount(currentProfile, accounts) && <div className="ab-browser__card" role="group" aria-label={`Which Google account does ${currentProfile.name} use?`}>
          <p>Which Google account does <b>{currentProfile.name}</b> use?</p>
          {[...accounts].filter((a) => a.email).sort((a, b) => Number(b.signedIn === true) - Number(a.signedIn === true)).slice(0, 4).map((a) => (
            <button key={a.id} type="button" onClick={() => makeDefault(a.id)}>{a.email}{a.signedIn === true ? " · signed in" : ""}</button>
          ))}
          <div className="ab-browser__card-row">{!accountsOpen && <button type="button" onClick={() => setAccountsOpen(true)}>More…</button>}<button type="button" onClick={() => makeDefault(DEFAULT_ACCOUNT, true)}>No account</button></div>
        </div>}
        {pendingGoogle && <p className="ab-browser__empty">Finish signing in to Google. This space will be named from your signed-in address.</p>}
        {creatingProfile && <form className="ab-browser__create" onSubmit={(e) => {
          e.preventDefault();
          try { const next = createBrowserProfile(profileName, browserStore); setArc(loadArcProfiles(browserStore)); chooseProfile(next.id); setCreatingProfile(false); setProfileError(""); }
          catch (e) { setProfileError(e instanceof Error ? e.message : "Could not save the profile."); }
        }}>
          <input aria-label="New space name" autoFocus maxLength={80} value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Space name" />
          <button type="submit">Create space</button><button type="button" onClick={() => setCreatingProfile(false)}>Cancel</button>
          {profileError && <span role="alert">{profileError}</span>}
        </form>}
        <div className="ab-browser__bottom">
          {pinMenu && <div className="ab-browser__menu" role="menu" aria-label={`Shortcut: ${pinMenu.pin.title}`} onKeyDown={(e) => { if (e.key === "Escape") setPinMenu(null); }}>
            <button type="button" role="menuitem" onClick={() => removePin(pinMenu.space, pinMenu.pin)}>Unpin</button>
            {pinMenu.space !== FAVORITES && <button type="button" role="menuitem" onClick={() => { keepImported(pinMenu.pin, true); setPinMenu(null); }}>Keep in favourites</button>}
            {pinMenu.space !== FAVORITES && <label className="ab-browser__move-pin">Move to folder<select aria-label={`Move ${pinMenu.pin.title} to folder`} value={folders.find((f) => f.space === profile && f.urls.includes(pinMenu.pin.url))?.id ?? ""} onChange={(e) => { filePin(pinMenu.pin, e.target.value || undefined); setPinMenu(null); }}><option value="">Top level</option>{folders.filter((f) => f.space === profile).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
            <button type="button" role="menuitem" onClick={() => setPinMenu(null)}>Cancel</button>
          </div>}
          {downloadsOpen && <div className="ab-browser__menu ab-browser__downloads" role="dialog" aria-label="Downloads" onKeyDown={(e) => { if (e.key === "Escape") setDownloadsOpen(false); }}>
            {!downloads.length ? <p className="ab-browser__empty">Nothing downloaded yet.</p> : <ul>
              {downloads.map((d) => (
                <li key={d.id} data-state={d.state}>
                  <span><b>{d.name}</b><small>{d.agent ? `Downloads/Agents/${d.agent}` : "Downloads"} · {d.state === "running" ? "downloading" : d.state === "failed" ? "failed" : new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span>
                  {d.state === "running" && <span className="ab-browser__dl-bar" role="progressbar" aria-label={`Downloading ${d.name}`} />}
                  {d.state === "done" && <button type="button" aria-label={`Show ${d.name} in Finder`} onClick={() => void reveal(d.name, d.agent)}>Show in Finder</button>}
                </li>
              ))}
            </ul>}
          </div>}
          {menuOpen && <div className="ab-browser__menu" role="menu" aria-label="Browser options">
            <button role="menuitem" type="button" onClick={addGoogleAccount}>+ Google account</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setAccountsOpen(false); updateSetup({ ...setup, step: 1, closedAt: undefined }); setSetupOpen(true); }}>Import from Arc and Chrome</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}>Import Arc pins</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setCreatingProfile(true); setProfileName(""); setProfileError(""); }}>New space</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); openHub(); }}>Accounts</button>
            <button role="menuitemcheckbox" type="button" aria-checked={blocking} title="Ads and trackers from EasyList and EasyPrivacy are never loaded" onClick={() => { const next = !blocking; setBlocking(next); void setAdblock(next).catch(() => setNotice("The ad blocker arrives with the next app update.")); }}>{blocking ? "✓ " : ""}Block ads and trackers</button>
          </div>}
          {now && <MiniPlayer now={now} onToggle={() => togglePlay(now.key, now.paused)} onMute={() => mute(now.key)} onGo={() => goToPlaying(now)} />}
          {finished && <DownloadToast done={finished} onShow={() => void reveal(finished.name, finished.agent)} onError={setNotice} onClose={() => setFinished(null)} />}
          {spacesOpen && <SpaceMenu spaces={profiles} current={profile} accounts={accounts} onPick={chooseProfile} onClose={() => setSpacesOpen(false)}
            onAccounts={() => { setSpacesOpen(false); openHub(); }}
            onImport={() => { setSpacesOpen(false); setAccountsOpen(false); updateSetup({ ...setup, step: 1, closedAt: undefined }); setSetupOpen(true); }}
            onNewSpace={() => { setSpacesOpen(false); setCreatingProfile(true); setProfileName(""); setProfileError(""); }} />}
          <nav className="ab-browser__spaces" aria-label="Browser spaces">
            <button type="button" className={`ab-browser__dl${running ? " is-running" : ""}`} aria-label={running ? "Downloads (one is running)" : "Downloads"} title="Downloads" aria-haspopup="dialog" aria-expanded={downloadsOpen} onClick={() => { setMenuOpen(false); setDotOpen(false); setSpacesOpen(false); setDownloadsOpen((v) => !v); }}><DownloadIcon size={15} /></button>
            <div className="ab-browser__spacetabs" role="tablist" aria-label="Spaces">
              {chips.shown.map((p, i) => <button key={p.id} type="button" role="tab" className="ab-browser__spacetab" title={`${p.name} (⌃${i + 1})`} aria-label={p.name} aria-selected={profile === p.id} style={{ "--ab-chip-rgb": spaceColour(p.id) } as CSSProperties} onClick={() => chooseProfile(p.id)}><i aria-hidden="true">{p.name.trim().charAt(0).toUpperCase()}</i><span>{p.name}</span></button>)}
              {chips.more > 0 && <button type="button" className="ab-browser__spacetab is-more" aria-label={`${chips.more} more spaces`} aria-haspopup="menu" aria-expanded={spacesOpen} onClick={() => { setMenuOpen(false); setDownloadsOpen(false); setSpacesOpen((v) => !v); }}><i aria-hidden="true">+{chips.more}</i><span>More</span></button>}
            </div>
            <button type="button" className="ab-browser__add" aria-label="Browser options" aria-haspopup="menu" aria-expanded={menuOpen} title="Accounts, import, ad blocker" onClick={() => { setDotOpen(false); setDownloadsOpen(false); setSpacesOpen(false); setMenuOpen((v) => !v); }}><EllipsisIcon size={15} /></button>
          </nav>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = "";
          if (!file) return;
          try { const profiles = importArcSidebar(await file.text(), browserStore); setArc(profiles); if (profiles.length) chooseProfile(profiles[0].id); setError(""); }
          catch { setError("Could not import Arc pins. Choose a valid StorableSidebar.json file."); }
        }} />
      </aside>
      </div>}
      <section className="siso-page" aria-label="Page">
        {(!rail || hidden || narrow) && <div className="ab-browser__bar" data-testid="browser-bar">
          <button ref={restoreButton} type="button" aria-label={rail && !hidden ? "Hide sidebar" : "Show sidebar"} title="Browser sidebar (⌘S)" onClick={() => { setRail(true); setSidebarPinned(hidden || !rail); }}><PanelLeftOpenIcon size={14} /></button>
          {steps}
          {(!rail || (hidden && !peek)) && address}
        </div>}
        {setupOpen && <SetupSheet setup={setup} accounts={accounts} spaces={profiles}
          onStep={(step) => updateSetup({ ...setup, step })}
          onImport={importBrowsers}
          onSort={(cols) => { const next = applySort(cols, profiles, loadAccounts(browserStore), browserStore); setAccounts(next.accounts); setArc(next.spaces); pickAccount(null); }}
          onSignIn={(id, email) => { setSetupOpen(false); signIn(id, email); }}
          onClose={() => { updateSetup({ ...setup, closedAt: Date.now() }); setSetupOpen(false); }}
          onDone={() => { updateSetup({ ...setup, doneAt: Date.now() }); setSetupOpen(false); }} />}
        {accountsOpen ? <AccountsHub key={hubFilter} filter={hubFilter} accounts={accounts} spaces={profiles} current={currentProfile} checking={checking} onSignIn={hubSignIn} onOpen={openAs} onMakeDefault={makeDefault} onRecheck={() => void recheck()} onAddGoogle={addGoogleAccount} onBack={() => setAccountsOpen(false)}
          sheet={sheetAccount && <SignInSheet key={`${sheetAccount.id}#${storeOf(sheetAccount)}`} account={sheetAccount} onSignedIn={signedInHere} onStop={(id, step) => setAccounts(noteSignIn(browserStore, id, Date.now(), step))} onKeepAs={keepAs} onFresh={(id) => setAccounts(freshStore(browserStore, id))} onClose={() => setSheetFor(null)} />} /> : nav.url ? (native ? (away ? <div className="ab-browser__away" role="status">
          <SiteMark url={nav.url} title={props.title} />
          <p><b>{props.title || siteOf(nav.url)}</b>{here === "main" ? "Open in the SISO Browser window." : "Back in Agent Base."}</p>
          <div>
            {here === "main" && <button type="button" onClick={popOut}>Show the window</button>}
            <button type="button" onClick={() => setAway(false)}>Bring it here</button>
          </div>
        </div> : failed ? <ErrorPage failure={failed} onRetry={() => { afterMount.current = "reload"; setFailed(null); }} onBack={() => { afterMount.current = "back"; setFailed(null); }} onChrome={() => openInChrome(failed.url)} /> : <>
          {loadingSince !== null && <div className="ab-browser__hairline" role="progressbar" aria-label={`Loading ${siteOf(nav.url)}`} />}
          {slow && <div className="ab-browser__strip" role="status">Still loading {siteOf(nav.url)} · {Math.round(loadingFor / 1000)} s<button type="button" onClick={() => { setLoadingSince(Date.now()); page.current?.action("reload"); }}>Reload</button><button type="button" onClick={() => openInChrome(nav.url)}>Open in Chrome</button></div>}
          {siteAuth && <SiteAuthSheet key={siteAuth.id} ask={siteAuth} onAnswer={answerAuth} />}
          {!siteAuth && authOff && <div className="ab-browser__away" role="status" data-native-overlay="true">
            <SiteMark url={nav.url} title={props.title} />
            <p><b>Not signed in to {authOff}</b>The page needs its password to show.</p>
            <div><button type="button" onClick={() => { setAuthOff(null); page.current?.action("reload"); }}>Sign in</button><button type="button" onClick={() => openInChrome(nav.url)}>Open in Chrome</button></div>
          </div>}
          {/* While a sign-in shows, the page's slot folds away, which hides the native page under it. */}
          <div ref={slot} aria-label={props.title} data-native-browser={account} style={{ flex: siteAuth || authOff ? 0 : 1, minHeight: 0 }} />
        </>) : (frameBlock?.url === nav.url ? <div className="ab-browser__away" role="status" data-testid="frame-blocked">
          <SiteMark url={nav.url} title={props.title} />
          <p><b>{siteOf(nav.url)} {frameBlock.why === "password" ? "asks for a password" : "won't open inside Agent Base"}</b>{frameBlock.why === "password" ? "Its sign-in only shows in a full browser tab." : "The site refuses to be shown inside another page."}</p>
          <div><button type="button" onClick={() => window.open(nav.url, "_blank", "noopener,noreferrer")}>Open in a new tab</button></div>
        </div> : <iframe key={`${nav.url}#${nav.n}`} title={props.title} src={nav.url} />)) : <BrowserHome space={currentProfile.name} colour={spaceColour(profile)} favourites={favorites} pins={profilePins} imported={imported} recents={props.recents} suggested={props.suggested} onTerminal={props.onTerminal}
          onOpen={(p, kind) => {
            // From a blank tab: a favourite or a pin shows its own tab (this blank one closes); anything else loads here.
            if (tabsMode && (kind === "fav" || kind === "pin") && props.tabId) { props.onCloseTab!(props.tabId); if (kind === "fav") openFavourite(p); else openPin(p); }
            else props.onGo(p.url, p.title);
          }}
          onKeep={(p, favourite) => keepImported(p, favourite)} />}
      </section>
    </div>
  );
}

/** The new-tab page (browser v3): his launcher, centred like the app's empty chat. Favourites and this space's pins as large
 * tiles, his Arc pages (the "30 imported", off the sidebar now) as a grid he can pin from, then recent pages; the app's
 * Terminal and the agents' pages stay, quietly, at the end. */
type HomePage = { url: string; title: string; at?: number };
function BrowserHome({ space, colour, favourites, pins, imported, recents, suggested, onOpen, onKeep, onTerminal }: { space: string; colour: string; favourites: HomePage[]; pins: HomePage[]; imported: BrowserPin[]; recents: Page[]; suggested: Page[];
  onOpen: (p: HomePage, kind: "fav" | "pin" | "page") => void; onKeep: (p: BrowserPin, favourite: boolean) => void; onTerminal: () => void }) {
  const [allArc, setAllArc] = useState(false);
  const arc = allArc ? imported : imported.slice(0, 12);
  const tile = (p: HomePage, kind: "fav" | "pin" | "page", extra?: ReactNode) => <div key={`${kind}:${p.url}`} className="ab-home__tile">
    <button type="button" title={p.url} onClick={() => onOpen(p, kind)}><FavouriteIcon title={p.title} url={p.url} /><span>{rowTitle(p)}</span></button>{extra}
  </div>;
  return (
    <div className="ab-home" style={{ "--ab-space-rgb": colour } as CSSProperties}>
      <div className="ab-home__inner">
        <header className="ab-home__head"><i aria-hidden="true" /><h2>{space}</h2><span>Type in the address bar to search or go anywhere.</span></header>
        {favourites.length > 0 && <section aria-label="Favourites"><h3>Favourites</h3><div className="ab-home__grid">{favourites.map((p) => tile(p, "fav"))}</div></section>}
        {pins.length > 0 && <section aria-label={`Pinned in ${space}`}><h3>Pinned in {space}</h3><div className="ab-home__grid">{pins.map((p) => tile(p, "pin"))}</div></section>}
        {imported.length > 0 && <section aria-label="From Arc"><h3>From Arc <small>{imported.length}</small></h3>
          <div className="ab-home__grid">{arc.map((p) => tile(p, "page", <span className="ab-home__keep">
            <button type="button" aria-label={`Pin ${p.title}`} title={`Pin in ${space}`} onClick={() => onKeep(p, false)}><PinIcon size={12} /></button>
            <button type="button" aria-label={`Favourite ${p.title}`} title="Add to favourites" onClick={() => onKeep(p, true)}><PlusIcon size={12} /></button>
          </span>))}</div>
          {imported.length > 12 && <button type="button" className="ab-home__more" onClick={() => setAllArc((v) => !v)}>{allArc ? "Show fewer" : `Show all ${imported.length}`}</button>}
        </section>}
        {recents.length > 0 && <section aria-label="Recent"><h3>Recent</h3><div className="ab-home__recent">
          {recents.filter((p) => /^https?:/.test(p.url)).slice(0, 8).map((p) => <button key={p.url} type="button" title={p.url} onClick={() => onOpen(p, "page")}>
            <SiteMark url={p.url} title={p.title} /><b>{rowTitle({ url: p.url, title: p.title && p.title !== p.url && !/^[\w.-]+(:\d+)?(\/.*)?$/.test(p.title) ? p.title : "" })}</b><small>{siteOf(p.url)}</small><time>{when(p.at)}</time>
          </button>)}
        </div></section>}
        <footer className="ab-home__tools">
          <button type="button" onClick={onTerminal}><TerminalSquareIcon size={14} />Terminal</button>
          {suggested.slice(0, 4).map((p) => <button key={p.url} type="button" title={p.url} onClick={() => onOpen(p, "page")}><GlobeIcon size={13} />{p.title}</button>)}
        </footer>
      </div>
    </div>
  );
}
