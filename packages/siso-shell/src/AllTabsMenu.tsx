import { GlobeIcon, TerminalSquareIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { matchTabs } from "./tab-search";
import { useOutsideClose } from "./useOutsideClose";

type RealTab = Exclude<import("./TopTabs").TopTab, { kind: "gap" }>;

const ROW_HEIGHT = 40; // px: height of each row for virtualization
const VIRTUAL_THRESHOLD = 100; // rows

/**
 * All tabs menu: search input, filtered tabs, keyboard navigation.
 * Props: tabs (RealTab[]), activeId, onSelect, onClose?.
 * Keys: ArrowUp/Down move, Enter selects, Meta+Backspace closes tab, Escape closes menu.
 */
export function AllTabsMenu({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: RealTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const filtered = matchTabs(tabs, query);
  const useVirtual = filtered.length > VIRTUAL_THRESHOLD;
  const rowCount = filtered.length;
  const visibleRows = Math.ceil(60 * 16 / ROW_HEIGHT); // 60vh max-height / row height
  const startIdx = useVirtual ? Math.floor(scrollTop / ROW_HEIGHT) : 0;
  const endIdx = useVirtual ? Math.min(startIdx + visibleRows + 1, rowCount) : rowCount;
  const visibleTabs = filtered.slice(startIdx, endIdx);
  const offsetY = useVirtual ? startIdx * ROW_HEIGHT : 0;

  // Focus input on open
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset highlight on query change
  useEffect(() => {
    setHighlighted(0);
    setScrollTop(0);
  }, [query]);

  // Keep highlighted row visible
  useLayoutEffect(() => {
    if (useVirtual) {
      const top = highlighted * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      const viewportTop = scrollTop;
      const viewportBottom = scrollTop + visibleRows * ROW_HEIGHT;

      if (top < viewportTop) {
        setScrollTop(top);
      } else if (bottom > viewportBottom) {
        setScrollTop(bottom - visibleRows * ROW_HEIGHT);
      }
    }
  }, [highlighted, useVirtual, visibleRows, scrollTop]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((prev) => (prev + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((prev) => (prev === 0 ? rowCount - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted < filtered.length) {
        onSelect(filtered[highlighted].id);
        onClose?.();
      }
    } else if (e.metaKey && e.key === "Backspace") {
      e.preventDefault();
      if (highlighted < filtered.length) {
        filtered[highlighted].close?.();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  };

  useOutsideClose(ref, true, () => onClose?.());

  return (
    <div ref={ref} className="siso-alltabs-menu">
      <input
        ref={inputRef}
        type="text"
        className="siso-alltabs-menu__search"
        placeholder="⌕ type to find a tab"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {filtered.length === 0 ? (
        <div className="siso-alltabs-menu__empty">No tab matches "{query}"</div>
      ) : (
        <div
          ref={listRef}
          className="siso-alltabs-menu__list"
          style={{ height: `${Math.min(rowCount, visibleRows) * ROW_HEIGHT}px` }}
          onScroll={(e) => {
            const target = e.currentTarget as HTMLDivElement;
            setScrollTop(target.scrollTop);
          }}
        >
          <div style={{ height: useVirtual ? rowCount * ROW_HEIGHT : "auto" }}>
            <div style={{ transform: useVirtual ? `translateY(${offsetY}px)` : undefined }}>
              {visibleTabs.map((tab, idx) => {
                const tabIdx = startIdx + idx;
                const isHighlighted = tabIdx === highlighted;
                const isActive = tab.id === activeId;
                return (
                  <div
                    key={tab.id}
                    className={cn(
                      "siso-alltabs-menu__row",
                      isActive && "is-active",
                      isHighlighted && "is-highlighted",
                    )}
                    data-index={tabIdx}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelect(tab.id);
                        onClose?.();
                      }}
                      onMouseEnter={() => setHighlighted(tabIdx)}
                    >
                      {tab.icon ?? (tab.kind === "chat" ? <TerminalSquareIcon aria-hidden="true" /> : <GlobeIcon aria-hidden="true" />)}
                      <span>{tab.label}</span>
                    </button>
                    {tab.close && (
                      <button
                        type="button"
                        className="siso-tab-close"
                        aria-label={`Close ${tab.label}`}
                        title="Close"
                        onClick={(e) => {
                          e.stopPropagation();
                          tab.close?.();
                        }}
                      >
                        <XIcon aria-hidden="true" size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
