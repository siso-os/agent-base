import { ChevronDownIcon, ChevronRightIcon, ExpandIcon } from "lucide-react";
import { useState } from "react";
import { formatDuration } from "@siso/side-nav";
import { type Agent, type Org, type OrgOwner, doingNow } from "../lib/agents";
import { canonName, isDone, isParked, tasksOf, useA0Tasks } from "../lib/a0-tasks";
import { AgentFace, faceFor } from "../lib/face";
import { WORD, markOf } from "./Sidebar";
import { Fold } from "./PanelFold";

type Row = { o: OrgOwner; a: Agent | null; workers: Agent[] };
type Group = { name: string; rows: Row[] };

/** Owners by project from /api/org, the Fleet last; each with its live agent (or none) and the workers that report to it. */
function groupsOf(org: Org | null, agents: Agent[]): Group[] {
  const live = agents.filter((a) => a.row === "live");
  const byName = new Map(live.map((a) => [canonName(a.name), a]));
  const row = (o: OrgOwner): Row => ({ o, a: byName.get(canonName(o.name)) ?? null, workers: live.filter((w) => w.lead && canonName(w.lead) === canonName(o.name)) });
  const out: Group[] = [];
  for (const g of org?.groups ?? []) for (const p of g.projects) if (p.owners.length) out.push({ name: p.name, rows: p.owners.map(row) });
  if (org?.bottom.length) out.push({ name: "Fleet", rows: org.bottom.map(row) });
  return out;
}
const busy = (a: Agent) => a.status === "working" || a.status === "needs" || a.status === "failed";
/** HH:MM, or nothing when the org gives no usable time (a report's `at` can be a bare date or text). */
const hhmm = (at?: string) => {
  const d = at ? new Date(at) : null;
  return d && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "";
};

/**
 * Who reports to Agent Zero, inline (rightpanel SPEC §2.4, kept; SPEC-PANEL-CARDS §7; Shaan 3 Oct 00:05: "i really like the
 * reports to you ui"). Owners by project with "N live"; an idle or done owner is one line, and the quiet line shows only
 * while it works or waits on him. Owners not spun up fold into one muted line. A tap peeks, Open makes it the chat,
 * "N workers ›" opens them in place; Team page › has a card per owner.
 */
export function TeamList({ org, agents, onPeek, onOpen, onOrgChart, onPage }: { org: Org | null; agents: Agent[]; onPeek: (a: Agent) => void; onOpen: (a: Agent) => void; onOrgChart: () => void; onPage?: () => void }) {
  const groups = groupsOf(org, agents);
  const all = groups.flatMap((g) => g.rows);
  const liveRows = all.filter((r) => r.a);
  const off = all.filter((r) => !r.a);
  const working = liveRows.filter((r) => r.a!.status === "working");
  // Folded: their faces, and who is working (SPEC-PANEL-CARDS §3).
  const peek = liveRows.length ? (
    <>
      <span className="ab-peekfaces">
        {liveRows.slice(0, 5).map((r) => (
          <AgentFace key={r.o.name} {...faceFor(r.a!)} size={16} />
        ))}
      </span>
      <span>
        {working.length ? (
          <>
            <b>{working[0].a!.name}</b> working{working.length > 1 ? ` +${working.length - 1}` : ""}
          </>
        ) : (
          "all quiet"
        )}
        {liveRows.length - working.length > 0 && ` · ${liveRows.length - working.length} idle`}
      </span>
    </>
  ) : null;
  return (
    <Fold id="team" title="Reports to you" note={org ? `${liveRows.length} live` : "…"} open testid="fold-team" peek={peek} onOpen={onPage}>
      {!org && <p className="ab-empty">Reading the org…</p>}
      {groups.map((g) => {
        const rows = g.rows.filter((r) => r.a);
        if (!rows.length) return null;
        return (
          <div key={g.name} className="ab-team__group">
            <h4>
              {g.name} <span>{rows.length} live</span>
            </h4>
            {rows.map((r) => (
              <OwnerRow key={r.o.name} {...r} onPeek={onPeek} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
      {off.length > 0 && (
        <p className="ab-team__off" data-testid="team-off">
          Not spun up: {off.map((r) => r.o.name).join(" · ")}
        </p>
      )}
      <div className="ab-team__foot">
        <button type="button" className="ab-more ab-team__chart" onClick={onOrgChart}>
          Org chart ›
        </button>
        {onPage && (
          <button type="button" className="ab-pagelink" data-testid="team-page" onClick={onPage}>
            Team page <ChevronRightIcon size={13} />
          </button>
        )}
      </div>
    </Fold>
  );
}

function OwnerRow({ o, a, workers, onPeek, onOpen }: Row & { onPeek: (a: Agent) => void; onOpen: (a: Agent) => void }) {
  const [open, setOpen] = useState(false);
  if (!a) return null;
  return (
    <>
      <div className={`ab-team__row${busy(a) ? "" : " is-quiet"}`} data-testid="team-row" data-name={o.name}>
        <button type="button" className="ab-team__main" title={`Peek ${a.name}`} onClick={() => onPeek(a)} onDoubleClick={() => onOpen(a)}>
          <AgentFace {...faceFor(a)} size={22} />
          <span className="ab-team__copy">
            <b>{a.name}</b>
            {busy(a) && (
              <small>
                {a.status === "working" ? doingNow(a, o.plan) : WORD[markOf(a)]} · {formatDuration(Date.now() - a.since)}
              </small>
            )}
          </span>
        </button>
        <button type="button" className="ab-team__open" title="Make it the chat" data-testid="team-open" onClick={() => onOpen(a)}>
          <ExpandIcon size={11} /> Open
        </button>
        {workers.length > 0 && (
          <button type="button" className="ab-team__workers" aria-expanded={open} onClick={() => setOpen(!open)}>
            {workers.length} {workers.length === 1 ? "worker" : "workers"} {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          </button>
        )}
        <span className={`siso-dot is-${markOf(a)}`} title={WORD[markOf(a)]} />
      </div>
      {open &&
        workers.map((w) => (
          <button key={w.id} type="button" className="ab-team__worker" data-testid="team-worker" onClick={() => onPeek(w)} onDoubleClick={() => onOpen(w)}>
            <span className={`siso-dot is-${markOf(w)}`} aria-hidden="true" />
            <span className="ab-team__wname">{w.name}</span>
            <span className="ab-team__wstate">{WORD[markOf(w)]}</span>
          </button>
        ))}
    </>
  );
}

/**
 * The Team page (SPEC-PANEL-CARDS §7): a card per live owner, busiest project first: face · name · domain · state and
 * since; what it is doing; its last report (time and text); its open tasks and how many need him (a tap opens the Tasks
 * page on that owner); its plan bar; its workers.
 */
export function TeamPage({ org, agents, onPeek, onTasks }: { org: Org | null; agents: Agent[]; onPeek: (a: Agent) => void; onTasks: (owner: string) => void }) {
  const { index } = useA0Tasks();
  const groups = groupsOf(org, agents);
  const off = groups.flatMap((g) => g.rows).filter((r) => !r.a);
  return (
    <div className="ab-teamp" data-testid="team-page-view">
      {!org && <p className="ab-empty">Reading the org…</p>}
      {groups.map((g) => {
        const rows = g.rows.filter((r) => r.a);
        if (!rows.length) return null;
        return (
          <section key={g.name}>
            <h4>{g.name}</h4>
            {rows.map(({ o, a, workers }) => {
              const open = tasksOf((index?.tasks ?? []).filter((t) => !isDone(t)), a!.name);
              const needs = open.filter((t) => t.needs && !isParked(t)).length;
              const plan = o.plan;
              return (
                <article key={o.name} className="ab-teamp__card" data-testid="team-card" data-name={o.name}>
                  <button type="button" className="ab-teamp__who" onClick={() => onPeek(a!)}>
                    <AgentFace {...faceFor(a!)} size={28} />
                    <span>
                      <b>{a!.name}</b>
                      <small>
                        {o.domain ?? a!.domain ?? g.name} · {WORD[markOf(a!)].toLowerCase()} {formatDuration(Date.now() - a!.since)}
                      </small>
                    </span>
                    <i className={`siso-dot is-${markOf(a!)}`} aria-hidden="true" />
                  </button>
                  <p className="ab-teamp__doing">{doingNow(a!, plan)}</p>
                  {o.lastReport && (
                    <p className="ab-teamp__report">
                      <time>{hhmm(o.lastReport.at)}</time> {o.lastReport.text}
                    </p>
                  )}
                  <div className="ab-teamp__foot">
                    <button type="button" className="ab-teamp__tasks" data-testid="team-card-tasks" onClick={() => onTasks(canonName(a!.name))}>
                      <b>{open.length}</b> open tasks{needs > 0 && <em> · {needs} need you</em>}
                    </button>
                    {workers.length > 0 && (
                      <span className="ab-teamp__workers">
                        {workers.length} {workers.length === 1 ? "worker" : "workers"}: {workers.map((w) => w.name).join(", ")}
                      </span>
                    )}
                  </div>
                  {plan && plan.total > 0 && (
                    <span className="ab-teamp__plan" title={`${plan.checked} of ${plan.total} checked`}>
                      <i style={{ width: `${Math.round((plan.checked / plan.total) * 100)}%` }} />
                    </span>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
      {off.length > 0 && <p className="ab-team__off">Not spun up: {off.map((r) => r.o.name).join(" · ")}</p>}
    </div>
  );
}

/** The Team page's bar: "5 live · 4 not spun up". */
export function TeamPageMeta({ org, agents }: { org: Org | null; agents: Agent[] }) {
  const rows = groupsOf(org, agents).flatMap((g) => g.rows);
  const live = rows.filter((r) => r.a).length;
  return (
    <span>
      {live} live{rows.length > live ? ` · ${rows.length - live} not spun up` : ""}
    </span>
  );
}
