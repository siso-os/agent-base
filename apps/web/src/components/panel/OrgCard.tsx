import { ChevronRightIcon, Maximize2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { type Agent, type Org, type OrgOwner, doingNow } from "../../lib/agents";
import { canonName } from "../../lib/a0-tasks";
import { AgentFace, faceFor } from "../../lib/face";
import { every } from "../../lib/poll";
import { WORD, markOf } from "../Sidebar";
import { Fold } from "../PanelFold";
import { SubFace, modelChip, subName, type SubRowData } from "./SubRow";
import "./panel.css";

type Group = { name: string; owners: { o: OrgOwner; a: Agent | null; workers: Agent[] }[] };

/** Agent Zero's team as groups: each project with an owner, then the Fleet (HEALTH, EFFICIENCY, ESTATE). */
export function orgGroups(org: Org | null, agents: Agent[]): Group[] {
  const live = agents.filter((a) => a.row === "live");
  const byName = new Map(live.map((a) => [canonName(a.name), a]));
  const row = (o: OrgOwner) => ({ o, a: byName.get(canonName(o.name)) ?? null, workers: live.filter((w) => w.lead && canonName(w.lead) === canonName(o.name)) });
  const out: Group[] = [];
  for (const g of org?.groups ?? []) for (const p of g.projects) if (p.owners.length) out.push({ name: p.name, owners: p.owners.map(row) });
  if (org?.bottom.length) out.push({ name: "Fleet", owners: org.bottom.map(row) });
  return out;
}

/** Agent Zero's own sub-agents, read every 5 s while shown. */
function useSubs(id: string) {
  const [rows, setRows] = useState<SubRowData[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/agents/${encodeURIComponent(id)}/subagents`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
        .then((x) => alive && setRows((x.rows ?? []).filter((r: SubRowData) => !r.agentId)))
        .catch(() => alive && setRows((v) => v ?? []));
    load();
    const stop = every(load, 5000);
    return () => {
      alive = false;
      stop();
    };
  }, [id]);
  return rows;
}

/**
 * The org chart card, Agent Zero only (SPEC-PANEL-CARDS §8; Shaan 3 Oct 00:05: "my agent zero should probably have an org
 * chart"; 1 Oct: "a little org chart ... of like all the agents in this fleet and how they work together ... and you can
 * click on them"). His face, a bracket, a tile per project with its owners' faces and a dot per worker (cyan while it
 * works). A face peeks that agent; anywhere else, or Tree ›, opens the tree.
 */
export function OrgCard({ zero, org, agents, onPeek, onTree }: { zero: Agent; org: Org | null; agents: Agent[]; onPeek: (a: Agent) => void; onTree: () => void }) {
  const groups = orgGroups(org, agents);
  const subs = useSubs(zero.id);
  const owners = groups.flatMap((g) => g.owners).filter((x) => x.a);
  const workers = owners.flatMap((x) => x.workers);
  const out = (subs ?? []).filter((r) => r.running).length;
  const peek = (
    <span>
      Agent Zero → <b>{owners.length}</b> owners → <b>{workers.length}</b> workers · {out} sub-agents out
    </span>
  );
  return (
    <Fold id="org" title="Org chart" note={org ? `${groups.length} groups` : "…"} open testid="fold-org" peek={peek} onOpen={onTree}>
      <div className="ab-orgc" role="button" tabIndex={0} data-testid="org-card" onClick={onTree} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTree())}>
        <span className="ab-orgc__top">
          <AgentFace {...faceFor(zero)} size={26} />
        </span>
        <span className="ab-orgc__bracket" aria-hidden="true" />
        <span className="ab-orgc__tiles" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, groups.length))}, minmax(0, 1fr))` }}>
          {groups.map((g) => (
            <span key={g.name} className="ab-orgc__tile" data-testid="org-tile" data-group={g.name}>
              <small>{g.name}</small>
              <span className="ab-orgc__faces">
                {g.owners.map(({ o, a }) =>
                  a ? (
                    <button key={o.name} type="button" title={`Peek ${a.name}`} data-testid="org-face" data-name={a.name} onClick={(e) => (e.stopPropagation(), onPeek(a))}>
                      <AgentFace {...faceFor(a)} size={20} />
                    </button>
                  ) : (
                    <span key={o.name} className="ab-orgc__off" title={`${o.name} · ${o.state === "planned" ? "not spun up" : "offline"}`} />
                  ),
                )}
              </span>
              <span className="ab-orgc__dots">
                {g.owners.flatMap((x) => x.workers).map((w) => (
                  <i key={w.id} className={w.status === "working" ? "is-working" : undefined} title={`${w.name} · ${WORD[markOf(w)]}`} />
                ))}
              </span>
            </span>
          ))}
        </span>
        <span className="ab-orgc__cap" data-testid="org-caption">
          {owners.length} owners · {workers.length} workers · <b>{subs ? out : "…"} sub-agents out</b>
        </span>
      </div>
      <div className="ab-orgc__foot">
        <span>tap a face to peek</span>
        <button type="button" className="ab-pagelink" data-testid="org-tree" onClick={onTree}>
          Tree <ChevronRightIcon size={13} />
        </button>
      </div>
    </Fold>
  );
}

/** One live owner's own sub-agents (a read per owner, only while the tree is open). */
function OwnerSubs({ a }: { a: Agent }) {
  const rows = useSubs(a.id);
  if (!rows?.length) return null;
  const running = rows.filter((r) => r.running).length;
  return (
    <p className="ab-tree__node is-sub">
      <i className={running ? "is-working" : undefined} />
      <span>
        <b>
          +{rows.length} sub-agent{rows.length === 1 ? "" : "s"}
        </b>{" "}
        <small>{running ? `${running} running` : "done"}</small>
      </span>
    </p>
  );
}

/**
 * The tree (SPEC-PANEL-CARDS §8 page): Agent Zero › each project › its owners › their workers and sub-agents, then his
 * own sub-agents. Every node has a state dot; a tap peeks it, hover offers Open; planned and offline owners are dimmed.
 * Full graph ⤢ opens the org page.
 */
export function OrgTree({ zero, org, agents, onPeek, onOpen, onSub, onSubs }: { zero: Agent; org: Org | null; agents: Agent[]; onPeek: (a: Agent) => void; onOpen: (a: Agent) => void; onSub: (r: SubRowData) => void; onSubs: () => void }) {
  const groups = orgGroups(org, agents);
  const subs = useSubs(zero.id);
  const running = (subs ?? []).filter((r) => r.running);
  const doneN = (subs ?? []).length - running.length;
  const node = (a: Agent, line: string, depth: "owner" | "worker") => (
    <div className={`ab-tree__node is-${depth}`} data-testid="tree-node" data-name={a.name}>
      <button type="button" className="ab-tree__main" title={`Peek ${a.name}`} onClick={() => onPeek(a)}>
        <AgentFace {...faceFor(a)} size={depth === "owner" ? 20 : 16} />
        <b>{a.name}</b>
        <small>{line}</small>
      </button>
      <button type="button" className="ab-tree__open" title="Make it the chat" onClick={() => onOpen(a)}>
        Open
      </button>
      <i className={`siso-dot is-${markOf(a)}`} aria-hidden="true" />
    </div>
  );
  return (
    <div className="ab-tree" data-testid="org-tree-page">
      <div className="ab-tree__root">
        <AgentFace {...faceFor(zero)} size={22} />
        <b>Agent Zero</b>
        <small>owns every domain</small>
        <span className="ab-tree__count">{subs ? `${running.length} sub-agents out` : "…"}</span>
      </div>
      {groups.map((g) => {
        const liveN = g.owners.filter((x) => x.a).length;
        return (
          <section key={g.name} className="ab-tree__group" data-testid="tree-group" data-group={g.name}>
            <h4>
              {g.name}
              <span>
                {liveN} live{g.owners.length > liveN ? ` · ${g.owners.length - liveN} off` : ""}
              </span>
            </h4>
            {g.owners.map(({ o, a, workers }) =>
              a ? (
                <div key={o.name} className="ab-tree__branch">
                  {node(a, doingNow(a, o.plan), "owner")}
                  <div className="ab-tree__kids">
                    {workers.map((w) => (
                      <div key={w.id}>{node(w, `${w.role ?? "worker"} · ${WORD[markOf(w)].toLowerCase()}`, "worker")}</div>
                    ))}
                    <OwnerSubs a={a} />
                  </div>
                </div>
              ) : (
                <div key={o.name} className="ab-tree__node is-owner is-off" data-testid="tree-node" data-name={o.name}>
                  <span className="ab-orgc__off" />
                  <b>{o.name}</b>
                  <small>{o.state === "planned" ? "not spun up" : "offline"}</small>
                </div>
              ),
            )}
          </section>
        );
      })}
      <section className="ab-tree__group">
        <h4>
          Its sub-agents
          <span>{subs ? `${running.length} running · ${doneN} done` : "reading…"}</span>
        </h4>
        {running.slice(0, 5).map((r) => (
          <button key={r.id} type="button" className="ab-tree__node is-owner ab-tree__subrow" onClick={() => onSub(r)}>
            <SubFace r={r} project={zero.project} size={18} />
            <b className={r.name ? "is-name" : undefined}>{subName(r)}</b>
            <small>{modelChip(r)}</small>
            <i className="siso-dot is-working" aria-hidden="true" />
          </button>
        ))}
        {(running.length > 5 || doneN > 0) && (
          <button type="button" className="ab-more" onClick={onSubs}>
            {running.length > 5 ? `+${running.length - 5} running · ` : ""}
            {doneN} done ›
          </button>
        )}
      </section>
    </div>
  );
}

/** The tree's bar: "Agent Zero's team" and Full graph ⤢. */
export function OrgTreeMeta({ onGraph }: { onGraph: () => void }) {
  return (
    <>
      <span>Agent Zero's team</span>
      <button type="button" className="ab-drill__open" title="The full org graph" onClick={onGraph}>
        Full graph <Maximize2Icon size={11} />
      </button>
    </>
  );
}
