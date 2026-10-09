import { useEffect, useState } from "react";
import { OPEN_PAGE, openLink } from "../ChatView";
import "./ReviewsHistory.css";

export type ReviewEvent = { kind: "posted" | "opened" | "approved" | "feedback" | "resolved"; at: string | null; text?: string };
export type Review = { id: string; title: string; url: string; by: string | null; at: string | null; opened: boolean; openedAt?: string; verdict: "approved" | "feedback" | "none"; feedback: string | null; history?: ReviewEvent[]; provenance?: { adapter: "native" | "legacy"; agentId: string; sessionId: string; messageId: string; deliveredAt: string; messageAt: string } };
type Reviews = { reviews: Review[]; error?: string; availability?: "available" | "unavailable" | "disabled"; coverage?: string };
export function useReviewsHistory() {
  const [data, setData] = useState<Reviews | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const r = await fetch("/api/reviews", { cache: "no-store" });
        if (!r.ok) throw new Error("Reviews unavailable");
        const v = await r.json() as Reviews;
        if (!Array.isArray(v.reviews)) throw new Error("Invalid reviews");
        if (active) {
          const unavailable = !!v.error || v.availability === "unavailable" || v.availability === "disabled";
          setData(old => unavailable && !v.reviews.length && old?.reviews.length ? { ...v, reviews: old.reviews } : v);
          setFailed(unavailable);
        }
      } catch { if (active) setFailed(true); }
    };
    void read(); const timer = window.setInterval(read, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const opened = async (id: string) => {
    const r = await fetch(`/api/reviews/${encodeURIComponent(id)}/opened`, { method: "POST" });
    if (!r.ok) throw new Error("Opened history could not be saved");
    setData(d => d && ({ ...d, reviews: d.reviews.map(row => row.id === id && !row.opened ? { ...row, opened: true, openedAt: new Date().toISOString(), history: [...(row.history ?? []), { kind: "opened", at: new Date().toISOString() }] } : row) }));
  };
  return { reviews: data?.reviews ?? null, failed, coverage: data?.coverage, opened };
}
const label = { posted: "Posted", opened: "Opened", approved: "Approved", feedback: "Feedback", resolved: "Resolved by agent" };
const date = (at: string | null | undefined) => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded";
function openReview(url: string) {
  if (!window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: { url }, cancelable: true }))) return;
  openLink(url);
}
/** Read-only decision history: only opening a link records an open; no approval control or inferred decisions. */
export function ReviewsHistory({ reviews, failed, coverage, onOpened, onOpen = openReview }: {
  reviews: Review[] | null; failed: boolean; coverage?: string; onOpened: (id: string) => void | Promise<void>; onOpen?: (url: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "unopened" | "opened" | "approved">("all"), [saveError, setSaveError] = useState(false);
  const shown = (reviews ?? []).filter(r => filter === "all" || (filter === "unopened" ? !r.opened : filter === "opened" ? r.opened : r.verdict === "approved"));
  return <section className="ab-review-history" aria-label="Review history">
    <p className="ab-review-history__source">{coverage === "console-and-chat" ? "Console pages and recorded assistant links" : coverage === "chat-deliveries" ? "Recorded assistant links" : "Pages posted to the console"}{coverage === "console-replay" ? " · recent replay; older records may be unavailable" : ""}. Chat capture covers verified deliveries only.</p>
    {failed && <p role="status" className="ab-review-history__notice">Some review sources are unavailable.{!!reviews?.length && " Showing the recorded history still available."}</p>}
    {saveError && <p role="alert" className="ab-review-history__notice">The page opened, but its opened history could not be saved. Try opening it again.</p>}
    {reviews === null ? !failed && <p role="status">Reading review history…</p> : <>
      <div className="ab-review-history__filters" aria-label="Filter reviews">{(["all", "unopened", "opened", "approved"] as const).map(f => <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>
      {!shown.length && !failed && <p className="ab-review-history__empty">{reviews.length ? "No reviews match this filter." : "No review pages recorded."}</p>}
      <ul className="ab-review-history__list">{shown.map(r => <li key={r.id} data-review={r.id}>
        <button type="button" className="ab-review-history__open" onClick={() => {
          onOpen(r.url);
          if (!r.opened) { setSaveError(false); void Promise.resolve().then(() => onOpened(r.id)).catch(() => setSaveError(true)); }
        }}>{r.title}<span aria-hidden>↗</span></button>
        <p className="ab-review-history__meta">{r.by && `${r.by} · `}{r.opened ? "Opened" : "Not opened"}{r.verdict !== "none" && <strong className={`is-${r.verdict}`}> · {r.verdict === "approved" ? "Approved" : "Feedback"}</strong>}</p>
        <details><summary>History · {date(r.at)}</summary>{r.provenance && <p className="ab-review-history__meta">Delivered through {r.provenance.adapter} chat · session {r.provenance.sessionId} · message {r.provenance.messageId}</p>}<ol>{(r.history?.length ? r.history : [{ kind: "posted" as const, at: r.at }, ...(r.opened ? [{ kind: "opened" as const, at: r.openedAt ?? null }] : [])]).map((event, i) => <li key={i}><b>{label[event.kind]}</b><time dateTime={event.at ?? undefined}>{date(event.at)}</time>{event.text && <p>{event.text}</p>}</li>)}</ol></details>
      </li>)}</ul>
    </>}
  </section>;
}
export function ReviewsHistoryPage() {
  const history = useReviewsHistory();
  return <main className="ab-review-history-page"><h1>Reviews</h1><p>Return to pages you were sent and see the recorded responses.</p><ReviewsHistory {...history} onOpened={history.opened} /></main>;
}
