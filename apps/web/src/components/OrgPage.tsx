import { ChevronRightIcon } from "lucide-react";
import { Icon } from "../lib/Icon";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type Org, type OrgOp, type OrgOwner, type OrgItem, type OrgProject, STAGES, folderCount } from "../lib/agents";
import type { EntityPageData } from "../lib/org-types";
import { EntityPage } from "./EntityPage";
import type { OrgOwner as OwnerT, PlanItem as PlanItemT } from "../lib/org-types";
import { type FolderTask, OwnerTasks } from "./OwnerTasks";
import { openLink } from "./ChatView";

/**
 * The group and project dashboards (projects-owners/SIDENAV-GROUPS.md; Shaan, 2 Oct: "see and work with my projects
 * … tasks"). A group's page: a card per project with its owners, "N of M checked", what nobody has picked up, the last
 * report. A project's page: group › project, its front door, its owners, and the plan merged from its owners, grouped
 * by state, each item opening to his words and the evidence.
 */
const STATES = ["asked", "specced", "allocated", "building", "built", "checked"] as const;
const STATE_WORD: Record<string, string> = { asked: "Not picked up", specced: "Specced", allocated: "Allocated", building: "Building", built: "Built", checked: "Checked" };

function PlanBar({ plan }: { plan: OrgOwner["plan"] }) {
  if (!plan) return <span className="siso-org__muted">no plan yet</span>;
  const pct = plan.total ? Math.round((plan.checked / plan.total) * 100) : 0;
  return (
    <span className="siso-org__plan">
      <span className="siso-org__bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </span>
      {plan.checked} of {plan.total} checked
      {plan.asked > 0 && <b> · {plan.asked} not picked up</b>}
    </span>
  );
}

function OwnerLine({ o, onOpen }: { o: OrgOwner; onOpen: (name: string) => void }) {
  return (
    <button type="button" className="siso-org__owner" disabled={o.state !== "live"} onClick={() => onOpen(o.name)}>
      <i className={o.state === "live" ? "is-live" : "is-planned"} aria-hidden />
      <span className="siso-org__ownername">
        <Icon name={o.icon} size={16} />
        {o.name}
      </span>
      <span className="siso-org__muted">{[o.domain, o.state === "planned" ? "not started" : o.state === "offline" ? "not running" : o.working ? `${o.working} working` : null].filter(Boolean).join(" · ")}</span>
    </button>
  );
}

function ProjectCard({ p, onPage, onOpen }: { p: OrgProject; onPage: (id: string) => void; onOpen: (name: string) => void }) {
  const plans = p.owners.map((o) => o.plan).filter(Boolean) as NonNullable<OrgOwner["plan"]>[];
  const report = p.owners.map((o) => o.lastReport).filter(Boolean).sort((a, b) => (b!.at > a!.at ? 1 : -1))[0];
  return (
    <article className="siso-org__card">
      <button type="button" className="siso-org__cardhead" onClick={() => onPage(p.id)}>
        <b>{p.name}</b>
        <ChevronRightIcon size={14} />
      </button>
      {p.line && <p className="siso-org__line">{p.line}</p>}
      <div className="siso-org__owners">
        {p.owners.map((o) => (
          <OwnerLine key={o.name} o={o} onOpen={onOpen} />
        ))}
      </div>
      {plans.length > 0 && <PlanBar plan={{ checked: plans.reduce((n, x) => n + x.checked, 0), total: plans.reduce((n, x) => n + x.total, 0), asked: plans.reduce((n, x) => n + x.asked, 0), items: [] }} />}
      {report && (
        <p className="siso-org__report" title={report.text}>
          <span className="siso-org__muted">{/\d\d:\d\d/.exec(report.at)?.[0] ?? ""}</span> {report.text.slice(0, 140)}
        </p>
      )}
    </article>
  );
}

function PlanItems({ owners, focus }: { owners: OrgOwner[]; focus?: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  // An item opened from an owner's row (OwnerTasks) opens here and comes into view.
  useEffect(() => {
    if (!focus) return;
    setOpen(focus);
    window.setTimeout(() => document.querySelector(`[data-item="${focus}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }, [focus]);
  const items = owners.flatMap((o) => (o.plan?.items ?? []).map((i) => ({ ...i, owner: o.name })));
  if (!items.length) return <p className="siso-org__muted">No plan file yet for these owners.</p>;
  return (
    <>
      {STATES.map((st) => {
        const list = items.filter((i) => i.status === st);
        if (!list.length) return null;
        return (
          <section key={st} className="siso-org__state">
            <h3 className={st === "asked" ? "is-asked" : undefined}>
              {STATE_WORD[st]} <span className="siso-org__muted">{list.length}</span>
            </h3>
            {list.map((i) => (
              <div key={i.id} className="siso-org__item" data-item={i.id}>
                <button type="button" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>
                  <span className="siso-org__muted">{i.id}</span> {i.title}
                </button>
                {open === i.id && (
                  <div className="siso-org__itembody">
                    {i.his && <blockquote>“{i.his}”</blockquote>}
                    {i.evidence?.length ? (
                      <ul>
                        {i.evidence.map((e, n) => (
                          <li key={n}>{e}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="siso-org__muted">No evidence recorded yet.</p>
                    )}
                    <p className="siso-org__muted">
                      {i.owner}
                      {i.at ? ` · ${i.at.slice(0, 16).replace("T", " ")}` : ""}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

export function OrgPage({ org, page, onPage, onOpen, onOrg, onStart }: { org: Org | null; page: { group: string } | { project: string }; onPage: (p: { group: string } | { project: string }) => void; onOpen: (name: string) => void; onOrg: (op: OrgOp) => void; onStart?: (s: { name: string; project: string }) => Promise<string | null> }) {
  const [pageError, setPageError] = useState<string | null>(null);
  const [door, setDoor] = useState<string | null>(null);
  /** The node's answer for the page: a project outside the org (a hidden client, a Rolodex project) renders from it. */
  const [solo, setSolo] = useState<(OrgProject & { groupName?: string; client?: OrgItem; page?: EntityPageData | null }) | null>(null);
  const [folders, setFolders] = useState<(FolderTask & { holder?: string })[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const projectId = "project" in page ? page.project : null;
  useEffect(() => {
    let alive = true;
    setPageError(null);
    setDoor(null);
    setSolo(null);
    setFolders([]);
    if (!projectId) return;
    fetch(`/api/org/project/${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDoor(d.door ?? null);
        setSolo(d.error ? null : d);
        setPageError(d.error ?? null);
      })
      .catch(() => { if (alive) setPageError("The project page could not be read. Reopen it to try again."); });
    fetch(`/api/tasks?project=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setFolders(d.tasks ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  if (!org) return <div className="siso-org"><p className="siso-org__muted">Reading the org…</p></div>;
  if ("group" in page) {
    const g = org.groups.find((x) => x.id === page.group);
    if (!g) return <div className="siso-org"><p>No such group.</p></div>;
    return (
      <div className="siso-org" data-testid="org-page">
        <h1>
          <Icon name={g.icon} size={16} /> {g.name}
        </h1>
        <div className="siso-org__grid">
          {g.projects.map((p) => (
            <ProjectCard key={p.id} p={p} onPage={(id) => onPage({ project: id })} onOpen={onOpen} />
          ))}
        </div>
        {/* The agency's folders, the same ones the side nav folds (projects-nav A): every client, never behind a tick. */}
        {g.folders.map((f) => (
          <section key={f.id} className="siso-org__folder" data-folder={f.id}>
            <h2>
              {f.name} <span className="siso-org__muted">{folderCount(f)}</span>
            </h2>
            {(f.id === "clients" ? STAGES.map((s) => ({ name: s.name, items: f.items.filter((i) => i.stage === s.id) })) : [{ name: "", items: f.items }])
              .filter((b) => b.items.length)
              .map((b) => (
                <div key={b.name || f.id}>
                  {b.name && <h3 className="siso-org__muted">{b.name}</h3>}
                  <ul className="pp-directory">
                    {b.items.map((i) => (
                      <li key={i.id} className="siso-org__card">
                        <button type="button" onClick={() => onPage({ project: i.project ?? i.id })} title={i.note}>
                          {i.name}
                        </button>
                        {i.line && <span className="siso-org__muted"> · {i.line}</span>}
                        {i.project !== "halo" && (
                          <button
                            type="button"
                            className="siso-org__muted"
                            onClick={() => (i.project ? onOrg({ op: i.pinned ? "hide" : "show", id: i.project }) : onOrg({ op: "show", id: i.folder ?? i.id, to: i.name }))}
                          >
                            {" "}
                            · {i.pinned ? "Unpin" : "Pin to Agency"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        ))}
      </div>
    );
  }
  if (pageError) return <div className="siso-org" role="alert">{pageError}</div>;
  if (solo?.page && solo.client) {
    const c = solo.client;
    const home = org.groups.find(x => x.id === solo.group) ?? org.groups[0];
    const folder = home.folders.find(f => f.items.some(i => i.id === c.id));
    const parent = c.parent ? home.folders.flatMap(f => f.items).find(i => i.id === c.parent) : null;
    const crumb = [folder?.id === 'agencies' ? 'Agencies' : home.name, ...(folder?.id === 'agencies' ? [] : [c.kind === 'industry' ? 'Industries' : 'Clients']), ...(parent ? [parent.name] : []), c.name];
    return <EntityPage page={solo.page} crumb={crumb} onCrumb={() => onPage({ group: home.id })} onOpen={onOpen} onStart={onStart} />;
  }
  const g = org.groups.find((x) => x.projects.some((p) => p.id === page.project));
  const p = g?.projects.find((x) => x.id === page.project);
  if (!g || !p) {
    if (!solo) return <div className="siso-org"><p className="siso-org__muted">Opening {page.project}…</p></div>;
    const home = org.groups.find((x) => x.id === solo.group) ?? org.groups[0];
    return (
      <div className="siso-org" data-testid="org-page">
        <nav className="siso-org__crumb">
          <button type="button" onClick={() => onPage({ group: home.id })}>
            <Icon name={home.icon} size={16} /> {home.name}
          </button>{" "}
          › <b>{solo.name}</b>
        </nav>
        {solo.line && <p className="siso-org__line">{solo.line}</p>}
        {solo.client && (
          <p className="siso-org__muted" data-testid="client-facts">
            {[STAGES.find((s) => s.id === solo.client!.stage)?.name ?? solo.client.kind, solo.client.people.join(", "), solo.client.id].filter(Boolean).join(" · ")}
          </p>
        )}
        {door && (
          <div className="siso-org__door siso-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{door}</ReactMarkdown>
          </div>
        )}
        <h2>Owners</h2>
        <p className="siso-org__muted">No owners yet: Agent Zero places one when work starts here.</p>
      </div>
    );
  }
  return (
    <div className="siso-org" data-testid="org-page">
      <nav className="siso-org__crumb">
        <button type="button" onClick={() => onPage({ group: g.id })}>
          <Icon name={g.icon} size={16} /> {g.name}
        </button>{" "}
        › <b>{p.name}</b>
      </nav>
      {p.line && <p className="siso-org__line">{p.line}</p>}
      {door && (
        <div className="siso-org__door siso-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, href, children }: any) => <a href={href} onClick={(e) => { if (href && /^https?:/.test(href)) { e.preventDefault(); openLink(href); } }}>{children}</a> }}>{door}</ReactMarkdown>
        </div>
      )}
      <h2>Owners</h2>
      {/* T6 OwnerTasks: each owner expands to its open plan items and task folders (a folder goes to its holder, else the first owner). */}
      <div className="siso-org__owners is-wide">
        {p.owners.map((o, n) => (
          <div key={o.name} className="siso-org__ownerrow is-tasks">
            <OwnerTasks
              owner={o as unknown as OwnerT}
              planItems={(o.plan?.items ?? []) as PlanItemT[]}
              taskFolders={folders.filter((f) => (f.holder ? f.holder === o.name || (n === 0 && !p.owners.some((x) => x.name === f.holder)) : n === 0))}
              onOpenItem={(item) => ("status" in item ? setFocus(item.id) : undefined)}
            />
          </div>
        ))}
      </div>
      <h2>Plan</h2>
      <PlanItems owners={p.owners} focus={focus} />
      {p.owners.some((o) => o.lastReport) && (
        <>
          <h2>Last reports</h2>
          {p.owners
            .filter((o) => o.lastReport)
            .map((o) => (
              <p key={o.name} className="siso-org__report">
                <b>{o.name}</b> {o.lastReport!.text}
              </p>
            ))}
        </>
      )}
    </div>
  );
}
