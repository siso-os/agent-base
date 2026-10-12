import type { ReactNode } from "react";
import { ChevronDownIcon, GlobeIcon, MessageSquareIcon, Trash2Icon } from "lucide-react";
import { MenuButton, type MenuItem } from "@siso/shell";
import { isUnseenDone, navState, slotText, type Agent } from "../lib/agents";
import "./LiveAgents.css";

/**
 * The agents up top, on the right, each once (Shaan, 12 Oct: "right now there's like two agents of the same ones showing up
 * at the same time ... they don't go away when they're working ... it's more important when they're coming back"). A chip
 * is an agent that needs him, one that came back and he has not looked, or one whose pages he opened (its caret lists them:
 * "any browsers it's got inside if I click drop down"). The agents only working fold into one "N working ˅". The agent on
 * screen has no chip unless it has pages, so looking at an agent clears it.
 */
export type LiveState = "needs" | "unseen" | "working";
export type LiveAgent = { id: string; name: string; state: LiveState; label: string };
export type AgentTabs = { id: string; name: string; tabs: { id: string; title: string; url: string }[] };

const RANK: Record<LiveState, number> = { needs: 0, unseen: 1, working: 2 };
const WORDS: Record<LiveState, string> = { needs: "needs you", unseen: "replied, not seen", working: "working" };

export function liveAgents(agents: Agent[], needs?: Set<string>, now = Date.now()): LiveAgent[] {
  const out: (LiveAgent & { at: number })[] = [];
  for (const a of agents) {
    if (a.zero || a.row !== "live" || a.codexWorker) continue;
    const nav = navState(a, needs, now);
    const state: LiveState | null = nav === "needs" ? "needs" : isUnseenDone(a) ? "unseen" : nav === "working" ? "working" : null;
    if (!state) continue;
    const when = state === "working" ? slotText(nav, a, now) : "";
    out.push({ id: a.id, name: a.name, state, label: `${a.name}: ${WORDS[state]}${when ? ` · ${when}` : ""}`, at: a.since });
  }
  return out.sort((x, y) => RANK[x.state] - RANK[y.state] || y.at - x.at).map(({ at: _at, ...a }) => a);
}

type Chip = { id: string; name: string; state: LiveState | null; label: string; tabs: AgentTabs["tabs"] };

/** Which agents get a chip, in order, and which fold into the dropdown. */
export function stripLayout(live: LiveAgent[], pages: AgentTabs[], currentId?: string | null, max = 4) {
  const by = new Map<string, Chip>();
  for (const a of live) by.set(a.id, { ...a, tabs: [] });
  for (const g of pages) {
    const c = by.get(g.id);
    by.set(g.id, c ? { ...c, tabs: g.tabs } : { id: g.id, name: g.name, state: null, label: `Back to ${g.name}'s chat`, tabs: g.tabs });
  }
  const all = [...by.values()];
  const rank = (c: Chip) => (c.state === "needs" ? 0 : c.state === "unseen" ? 1 : 2);
  const chips = all.filter((c) => (c.tabs.length > 0 || (c.state !== "working" && c.id !== currentId))).sort((x, y) => rank(x) - rank(y));
  const folded = all.filter((c) => c.state === "working" && !c.tabs.length && c.id !== currentId);
  return { chips: chips.slice(0, max), more: [...chips.slice(max), ...folded] };
}

export function LiveAgents({ agents, pages = [], currentId, currentTab, face, onOpen, onPage, onCloseAll, max = 4 }: {
  agents: LiveAgent[];
  /** The pages each agent sent him, newest agent first. */
  pages?: AgentTabs[];
  /** The agent on screen. */
  currentId?: string | null;
  /** The browser tab on screen. */
  currentTab?: string;
  face: (id: string) => ReactNode;
  onOpen: (id: string) => void;
  onPage?: (tabId: string) => void;
  onCloseAll?: (id: string) => void;
  max?: number;
}) {
  const { chips, more } = stripLayout(agents, pages, currentId, max);
  if (!chips.length && !more.length) return null;
  const working = more.every((c) => c.state === "working");
  return (
    <div className="ab-live-agents" data-testid="live-agents">
      {chips.map((c) => {
        const here = c.id === currentId || c.tabs.some((t) => t.id === currentTab);
        return (
          <div key={c.id} className={`ab-live-agent${c.tabs.length ? " has-pages" : ""}`} data-testid="live-agent" data-state={c.state ?? "pages"} data-agent={c.name}
            data-pages={c.tabs.length || undefined} data-current={here ? "1" : undefined}>
            <button type="button" className="ab-live-agent__name" aria-current={c.id === currentId ? "page" : undefined} aria-label={c.label} title={c.label} onClick={() => onOpen(c.id)}>
              {face(c.id)}
              <span>{c.name}</span>
              {c.state && <i className="ab-live-agent__dot" aria-hidden="true" />}
            </button>
            {c.tabs.length > 0 && (
              <MenuButton label={`${c.name}'s pages`} align="right" menuClassName="siso-rail-menu" className="ab-live-agent__pages"
                items={(): MenuItem[] => [
                  { key: "chat", icon: <MessageSquareIcon />, label: `${c.name}'s chat`, onSelect: () => onOpen(c.id) },
                  ...c.tabs.map((t): MenuItem => ({ key: t.id, icon: <GlobeIcon />, label: t.title || t.url, current: t.id === currentTab, onSelect: () => onPage?.(t.id) })),
                  { key: "close", icon: <Trash2Icon />, label: c.tabs.length === 1 ? "Close this page" : `Close all ${c.tabs.length} pages`, danger: true, onSelect: () => onCloseAll?.(c.id) },
                ]}>
                <span className="ab-live-agent__count">{c.tabs.length}</span>
                <ChevronDownIcon aria-hidden="true" />
              </MenuButton>
            )}
          </div>
        );
      })}
      {more.length > 0 && (
        <MenuButton label={working ? `${more.length} working` : `${more.length} more agents`} align="right" menuClassName="siso-rail-menu" className={`ab-live-agent ab-live-agent--more${working ? " is-working" : ""}`}
          items={(): MenuItem[] => more.map((c) => ({ key: c.id, icon: face(c.id), label: c.label, onSelect: () => onOpen(c.id) }))}>
          {working && <i className="ab-live-agent__dot" aria-hidden="true" />}
          <span>{working ? `${more.length} working` : `+${more.length}`}</span>
          <ChevronDownIcon aria-hidden="true" />
        </MenuButton>
      )}
    </div>
  );
}
