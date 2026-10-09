/**
 * Voice history, lifted from SISO Internal's VoiceHistoryPage: search, the top-app filter, rows newest first grouped
 * by day (Today, Yesterday, weekday, date), click or Return to expand a dictation to its full text, copy, page on.
 * Given a `day` it shows that day only. Read-only.
 */
import { cn } from "@siso/shell";
import { Check, ChevronDown, ChevronRight, Copy, History as HistoryIcon, Mic, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { historyPath, voiceGet, type VoiceEntry, type VoiceHistoryPage, type VoiceSource } from "./api";
import { clock, dayKey, dayLabel, formatGrouped, formatSeconds, timeAgo } from "./format";

const PAGE = 100;

function Row({ entry, open, selected, copied, onToggle, onCopy }: { entry: VoiceEntry; open: boolean; selected: boolean; copied: boolean; onToggle: () => void; onCopy: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const duration = formatSeconds(entry.durationSeconds);
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    onCopy();
  };
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      aria-expanded={open}
      onClick={onToggle}
      data-voice-row={entry.id}
      className={cn(
        "group flex w-full cursor-default items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-sidebar-row-hover",
        selected && "bg-working/[0.06] outline outline-1 -outline-offset-1 outline-working/30",
      )}
    >
      <span className="mt-[3px] grid h-[22px] w-[22px] flex-none place-items-center rounded-[5px] bg-foreground/[0.04] text-muted-foreground">
        <Mic className="h-3 w-3" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10.5px] tabular-nums text-secondary-label" title={new Date(entry.timestamp).toLocaleString("en-GB")}>
            {clock(entry.timestamp)} · {timeAgo(entry.timestamp)}
          </span>
          {entry.app && (
            <span className="rounded-md border border-border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">{entry.app}</span>
          )}
          {entry.intent !== "dictation" && <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-working/80">{entry.intent}</span>}
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {entry.words} words{duration ? ` · ${duration}` : ""}
          </span>
        </span>
        <span className={cn("mt-1 block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground", open ? "select-text" : "line-clamp-2")}>
          {entry.text || <em className="text-muted-foreground">pending…</em>}
        </span>
        {open && entry.raw && entry.raw !== entry.text && (
          <span className="mt-2 block select-text whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">raw: {entry.raw}</span>
        )}
      </span>
      <span className="mt-[3px] flex flex-none items-center gap-2 text-muted-foreground">
        <button
          type="button"
          onClick={copy}
          className={cn("transition-opacity hover:text-foreground group-hover:opacity-100", copied || open ? "opacity-100" : "opacity-0")}
          aria-label="Copy dictation"
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-done" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden />}
      </span>
    </div>
  );
}

/** A page of the history: `day` (yyyy-MM-dd) limits it to one day, `query` seeds the search. */
export function VoiceHistory({ day, query, source, className }: { day?: string; query?: string; source?: VoiceSource; className?: string }) {
  const [text, setText] = useState(query ?? "");
  const [q, setQ] = useState((query ?? "").trim());
  const [app, setApp] = useState<string | null>(null);
  const [page, setPage] = useState<VoiceHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | string | null>(null);
  const [sel, setSel] = useState(-1);
  const [copiedId, setCopiedId] = useState<number | string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const moreRef = useRef(false);
  const base = source?.base;
  const fetchJson = source?.fetchJson;

  useEffect(() => {
    setText(query ?? "");
    setQ((query ?? "").trim());
  }, [query]);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 200);
    return () => window.clearTimeout(t);
  }, [text]);

  // A new day, search or app filter starts again from the newest.
  useEffect(() => {
    ++generation.current;
    let cancelled = false;
    setLoading(true);
    moreRef.current = false;
    setMore(false);
    setOpenId(null);
    setSel(-1);
    voiceGet({ base, fetchJson }, historyPath({ limit: PAGE, q: q || undefined, app, day }))
      .then((d) => {
        if (cancelled) return;
        setPage(d as VoiceHistoryPage);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && (setPage(null), setError(e instanceof Error ? e.message : String(e))))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [day, q, app, base, fetchJson]);

  const loadMore = async () => {
    if (!page || moreRef.current) return;
    const current = generation.current;
    moreRef.current = true;
    setMore(true);
    try {
      const next = (await voiceGet({ base, fetchJson }, historyPath({ limit: PAGE, offset: page.entries.length, q: q || undefined, app, day }))) as VoiceHistoryPage;
      if (generation.current !== current) return;
      setPage((p) => (p ? { ...next, entries: [...p.entries, ...next.entries] } : next));
    } catch (e) {
      if (generation.current === current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation.current === current) {
        moreRef.current = false;
        setMore(false);
      }
    }
  };

  const entries = useMemo(() => page?.entries ?? [], [page]);
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: Array<{ entry: VoiceEntry; idx: number }> }> = [];
    entries.forEach((entry, idx) => {
      const key = dayKey(new Date(entry.timestamp));
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push({ entry, idx });
      else out.push({ key, label: dayLabel(key), items: [{ entry, idx }] });
    });
    return out;
  }, [entries]);

  const copyEntry = useCallback(async (entry: VoiceEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1200);
    } catch {
      /* the clipboard can refuse outside a user gesture; nothing to do */
    }
  }, []);

  // The native HistoryView's keys, kept to this pane: ↑/↓ move, Return expands, ⌘C copies the selected one, ⌘F searches.
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (e.target instanceof HTMLInputElement || entries.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && sel >= 0) {
      e.preventDefault();
      const id = entries[sel].id;
      setOpenId((c) => (c === id ? null : id));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && sel >= 0 && !window.getSelection()?.toString()) {
      e.preventDefault();
      void copyEntry(entries[sel]);
    }
  };

  const filtered = Boolean(q || app);
  const pill = (active: boolean) =>
    cn(
      "rounded-[var(--crm-radius-pill)] border px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors",
      active ? "border-working/40 bg-working/[0.12] text-working" : "border-border text-muted-foreground hover:bg-sidebar-row-hover hover:text-foreground",
    );

  return (
    <div className={cn("flex flex-col gap-3 outline-none", className)} tabIndex={0} onKeyDown={onKey} data-voice="history">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={day ? `Search ${dayLabel(day)}…` : "Search everything you've said…"}
            aria-label="Search dictations"
            className="w-full rounded-[var(--crm-radius-control)] border border-border bg-page py-2 pl-9 pr-3 text-[13px] text-foreground select-text placeholder:text-muted-foreground focus:border-working/40 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setApp(null)} className={pill(app === null)}>
            All
          </button>
          {(page?.apps ?? []).map(({ app: name, n }) => (
            <button key={name} type="button" onClick={() => setApp(app === name ? null : name)} className={pill(app === name)} title={`${formatGrouped(n)} dictations, all time`}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--crm-radius-card)] border border-border bg-raised">
        {error && <p className="px-4 py-6 text-[13px] text-muted-foreground">Voice is not answering: {error}</p>}
        {!error && loading && !page && <p className="px-4 py-6 text-[13px] text-muted-foreground">Reading the record…</p>}
        {!error && !loading && groups.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <HistoryIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-[13.5px] font-medium text-foreground">{filtered ? "No matches" : day ? "Nothing that day" : "No history yet"}</p>
            <p className="text-[12px] text-muted-foreground">{filtered ? "Try a different search or app." : "Everything you say lands here."}</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            {!day && (
              <header className="sticky top-0 z-10 border-b border-border bg-raised/95 px-4 py-1.5 font-mono text-3xs uppercase tracking-[0.16em] text-muted-foreground backdrop-blur">
                {g.label} · {g.items.length}
              </header>
            )}
            <div className="divide-y divide-border">
              {g.items.map(({ entry, idx }) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  open={openId === entry.id}
                  selected={idx === sel}
                  copied={copiedId === entry.id}
                  onToggle={() => {
                    setSel(idx);
                    setOpenId((c) => (c === entry.id ? null : entry.id));
                  }}
                  onCopy={() => void copyEntry(entry)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          {page ? `showing ${formatGrouped(entries.length)} of ${formatGrouped(page.total)}` : ""}
          <span className="ml-3 hidden opacity-60 lg:inline">↑↓ move · return expand · ⌘C copy · ⌘F search</span>
        </span>
        {page && page.total > entries.length && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={more}
            className="rounded-[var(--crm-radius-pill)] border border-border px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground disabled:opacity-50"
          >
            {more ? "loading…" : "load more"}
          </button>
        )}
      </div>
    </div>
  );
}
