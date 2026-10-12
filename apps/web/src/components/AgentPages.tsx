import type { ReactNode } from "react";
import { ChevronDownIcon, GlobeIcon, MessageSquareIcon, Trash2Icon } from "lucide-react";
import { MenuButton, type MenuItem } from "@siso/shell";
import "./AgentPages.css";

/**
 * The pages each agent sent him, up top on the right (Shaan, 12 Oct: "if I'm on the UI hub agent ... whenever he sends me a
 * URL, I click it and it opens the browser ... it goes up top but maybe to the right hand side ... shows that it's connected
 * under UI hub ... any browsers it's got inside if I click drop down"). One chip per agent: its name goes back to its chat in
 * one click, the caret lists its pages.
 */
export type AgentPagesGroup = { agent: string; face?: ReactNode; tabs: { id: string; title: string; url: string }[] };

export function AgentPages({ groups, currentTab, onChat, onPage, onCloseAll }: {
  groups: AgentPagesGroup[];
  /** The browser tab on screen, if it is one of these. */
  currentTab?: string;
  onChat: (agent: string) => void;
  onPage: (tabId: string) => void;
  onCloseAll: (agent: string) => void;
}) {
  if (!groups.length) return null;
  return (
    <div className="ab-agent-pages" data-testid="agent-pages">
      {groups.map((g) => {
        const here = g.tabs.some((t) => t.id === currentTab);
        return (
          <div key={g.agent} className="ab-agent-pages__chip" data-testid="agent-pages-chip" data-agent={g.agent} data-current={here ? "1" : undefined}>
            <button type="button" className="ab-agent-pages__name" aria-label={`Back to ${g.agent}'s chat`} title={`Back to ${g.agent}'s chat`} onClick={() => onChat(g.agent)}>
              {g.face}
              <span>{g.agent}</span>
            </button>
            <MenuButton
              label={`${g.agent}'s pages`}
              align="right"
              menuClassName="siso-rail-menu"
              className="ab-agent-pages__more"
              items={(): MenuItem[] => [
                { key: "chat", icon: <MessageSquareIcon />, label: `${g.agent}'s chat`, onSelect: () => onChat(g.agent) },
                ...g.tabs.map((t): MenuItem => ({ key: t.id, icon: <GlobeIcon />, label: t.title || t.url, current: t.id === currentTab, onSelect: () => onPage(t.id) })),
                { key: "close", icon: <Trash2Icon />, label: g.tabs.length === 1 ? "Close this page" : `Close all ${g.tabs.length} pages`, danger: true, onSelect: () => onCloseAll(g.agent) },
              ]}
            >
              <span className="ab-agent-pages__count">{g.tabs.length}</span>
              <ChevronDownIcon aria-hidden="true" />
            </MenuButton>
          </div>
        );
      })}
    </div>
  );
}

/** Web tabs an agent sent, grouped by agent, the agent with the newest page first; at most `max` agents. */
export function groupAgentPages<T extends { id: string; title: string; url: string; via?: string }>(tabs: T[], known: (name: string) => boolean, max = 3) {
  const order: string[] = [];
  const by = new Map<string, T[]>();
  for (const t of tabs) {
    if (!t.via || !known(t.via)) continue;
    by.set(t.via, [...(by.get(t.via) ?? []), t]);
    const i = order.indexOf(t.via);
    if (i >= 0) order.splice(i, 1);
    order.unshift(t.via);
  }
  return order.slice(0, max).map((agent) => ({ agent, tabs: by.get(agent)! }));
}
