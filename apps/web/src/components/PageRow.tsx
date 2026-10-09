import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { BookTextIcon, LayoutGridIcon, LayoutPanelTopIcon, PinIcon, XIcon } from "lucide-react";
import { PAGE_DRAG } from "@siso/shell";
import type { Page } from "../lib/agents";
import "./panel/panel.css";

/**
 * The agent's pages as a row in the panel card's head (pagestrip SPEC §0a, option R1; Shaan 3 Oct ~01:05: "you got to find
 * a cleaner way of doing it ... the scrollies fit on the page like on the side nav tab is a bit of a waste of space"). It
 * replaces the 44 px column at the window's edge (R1.22). His pins first (a short underline marks one), a hairline, then
 * this agent's pages, kept first then newest. 0 icons: no row. 1-3: inside the head line, between the name and ×. 4 or
 * more: one row under the head with as many as fit and `+N`; it never scrolls. Hover drops one card under the row, inside
 * the panel (no OS tooltip, no clipped label). A click opens the page as this agent's tab, as the strip did. While a page
 * drags anywhere, the row shows its two drop zones: Pin (every agent) and Keep (this agent).
 */
export type PageRowProps = {
  agent: string;
  pinned: Page[];
  dropped: Page[];
  /** Pages open as tabs of this agent now (by address): drawn hollow. */
  open: Set<string>;
  /** Pages posted after this (ms) carry the new dot; null: none do. */
  seenAt: number | null;
  /** A page drag is running somewhere: show the zones even when they are empty. */
  dragging: boolean;
  onOpen: (p: Page) => void;
  onUnpin: (p: Page) => void;
  onHide: (p: Page) => void;
  onPin: (p: { url: string; title: string }) => void;
  onKeep: (p: { url: string; title: string }) => void;
};

/** Where the row goes: nowhere (no pages, no pins), inside the head line (1-3), or a row of its own (4+, or a drag). */
export const rowMode = (p: Pick<PageRowProps, "pinned" | "dropped" | "dragging">) => {
  const n = p.pinned.length + p.dropped.length;
  return p.dragging ? "row" : n === 0 ? "none" : n <= 3 ? "inline" : "row";
};
const isNew = (p: PageRowProps, x: Page) => p.seenAt !== null && (x.at ?? 0) > p.seenAt && !p.open.has(x.url);

const TILE = 28;
const GAP = 5;
const MORE = 34;
const DIV = 1 + GAP;

const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" }) : "");
const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const isCard = (p: Page) => /\/card\/[^/]+\/html$/.test(p.url);
const isWidgets = (p: Page) => /\/widgets?(\/|\?|#|$)/i.test(p.url) || /widgets/i.test(p.title);
const isDoc = (p: Page) => /\.(md|pdf|txt|docx?)(\?|#|$)/i.test(p.url) || /docs\.google\.com/.test(p.url);
const TONES = ["--crm-brand-rgb", "--crm-success-rgb", "--crm-danger-rgb", "--crm-highlight-rgb"];
/**
 * A site's own mark: its favicon, else a letter tile in a colour of its host (HUB-DESIGN 22:18: identical globes make the
 * row unreadable). The favicon is asked of the site itself, the same server the page loads from.
 */
function SiteTile({ url, title }: { url: string; title: string }) {
  const [broken, setBroken] = useState(false);
  let host = title, icon = "", name = title;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    icon = `${u.origin}/favicon.ico`;
    // A title that is only its address ("127.0.0.1:5420/keep-me") is named by its last path segment.
    if (!title || title.includes(u.host) || /^https?:/.test(title)) name = u.pathname.split("/").filter(Boolean).at(-1) ?? host;
  } catch {
    /* a title-only page */
  }
  // Coloured by the page as well as the site, so two pages of one site starting with one letter still differ.
  const tone = `var(${TONES[[...`${host}${title}`].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]})`;
  return broken || !icon ? (
    <span className="ab-prow__letter" data-testid="prow-letter" style={{ "--ab-tile-rgb": tone } as CSSProperties} aria-hidden>
      {(name || host).trim().charAt(0).toUpperCase()}
    </span>
  ) : (
    <img className="ab-prow__fav" src={icon} alt="" width={16} height={16} onError={() => setBroken(true)} />
  );
}
/** A page an agent dropped in: a kind icon (A0's widgets page, a console card, a doc), and a plain web page by its site. */
const Mark = ({ p, kind }: { p: Page; kind: "pin" | "drop" }) =>
  kind === "pin" ? <SiteTile url={p.url} title={p.title} /> : isWidgets(p) ? <LayoutGridIcon size={14} aria-hidden /> : isCard(p) ? <LayoutPanelTopIcon size={14} aria-hidden /> : isDoc(p) ? <BookTextIcon size={14} aria-hidden /> : <SiteTile url={p.url} title={p.title} />;

type Item = { p: Page; kind: "pin" | "drop" };

function Tile({ it, isOpen, fresh, onOpen, onHover }: { it: Item; isOpen: boolean; fresh: boolean; onOpen: () => void; onHover: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={`ab-prow__tile is-${it.kind}${isOpen ? " is-open" : ""}`}
      data-testid={`prow-${it.kind}`}
      data-url={it.p.url}
      // No title attribute: the hover card is the label, so neither the OS tooltip nor the global [title] one fires.
      aria-label={`${it.p.title}${fresh ? " (new)" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PAGE_DRAG, JSON.stringify({ url: it.p.url, title: it.p.title }));
        e.dataTransfer.effectAllowed = "copy";
        onHover(false);
      }}
      onMouseEnter={() => onHover(true)}
      onFocus={() => onHover(true)}
      onClick={onOpen}
    >
      <Mark p={it.p} kind={it.kind} />
      {fresh && <i className="ab-prow__new" data-testid="prow-new" aria-hidden />}
    </button>
  );
}

function Zone({ label, hint, testid, onPage, children }: { label: string; hint: string; testid: string; onPage: (p: { url: string; title: string }) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const isPage = (e: DragEvent) => e.dataTransfer.types.includes(PAGE_DRAG);
  return (
    <div
      className={`ab-prow__zone${over ? " is-over" : ""}`}
      data-testid={testid}
      aria-label={label}
      onDragOver={(e) => {
        if (!isPage(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!isPage(e)) return;
        // Taken: the chat's own drop (beside the chat), which this row sits inside, checks defaultPrevented.
        e.preventDefault();
        try {
          const p = JSON.parse(e.dataTransfer.getData(PAGE_DRAG)) as { url?: string; title?: string };
          if (p.url && /^https?:/i.test(p.url)) onPage({ url: p.url, title: p.title || p.url });
        } catch {
          /* not one of ours */
        }
      }}
    >
      {children}
      <span className="ab-prow__hint">{hint}</span>
    </div>
  );
}

/** The one hover card: title, who put it there and when, the host, how a click opens it; pin and remove in its corner. */
function Card({ it, agent, onPin, onX, onEnter }: { it: Item; agent: string; onPin: (() => void) | null; onX: () => void; onEnter: () => void }) {
  const { p, kind } = it;
  const who = kind === "pin" ? "pinned · every agent" : p.from === "saved" ? `kept for ${agent}${p.at ? ` · ${day(p.at)}` : ""}` : `${agent}${p.at ? ` · posted ${time(p.at)}` : ""}`;
  return (
    <div className="ab-prow__card" data-testid="prow-card" role="tooltip" onMouseEnter={onEnter}>
      <div className="ab-prow__cardacts">
        {onPin && (
          <button type="button" aria-label="Pin for every agent" data-testid="prow-card-pin" onClick={onPin}>
            <PinIcon size={12} />
          </button>
        )}
        <button type="button" aria-label={kind === "pin" ? "Unpin" : "Remove"} data-testid="prow-card-x" onClick={onX}>
          <XIcon size={12} />
        </button>
      </div>
      <b>{p.title}</b>
      <span>{who}</span>
      {hostOf(p.url) && <code>{hostOf(p.url)}</code>}
      <small>Click: open as a tab · drag: anywhere</small>
    </div>
  );
}

/** Hover: the first card after 250 ms, the next one at once, gone 120 ms after the pointer leaves the row and the card. */
function useHover() {
  const [at, setAt] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const shown = useRef(false);
  shown.current = at !== null;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    at,
    enter: (url: string) => {
      window.clearTimeout(timer.current);
      if (shown.current) setAt(url);
      else timer.current = window.setTimeout(() => setAt(url), 250);
    },
    stay: () => window.clearTimeout(timer.current),
    leave: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setAt(null), 120);
    },
    hide: () => (window.clearTimeout(timer.current), setAt(null)),
  };
}

export function PageRow(p: PageRowProps & { placement: "inline" | "row" | "tray" }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [list, setList] = useState(false);
  const hover = useHover();
  const fits = p.placement !== "inline";
  useLayoutEffect(() => {
    const el = root.current;
    if (!fits || !el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [fits]);
  useEffect(() => {
    if (!list) return;
    const out = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setList(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setList(false);
    window.addEventListener("mousedown", out);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", out);
      window.removeEventListener("keydown", esc, true);
    };
  }, [list]);

  const items: Item[] = [...p.pinned.map((x) => ({ p: x, kind: "pin" as const })), ...p.dropped.map((x) => ({ p: x, kind: "drop" as const }))];
  // As many as fit on one line; the rest behind +N (never a scrollbar). Inline: all of them (1-3).
  const divCost = p.pinned.length && p.dropped.length ? DIV : 0;
  const fit = (w: number) => Math.max(0, Math.floor((w - divCost + GAP) / (TILE + GAP)));
  const all = !fits || !width || fit(width) >= items.length;
  const shown = all ? items : items.slice(0, fit(width - MORE - GAP));
  const rest = items.slice(shown.length);
  const pins = shown.filter((x) => x.kind === "pin");
  const drops = shown.filter((x) => x.kind === "drop");
  const cur = hover.at ? items.find((x) => x.p.url === hover.at) ?? null : null;
  const open = (it: Item) => (hover.hide(), setList(false), p.onOpen(it.p));
  const tile = (it: Item) => <Tile key={`${it.kind}:${it.p.url}`} it={it} isOpen={p.open.has(it.p.url)} fresh={it.kind === "drop" && isNew(p, it.p)} onOpen={() => open(it)} onHover={(on) => (on ? (setList(false), hover.enter(it.p.url)) : hover.hide())} />;

  return (
    <div ref={root} className={`ab-prow is-${p.placement}${p.dragging ? " is-dragging" : ""}`} data-testid="page-row" data-placement={p.placement} aria-label="Pages" onMouseLeave={hover.leave}>
      {p.dragging ? (
        <>
          <Zone label="Pinned for every agent" hint="Pin for every agent" testid="prow-zone-pin" onPage={p.onPin}>
            {pins.length ? pins.map(tile) : <PinIcon size={13} className="ab-prow__ghost" aria-hidden />}
          </Zone>
          <Zone label={`Kept for ${p.agent}`} hint={`Keep for ${p.agent}`} testid="prow-zone-drop" onPage={p.onKeep}>
            {drops.map(tile)}
          </Zone>
        </>
      ) : (
        <>
          {pins.map(tile)}
          {pins.length > 0 && drops.length > 0 && <i className="ab-prow__div" aria-hidden />}
          {drops.map(tile)}
          {rest.length > 0 && (
            <button type="button" className="ab-prow__more" data-testid="prow-more" aria-label={`${rest.length} more pages`} aria-expanded={list} onMouseEnter={hover.hide} onClick={() => setList((v) => !v)}>
              +{rest.length}
            </button>
          )}
        </>
      )}
      {cur && !list && !p.dragging && (
        <Card
          it={cur}
          agent={p.agent}
          onEnter={hover.stay}
          onPin={cur.kind === "drop" && !p.pinned.some((x) => x.url === cur.p.url) ? () => (hover.hide(), p.onPin(cur.p)) : null}
          onX={() => (hover.hide(), cur.kind === "pin" ? p.onUnpin(cur.p) : p.onHide(cur.p))}
        />
      )}
      {list && rest.length > 0 && (
        <div className="ab-prow__list" data-testid="prow-list" data-esc-own="" role="menu" aria-label="More pages">
          {rest.map((it) => (
            <button key={`${it.kind}:${it.p.url}`} type="button" role="menuitem" className="ab-prow__item" data-url={it.p.url} onClick={() => open(it)}>
              <span className="ab-prow__itemmark">
                <Mark p={it.p} kind={it.kind} />
              </span>
              <span className="ab-prow__itemtitle">{it.p.title}</span>
              <small>{it.kind === "pin" ? "pinned" : it.p.from === "saved" ? "kept" : time(it.p.at)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * With the panel closed, the pages wait as one chip in the chat header: the newest one's mark, "N pages", and a dot when
 * something is new. A click opens the panel on its row; hovering shows the row as a small tray under the chip.
 */
export function PagesChip({ onPanel, ...p }: PageRowProps & { onPanel: () => void }) {
  const [tray, setTray] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const n = p.pinned.length + p.dropped.length;
  if (!n) return null;
  const newest = p.dropped.slice().sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  const first: Item = newest ? { p: newest, kind: "drop" } : { p: p.pinned[0], kind: "pin" };
  const fresh = p.dropped.some((x) => isNew(p, x));
  return (
    <div
      className="ab-pchip"
      onMouseEnter={() => (window.clearTimeout(t.current), (t.current = window.setTimeout(() => setTray(true), 250)))}
      onMouseLeave={() => (window.clearTimeout(t.current), (t.current = window.setTimeout(() => setTray(false), 150)))}
    >
      <button type="button" className="ab-pchip__btn" data-testid="pages-chip" aria-label={`${n} page${n === 1 ? "" : "s"}${fresh ? ", something new" : ""}: open the panel`} onClick={() => (setTray(false), onPanel())}>
        <span className="ab-pchip__mark">
          <Mark p={first.p} kind={first.kind} />
        </span>
        <span className="ab-pchip__n">
          {n} page{n === 1 ? "" : "s"}
        </span>
        {fresh && <i className="ab-pchip__dot" data-testid="pages-chip-new" aria-hidden />}
      </button>
      {tray && (
        <div className="ab-pchip__tray" data-testid="pages-tray">
          <PageRow {...p} placement="tray" />
        </div>
      )}
    </div>
  );
}
