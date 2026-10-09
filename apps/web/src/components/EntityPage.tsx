// The industry and client page (project-pages spec v2, Shaan 3 Oct 01:05: approved option A's structure, "it feels like
// sonnet made it ... distill some knowledge from how it built ui elsewhere"). One template for both kinds: a hero (crumb,
// kicker, name, lede, tags, the owner capsule with its Halo rim, the live site framed on the right), one stat bar with the
// commit chart, a bento of the record, and one quiet "Not recorded yet" line. Data: GET /api/org/project/:id `page`.
import { useState, type CSSProperties, type ReactNode } from "react";
import { BoxesIcon, ChevronRightIcon, ClipboardCheckIcon, ClockIcon, FolderIcon, MessageSquareQuoteIcon, PlayIcon, MessageCircleIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { AgentFace, projectHue, type AgentStatus } from "../../../../packages/halo-face";
import type { EntityPageData, Tone } from "../lib/org-types";
import { openLink } from "./ChatView";
import "./EntityPage.css";

const TONE: Record<Tone, string> = { good: "g", working: "b", needs: "a", neutral: "z" };
const PILL: Record<Tone, string> = { good: "g", working: "b", needs: "a", neutral: "n" };
// Task states as the tracker colours them (rule 6): cyan building, green tested, amber allocated, violet specced, red todo.
const STATE_COLOUR: Record<string, string> = { building: "var(--cyan)", review: "#34c38f", done: "#34c38f", claimed: "#f0b03f", allocated: "#f0b03f", specced: "#a78bfa", open: "#ef5b4c", todo: "#ef5b4c", failed: "#6b6b66" };
const FACE_OF: Record<string, AgentStatus> = { working: "working", idle: "waiting", planned: "offline", none: "offline", needs: "needs-shaan", done: "done" };
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Info({ src }: { src: string }) {
  return (
    <span className="info" data-src={src} aria-label={`Source: ${src}`} role="note">
      i
    </span>
  );
}
function Card({ icon, title, count, src, span, children }: { icon: ReactNode; title: string; count?: number; src: string; span?: 2; children: ReactNode }) {
  return (
    <section className={`card2${span === 2 ? " s2" : ""}`} data-testid="entity-card" data-title={title}>
      <div className="ch">
        <span className="ic">{icon}</span>
        <h4>{title}</h4>
        {count !== undefined && <span className="c">{count}</span>}
        <Info src={src} />
      </div>
      {children}
    </section>
  );
}
const thumbUrl = (folder: string, file: string) => `/api/org/thumb?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`;

export function EntityPage({
  page,
  crumb,
  onCrumb,
  onOpen,
  onStart,
  stage,
  children,
  afterHeader,
  contentId,
  contentLabelledBy,
}: {
  page: EntityPageData;
  /** "SISO Agency › Clients › Active › <name>": each part but the last is a link (group dashboard). */
  crumb: string[];
  onCrumb: () => void;
  onOpen: (name: string) => void;
  onStart?: (s: { name: string; project: string }) => Promise<string | null>;
  /** Project work uses the same hero and owner capsule, with its working brief beside it. */
  stage?: ReactNode;
  children?: ReactNode;
  afterHeader?: ReactNode;
  contentId?: string;
  contentLabelledBy?: string;
  /** "N more ›": Agent Zero's page, where the whole board is. */
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const h = (() => {
    try {
      return projectHue(page.name);
    } catch {
      return 200;
    }
  })();
  const o = page.owner;
  const ownerClass = o.state === "working" ? " working" : "";
  const desktop = page.thumbs.filter((t) => !t.phone);
  const phone = page.thumbs.find((t) => t.phone);
  const maxDay = Math.max(1, ...page.activity.days.map((d) => d.n));
  const commits = page.activity.days.reduce((s, d) => s + d.n, 0);
  const segs = Object.entries(page.work.byState).filter(([, n]) => n > 0);
  const start = async () => {
    if (o.mode === "running" && o.name) return onOpen(o.name);
    if (!o.planned || !onStart) return;
    setStarting(true);
    setStartError(await onStart({ name: o.planned, project: "Agency base" }));
    setStarting(false);
  };
  const liveDot = (code: number | null) => (code === 200 ? "ok" : code === 401 ? "gate" : "none");
  return (
    <div className="ep" style={{ "--h": h } as CSSProperties} data-testid="entity-page" data-kind={page.kind}>
      <header className="hero" style={{ "--st": o.state === "working" ? "var(--cyan)" : "hsl(var(--h) 80% 60%)" } as CSSProperties}>
        <div>
          <nav className="crumb" aria-label="Breadcrumb">
            {crumb.slice(0, -1).map((c, i) => (
              <span key={c} style={{ display: "contents" }}>
                {i === 0 ? (
                  <button type="button" onClick={onCrumb}>
                    {c}
                  </button>
                ) : (
                  <span>{c}</span>
                )}
                <ChevronRightIcon />
              </span>
            ))}
            <b>{crumb.at(-1)}</b>
          </nav>
          <div className="kick">
            {page.kicker.map((k, i) => (
              <span key={k} style={{ display: "contents" }}>
                {i > 0 && <i />}
                <span>{k}</span>
              </span>
            ))}
          </div>
          <h1 className="h1">{page.name}</h1>
          <p className="lede" title={page.line?.src}>
            {page.line?.text ?? "Nothing written about it yet."}
          </p>
          <div className="tags">
            {page.tags.map((t) => (
              <span key={t.label} className={`tag2 ${{ good: "g", working: "v", needs: "a", neutral: "" }[t.tone]}`}>
                {t.label}
              </span>
            ))}
          </div>
          {/* The owner capsule (rule 2: the composer's Halo rim; it turns only while the owner works). */}
          <div className={`owner${ownerClass}`} style={{ "--oh": h } as CSSProperties} data-testid="entity-owner" data-mode={o.mode}>
            <div className="own-top">
              {o.name && o.mode !== "domain" && o.mode !== "record" ? (
                <AgentFace name={o.name} project={page.name} status={FACE_OF[o.state]} size={56} />
              ) : o.planned ? (
                <AgentFace name={o.planned} project="Agency base" status="offline" size={56} />
              ) : (
                <span className="seatf" style={{ width: 56, height: 56 }} aria-hidden="true">
                  +
                </span>
              )}
              <div>
                <div className="own-k">Owner</div>
                <div className="own-n">{o.mode === "record" ? (o.name ?? "On record") : (o.name ?? "Nobody yet")}</div>
                <div className="own-s">
                  <b className={o.state === "working" ? "w" : o.state === "planned" ? "a" : ""}>{o.sentence}</b>
                </div>
              </div>
              {(o.mode === "running" || (o.planned && onStart)) && (
                <button type="button" className="go" onClick={start} disabled={starting} aria-label={o.mode === "running" ? `Open ${o.name}` : `Start ${o.planned}`} title={o.mode === "running" ? `Open ${o.name}` : `Start ${o.planned}`}>
                  {o.mode === "running" ? <MessageCircleIcon /> : <PlayIcon />}
                </button>
              )}
            </div>
            <p className="own-why" title={o.why.src}>
              {o.why.text}
              {o.mode === "record" && o.planned && (
                <>
                  {" "}
                  <b>{o.planned}</b> is the Agency's owner when it starts.
                </>
              )}
              {startError && <span className="a"> {startError}</span>}
            </p>
            {o.crew.length > 0 && (
              <div className="crew2">
                <span className="stackf">
                  {o.crew.slice(0, 5).map((c) => (
                    <span key={c.name}>
                      <AgentFace name={c.name} project={page.name} status={FACE_OF[c.state] ?? "waiting"} size={26} />
                    </span>
                  ))}
                </span>
                <small>
                  <b>{o.crew.length}</b> more here
                </small>
              </div>
            )}
          </div>
        </div>
        {/* Rule 4: the live site, framed and layered, the phone on top; with no image, a hue field and why. */}
        {stage ?? <div className="stage3" data-testid="entity-stage">
          {desktop[1] && (
            <div className="bw back">
              <div className="chrome">
                <i />
                <i />
                <i />
              </div>
              <img className="shot" src={thumbUrl(desktop[1].folder, desktop[1].file)} alt="" loading="lazy" />
            </div>
          )}
          <div className={`bw front${desktop[0] ? "" : " locked"}`}>
            <div className="chrome">
              <i />
              <i />
              <i />
              <span className="url">
                <span className={`dot ${liveDot(page.live[0]?.code ?? null)}`} />
                {page.live[0] ? new URL(page.live[0].url).host : "no demo URL yet"}
              </span>
            </div>
            {desktop[0] ? <img className="shot" src={thumbUrl(desktop[0].folder, desktop[0].file)} alt={`${page.name}, as captured`} /> : <div className="shot">{page.live.length ? "No screenshot captured yet" : "No demo URL and no screenshot yet"}</div>}
          </div>
          {phone && (
            <div className="phone">
              <img src={thumbUrl(phone.folder, phone.file)} alt="" loading="lazy" />
            </div>
          )}
          {page.live.length > 0 && (
            <div className="cap">
              {page.live.slice(0, 3).map((l) => (
                <span key={l.url} title={l.src} onClick={() => openLink(l.url)} role="link">
                  <span className={`dot ${liveDot(l.code)}`} />
                  {new URL(l.url).host} · {l.code ?? "no answer"}
                </span>
              ))}
            </div>
          )}
        </div>}
      </header>
      {afterHeader}

      <div id={contentId} role={contentLabelledBy ? 'tabpanel' : undefined} aria-labelledby={contentLabelledBy}>
      {children ?? <>

      {/* Rule 5: one joined stat bar, four figures and the commit chart. */}
      <div className="stats" data-testid="entity-stats">
        {page.stats.map((s) => (
          <div className="stat" key={s.label}>
            <Info src={s.src} />
            <div className="l">{s.label}</div>
            <div className="p">{s.period || " "}</div>
            <div className="row">
              <span className={`n${s.value === null ? " dim" : ""}`}>
                {s.value ?? "—"}
                {s.unit && <small>{s.unit}</small>}
              </span>
              {s.delta && <span className={`delta ${TONE[s.delta.tone]}`}>{s.delta.text}</span>}
            </div>
            <div className="s">{s.line}</div>
          </div>
        ))}
        <div className="stat">
          <Info src={page.activity.src} />
          <div className="l">Commits</div>
          <div className="p">last 11 days · {commits}</div>
          <div className="bars">
            {page.activity.days.map((d, i) => (
              <i key={d.date} className={i === page.activity.days.length - 1 ? "hot" : ""} style={{ height: `${Math.max(8, (d.n / maxDay) * 100)}%` }} title={`${d.date}: ${d.n}`}>
                {i === page.activity.days.length - 1 && d.n > 0 && <b>{d.n}</b>}
              </i>
            ))}
          </div>
          <div className="blab">
            {page.activity.days.map((d, i) => (
              <span key={d.date}>{i % 2 === 0 ? new Date(d.date).getDate() : ""}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="body">
        {page.kind === "industry" ? (
          <Card icon={<UsersIcon />} title="Clients in it" count={page.clients.length} src="SISO_Agency/clients/CLIENTS.json (inferred: no industry field yet)" span={2}>
            {page.clients.length ? (
              <div className="tiles">
                {page.clients.map((c) => (
                  <div className="tile" key={c.id} style={{ "--th": (() => { try { return projectHue(c.name); } catch { return 200; } })() } as CSSProperties}>
                    <div className="art">
                      {c.thumb ? <img src={thumbUrl(c.thumb.split("|")[0], c.thumb.split("|")[1])} alt="" loading="lazy" /> : <span className="mono">{c.name.slice(0, 2).toUpperCase()}</span>}
                    </div>
                    <div className="ft">
                      <div>
                        <b>{c.name}</b>
                        <small>{c.line}</small>
                      </div>
                      <span className="seatf" style={{ width: 22, height: 22 }} aria-hidden="true">
                        +
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty3">No client is placed in this industry yet. CLIENTS.json's `industry` field will fill this.</p>
            )}
          </Card>
        ) : (
          <Card icon={<SparklesIcon />} title="What we built" count={page.built.length} src="README.md URLs (probed) · code/ repos" span={2}>
            {page.built.length ? (
              <div className="deliv">
                {page.built.slice(0, 4).map((b) => (
                  <div className="dv" key={b.line}>
                    <b>{b.title}</b>
                    <small>{b.line}</small>
                    <span className={`pill ${PILL[b.tone]}`}>{b.chip}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty3">No live page or repo is recorded in its folder yet.</p>
            )}
          </Card>
        )}
        <Card icon={<ClipboardCheckIcon />} title="Open work" src={page.work.src}>
          <div className="big">
            <b>{page.work.open}</b>
            <span>of {page.work.total}</span>
          </div>
          {segs.length > 0 && (
            <>
              <div className="seg">
                {segs.map(([st, n]) => (
                  <i key={st} style={{ flex: n, background: STATE_COLOUR[st] ?? "#6b6b66" }} />
                ))}
              </div>
              <div className="segl">
                {segs.map(([st, n]) => (
                  <span key={st}>
                    <i style={{ background: STATE_COLOUR[st] ?? "#6b6b66" }} />
                    {n} {st}
                  </span>
                ))}
              </div>
            </>
          )}
          {page.work.items.map((t) => (
            <div className="task" key={t.id}>
              <i style={{ background: STATE_COLOUR[t.state] ?? "#6b6b66" }} />
              <span>{t.title}</span>
              <small>{t.id}</small>
            </div>
          ))}
          {!page.work.total && <p className="empty3">No task folders in its .agents/tasks yet.</p>}
        </Card>
        {page.kind === "client" && (
          <Card icon={<UsersIcon />} title="People" count={page.people.length} src="CLIENTS.json people · the Rolodex">
            <div className="ppl">
              {page.people.map((p) => (
                <div className="pp2" key={p.name}>
                  <span className="av2" style={{ "--ph": (() => { try { return projectHue(p.name); } catch { return 200; } })() } as CSSProperties}>
                    {p.name.slice(0, 1)}
                  </span>
                  <div>
                    <b>{p.name}</b>
                    <small>{p.note || "on the Rolodex"}</small>
                  </div>
                  <span className={`pill ${p.contact ? "n" : "a"}`}>{p.contact ? "Rolodex" : "no contact"}</span>
                </div>
              ))}
              {!page.people.length && <p className="empty3">Nobody is named for it in CLIENTS.json.</p>}
            </div>
          </Card>
        )}
        <Card icon={<ClockIcon />} title="What happened" src={page.happened[0]?.src ?? page.activity.src}>
          <div className="tl2">
            {page.happened.map((e, i) => (
              <div className={`ev${i === 0 ? " hot" : ""}`} key={`${e.date}-${i}`}>
                <time>{day(e.date)}</time>
                <span className="k">
                  <i />
                </span>
                <span>{e.text}</span>
              </div>
            ))}
            {!page.happened.length && <p className="empty3">No commits touch its folder.</p>}
          </div>
        </Card>
        {page.kind === "industry" ? (
          <Card icon={<BoxesIcon />} title="Assets and research" count={page.assets.length} src="its folder's sub-folders (names and counts only)">
            <div className="chips2">
              {page.assets.map((a) => (
                <span className="chip2" key={a.name}>
                  <FolderIcon />
                  {a.name} <em>{a.files} files</em>
                </span>
              ))}
              {!page.assets.length && <p className="empty3">Nothing filed in its folder yet.</p>}
            </div>
          </Card>
        ) : (
          <Card icon={<MessageSquareQuoteIcon />} title="Notes" src={page.notes[0]?.src ?? "CLIENTS.json"}>
            {page.notes.map((n) => (
              <p className="quote2" key={n.text}>
                {n.text}
                <small>{n.src}</small>
              </p>
            ))}
            {!page.notes.length && <p className="empty3">No note in CLIENTS.json.</p>}
            {page.assets.length > 0 && (
              <div className="chips2">
                {page.assets.map((a) => (
                  <span className="chip2" key={a.name}>
                    <FolderIcon />
                    {a.name} <em>{a.files}</em>
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
      {page.missing.length > 0 && (
        <p className="notrec" data-testid="entity-missing">
          <b>Not recorded yet</b>
          {page.missing.map((m) => (
            <span key={m.field} title={`It would come from ${m.how}`}>
              {m.field}
            </span>
          ))}
        </p>
      )}
      </>}
      </div>
    </div>
  );
}
