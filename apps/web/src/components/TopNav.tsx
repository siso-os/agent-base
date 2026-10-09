import { ChartColumnIncreasingIcon, CircleDollarSignIcon, ClipboardCheckIcon, ServerIcon, WorkflowIcon } from "lucide-react";
import { HoverCard } from "@siso/shell";
import "./TopNav.css";

export type TopPage = "org" | "tasks" | "stats" | "servers" | "tokens";
/** The pages that also open in the right panel (servers-tokens §4). */
export type PanelPage = "servers" | "tokens";
/** What a Servers or Tokens icon carries when dragged: the page's id; dropped on the right edge, it opens there. */
export const PANEL_DRAG = "application/x-siso-panel-page";
const isPanel = (id: TopPage): id is PanelPage => id === "servers" || id === "tokens";
const PAGES: { id: TopPage; label: string; line: string; Icon: typeof ServerIcon }[] = [
  { id: "org", label: "Org chart", line: "Who runs what: the projects, their owners and crews", Icon: WorkflowIcon },
  { id: "tasks", label: "Tasks", line: "Every task across the agents, by stage", Icon: ClipboardCheckIcon },
  { id: "stats", label: "Stats", line: "How the fleet is doing: turns, time and output", Icon: ChartColumnIncreasingIcon },
  { id: "servers", label: "Servers", line: "The dev servers and ports the agents run", Icon: ServerIcon },
  { id: "tokens", label: "Tokens", line: "What the agents spend, by agent and model", Icon: CircleDollarSignIcon },
];

/**
 * Shaan 3 Oct 00:05: "those five icons ... no texts above the agent zero in the side nav". `icons` draws them there, icon
 * only (the hover card and aria-label carry the name); the top row keeps the labelled form for when the side nav is closed.
 * Each one's hover card (hover-all) says what the page is, with a count where one exists (`counts`, e.g. open tasks).
 *
 * R1.2 B, the top row (Shaan ~21:00: "org chart stats tasks ... horizontally going across ... move server and tokens
 * into that"): five compact buttons after ‹ ›, icon and label, the open one filled. Each opens in the main area.
 */
/**
 * SPEC-STATS-TASKS §2: ⌥-click pops a page out beside the side nav (`onPop`); the popped one carries a 2 px underline in
 * its page's colour (`popped`, `hue`).
 */
export function TopNav({ active, onOpen, icons = false, counts = {}, popped = null, hue, onPop, onPanel }: { active: TopPage | null; onOpen: (p: TopPage) => void; icons?: boolean; counts?: Partial<Record<TopPage, string>>; popped?: TopPage | null; hue?: string; onPop?: (p: TopPage) => boolean; onPanel?: (p: PanelPage) => void }) {
  return (
    <nav className={`ab-topnav${icons ? " is-icons" : ""}`} aria-label="Pages" data-testid="top-nav">
      {PAGES.map(({ id, label, line, Icon }) => (
        <HoverCard key={id} title={label} line={line} meta={counts[id]}>
          <button type="button" aria-label={label} aria-pressed={active === id} data-popped={popped === id || undefined} style={popped === id && hue ? ({ "--ab-pop-hue": hue } as React.CSSProperties) : undefined} onClick={(e) => {
              if (e.altKey && onPanel && isPanel(id)) onPanel(id);
              else if (!(e.altKey && onPop?.(id))) onOpen(id);
            }}
            draggable={!!onPanel && isPanel(id)}
            onDragStart={(e) => {
              if (!onPanel || !isPanel(id)) return;
              e.dataTransfer.setData(PANEL_DRAG, id);
              e.dataTransfer.effectAllowed = "copy";
            }}>
            <Icon aria-hidden="true" />
            {!icons && label}
          </button>
        </HoverCard>
      ))}
    </nav>
  );
}
