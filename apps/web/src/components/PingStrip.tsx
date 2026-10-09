import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AudioLinesIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, SendIcon } from "lucide-react";
import { MicButton } from "./MicButton";
import type { Agent } from "../lib/agents";
import { AgentFace, faceFor, projectHue } from "../lib/face";
import { byPing, needsHim, type Ping, type Pings } from "../lib/pings";

/**
 * His pings from this agent (R1.21, header spec option A; Shaan 15:33: "it stays even if i keep messaging you ... click
 * read them react to them maybe voice note feedback"). The strip sits under the header while anything is unread, the
 * one that needs him first, and folds away at 0; it is outside the chat's scroll, so messages never push it off. ⌄, the
 * strip itself or ⌥⌘N open the stack in place over the chat (tabs, rows, read, react, reply); Esc or ⌃ closes it.
 */
const when = (at: string) => {
  const t = Date.parse(at.includes("T") ? at : at.replace(" ", "T"));
  if (!Number.isFinite(t)) return at;
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};
const safeUrl = (url?: string) => {
  try {
    const u = new URL(url ?? "");
    return ["http:", "https:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
};
type Tab = "unread" | "needs" | "all";
const REACTS = [["like", "👍", "Yes"], ["no", "✗", "No"], ["hmm", "🤔", "Not sure"]] as const;

function Row({ p, agent, pings, replying, onReply }: { p: Ping; agent: Agent; pings: Pings; replying: boolean; onReply: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const href = safeUrl(p.url);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const needs = needsHim(p);
  return (
    <article className={`ab-ping${p.read ? " is-read" : ""}`} data-testid="ping-row" data-id={String(p.id)}>
      <i className={`ab-ping__dot${p.read ? "" : needs ? " is-needs" : " is-new"}`} aria-hidden />
      <span className="ab-ping__face">
        <AgentFace {...faceFor(agent)} size={20} />
      </span>
      <div className="ab-ping__main">
        <div className="ab-ping__meta">
          <b>{agent.name}</b>
          {(p.project ?? agent.project) && <span>{p.project ?? agent.project}</span>}
          <time dateTime={p.at}>· {when(p.at)}</time>
        </div>
        <h3 className="ab-ping__title">{p.title}</h3>
        {p.body && (
          <p className={`ab-ping__body${open ? " is-open" : ""}`} onClick={() => setOpen((v) => !v)} title={open ? "Show less" : "Show all"}>
            {p.body}
          </p>
        )}
        {needs && <span className="ab-ping__needs">Needs: {p.needs}</span>}
        {replying && (
          <form
            className="ab-ping__reply"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void act(async () => (await pings.reply(p.id, draft.trim()), setDraft(""), onReply(false)));
            }}
          >
            {/* a0-016: say it; it goes as the reply (t-0100's mic, the node's transcribe path). */}
            <MicButton label={`Say a reply to ping ${p.id}`} onText={(said) => void act(async () => (await pings.reply(p.id, said), setDraft(""), onReply(false)))} />
            <input autoFocus aria-label={`Reply to ping ${p.id}`} placeholder="Say it (mic) or type a reply" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onReply(false))} />
            <button type="submit" className="ab-ping__send" disabled={busy || !draft.trim()} aria-label={`Send reply to ping ${p.id}`}>
              <SendIcon size={13} /> Send
            </button>
          </form>
        )}
        <div className="ab-ping__acts">
          <button type="button" disabled={busy} aria-pressed={p.read} onClick={() => void act(() => pings.mark(p.id, { read: !p.read }))}>
            <CheckIcon size={13} /> {p.read ? "Read" : "Mark read"}
          </button>
          {/* a0-016: 👍 / ✗ / 🤔; each goes back to the agent as a message (clearing one says nothing). */}
          {REACTS.map(([k, mark, label]) => (
            <button key={k} type="button" className="ab-ping__react" disabled={busy} aria-label={label} title={`${label} · tells ${agent.name}`} aria-pressed={p.react === k} onClick={() => void act(() => pings.mark(p.id, { react: p.react === k ? null : k }))}>
              {mark}
            </button>
          ))}
          <button type="button" className="is-voice" aria-pressed={replying} onClick={() => onReply(!replying)}>
            <AudioLinesIcon size={13} /> Voice reply
          </button>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon size={13} /> Open
            </a>
          )}
        </div>
        {error && <p role="alert" className="ab-ping__error">{error}</p>}
      </div>
    </article>
  );
}

export function PingStrip({ agent, pings, onBoard }: { agent: Agent; pings: Pings; onBoard: () => void }) {
  const [stack, setStack] = useState(false);
  const [tab, setTab] = useState<Tab>("unread");
  const [replyFor, setReplyFor] = useState<Ping["id"] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (setStack(false), setReplyFor(null)), [agent.id]);
  useEffect(() => {
    const toggle = () => setStack((v) => !v);
    window.addEventListener("siso-pings-toggle", toggle);
    return () => window.removeEventListener("siso-pings-toggle", toggle);
  }, []);
  useEffect(() => {
    if (!stack) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setStack(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [stack]);
  const unread = pings.unread;
  const top = unread[0];
  const needing = pings.items.filter((p) => !p.read && needsHim(p));
  const rows = (tab === "unread" ? unread : tab === "needs" ? needing : [...pings.items].sort(byPing)).slice(0, 60);
  if (!top && !stack) return null;
  const hue = { "--ab-hue": String(projectHue(agent.project ?? agent.name)) } as CSSProperties;
  return (
    <div className="ab-pings" ref={root} style={hue}>
      {top && (
        <div className={`ab-strip${needsHim(top) ? " is-needs" : ""}`} data-testid="ping-strip">
          <button type="button" className="ab-strip__open" onClick={() => setStack((v) => !v)} aria-expanded={stack} aria-label={`Pings from ${agent.name}: ${unread.length} unread. Open the stack (⌥⌘N)`}>
            <AgentFace {...faceFor(agent)} size={20} />
            <span className={`ab-strip__kind${needsHim(top) ? " is-needs" : ""}`}>{needsHim(top) ? "Needs you" : "New"}</span>
            <span className="ab-strip__title">{top.title}</span>
            <span className="ab-strip__where">
              {(top.project ?? agent.project) ? ` · ${top.project ?? agent.project}` : ""} · {when(top.at)}
            </span>
          </button>
          <span className="ab-strip__count" data-testid="ping-count">
            1 of {unread.length}
          </span>
          <button type="button" className="ab-strip__btn" aria-label="Mark read" title="Mark read" data-testid="ping-read" onClick={() => void pings.mark(top.id, { read: true })}>
            <CheckIcon size={15} />
          </button>
          <button type="button" className="ab-strip__btn is-voice" aria-label="Voice reply" title="Voice reply" onClick={() => (setStack(true), setTab("unread"), setReplyFor(top.id))}>
            <AudioLinesIcon size={15} />
          </button>
          <button type="button" className="ab-strip__btn" aria-label={stack ? "Close the stack" : "Open the stack"} title={stack ? "Close (Esc)" : "All pings (⌥⌘N)"} onClick={() => setStack((v) => !v)}>
            {stack ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
          </button>
        </div>
      )}
      {stack && <div className="ab-stack__shade" aria-hidden onClick={() => setStack(false)} />}
      {stack && (
        <section className="ab-stack" role="dialog" aria-label={`${agent.name} pings`} data-testid="ping-stack">
          <header className="ab-stack__head">
            <div className="ab-stack__tabs" role="tablist">
              {([["unread", `Unread ${unread.length}`], ["needs", `Needs you ${needing.length}`], ["all", `All ${pings.items.length}`]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={k === "needs" ? "is-needs" : ""} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="ab-stack__all" disabled={!unread.length} onClick={() => void pings.markAll()}>
              Mark all read
            </button>
            <button type="button" className="ab-strip__btn" aria-label="Close the stack" onClick={() => setStack(false)}>
              <ChevronUpIcon size={15} />
            </button>
          </header>
          <div className="ab-stack__list">
            {rows.length ? (
              rows.map((p) => <Row key={String(p.id)} p={p} agent={agent} pings={pings} replying={replyFor === p.id} onReply={(on) => setReplyFor(on ? p.id : null)} />)
            ) : (
              <p className="ab-stack__empty">{tab === "all" ? "No pings yet." : "All read."}</p>
            )}
          </div>
          <footer className="ab-stack__foot">
            <span>{`A reaction or reply goes into ${agent.zero ? "Agent Zero" : agent.name}'s chat as "re: notification N: …"${agent.zero ? " (and his console inbox)" : ""}; pings stay until you mark them read.`}</span>
            <button type="button" onClick={() => (setStack(false), onBoard())}>
              Every ping, by project ›
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
