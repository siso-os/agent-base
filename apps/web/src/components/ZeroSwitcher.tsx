import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Agent, RegistryEdit } from "../lib/agents";
import { every } from "../lib/poll";
import { WORD, markOf } from "./Sidebar";
import "./ZeroSwitcher.css";

type Sub = { id: string; kind: string; what: string; name?: string; type: string; running: boolean; agentId?: string };

/**
 * t-0264 (Shaan 2 Oct 15:49: "you could have an agent zero cli and an agent zero thing and i could rename them"): the
 * drop-down under the Agent Zero entry. One line per Agent Zero session (the seat's is the default), each renamed in place
 * and each with its own drop-down of what it runs: its sub-agents and the herdr workers that report to it.
 */
export function ZeroSwitcher({ zeros, agents, activeId, onOpen, onEdit, children, navigationOnly = false }: { navigationOnly?: boolean; children?: ReactNode; zeros: Agent[]; agents: Agent[]; activeId: string | null; onOpen: (a: Agent) => void; onEdit: (e: RegistryEdit) => void }) {
  return (
    <div className="ab-zsw" role="list" aria-label="Agent Zeros" data-testid="zero-switcher">
      {children}
      {zeros.map((z) => (
        <ZeroLine navigationOnly={navigationOnly} key={z.id} z={z} crew={agents.filter((a) => a.row === "live" && (a.owner ?? a.lead) === z.name && !a.a0 && !a.zero)} active={z.id === activeId} onOpen={onOpen} onEdit={onEdit} />
      ))}
    </div>
  );
}

function ZeroLine({ z, crew, active, onOpen, onEdit, navigationOnly }: { navigationOnly?: boolean; z: Agent; crew: Agent[]; active: boolean; onOpen: (a: Agent) => void; onEdit: (e: RegistryEdit) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);
  const [subs, setSubs] = useState<Sub[] | null>(null);
  // What it runs, read while the switcher shows (the same source as the HUD and the right panel).
  useEffect(() => {
    if (navigationOnly) return;
    let alive = true;
    const load = () =>
      fetch(`/api/agents/${encodeURIComponent(z.id)}/subagents`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => alive && setSubs((d.rows ?? []).filter((r: Sub) => !r.agentId)))
        .catch(() => alive && setSubs((s) => s ?? []));
    const stop = every(() => void load(), 5000);
    return () => {
      alive = false;
      stop();
    };
  }, [z.id, navigationOnly]);
  const started = z.chatStartedAt;
  const name = z.label ?? z.name;
  // A second Agent Zero on Codex reads "Agent Zero · Sol" (ab-nav-iterate); the Claude seat keeps its dated label.
  const label = z.tool === "codex" && /^(Agent Zero|A0|ZERO)/i.test(name) ? "Agent Zero · Sol" : !/^(Agent Zero|A0(?:$|[ _-]))/i.test(name) ? name : started ? `A0 · ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(started)} ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(started)}` : "A0 · date unavailable";
  const running = (subs ?? []).filter((s) => s.running).length + crew.filter((c) => c.status === "working").length;
  const total = (subs?.length ?? 0) + crew.length;
  return (
    <div className={`ab-zsw__item${active ? " is-active" : ""}`} role="listitem" data-testid="zero-session" data-id={z.id} data-default={z.zero ? "true" : undefined}>
      <div className="ab-zsw__line">
        {!navigationOnly && <button type="button" className="ab-zsw__fold" aria-expanded={open} aria-label={`What ${label} runs`} data-testid="zero-session-fold" onClick={() => setOpen(!open)} disabled={!total}>
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>}
        <span className={`siso-dot is-${markOf(z)}`} aria-hidden="true" />
        {renaming ? (
          <input
            className="ab-zsw__rename"
            autoFocus
            defaultValue={z.label ?? z.name}
            aria-label="Agent Zero's name"
            data-testid="zero-rename-input"
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.stopPropagation(), setRenaming(false));
              if (e.key === "Enter") {
                const to = e.currentTarget.value.trim();
                if (to && to !== (z.label ?? z.name)) onEdit({ op: "rename", name: z.name, to });
                setRenaming(false);
              }
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <button type="button" className="ab-zsw__open" title={`Open ${label}`} data-testid="zero-session-open" onClick={() => onOpen(z)}>
            <b>{label}</b>
            {z.zero && <em>default</em>}
            <small>
              {WORD[markOf(z)]}
              {!navigationOnly && total > 0 && ` · ${running ? `${running} running · ` : ""}${total} ${total === 1 ? "agent" : "agents"}`}
            </small>
          </button>
        )}
        {!renaming && (
          <button type="button" className="ab-zsw__pen" aria-label={`Rename ${label}`} title="Rename" data-testid="zero-rename" onClick={() => setRenaming(true)}>
            <PencilIcon size={11} />
          </button>
        )}
      </div>
      {!navigationOnly && open && (
        <div className="ab-zsw__runs" data-testid="zero-session-runs">
          {crew.map((c) => (
            <button key={c.id} type="button" className="ab-zsw__run" onClick={() => onOpen(c)}>
              <span className={`siso-dot is-${markOf(c)}`} aria-hidden="true" />
              <span>{c.name}</span>
              <small>herdr · {WORD[markOf(c)]}</small>
            </button>
          ))}
          {(subs ?? []).map((s) => (
            // A sub-agent lives in its Agent Zero's chat: opening it opens that chat.
            <button key={s.id} type="button" className="ab-zsw__run" onClick={() => onOpen(z)}>
              <span className={`siso-dot is-${s.running ? "working" : "quiet"}`} aria-hidden="true" />
              <span>{s.what || s.name || s.type}</span>
              <small>{s.running ? "running" : "done"}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
