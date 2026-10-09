import { useEffect, useState } from "react";
import { usePersisted } from "@siso/shell";
import type { Agent } from "../../lib/agents";
import { canonName } from "../../lib/a0-tasks";
import { AgentFace } from "../../lib/face";
import { OPEN_PAGE, openLink } from "../ChatView";
import { Fold } from "../PanelFold";
import { ReviewsHistory, useReviewsHistory } from "./ReviewsHistory";
export type { Review } from "./ReviewsHistory";
import "./panel.css";
import "./YourAsks.css";

/** One of his asks, as GET /api/asks serves it (services/node/src/asks.ts). */
export type Ask = {
  id: string;
  words: string;
  quotes: string[];
  count: number;
  domain: string | null;
  files: string[];
  first: string | null;
  last: string | null;
  status: "open" | "answered" | "done";
  answer?: string;
  link?: string;
  owner?: string;
};
type Filter = "open" | "answered" | "all";
/** One page posted to the console for him, as GET /api/reviews serves it (services/node/src/reviews.ts). */
type Tab = "asks" | "reviews";

const DOT: Record<Ask["status"], string> = { open: "is-needs", answered: "is-working", done: "is-done" };
const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
/** Asked more than once and still open: those float to the top; then newest first. */
const rank = (a: Ask) => (a.status === "open" && a.count > 1 ? 0 : 1);
const order = (a: Ask, b: Ask) => rank(a) - rank(b) || (b.last ?? "").localeCompare(a.last ?? "");

/** A list the node serves under `key`, read now and every 30 s; `set` changes it locally until the next read. */
function useList<T>(path: string, key: string) {
  const [list, setList] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const get = () =>
      fetch(path, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((v: Record<string, unknown>) => (setList(Array.isArray(v[key]) ? (v[key] as T[]) : []), setFailed(false)))
        .catch(() => setFailed(true));
    get();
    const t = window.setInterval(get, 30_000);
    return () => window.clearInterval(t);
  }, [path, key]);
  return { list, failed, set: setList };
}

/** A review page opens as an Agent Base tab (App takes OPEN_PAGE); outside the app, the usual link. */
function openInTab(url: string) {
  if (!window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: { url }, cancelable: true }))) return;
  openLink(url);
}
/**
 * Your asks (Shaan, 2 Oct: "I request information ... and then it goes in the chat and it gets lost. It's annoying"):
 * what he asked for, so it does not sink in the chat. A card in the right panel beside Needs you (A0's ask, 3 Oct).
 * Agent Zero's panel holds every ask and every page posted for him; another agent's only those it owns or posted, and
 * none at all hides the card. Folded it peeks "last: …" (the count is on its head); open, his words with a dot for where it stands, who
 * owns it, and the answer or link when there is one; a row expands in place. Its second tab, Reviews, lists the pages
 * posted for him to look at, unopened first.
 */
export function YourAsks({ a }: { a: Agent }) {
  const asksAll = useList<Ask>("/api/asks", "asks");
  const reviewsAll = useReviewsHistory();
  const me = canonName(a.name);
  const mine = (who: string | null | undefined) => !!who && canonName(who) === me;
  const asks = asksAll.list && (a.zero ? asksAll.list : asksAll.list.filter((x) => mine(x.owner)));
  const reviews = reviewsAll.reviews && (a.zero ? reviewsAll.reviews : reviewsAll.reviews.filter((x) => mine(x.by)));
  const failed = asksAll.failed;
  const unopened = (reviews ?? []).filter((r) => !r.opened).length;
  const [tab, setTab] = usePersisted<Tab>("asks-tab", "asks");
  const [filter, setFilter] = usePersisted<Filter>("asks-filter", "open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const all = asks ?? [];
  if (!a.zero && !all.length && !(reviews ?? []).length && !failed && !reviewsAll.failed && asks !== null && reviews !== null) return null;
  const openCount = all.filter((x) => x.status === "open").length;
  const newest = all.slice().sort((x, y) => (y.last ?? "").localeCompare(x.last ?? ""))[0];
  const line = asks === null ? (failed ? "unavailable" : "reading…") : all.length === 0 ? "none yet" : `last: ${short(newest.words, 44)}`;
  const shown = all.filter((x) => filter === "all" || x.status === filter).sort(order);
  const chip = (f: Filter, label: string, n: number) => (
    <button type="button" className="ab-asks__chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
      {label} <span>{n}</span>
    </button>
  );
  return (
    <Fold
      id="asks"
      title="Your asks"
      note={asks === null ? undefined : `${openCount} open`}
      open={false}
      testid="your-asks"
      peek={
        <>
          <span className="ab-asks__line" title={newest?.words}>
            {line}
          </span>
          {unopened > 0 && <b className="ab-asks__rev">· {unopened} to review</b>}
        </>
      }
    >
      <div className="ab-asks">
        <div className="ab-asks__tabs" role="tablist" aria-label="Your asks and reviews">
          <button type="button" role="tab" className="ab-asks__tab" aria-selected={tab === "asks"} onClick={() => setTab("asks")}>
            Asks <span>{openCount}</span>
          </button>
          <button type="button" role="tab" className="ab-asks__tab" aria-selected={tab === "reviews"} onClick={() => setTab("reviews")}>
            Reviews <span>{unopened}</span>
          </button>
        </div>
      {tab === "reviews" && <ReviewsHistory reviews={reviews} failed={reviewsAll.failed} coverage={reviewsAll.coverage} onOpened={reviewsAll.opened} />}
      {tab === "asks" && (
        <>
          <div className="ab-asks__filters" role="group" aria-label="Show asks">
            {chip("open", "Open", openCount)}
            {chip("answered", "Answered", all.filter((a) => a.status === "answered").length)}
            {chip("all", "All", all.length)}
          </div>
          {shown.length === 0 && <p className="ab-asks__empty">{asks === null ? line : filter === "open" ? "Nothing open." : "None here."}</p>}
          <ul className="ab-asks__list">
            {shown.map((a) => {
              const isOpen = expanded === a.id;
              return (
                <li key={a.id} className={`ab-asks__row is-${a.status}${isOpen ? " is-expanded" : ""}`} data-ask={a.id}>
                  <button type="button" className="ab-asks__head" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : a.id)}>
                    <span className={`siso-dot ${DOT[a.status]}`} aria-label={a.status} title={a.status} />
                    <span className="ab-asks__words">{a.words}</span>
                    {a.owner && <AgentFace name={a.owner} status="waiting" size={18} title={a.owner} />}
                  </button>
                  {(a.answer || a.link || a.count > 1) && (
                    <div className="ab-asks__inline">
                      {a.count > 1 && <em className="ab-asks__count">asked {a.count}×</em>}
                      {a.answer && <span className="ab-asks__answer">{a.answer}</span>}
                      {a.link && (
                        <a
                          className="ab-asks__link"
                          href={a.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            openInTab(a.link!);
                          }}
                        >
                          Open
                        </a>
                      )}
                    </div>
                  )}
                  {isOpen && (
                    <div className="ab-asks__more">
                      {a.quotes.length > 0 && (
                        <ul className="ab-asks__quotes">
                          {a.quotes.map((q, i) => (
                            <li key={i}>“{q}”</li>
                          ))}
                        </ul>
                      )}
                      <p className="ab-asks__meta">
                        {[a.domain, a.owner && `owner ${a.owner}`, a.first && (a.first === a.last ? `asked ${day(a.first)}` : `first ${day(a.first)} · last ${day(a.last)}`)].filter(Boolean).join(" · ")}
                      </p>
                      {a.files.length > 0 && <p className="ab-asks__meta">{a.files.join(" · ")}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      </div>
    </Fold>
  );
}
