import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRightIcon, MessageSquareIcon } from "lucide-react";
import { formatDuration } from "@siso/side-nav";
import { useHoverCard, usePersisted } from "@siso/shell";
import { AgentFace } from "../../lib/face";
import { clock } from "../../lib/poll";
import { openOwner, openOwnerLink, useOwners, type Owner } from "../../lib/owners";
import { LIVE_WORD, OwnerBoard, STATUS_WORD, active, ago, face, live, model, overdue } from "../OwnerBoard";
import { ProjectMark } from "../ProjectMark";
import "./OwnerRoster.css";

/**
 * The owners at the top of Team (Shaan, 6 Oct 22:00: "I should be able to see the owners in team cleanly at the top, and
 * like the working, not working"; 22:35: "idle ones should be batched on the same vertical line"). One block per project
 * with its mark; a working owner gets a line with its step and latest link; idle owners share one line. Hovering any owner
 * shows the rest of its card (22:35: "when you hover over stuff you should usually show more information").
 */
type Now = ReturnType<typeof live> | "working" | "idle";
const nowOf = (o: Owner): NonNullable<Now> => live(o) ?? (active(o) ? "working" : "idle");
const loud = (o: Owner) => ["needs", "failed"].includes(nowOf(o)) || ["blocked", "waiting-on-shaan"].includes(o.status);
const rank = (o: Owner) => (loud(o) ? 0 : nowOf(o) === "working" ? 1 : 2);
/** The project an owner's workspace belongs to: HALO's workspaces are HALO, Kika's and Fahmy's are SISO Agency's clients. */
export const projectOf = (workspace: string, names: Map<string, string>) => {
  const w = workspace.toLowerCase();
  if (w === "halo" || w.startsWith("halo-")) return "HALO";
  if (["siso-agency", "kikas", "fahmy"].includes(w)) return "SISO Agency";
  if (["agent-base", "zero", "tasks", "app-atlas"].includes(w)) return "Agent Base";
  return names.get(workspace) ?? (workspace || "Unsorted");
};
const shortHost = (url: string) => { try { const u = new URL(url); return /^(127\.0\.0\.1|localhost)$/.test(u.hostname) ? `:${u.port}` : u.hostname.replace(/^www\./, ""); } catch { return "link"; } };
const short = (ms: number) => formatDuration(Math.max(0, ms)).split(" ")[0];

function useNow() { const [now, setNow] = useState(Date.now()); useEffect(() => clock(() => setNow(Date.now())), []); return now; }

/** Everything else on its card, shown on hover; it holds the link and the page, so the pointer can cross into it. */
function OwnerHover({ o, now, style, cardProps, bridge, workers }: { o: Owner; now: number; workers: Owner[] } & Pick<ReturnType<typeof useHoverCard>, "style" | "cardProps" | "bridge">) {
  const state = nowOf(o), started = o.runtime?.started ?? o.started;
  return createPortal(<>
    <div {...bridge} />
    <div className="siso-hovercard ab-roster-hover" style={style} {...cardProps} data-testid="owner-hover">
      <div className="ab-roster-hover__head"><AgentFace {...face(o)} size={30} /><span><b>{o.name}</b><small>{o.title}</small></span></div>
      <p className={`ab-roster-hover__state is-${state}`}><i aria-hidden />{LIVE_WORD[state]}{o.status !== "unreported" && <> · card says {STATUS_WORD[o.status] ?? o.status}</>}{overdue(o, now) && <> · no update for {ago(o.updated, now).replace(" ago", "")}</>}</p>
      {o.subtitle && <p className="ab-roster-hover__step">{o.subtitle}</p>}
      {o.summary && o.summary !== o.subtitle && <p className="ab-roster-hover__summary">{o.summary}</p>}
      {o.next && <p className="ab-roster-hover__summary"><b>Next</b> {o.next}</p>}
      {!!o.asks.length && <p className="ab-roster-hover__ask"><b>Needs you</b> {o.asks[0]}{o.asks.length > 1 ? ` (+${o.asks.length - 1})` : ""}</p>}
      <dl>
        <dt>Updated</dt><dd>{ago(o.updated, now)}</dd>
        {started && <><dt>On it</dt><dd>{formatDuration(Math.max(0, now - Date.parse(started)))}</dd></>}
        <dt>Model</dt><dd>{model(o)}{o.machine ? ` · ${o.machine === "mini" ? "Mac Mini" : o.machine}` : ""}</dd>
        {!!workers.length && <><dt>Workers</dt><dd>{workers.map(w => w.name).join(", ")}</dd></>}
      </dl>
      <div className="ab-roster-hover__actions">
        {o.page && <button type="button" onClick={() => openOwnerLink(o.page!, `${o.name} · ${o.subtitle || o.title}`.slice(0, 80))}><ArrowUpRightIcon size={12} aria-hidden />Open its link <small>{shortHost(o.page)}</small></button>}
        <button type="button" onClick={() => openOwner(o.name)}><MessageSquareIcon size={12} aria-hidden />Its page</button>
      </div>
    </div>
  </>, document.body);
}

function LinkChip({ o, now }: { o: Owner; now: number }) {
  if (!o.page) return null;
  return <button type="button" className="ab-roster__link" data-testid={`roster-link-${o.name}`} title={o.page} onClick={e => { e.stopPropagation(); openOwnerLink(o.page!, `${o.name} · ${o.subtitle || o.title}`.slice(0, 80)); }}>
    <ArrowUpRightIcon size={11} aria-hidden />{o.updated ? short(now - Date.parse(o.updated)) : shortHost(o.page)}
  </button>;
}

/** A working (or stuck) owner: its line, its step under it, its link at the end. */
function OwnerLine({ o, now, workers }: { o: Owner; now: number; workers: Owner[] }) {
  const hover = useHoverCard<HTMLDivElement>(300, { label: `${o.name} details`, side: "left" });
  const state = nowOf(o);
  return <div {...hover.triggerProps} className={`ab-roster__line is-${state}${overdue(o, now) ? " is-stale" : ""}`} data-testid={`roster-${o.name}`} data-state={state}>
    <button type="button" className="ab-roster__main" onClick={() => openOwner(o.name)} aria-label={`${o.name}: ${LIVE_WORD[state]}. Open its page`}>
      <AgentFace {...face(o)} size={26} />
      <span className="ab-roster__copy">
        <span className="ab-roster__name"><b>{o.name}</b><em className={`ab-roster__state is-${state}`}><i aria-hidden />{LIVE_WORD[state]}</em>{!!workers.length && <small>+{workers.length}</small>}</span>
        <small className="ab-roster__step">{o.subtitle || o.title}</small>
      </span>
    </button>
    <LinkChip o={o} now={now} />
    {hover.open && <OwnerHover o={o} now={now} workers={workers} style={hover.style} cardProps={hover.cardProps} bridge={hover.bridge} />}
  </div>;
}

/** An idle owner on the shared idle line: its face and name; the rest on hover. */
function IdleChip({ o, now, workers }: { o: Owner; now: number; workers: Owner[] }) {
  const hover = useHoverCard<HTMLButtonElement>(300, { label: `${o.name} details`, side: "left" });
  const state = nowOf(o);
  return <>
    <button type="button" {...hover.triggerProps} className={`ab-roster__idle is-${state}`} data-testid={`roster-${o.name}`} data-state={state} onClick={() => openOwner(o.name)} aria-label={`${o.name}: ${LIVE_WORD[state]}. Open its page`}>
      <AgentFace {...face(o)} size={18} /><span>{o.name}</span>{o.page && <i className="ab-roster__dotlink" aria-label="has a link" />}
    </button>
    {hover.open && <OwnerHover o={o} now={now} workers={workers} style={hover.style} cardProps={hover.cardProps} bridge={hover.bridge} />}
  </>;
}

export function OwnerRoster() {
  const data = useOwners(true), now = useNow();
  const owners = (data?.owners ?? []).filter(o => !o.readError || o.updated);
  const names = new Map((data?.workspaces ?? []).map(w => [w.id, w.name]));
  const roots = owners.filter(o => !o.parent || !owners.some(p => p.name === o.parent));
  const kids = (o: Owner) => owners.filter(c => c.parent === o.name);
  const groups = [...new Set(roots.map(o => projectOf(o.workspace, names)))].map(project => {
    const list = roots.filter(o => projectOf(o.workspace, names) === project).sort((a, b) => rank(a) - rank(b) || (b.updated ?? "").localeCompare(a.updated ?? ""));
    return { project, lines: list.filter(o => rank(o) < 2), idle: list.filter(o => rank(o) === 2) };
  }).sort((a, b) => b.lines.length - a.lines.length || a.project.localeCompare(b.project));
  const busy = roots.filter(o => nowOf(o) === "working").length;
  // The Fleet's full owner cards are one click away, never opened by themselves (22:00: "this fleet pops out randomly").
  const [cards, setCards] = usePersisted("panel.team.cards", false);
  return <section className="ab-roster" aria-label="Owners" data-testid="owner-roster">
    <header className="ab-roster__head"><span>Owners</span><small>{data ? `${busy} working · ${roots.length - busy} idle` : "Connecting…"}</small><button type="button" className="ab-roster__cards" data-testid="roster-cards" aria-pressed={cards} onClick={() => setCards(!cards)}>{cards ? "Hide full cards" : "Full cards"}</button></header>
    {data?.error && <p role="status" className="ab-roster__note">{data.error}</p>}
    {data && !roots.length && <p className="ab-roster__note">No owner has reported yet.</p>}
    {groups.map(g => <div key={g.project} className="ab-roster__group" data-project={g.project}>
      <h4><ProjectMark project={g.project} /><span>{g.project}</span>{!!g.lines.length && <small>{g.lines.length} working</small>}</h4>
      {g.lines.map(o => <OwnerLine key={o.name} o={o} now={now} workers={kids(o)} />)}
      {!!g.idle.length && <div className="ab-roster__idles" data-testid="roster-idle"><span className="ab-roster__idleword">Idle</span>{g.idle.map(o => <IdleChip key={o.name} o={o} now={now} workers={kids(o)} />)}</div>}
    </div>)}
    {cards && <OwnerBoard />}
  </section>;
}
