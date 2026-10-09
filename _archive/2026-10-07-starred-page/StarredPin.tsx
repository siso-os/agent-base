import type { ConversationPinTarget } from "../../../../services/node/src/conversation-route";
import { PinIcon, PinOffIcon } from "lucide-react";
import { useRef, useState } from "react";
import { conversationTarget } from "../../../../services/node/src/agent-pins";
import type { Agent, PinTarget, PinView, RegistryEdit } from "../lib/agents";
import { AgentFace, faceFor } from "../lib/face";
import type { HubAgent } from "../lib/hub-types";
import type { NavWorkspace } from "../lib/workspace-nav";
import { pinStateLabel, pinTargetDescription, readyPinAgent } from "../lib/pin-view";
import { bindPinEdit, samePinTarget } from "../lib/pin-actions";

const STATE: Record<Agent["status"], string> = { working: "Working", needs: "Needs you", done: "Turn done", idle: "Idle", failed: "Failed" };
export type PinEdit = (edit: RegistryEdit) => Promise<string | null | void> | string | null | void;
type Choice = { key: string; target: PinTarget; agentId?: string; label: string; disabled?: boolean };

/** Each choice carries its target, not just a terminal ID that a later session could reuse. */
function bindingChoices(agents: Agent[], workspaces: NavWorkspace[]): Choice[] {
  const owners: Choice[] = workspaces.filter(workspace => workspace.owner?.trim()).map(workspace => {
    const target: PinTarget = { kind: "owner", workspaceId: workspace.id };
    const agent = agents.find(row => row.pinTarget?.kind === "owner" && row.pinTarget.workspaceId === workspace.id);
    const ready = agent && readyPinAgent({ id: "choice", name: workspace.owner!, target, state: "ready", agentId: agent.id }, agents, workspaces);
    return { key: JSON.stringify({ target }), target, label: `${workspace.name} · ${workspace.owner} · ${workspace.id} · owner slot${ready ? "" : " (offline or unavailable)"}`, disabled: workspaces.filter(row => row.id === workspace.id).length !== 1 };
  });
  const conversations: Choice[] = agents.flatMap(agent => {
    // The hook clears this authority while restoring cache or after a failed identity read.
    if (!agent.pinTarget) return [];
    const target = conversationTarget(agent);
    if (!target || target.kind !== "conversation") return [];
    if (!readyPinAgent({ id: "choice", name: agent.name, target, state: "ready", agentId: agent.id }, agents, workspaces)) return [];
    return [{ key: JSON.stringify({ target, agentId: agent.id }), target, agentId: agent.id, label: `${agent.name} · ${target.machine} · ${target.harness} · session ${target.session}` }];
  });
  return [...owners, ...conversations];
}

export function StarredPin({ pin, agents, workspaces, details, onOpenAgent, onEdit }: {
  pin: PinView; agents: Agent[]; workspaces: NavWorkspace[]; details: Map<string, HubAgent>; onOpenAgent: (agent: Agent, conversationTarget?: ConversationPinTarget) => void; onEdit: PinEdit;
}) {
  const agent = readyPinAgent(pin, agents, workspaces);
  const editable = pin.refEditable !== false;
  const [choosing, setChoosing] = useState(false);
  const [selection, setSelection] = useState("");
  const [expectedTarget, setExpectedTarget] = useState<PinTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const choices = bindingChoices(agents, workspaces);
  const pinChanged = choosing && !samePinTarget(pin.target, expectedTarget);
  const chosen = !editable || pinChanged ? undefined : choices.find(choice => choice.key === selection && !choice.disabled);
  const act = async (edit: RegistryEdit) => {
    if (!editable || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const why = await onEdit(edit);
      if (why) {
        setError(why);
        if (edit.op === "bind-pin") { setChoosing(false); setSelection(""); }
      }
      else { setChoosing(false); setSelection(""); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the pin. Try again.");
      if (edit.op === "bind-pin") { setChoosing(false); setSelection(""); }
    }
    finally { writing.current = false; setBusy(false); }
  };
  // Hub summaries are indexed by name; do not borrow one when duplicate display names exist.
  const current = agent && agents.filter(row => row.name.toUpperCase() === agent.name.toUpperCase()).length === 1 ? details.get(agent.name.toUpperCase()) : undefined;
  const doing = current?.holding?.title || current?.lastReport?.text || agent?.title || (agent ? "Nothing on its plate yet" : pin.state === "ready" ? "The target changed. Waiting for a fresh list." : pin.detail || pinStateLabel(pin, agent));
  return <article data-pin-id={pin.id} data-agent-id={agent?.id} className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 hover:border-white/[0.14]">
    <div className="flex min-w-0 items-center gap-2">
      <button type="button" disabled={!agent} onClick={() => agent && onOpenAgent(agent, pin.target?.kind === "conversation" ? pin.target : undefined)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default" aria-label={agent ? `Open ${pin.name}` : `${pin.name}, ${pinStateLabel(pin, agent)}`}>
        {agent ? <AgentFace {...faceFor(agent)} size={34} /> : <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-white/[0.05] text-muted-foreground"><PinIcon size={18} /></span>}
        <span className="min-w-0 flex-1"><b className="block break-words text-foreground">{pin.name}</b><span className="mt-0.5 block truncate text-muted-foreground" title={doing}>{doing}</span></span>
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[10px] text-muted-foreground">{agent ? STATE[agent.status] : pinStateLabel(pin, agent)}</span>
      </button>
      <button type="button" disabled={busy || !editable} onClick={() => void act({ op: "unpin-ref", pinId: pin.id })} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.07] hover:text-foreground disabled:opacity-50" aria-label={`Unstar ${pin.name}`} title="Remove this saved pin"><PinOffIcon size={14} /></button>
    </div>
    <p className="mt-2 break-all text-[10px] text-muted-foreground">{pinTargetDescription(pin, workspaces)}</p>
    <button type="button" disabled={busy || !editable} aria-expanded={choosing} className="mt-2 rounded-md border border-white/[0.1] px-2 py-1 text-[11px] text-foreground hover:bg-white/[0.05]" onClick={() => { if (!choosing) setExpectedTarget(pin.target ? { ...pin.target } : null); setChoosing(value => !value); setSelection(""); setError(null); }}>{choosing ? "Cancel" : pin.target ? "Change target" : "Choose target"}</button>
    {!editable && <p role="status" className="mt-2 text-[11px] text-muted-foreground">Saved reference unavailable. Waiting for a valid refresh.</p>}
    {choosing && <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); const edit = chosen && bindPinEdit(pin, expectedTarget, chosen.target, chosen.agentId); if (edit) void act(edit); }}>
      <label className="block text-[11px] text-muted-foreground">Target for {pin.name}
        <select aria-label={`Target for ${pin.name}`} value={chosen ? selection : ""} disabled={busy || !editable || pinChanged} onChange={event => setSelection(event.target.value)} className="mt-1 block w-full min-w-0 rounded-md border border-white/[0.12] bg-background px-2 py-2 text-foreground">
          <option value="">Choose an owner slot or exact conversation…</option>
          <optgroup label="Workspace owner slots (kept while offline)">{choices.filter(choice => choice.target.kind === "owner").map((choice, index) => <option key={`${choice.key}:${index}`} value={choice.key} disabled={choice.disabled}>{choice.label}</option>)}</optgroup>
          <optgroup label="Current exact conversations">{choices.filter(choice => choice.target.kind === "conversation").map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</optgroup>
        </select>
      </label>
      <p className="text-[10px] text-muted-foreground">Owner slots follow the configured owner across sessions. Conversations stay tied to the selected session.</p>
      {pinChanged ? <p role="status" className="text-[11px] text-amber-400">This pin changed elsewhere. Cancel and reopen the chooser to review it.</p> : selection && !chosen && <p role="status" className="text-[11px] text-amber-400">That choice changed or became unavailable. Choose again.</p>}
      <button type="submit" disabled={busy || !chosen} className="rounded-md bg-white/[0.09] px-3 py-1.5 text-[11px] text-foreground hover:bg-white/[0.14] disabled:opacity-40">{busy ? "Saving…" : "Save target"}</button>
    </form>}
    {error && <p role="alert" className="mt-2 break-words text-[11px] text-red-400">{error}</p>}
  </article>;
}
