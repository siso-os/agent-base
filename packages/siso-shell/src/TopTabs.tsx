/**
 * Tabs in the top bar, the cmux way (Shaan, 2 Oct, with his cmux screenshot: "pin shit up here and more importantly
 * view different browser urls"): the open chat first, then pages. A page tab drags (HTML drag and drop, type
 * PAGE_DRAG) so the app can drop it beside the chat as a split; hover shows the tab's own small actions.
 *
 * Closing is one click (2 Oct 13:52: "I've got to do two clicks to X them off when it should only really be one … when
 * the name gets too long, it's hard to actually remove it"): a tab that can close shows its × at its right edge, never
 * pushed off by a long label; middle-click closes too. As tabs pile up they shrink like Chrome's (down to ~90px, the
 * label ellipsed, the × kept), and the ones that still do not fit go into "⌄ N more" at the end, each with its ×.
 *
 * R1.22 (A0's tab bar spec, option C, §3.4): a tab marked `reorder` drags between the other reorderable tabs, with an
 * insertion line where it lands; a page dragged in from elsewhere (an icon in the page strip, a link in the chat) drops
 * on the row as a new tab at that spot. A dragged tab carries TAB_DRAG (its id) beside PAGE_DRAG, so a drop knows a
 * move from a new page.
 */
import { ChevronDownIcon, GlobeIcon, TerminalSquareIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { AllTabsMenu } from "./AllTabsMenu";
import { useOutsideClose } from "./useOutsideClose";

export const PAGE_DRAG = "application/x-siso-page";
/** A top-row tab being dragged: its id (set beside PAGE_DRAG when the tab has an address). */
export const TAB_DRAG = "application/x-siso-tab";
/** An agent's chat tab being dragged: the agent's id (to read its chat beside a page). */
export const CHAT_DRAG = "application/x-siso-chat";

export type TopTab =
  | { kind: "chat" | "page"; id: string; label: string; title?: string; actions?: ReactNode; drag?: string; icon?: ReactNode; close?: () => void; reorder?: boolean; dragType?: string }
  | { kind: "gap"; id: string };
type RealTab = Exclude<TopTab, { kind: "gap" }>;

const MIN_TAB = 120; // px: a shrunk tab still shows its icon, a word of its label and its × (HUB-DESIGN 22:18)
const GAP = 2;
const MORE = 76; // px kept for "⌄ N more"

type DropAt = { id: string | null; after: boolean };
export function TopTabs({
  tabs,
  activeId,
  onSelect,
  label = "Tabs",
  onReorder,
  onDropPage,
  fold = false,
}: {
  tabs: TopTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  label?: string;
  /** A reorderable tab dropped beside another: put `id` before `before` (null: at the end). */
  onReorder?: (id: string, before: string | null) => void;
  /** A page (not one of these tabs) dropped on the row: open it as a tab before `before` (null: at the end). */
  onDropPage?: (page: { url: string; title?: string }, before: string | null) => void;
  /** Another list shows the reorderable tabs now (the browser's own sidebar): they fold into "⌄ N more". */
  fold?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drop, setDrop] = useState<DropAt | null>(null);
  const [showAllTabs, setShowAllTabs] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    // QA #10: measure again once the bar has laid out (a width read mid-mount folded tabs that fit).
    const raf = requestAnimationFrame(() => setWidth(el.clientWidth));
    return () => (ro.disconnect(), cancelAnimationFrame(raf));
  }, []);

  // Meta+Shift+A to open all tabs menu
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        setShowAllTabs(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // How many tabs fit at their smallest; the rest go to "N more", keeping the active one in sight.
  const all = tabs.filter((t): t is RealTab => t.kind !== "gap");
  // QA #10 (A0, 3 Oct): the selected tab never folds; it hid behind "1 more" with half the bar empty.
  const folds = (t: RealTab) => fold && !!t.reorder && t.id !== activeId;
  const folded = all.filter(folds);
  const real = all.filter((t) => !folds(t));
  const gaps = tabs.length - all.length;
  const fitAll = width === 0 || real.length * (MIN_TAB + GAP) + gaps * 13 + (folded.length ? MORE : 0) <= width;
  let shown = new Set(real.map((t) => t.id));
  let hidden: RealTab[] = [...folded];
  if (!fitAll) {
    const room = Math.max(1, Math.floor((width - MORE - gaps * 13) / (MIN_TAB + GAP)));
    const keep = real.slice(0, room);
    const active = real.find((t) => t.id === activeId);
    if (active && !keep.includes(active)) keep.splice(keep.length - 1, 1, active);
    shown = new Set(keep.map((t) => t.id));
    hidden = [...real.filter((t) => !shown.has(t.id)), ...folded];
  }
  // A gap shows only between two shown tabs.
  const visible = tabs.filter((t) => t.kind !== "gap" && shown.has(t.id));
  const rendered = tabs.filter((t, i) => (t.kind === "gap" ? visible.length && tabs.slice(0, i).some((x) => x.kind !== "gap" && shown.has(x.id)) && tabs.slice(i + 1).some((x) => x.kind !== "gap" && shown.has(x.id)) : shown.has(t.id)));

  // Where a drop lands: before or after the reorderable tab under the pointer; past the last one, at the end.
  const order = real.filter((t) => t.reorder).map((t) => t.id);
  const accepts = (e: DragEvent) => (e.dataTransfer.types.includes(TAB_DRAG) ? !!onReorder : !!onDropPage && e.dataTransfer.types.includes(PAGE_DRAG));
  const before = (at: DropAt) => (at.id === null ? null : at.after ? order[order.indexOf(at.id) + 1] ?? null : at.id);
  const over = (e: DragEvent, t: RealTab | null) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(TAB_DRAG) ? "move" : "copy";
    const r = t?.reorder ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null;
    const at: DropAt = t?.reorder && r ? { id: t.id, after: e.clientX > r.left + r.width / 2 } : { id: null, after: false };
    setDrop((d) => (d?.id === at.id && d.after === at.after ? d : at));
  };
  const land = (e: DragEvent) => {
    const at = drop ?? { id: null, after: false };
    setDrop(null);
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData(TAB_DRAG);
    if (id) {
      if (id !== at.id && order.includes(id)) onReorder?.(id, before(at));
      return;
    }
    try {
      const p = JSON.parse(e.dataTransfer.getData(PAGE_DRAG)) as { url?: string; title?: string };
      if (p.url) onDropPage?.({ url: p.url, title: p.title }, before(at));
    } catch {
      /* not one of ours */
    }
  };

  return (
    <div
      ref={box}
      className={cn("siso-toptabs", drop && "is-dropping")}
      role="tablist"
      aria-label={label}
      onDragOver={(e) => over(e, null)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(null)}
      onDrop={land}
    >
      {rendered.map((t) =>
        t.kind === "gap" ? (
          <span key={t.id} className="siso-toptabs__gap" aria-hidden="true" />
        ) : (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            title={t.title ?? t.label}
            className={cn(
              "siso-toptab",
              t.id === activeId && "is-active",
              t.kind === "chat" && "is-chat",
              t.close && "can-close",
              drop?.id === t.id && (drop.after ? "is-drop-after" : "is-drop-before"),
            )}
            data-tab={t.id}
            draggable={!!t.drag || !!t.reorder}
            onDragStart={(e: DragEvent) => {
              if (!t.drag && !t.reorder) return;
              if (t.drag) e.dataTransfer.setData(t.dragType ?? PAGE_DRAG, t.drag);
              if (t.reorder) e.dataTransfer.setData(TAB_DRAG, t.id);
              e.dataTransfer.effectAllowed = "copyMove";
            }}
            onDragEnd={() => setDrop(null)}
            onDragOver={(e) => over(e, t)}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && t.close) {
                e.preventDefault();
                t.close();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(t.id);
              }
            }}
          >
            {t.icon ?? (t.kind === "chat" ? <TerminalSquareIcon aria-hidden="true" /> : <GlobeIcon aria-hidden="true" />)}
            <span className="siso-toptab__label">{t.label}</span>
            {t.actions && <span className="siso-toptab__actions">{t.actions}</span>}
            {t.close && <CloseButton label={t.label} onClose={t.close} />}
          </div>
        ),
      )}
      {hidden.length > 0 && (
        <MoreTabs
          tabs={all}
          hidden={hidden}
          activeId={activeId}
          onSelect={onSelect}
          showAllTabs={showAllTabs}
          onShowAllTabs={setShowAllTabs}
        />
      )}
      {drop?.id === null && <span className="siso-toptabs__end" aria-hidden="true" />}
    </div>
  );
}

function CloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button
      type="button"
      className="siso-tab-close"
      aria-label={`Close ${label}`}
      title="Close"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <XIcon aria-hidden="true" size={12} />
    </button>
  );
}

/** "⌄ N more": the tabs that do not fit. Renders AllTabsMenu with all tabs. */
function MoreTabs({
  tabs,
  hidden,
  activeId,
  onSelect,
  showAllTabs,
  onShowAllTabs,
}: {
  tabs: RealTab[];
  hidden: RealTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  showAllTabs: boolean;
  onShowAllTabs: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, showAllTabs, () => onShowAllTabs(false));

  return (
    <div ref={ref} className="siso-toptabs__more">
      <button
        type="button"
        className={cn("siso-toptab", hidden.some((t) => t.id === activeId) && "is-active")}
        aria-expanded={showAllTabs}
        aria-label={`${hidden.length} more tabs`}
        onClick={() => onShowAllTabs(!showAllTabs)}
      >
        <ChevronDownIcon aria-hidden="true" />
        <span>{hidden.length} more</span>
      </button>
      {showAllTabs && (
        <div className="siso-toptabs__list" role="menu">
          <AllTabsMenu
            tabs={tabs}
            activeId={activeId}
            onSelect={(id) => {
              onSelect(id);
              onShowAllTabs(false);
            }}
            onClose={() => onShowAllTabs(false)}
          />
        </div>
      )}
    </div>
  );
}
