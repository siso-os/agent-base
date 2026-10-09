import { useEffect, useRef } from 'react';
import type { Agent, Org } from '../lib/agents';
import { BankInfrastructure, BankWorkspaceArrival } from './BankNavigationAdapters';
import './BankWorkspaceChooser.css';

/** A deliberate workspace switch, with the existing navigation callback kept by App. */
export function BankWorkspaceChooser({ open, onOpenChange, agents, activeId, connected, org, observedAt, onOpenAgent }: {
  open: boolean; onOpenChange: (open: boolean) => void; agents: Agent[];
  activeId: string | null; connected: boolean; org: Org | null; observedAt: number | null;
  onOpenAgent: (agent: Agent) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    }
  }, [open]);
  useEffect(() => () => {
    dialog.current?.close();
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, []);
  return <dialog ref={dialog} className="ab-workspace-chooser" data-esc-own={open ? '' : undefined}
    aria-labelledby="ab-workspace-chooser-title"
    onCancel={event => { event.preventDefault(); onOpenChange(false); }}
    onClose={() => { if (open) onOpenChange(false); }}>
    <header><h2 id="ab-workspace-chooser-title">Agent workspaces</h2><button type="button" onClick={() => onOpenChange(false)} aria-label="Close agent workspaces">Close</button></header>
    {!connected && <p role="status">Agent observations are unavailable. The last known workspaces are shown.</p>}
    {!agents.length && <p role="status">No agent workspaces are available.</p>}
    <BankWorkspaceArrival agents={agents} connected={connected} activeId={activeId} onOpenAgent={agent => { onOpenAgent(agent); onOpenChange(false); }} />
    {!!org?.bottom.length && <div className="ab-workspace-infrastructure"><BankInfrastructure rows={org.bottom.map(row => ({ ...row, domain: row.domain ?? undefined }))} agents={agents} connected={connected} observedAt={observedAt} onOpenAgent={agent => { onOpenAgent(agent); onOpenChange(false); }} /></div>}
  </dialog>;
}
