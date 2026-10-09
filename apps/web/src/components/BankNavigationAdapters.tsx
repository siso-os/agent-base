// uihub: arc:command-palette
import { useEffect, useState } from 'react';
import { useLive } from '../lib/chatLive';
import { RECENTS_KEY, parseRecents, rememberCommand } from '../lib/command-palette';
import { urlKey } from '../lib/browser-tabs';
import { hostOf, toUrl } from './Browser';
import type { Page } from '../lib/agents';
import type { Agent } from '../lib/agents';
import type { NavWorkspace } from '../lib/workspace-nav';
import { faceFor } from '../lib/face';
import { WorkspaceCommandPalette, type WorkspaceCommandAction } from './WorkspaceCommandPalette';
import { WorkspaceArrival, type WorkspaceArrivalAgent } from './WorkspaceArrival';
import { InfrastructurePopover, type InfrastructureRecord } from './InfrastructurePopover';
import './BankChrome.css';

export type BankNavigationProps = {
  agents: Agent[]; workspaces: NavWorkspace[]; connected: boolean;
  onOpenAgent: (agent: Agent) => void; onOpenWorkspace: (id: string) => void;
};
/** All navigation remains caller-owned; previews reuse already-read chat text only. */
export function BankWorkspacePalette({ agents, workspaces, connected, onOpenAgent, onOpenWorkspace, open, onOpenChange, pages = [], hideTrigger = false, browserTabs = [], browserPages = [], onBrowserTab, onGo, onTerminal, visitedId, visitedWorkspaceId }: BankNavigationProps & {
  open: boolean; onOpenChange: (open: boolean) => void; hideTrigger?: boolean;
  pages?: (WorkspaceCommandAction & { onSelect: () => void })[];
  browserTabs?: { id: string; title: string; url: string }[]; browserPages?: Page[];
  onBrowserTab?: (id: string) => void; onGo?: (url: string, title?: string) => void; onTerminal?: () => void;
  visitedId?: string; visitedWorkspaceId?: string | null;
}) {
  const [query, setQuery] = useState(''), [active, setActive] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>(() => { try { return parseRecents(localStorage.getItem(RECENTS_KEY)); } catch { return []; } });
  const remember = (id: string) => setRecents(old => rememberCommand(old, id));
  useEffect(() => { if (visitedWorkspaceId) remember(`workspace:${visitedWorkspaceId}`); }, [visitedWorkspaceId]);
  useEffect(() => { if (visitedId) remember(visitedId); }, [visitedId]);
  useEffect(() => { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch { /* Navigation works without storage. */ } }, [recents]);
  useEffect(() => { if (!open) { setQuery(''); setActive(null); } }, [open]);
  const selectedChat = useLive(open && active?.startsWith('agent:') ? active.slice(6) : '');
  const live = connected ? agents.filter(a => a.row === 'live') : [];
  // Only while open, and one key per address (t-0586: closed, this ran on every App render, pairwise, a URL parse per
  // pair: 10% of a core with the app idle). The newest tab for an address, newest first; then each saved page once.
  const tabs: typeof browserTabs = [], suggested: Page[] = [];
  if (open) {
    const seen = new Set<string>();
    for (let i = browserTabs.length - 1; i >= 0; i--) { const t = browserTabs[i]; if (!t.url || seen.has(urlKey(t.url))) continue; seen.add(urlKey(t.url)); tabs.push(t); }
    for (const p of browserPages) { const k = p.url ? urlKey(p.url) : ""; if (k && seen.has(k)) continue; if (k) seen.add(k); suggested.push(p); }
  }
  const typed = query.trimStart().startsWith('>') ? null : toUrl(query);
  const actions: WorkspaceCommandAction[] = !open ? [] : [
    ...workspaces.filter(w => w.nav !== false).map(w => ({ id: `workspace:${w.id}`, label: w.name, description: 'Open workspace', scope: [w.parent, w.id].filter(Boolean).join(' / '), kind: 'projects' as const, icon: 'agent-base' as const })),
    ...live.map(a => ({ id: `agent:${a.id}`, label: a.name, description: [a.project, a.title, a.status].filter(Boolean).join(' · '), scope: [a.workspace, a.machine, a.id].filter(Boolean).join(' / '), kind: 'chats' as const, icon: 'agent-base' as const, keywords: [a.tool, a.cwd],
      preview: active === `agent:${a.id}` && selectedChat?.preview?.session === a.session ? selectedChat.preview.text : 'Open this chat to read its conversation. No already-read reply is available to preview.',
      sourceLabel: active === `agent:${a.id}` && selectedChat?.preview?.session === a.session ? 'Latest read reply' : 'No excerpt loaded' })),
    ...pages.map(p => ({ ...p, kind: p.kind ?? 'commands' as const, id: `page:${p.id}` })),
    ...tabs.map(t => ({ id: `browser-tab:${t.id}`, label: t.title || hostOf(t.url), description: 'Switch to open tab', scope: t.url, preview: t.url, sourceLabel: 'Open tab · address', kind: 'pages' as const, icon: 'web' as const, keywords: [t.url] })),
    ...suggested.map(p => ({ id: `browser-page:${p.url}`, label: p.title || hostOf(p.url), description: 'Open saved page', scope: hostOf(p.url), preview: p.url, sourceLabel: 'Saved page · address', kind: 'pages' as const, icon: 'web' as const, keywords: [p.url] })),
    ...(onTerminal ? [{ id: 'command:terminal', label: 'Terminal', description: 'Open a shell on this Mac', kind: 'commands' as const, icon: 'agent-base' as const }] : []),
    ...(typed && onGo ? [{ id: 'command:go', label: typed.startsWith('https://www.google.com/search?') ? `Search Google for “${query.trim()}”` : `Open ${hostOf(typed)}`, description: typed, kind: 'pages' as const, icon: 'web' as const, matchQuery: true }] : []),
  ];
  return <div className={hideTrigger ? 'ab-bank-palette--hidden' : 'ab-bank-palette'}><WorkspaceCommandPalette open={open} onOpenChange={onOpenChange} query={query} onQueryChange={value => { setQuery(value); setActive(null); }} actions={actions} activeActionId={active} onActiveActionChange={setActive} recentIds={recents} onRemember={remember}
    sourceUnavailable={!connected ? 'Chat source unavailable. Projects, pages and commands are still available.' : undefined}
    onSelect={action => {
      const workspace = workspaces.find(w => `workspace:${w.id}` === action.id);
      const agent = live.find(a => `agent:${a.id}` === action.id);
      const page = pages.find(p => `page:${p.id}` === action.id);
      const tab = tabs.find(t => `browser-tab:${t.id}` === action.id);
      const suggestion = suggested.find(p => `browser-page:${p.url}` === action.id);
      if (workspace) onOpenWorkspace(workspace.id); else if (agent) onOpenAgent(agent); else if (page) page.onSelect();
      else if (tab) onBrowserTab?.(tab.id); else if (suggestion) onGo?.(suggestion.url, suggestion.title);
      else if (action.id === 'command:terminal') onTerminal?.(); else if (action.id === 'command:go' && typed) onGo?.(typed);
    }} /></div>;
}

/** Only direct owner links survive. Missing parents, cycles and deeper links stay visible at root. */
export function arrivalAgents(agents: Agent[], connected: boolean): WorkspaceArrivalAgent[] {
  const byId = new Map(agents.map(a => [a.id, a]));
  const parents = new Map(agents.map(a => [a.id, a.navParentId ?? a.parentId ?? null]));
  return agents.map(a => {
    const parent = parents.get(a.id), owner = parent ? byId.get(parent) : undefined;
    const ownerId = owner && owner.id !== a.id && !parents.get(owner.id) ? owner.id : undefined;
    const face = faceFor(a);
    return { id: a.id, name: a.name, role: a.role || (ownerId ? 'Worker' : a.navOwner ? 'Workspace owner' : 'Agent'),
      project: a.project || a.workspace || 'Workspace unassigned', toolSummary: [a.tool, a.title].filter(Boolean).join(' · ') || 'No activity summary supplied',
      workspaceTitle: a.folder || a.name, status: connected ? face.status : 'offline', ownerId, face };
  });
}
/** Two-pane body only. Root places this inside its controlled chooser overlay, never the sidebar rail. */
export function BankWorkspaceArrival({ agents, connected, activeId, onOpenAgent }: Pick<BankNavigationProps, 'agents' | 'connected' | 'onOpenAgent'> & { activeId: string | null }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  return <div className="ab-bank-arrival"><WorkspaceArrival agents={arrivalAgents(agents, connected)} selectedAgentId={activeId} expandedOwnerIds={expanded} onToggleOwner={id => setExpanded(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id])} onSelectAgent={id => { const agent = agents.find(a => a.id === id); if (agent && connected) onOpenAgent(agent); }} paused={!connected} /></div>;
}

export type BankInfrastructureRow = { name: string; domain?: string; ledger?: string | null };
export function infrastructureRecords(rows: BankInfrastructureRow[], agents: Agent[], connected: boolean, observedAt?: number | null): InfrastructureRecord[] {
  return rows.map(row => {
    const name = row.name.toUpperCase();
    const matches = agents.filter(a => a.infrastructureRole?.toUpperCase() === name);
    const named = matches.length ? matches : agents.filter(a => a.name.toUpperCase() === name);
    const agent = named.length === 1 ? named[0] : undefined;
    return { id: agent?.id ?? `unavailable:${name}`, name: row.name, domain: row.domain ?? '', status: connected && agent ? agent.status : 'unknown',
      available: connected && !!agent, stale: !connected, summary: [agent?.infrastructureSummary?.line, row.ledger ?? agent?.infrastructureSummary?.ledger].filter(Boolean).join(' · '),
      observedAt: typeof observedAt === 'number' && Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : undefined,
      face: agent ? faceFor(agent) : undefined };
  });
}
export function BankInfrastructure({ rows, agents, connected, observedAt, onOpenAgent }: Pick<BankNavigationProps, 'agents' | 'connected' | 'onOpenAgent'> & { rows: BankInfrastructureRow[]; observedAt?: number | null }) {
  const [disclosure, setDisclosure] = useState({ open: false, pinned: false });
  const records = infrastructureRecords(rows, agents, connected, observedAt);
  return <InfrastructurePopover {...disclosure} records={records} onDisclosureChange={setDisclosure} onOpenAgent={id => {
    const record = records.find(r => r.id === id), agent = agents.find(a => a.id === id);
    if (connected && record?.available && !record.stale && agent) onOpenAgent(agent);
  }} />;
}
