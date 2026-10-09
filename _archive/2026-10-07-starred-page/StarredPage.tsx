import type { ConversationPinTarget } from "../../../../services/node/src/conversation-route";
import { BookmarkIcon, ExternalLinkIcon, PinIcon, PinOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Agent, Page, PinView } from "../lib/agents";
import type { HubAgent } from "../lib/hub-types";
import type { NavWorkspace } from "../lib/workspace-nav";
import { StarredPin, type PinEdit } from "./StarredPin";

export function StarredPage({ agents, pins, workspaces, pages, onOpenAgent, onOpenPage, onEdit, onUnpinPage }: {
  agents: Agent[];
  pins: PinView[];
  workspaces: NavWorkspace[];
  pages: Page[];
  onOpenAgent: (agent: Agent, conversationTarget?: ConversationPinTarget) => void;
  onOpenPage: (page: Page) => void;
  onEdit: PinEdit;
  onUnpinPage: (page: Page) => void;
}) {
  const [details, setDetails] = useState<Map<string, HubAgent>>(new Map());
  useEffect(() => {
    let live = true;
    fetch("/api/hub/agents", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((rows: HubAgent[]) => { if (live && Array.isArray(rows)) setDetails(new Map(rows.map((row) => [row.name.toUpperCase(), row]))); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return <main className="h-full overflow-y-auto p-5 text-[12px]">
    <header className="mb-5"><div className="text-[10px] uppercase tracking-[.12em] text-muted-foreground">Your shortcuts</div><h1 className="mt-1 text-xl font-semibold text-foreground">Starred</h1><p className="mt-1 text-muted-foreground">Agents and pages you pinned for quick access. Owner slots stay here while offline.</p></header>
    <section aria-labelledby="starred-agents" className="mb-7">
      <h2 id="starred-agents" className="mb-2 flex items-center gap-2 font-medium text-foreground"><PinIcon size={14} />Agents</h2>
      {pins.length ? <div className="grid gap-2 sm:grid-cols-2">{pins.map(pin => <StarredPin key={pin.id} pin={pin} agents={agents} workspaces={workspaces} details={details} onOpenAgent={onOpenAgent} onEdit={onEdit} />)}</div> : <p className="text-muted-foreground">Star an agent from its card</p>}
    </section>
    <section aria-labelledby="starred-pages">
      <h2 id="starred-pages" className="mb-2 flex items-center gap-2 font-medium text-foreground"><BookmarkIcon size={14} />Pages</h2>
      {pages.length ? <div className="flex flex-col">{pages.map((page) => <div key={page.url} className="flex items-center gap-2 border-b border-white/[0.07] py-2">
        <button type="button" onClick={() => onOpenPage(page)} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left hover:text-foreground">
          <ExternalLinkIcon size={14} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-foreground">{page.title || page.url}</span><span className="max-w-[45%] truncate text-muted-foreground">{page.url}</span>
        </button>
        <button type="button" onClick={() => onUnpinPage(page)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.07] hover:text-foreground" aria-label={`Unstar page ${page.title || page.url}`} title="Unstar page"><PinOffIcon size={14} /></button>
      </div>)}</div> : <p className="text-muted-foreground">No starred pages yet.</p>}
    </section>
  </main>;
}
