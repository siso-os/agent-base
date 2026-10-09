import { useEffect, useState } from "react";
import { Peek } from "@siso/shell";
import { useVersion } from "../lib/useVersion";
import { ShippedCard } from "./UpdateToast";
import { Toast } from "./ToastStack";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type Branch, type Commit, type Note, type Release, kindLabel, lastSeen, markSeen, openWhatsNew, unseenCount, useReleasesState, useLandingState, useShippingState, useUnseenCount, whenWords } from "../lib/releases";
import "./WhatsNew.css";
import { EvidenceLightbox } from "./panel/LandedRows";

/** Lines a card shows before "All N changes" (the brief: three to eight readable lines). */
const SHOWN = 6;

/** Each change once, in the order it landed: two commits saying the same thing read as one line. */
const linesOf = (commits: Commit[]) => [...new Set(commits.map((c) => c.line))];

function Lines({ commits, all }: { commits: Commit[]; all: boolean }) {
  if (all) {
    return (
      <ul className="ab-wn__all" data-testid="wn-all">
        {commits.map((c) => (
          <li key={c.sha}>
            <code>{c.sha.slice(0, 7)}</code>
            <span className="ab-wn__subject">{c.subject}</span>
            <span className="ab-wn__who">{[c.tag, c.author].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="ab-wn__lines">
      {linesOf(commits).slice(0, SHOWN).map((l) => (
        <li key={l} data-testid="wn-line">{l}</li>
      ))}
    </ul>
  );
}

/** The owner's release note above the commit lines: the title, why (his words), what changed, how to see it. */
function NoteBlock({ note }: { note: Note }) {
  return (
    <div className="ab-wn__note" data-testid="wn-note">
      <b>{note.title}</b>
      {note.why && <p className="ab-wn__why">{note.why}</p>}
      {!!note.what?.length && <ul>{note.what.map((w) => <li key={w}>{w}</li>)}</ul>}
      {note.see && <p className="ab-wn__see">See it: {note.see}</p>}
    </div>
  );
}

export function ReleaseEvidenceBlock({ r }: { r: Release }) {
  const [image, setImage] = useState<{ title: string; shots: { before: string; after: string }; side: number } | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const pairs = r.evidence?.pairs ?? [];
  return <section className="ab-wn__evidence" aria-label="Release screenshots">
    {!pairs.length ? <p className="ab-wn__quiet" data-testid="wn-evidence-unavailable">Before/after screenshots unavailable for this release.</p> : pairs.map(pair => <div key={pair.id} className="ab-wn__evidence-pair">
      <h3>{pair.title}{pair.viewport && <small>{pair.viewport.width} × {pair.viewport.height}</small>}</h3>
      <div>{(["before", "after"] as const).map((side, i) => <button type="button" key={side} aria-label={`${i ? "After" : "Before"}: ${pair.title}`} onClick={() => setImage({ title: pair.title, shots: pair, side: i })}>
        {failed[`${pair.id}:${side}`] ? <span className="ab-wn__image-missing">Image unavailable</span> : <img src={pair[side]} alt={`${i ? "After" : "Before"}: ${pair.title}`} loading="lazy" onError={() => setFailed(v => ({ ...v, [`${pair.id}:${side}`]: true }))} />}
        <span>{i ? "After" : "Before"} <code>{(i ? pair.afterSha : pair.beforeSha).slice(0, 7)}</code></span>
      </button>)}</div>
    </div>)}
    {!!pairs.length && r.evidence?.reason && <p className="ab-wn__quiet">{r.evidence.reason}</p>}
    {image && <EvidenceLightbox task={image} side={image.side} onClose={() => setImage(null)} />}
  </section>;
}

function ReleaseCard({ r, fresh }: { r: Release; fresh: boolean }) {
  const [all, setAll] = useState(false);
  const more = r.commits.length > Math.min(SHOWN, linesOf(r.commits).length);
  return (
    <article className={`siso-panel ab-wn__card${fresh ? " is-new" : ""}`} data-testid="wn-release" data-sha={r.sha}>
      <header>
        <b>v{r.version}</b>
        <code>{r.sha.slice(0, 7)}</code>
        {r.kinds.map((k) => <span key={k} className="ab-wn__kind">{kindLabel(k)}</span>)}
        <time dateTime={Number.isFinite(Date.parse(r.at)) ? r.at : undefined} title={Number.isFinite(Date.parse(r.at)) ? new Date(r.at).toLocaleString() : "Time unavailable"}>{whenWords(r.at)}</time>
      </header>
      {r.note && <NoteBlock note={r.note} />}
      <ReleaseEvidenceBlock r={r} />
      {r.commits.length ? <Lines commits={r.commits} all={all} /> : <p className="ab-wn__quiet">A redeploy: no new changes to list.</p>}
      {(more || all) && (
        <button type="button" className="ab-wn__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          {all ? "Fewer" : `All ${r.commits.length} changes`}
        </button>
      )}
    </article>
  );
}

/** Branches a card shows before "All N branches". */
const BRANCHES_SHOWN = 8;

/**
 * Not landed (Shaan, 3 Oct 14:15: "we clearly don't have a good way of seeing what was achieved last night"): every
 * origin branch with commits main does not carry, newest first, with its lane, its count and how long ago it moved.
 */
function NotLanded({ branches, parked }: { branches: Branch[]; parked: Branch[] }) {
  const [all, setAll] = useState(false), [parkedOpen, setParkedOpen] = useState(false);
  const shown = all ? branches : branches.slice(0, BRANCHES_SHOWN);
  return (
    <section className="siso-panel ab-wn__card is-pending" data-testid="wn-not-landed" aria-label="Not landed">
      <header>
        <b>Not landed</b>
        <span className="ab-wn__badge">{branches.length}</span>
        <time>{branches.length ? "branches someone means to land" : "nothing waiting to land"}</time>
      </header>
      <ul className="ab-wn__all">
        {shown.map((b) => (
          <li key={b.branch} data-testid="wn-branch" data-branch={b.branch}>
            {b.lane && <span className="ab-wn__kind">{b.lane}</span>}
            <code title={b.sha}>{b.branch}</code>
            <span className="ab-wn__subject" title={b.subject}>{b.subject}</span>
            {b.why && <span className="ab-wn__who" data-testid="wn-branch-why">{b.why}</span>}
            <span className="ab-wn__who" data-testid="wn-branch-count">{b.commits} {b.commits === 1 ? "commit" : "commits"}</span>
            <time className="ab-wn__who" dateTime={Number.isFinite(Date.parse(b.at)) ? b.at : undefined} title={`${b.author} · ${Number.isFinite(Date.parse(b.at)) ? new Date(b.at).toLocaleString() : "Time unavailable"}`}>{whenWords(b.at)}</time>
          </li>
        ))}
      </ul>
      {branches.length > BRANCHES_SHOWN && (
        <button type="button" className="ab-wn__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          {all ? "Fewer" : `All ${branches.length} branches`}
        </button>
      )}
      {/* 9 Oct: evidence, archives and lanes nobody is landing are not work waiting to ship; they fold here with why. */}
      {parked.length > 0 && <>
        <button type="button" className="ab-wn__more" aria-expanded={parkedOpen} onClick={() => setParkedOpen((v) => !v)}>
          {parkedOpen ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          Parked ({parked.length})
        </button>
        {parkedOpen && <ul className="ab-wn__all" data-testid="wn-parked">
          {parked.map((b) => <li key={b.branch} data-branch={b.branch}>
            <code title={b.sha}>{b.branch}</code>
            <span className="ab-wn__subject" title={b.subject}>{b.why}</span>
            <time className="ab-wn__who" dateTime={Number.isFinite(Date.parse(b.at)) ? b.at : undefined}>{whenWords(b.at)}</time>
          </li>)}
        </ul>}
      </>}
    </section>
  );
}

/**
 * What's new (Shaan, 3 Oct 04:30): every build that went live, newest first, each a card of what it brought; a line
 * where he last left off, with how many came since; and what is on main but not live yet. Opening the page marks the
 * newest one seen; the line stays where it was until he comes back.
 */
export function WhatsNewPage() {
  const { data, error: releasesError } = useReleasesState();
  const { data: landing, error: landingError } = useLandingState();
  const [seen] = useState(lastSeen);
  const newest = data?.releases[0]?.sha;
  useEffect(() => {
    if (newest) markSeen(newest);
  }, [newest]);
  if (!data) return <p className="ab-wn__quiet px-6 py-4" role="status">{releasesError ? `Deployment history unavailable (${releasesError}).` : "Reading the deploy log…"}</p>;
  const { releases, pending } = data;
  const unseen = unseenCount(releases, seen);
  return (
    <div className="ab-wn" data-testid="whats-new">
      <header className="ab-wn__head">
        <div className="ab-wn__kicker">Agent Base</div>
        <h1>What’s new</h1>
        <p>Recorded deployments, newest first. Deployment records do not verify the running app.</p>
        {releasesError && <p role="status">Deployment history could not be refreshed ({releasesError}). Previously loaded records may be stale.</p>}
        {landingError && <p role="status">Branch and live comparison could not be refreshed ({landingError}). Previously loaded comparisons may be stale.</p>}
        {!!landing?.live.behind && (
          <p className="ab-wn__behind" data-testid="wn-behind">
            Live is <b>{landing.live.behind}</b> {landing.live.behind === 1 ? "commit" : "commits"} behind main
            <code title={`live ${landing.live.sha} · main ${landing.live.main}`}>{landing.live.sha.slice(0, 7)}</code>
          </p>
        )}
      </header>
      {pending.commits.length > 0 && (
        <section className="siso-panel ab-wn__card is-pending" data-testid="wn-pending" aria-label="Since the last recorded deployment">
          <header>
            <b>Since the last recorded deployment</b>
            <span className="ab-wn__badge">{pending.commits.length}</span>
            <time>on {pending.ref}</time>
          </header>
          {pending.note && <NoteBlock note={pending.note} />}
          <Lines commits={pending.commits} all={false} />
        </section>
      )}
      {!!(landing?.branches.length || landing?.parked?.length) && <NotLanded branches={landing.branches} parked={landing.parked ?? []} />}
      {releases.length === 0 && <p className="ab-wn__quiet" data-testid="wn-empty">No deployments recorded in this log.</p>}
      {releases.map((r, i) => (
        <div key={`${r.version}:${r.sha}`} className="contents">
          {i === unseen && unseen > 0 && (
            <div className="ab-wn__divider" role="separator" data-testid="wn-divider">
              <span>
                <span className="ab-wn__badge" data-testid="wn-divider-count">{unseen}</span> new since you were last here ↑
              </span>
            </div>
          )}
          <ReleaseCard r={r} fresh={i < unseen} />
        </div>
      ))}
    </div>
  );
}

/** The way in from the Shipped card and Stats: "What's new", with how many builds went live since his last visit. */
export function WhatsNewLink({ testid = "whats-new-link" }: { testid?: string }) {
  const n = useUnseenCount();
  return (
    <button type="button" className="ab-wn-link" data-testid={testid} onClick={openWhatsNew}>
      What’s new{n > 0 && <span className="ab-wn__badge" aria-label={`${n} new`}>{n}</span>} ›
    </button>
  );
}

/**
 * The top bar's version pill (Shaan, 3 Oct 14:15: one click from the top of the app to What's new): the live build's
 * recorded version, with builds since his last visit or how far live is behind main. The deployment log does not identify the running app.
 * t-0570 (Shaan, 9 Oct: "when you click the recorded thing to show the version that should be a pop-up not take you to a new
 * page"): a click opens the newest releases in a pop-up; "All releases" still opens the page. A waiting build is offered here
 * too, so the floating Version pill over the composer is gone ("there's this pinned versions thing hanging around I hate").
 */
export function VersionPill() {
  const { data, error: releasesError } = useReleasesState();
  const { data: landing, error: landingError } = useLandingState();
  const n = useUnseenCount();
  const version = data?.releases[0]?.version;
  const behind = landing?.live.behind ?? 0;
  const { data: shipping, error: shippingError } = useShippingState();
  const build = useVersion();
  const [open, setOpen] = useState(false);
  const next = version && !releasesError ? `v${version + 1}` : "Next build";
  const note = data?.pending.note?.title;
  const ready = build.update?.kind === "web";
  const waiting = build.update ? (build.update.changes.length ? build.update.changes.map(c => c.subject) : build.update.subjects) : [];
  const said = [version ? `Latest recorded deployment: version ${version}` : "What's new", ready ? "new build ready" : "", releasesError ? "deployment history may be stale" : "", landingError ? "live comparison may be stale" : "", shippingError ? `Shipping status unavailable (${shippingError})` : "", shipping ? `${next} ${shipping.state}${note ? `: ${note}` : ""}` : "", n ? `${n} new` : "", behind ? `live ${behind} behind main` : "", landing?.branches.length ? `${landing.branches.length} not landed` : ""].filter(Boolean).join(" · ");
  const shown = data?.releases.slice(0, Math.max(1, Math.min(3, n))) ?? [];
  const newest = data?.releases[0]?.sha;
  const toggle = (value: boolean) => { setOpen(value); if (value && newest) markSeen(newest); };
  return (
    <>
      <Peek title={version ? `v${version}` : "What’s new"} hoverOpens={false} open={open} onOpenChange={toggle} className="ab-version-peek" testId="version-peek" content={({ close }) => (
        <div className="ab-version-pop" data-testid="version-pop">
          {build.update && <section className="ab-version-pop__ready" data-testid="version-ready">
            <header><i aria-hidden /><b>{ready ? "New build ready" : "Desktop update"}</b>{waiting.length > 0 && <span>{waiting.length} {waiting.length === 1 ? "change" : "changes"}</span>}
              {ready && <button type="button" disabled={build.applying} onClick={build.reload}>{build.applying ? "Reloading…" : "Reload"}</button>}
              <button type="button" className="is-quiet" onClick={build.dismiss}>Later</button></header>
            {!ready && <p>Desktop changes need an app rebuild; reloading the page does not apply them.</p>}
            {waiting.length > 0 && <ul>{waiting.slice(0, 3).map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>}
          </section>}
          {build.error && !build.update && <p className="ab-wn__quiet" role="status">Update check unavailable; the running build is unchanged.</p>}
          {!data ? <p className="ab-wn__quiet" role="status">{releasesError ? `Deployment history unavailable (${releasesError}).` : "Reading the deploy log…"}</p>
            : shown.length ? shown.map(r => <ReleaseCard key={`${r.version}:${r.sha}`} r={r} fresh={false} />) : <p className="ab-wn__quiet">No deployments recorded in this log.</p>}
          {shipping && <p className="ab-version-pop__ship" data-state={shipping.state}><i aria-hidden />{next} {shipping.state}{note ? `: ${note}` : ""}</p>}
          <footer>{behind > 0 && <span className="ab-version-pill__behind">Live is {behind} behind main</span>}<button type="button" className="ab-wn-link" onClick={() => { close(); openWhatsNew(); }}>All releases ›</button></footer>
        </div>
      )}>
        <button type="button" className="ab-version-pill" data-testid="version-pill" data-ready={ready || undefined} aria-label={`${said}: show the latest release`} title={said}>
          {ready && <i className="ab-version-pill__ready" aria-hidden />}
          {/* t-0532 item 8 (Shaan, 8 Oct ~10:15: "it doesn't need to say recorded it could just be the version number"): the
              number alone; "latest recorded deployment" stays in its title and label, where it is still true. */}
          <b>{version ? `v${version}` : "What’s new"}</b>
          {/* t-0532 item 9 ("where it says 9 behind I don't like"): no counts on the bar. New releases are a dot; how far live is
              behind main is in the pop-up's footer. */}
          {shippingError ? <span data-testid="version-shipping-unavailable">Shipping unavailable</span> : shipping ? <span className="ab-version-pill__ship" data-testid="version-shipping" data-state={shipping.state}><i aria-hidden />{next} {shipping.state}</span> : n > 0 ? <i className="ab-version-pill__new" data-testid="version-new" aria-hidden /> : null}
        </button>
      </Peek>
      {build.shipped && <Toast kind="shipped"><ShippedCard shipped={build.shipped} onClose={build.clearShipped} /></Toast>}
    </>
  );
}
