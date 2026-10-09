// uihub: arc:command-palette
import { BankWorkspacePalette } from "../BankNavigationAdapters";
import { onBrowserShortcut } from "../../lib/webview";
import { useEffect, useState } from "react";
import { type BrowserTab, type Nav, PageView, hostOf } from "../Browser";
import { onNewTab, onWindowTab } from "../../lib/webview";
import type { Page } from "../../lib/agents";

/**
 * The SISO Browser window (t-0439). Shaan, 6 Oct: "I would use my arc browser more if I could move it over to a new window
 * so I could use the Mac's built-in swipe": Agent Base full screen in one Space, the browser full screen in the next.
 *
 * The same browser (spaces, pins, folders, Today, profiles) in a window of its own. A tab popped out of Agent Base arrives
 * with its live page; this window keeps that tab's address and back/forward itself, as Agent Base does for its tabs.
 */
const empty: Nav = { url: "", back: [], fwd: [], n: 0 };
const params = new URLSearchParams(location.search);
// `n` counts arrivals: a tab popped out again (after it went back to Agent Base) remounts, so its page comes over again.
type WindowTab = BrowserTab & { nav: Nav; n: number };
const newId = () => `win:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function BrowserWindow() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => onBrowserShortcut(({ action }) => { if (action === 'spotlight' || action === 'new-tab') setPaletteOpen(true); }), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && (event.code === 'KeyK' || event.code === 'KeyT')) { event.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  // Browser v3: every sidebar row is a tab of its own with its own live page. This window keeps its own tabs, as Agent Base does.
  const [tabs, setTabs] = useState<WindowTab[]>(() => [{ id: params.get("tab") || newId(), title: params.get("title") || "", url: params.get("url") || "", nav: { ...empty, url: params.get("url") || "" }, n: 0 }]);
  const [active, setActive] = useState(() => tabs[0].id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  // The personal space's pins come from the agent table Agent Base keeps (it caches the last read in this origin's storage).
  const [pinned, setPinned] = useState<Set<string>>(() => readPinned());
  const edit = (id: string, change: (t: WindowTab) => WindowTab) => setTabs((ts) => ts.map((t) => (t.id === id ? change(t) : t)));
  const open = (url: string, title: string, pin?: string) => {
    const id = newId();
    setTabs((ts) => [...ts, { id, title, url, pin, nav: { ...empty, url }, n: 0 }]);
    setActive(id);
    return id;
  };
  useEffect(() => { document.title = tab.title || (tab.url ? hostOf(tab.url) : "SISO Browser"); }, [tab.title, tab.url]);
  useEffect(() => onWindowTab((t) => {
    setTabs((ts) => ts.some((x) => x.id === t.tab)
      ? ts.map((x) => (x.id === t.tab ? { ...x, title: t.title, url: t.url, nav: { ...empty, url: t.url }, n: x.n + 1 } : x))
      : [...ts, { id: t.tab, title: t.title, url: t.url, nav: { ...empty, url: t.url }, n: 0 }]);
    setActive(t.tab);
  }), []);
  // A link that opens a new window from a page here (target=_blank) opens as a tab in this window, as in Agent Base.
  useEffect(() => onNewTab((url) => void open(url, hostOf(url))), []);
  const go = (url: string, title?: string) => {
    edit(tab.id, (t) => ({ ...t, url, title: title ?? hostOf(url), nav: { url, back: [...t.nav.back, t.nav.url].slice(-50), fwd: [], n: t.nav.n } }));
    if (url) void registry({ op: "visit", url, title: title ?? hostOf(url) });
  };
  const step = (dir: -1 | 1) => edit(tab.id, (t) => {
    const c = t.nav;
    if (dir < 0 && c.back.length) return { ...t, url: c.back.at(-1)!, nav: { ...c, url: c.back.at(-1)!, back: c.back.slice(0, -1), fwd: [c.url, ...c.fwd] } };
    if (dir > 0 && c.fwd.length) return { ...t, url: c.fwd[0], nav: { ...c, url: c.fwd[0], fwd: c.fwd.slice(1), back: [...c.back, c.url] } };
    return t;
  });
  const recents: Page[] = [];
  return (
    <div className="ab-browser-window" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--crm-color-bg, #0b0b0c)" }}>
      <BankWorkspacePalette agents={[]} workspaces={[]} connected open={paletteOpen} onOpenChange={setPaletteOpen} hideTrigger
        onOpenAgent={() => undefined} onOpenWorkspace={() => undefined} browserTabs={tabs}
        onBrowserTab={setActive} onGo={(url, title) => { open(url, title ?? hostOf(url)); }} visitedId={`browser-tab:${active}`} />
      <PageView
        key={`${tab.id}#${tab.n}`}
        tabId={tab.id}
        web
        nav={tab.nav}
        title={tab.title || (tab.url ? hostOf(tab.url) : "New tab")}
        pinned={pinned.has(tab.url)}
        suggested={[]}
        recents={recents}
        onGo={go}
        onTitle={(title) => edit(tab.id, (t) => ({ ...t, title }))}
        onBack={() => step(-1)}
        onForward={() => step(1)}
        onReload={() => edit(tab.id, (t) => ({ ...t, nav: { ...t.nav, n: t.nav.n + 1 } }))}
        onPin={(pin) => {
          const url = tab.url;
          setPinned((s) => { const next = new Set(s); if (pin) next.add(url); else next.delete(url); return next; });
          void registry(pin ? { op: "pin-page", url, title: tab.title || hostOf(url) } : { op: "unpin-page", url });
        }}
        onNewTab={() => setPaletteOpen(true)}
        onTerminal={() => undefined}
        tabs={tabs.map(({ id, title, url, pin }) => ({ id, title, url, pin }))}
        onSelectTab={setActive}
        onCloseTab={(id) => setTabs((ts) => {
          const left = ts.filter((t) => t.id !== id);
          if (id === active && left.length) setActive(left[left.length - 1].id);
          return left.length ? left : [{ id: newId(), title: "New tab", url: "", nav: empty, n: 0 }];
        })}
        onOpenTab={open}
        onBindTab={(id, pin) => edit(id, (t) => ({ ...t, pin }))}
      />
    </div>
  );
}

function readPinned(): Set<string> {
  try {
    const d = JSON.parse(localStorage.getItem("agent-base:agents-last") ?? "null") as { pinnedPages?: { url?: unknown }[] } | null;
    return new Set((d?.pinnedPages ?? []).map((p) => p.url).filter((u): u is string => typeof u === "string"));
  } catch { return new Set(); }
}

const registry = (edit: { op: "visit" | "pin-page" | "unpin-page"; url: string; title?: string }) =>
  fetch("/api/registry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(edit) }).catch(() => undefined);
