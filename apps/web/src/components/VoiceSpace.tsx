import "./VoiceSpace.css";
import "../../../../packages/siso-shell/src/halo-rim/halo-rim.css";
import { cn } from "@siso/shell";
import { VoiceCalendar, VoiceDictionary, VoiceHistory, VoiceSettings, VoiceStats, dayLabel, formatGrouped, timeAgo, useVoiceActivity, useVoiceStats, useVoiceStatus, voiceRestart, type VoiceEntry, type VoiceStatus } from "@siso/voice";
import { ArrowUpRightIcon, BookOpenTextIcon, ChartColumnIcon, CheckIcon, CopyIcon, HistoryIcon, HouseIcon, RotateCcwIcon, Settings2Icon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { LivingIcon } from "../../../../packages/halo-face/living-assets";
import { refresh, useSharedState } from "../lib/poll";

/**
 * The Voice space, v2 (ui-hub/voice/v2/SPEC.md, t-0500). Shaan, 7 Oct: "the exact same voice app i have just remade with
 * opus way nicer way cleaner way better". One app: the floating bar and the hotkey live in Agent Base's native helper
 * (apps/desktop/native_dictation.swift); this page is its home, its record and its settings. History and stats read SISO
 * Voice's store and Agent Base's together (services/node/src/voice.ts).
 *
 * `selected` is "home", "history", "stats", "dictionary", "settings" or a day as yyyy-MM-dd.
 */
export type VoiceSelection = "home" | "history" | "stats" | "dictionary" | "settings" | (string & {});

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** v1 saved "dictation" for the page that is now Home. */
const pageOf = (s: string) => (s === "dictation" ? "home" : s);

const PAGES: Array<{ id: VoiceSelection; label: string; Icon: LucideIcon }> = [
  { id: "home", label: "Home", Icon: HouseIcon },
  { id: "history", label: "History", Icon: HistoryIcon },
  { id: "stats", label: "Stats", Icon: ChartColumnIcon },
  { id: "dictionary", label: "Dictionary", Icon: BookOpenTextIcon },
  { id: "settings", label: "Settings", Icon: Settings2Icon },
];

/** /api/dictation/status: who holds the hotkey, the helper's live phase, the bar. */
export type DictationStatus = {
  owner: "agent-base" | "siso-voice";
  switching: boolean;
  phase: string;
  error: string;
  hotkey: string;
  bar?: boolean;
  native: { registered: boolean; permission: boolean; updatedAt: number; error: string; tap?: boolean; mic?: string; device?: string; issue?: string };
  /** The node's self-check (dictation.ts `dictationHealth`, 9 Oct): ok, or the one thing that is wrong. */
  health?: { level: "ok" | "warn" | "bad"; line: string; pending: number; device: string; lastTake: { at: string; outcome: string; seconds: number } | null };
};
const STATUS = "/api/dictation/status";
export const useDictation = () => useSharedState<DictationStatus>(STATUS, 5000);

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Voice did not answer");
  return data as T;
}

/** How a state reads: green ready, pink live (the only one that moves), amber waiting on something, red a problem (still). */
type Tone = "good" | "live" | "warn" | "bad" | "quiet";
type VoiceState = { key: string; word: string; line: string; help?: string; tone: Tone };
const HOWTO = "Tap right ⌥ (or click the bar) to start, tap again to finish; hold Fn to talk while it is held. It cleans up what you said, types it where you were, and puts your clipboard back.";
/** The helper checks in on every owner poll; this long without a word and it is not running. */
const DOWN_MS = 30_000;
const live = (key: string) => key === "listening" || key === "writing";

/** What to do about the helper's last error, in one line (the error itself comes from native_dictation.swift or the node). */
function remedy(error: string) {
  if (/microphone|input device/i.test(error)) return "Allow Agent Base Voice in System Settings › Privacy & Security › Microphone, then press right ⌥ again.";
  if (/silence|no speech/i.test(error)) return "Nothing is broken: speak a little longer, then press right ⌥ again.";
  if (/saved|queued|retr/i.test(error)) return "The recording is kept and is tried again by itself.";
  return "Press right ⌥ to try again.";
}

/**
 * Where his voice stands, in words: the one state the bar picture, the home hero and the side nav share (voice lane,
 * 9 Oct). Read from /api/dictation/status as the native helper reports it: its phase, its last error, its permission and
 * when it last checked in. Problems say what is wrong and what to do; nothing here is guessed.
 */
function stateOf(s: DictationStatus | null, now = Date.now()): VoiceState {
  if (!s) return { key: "loading", word: "Reading…", line: "Reading Voice's state…", tone: "quiet" };
  if (s.owner !== "agent-base") return { key: "elsewhere", word: "In SISO Voice", line: "Your hotkey still runs the old SISO Voice app.", tone: "warn" };
  if (["recording", "starting"].includes(s.phase)) return { key: "listening", word: "Listening", line: "Listening. Tap right ⌥ again to finish.", help: "Esc on the bar throws it away. Your words land where your cursor is.", tone: "live" };
  if (["transcribing", "pasting"].includes(s.phase)) return { key: "writing", word: "Writing", line: "Writing it out…", help: "Cleaning up what you said, then typing it where your cursor was.", tone: "live" };
  const quiet = now - s.native.updatedAt;
  if (quiet >= DOWN_MS) return { key: "down", word: "Not running", line: "The voice engine is not running.", help: `It restarts by itself within a few seconds (last checked in ${s.native.updatedAt ? `${since(quiet)} ago` : "never"}). Still like this in a minute? Quit and reopen Agent Base.`, tone: "bad" };
  if (!s.native.registered) return { key: "connecting", word: "Starting", line: "Voice is starting: taking right ⌥…", help: s.native.error || "This takes a second or two.", tone: "warn" };
  if (!s.native.permission) return { key: "access", word: "Needs access", line: "Voice needs Accessibility to type for you.", help: s.native.error || "Turn on Agent Base Voice in System Settings › Privacy & Security › Accessibility. It notices by itself.", tone: "warn" };
  if (s.phase === "error") return { key: "error", word: "Last take failed", line: s.error || "The last dictation did not finish.", help: remedy(s.error), tone: "bad" };
  if (s.health?.level === "bad") return { key: "trouble", word: "Not hearing", line: "Voice is not hearing you right now.", help: s.health.line, tone: "bad" };
  return { key: "ready", word: "Ready", line: "Ready. Press right ⌥ in any app.", tone: "good" };
}

const since = (ms: number) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`);

/**
 * The one honest line (9 Oct, after "voice app is brokens its not hearing naything"): working, with when it last heard
 * him and on which mic, or exactly what is wrong. Read from the node's self-check, never guessed in the page.
 */
function VoiceCheck({ status }: { status: DictationStatus | null }) {
  if (!status || status.owner !== "agent-base") return null;
  const h = status.health;
  const fresh = Date.now() - status.native.updatedAt < 30_000;
  const level = !fresh ? "bad" : h?.level ?? "ok";
  const mic = h?.device ? ` · ${h.device}` : "";
  const last = h?.lastTake ? ` · last heard you ${timeAgo(h.lastTake.at)}` : "";
  const line = !fresh ? (status.native.error || "The voice helper is not checking in.") : level === "ok" ? `Working${last}${mic}` : h?.line ?? "";
  return (
    <p className={cn("vx-check", `is-${level}`)} role={level === "bad" ? "alert" : "status"} data-testid="voice-check" data-level={level}>
      <span className="vx-dot" aria-hidden="true" />{line}
    </p>
  );
}

export function VoiceSidebar({ selected, onSelect }: { selected: VoiceSelection; onSelect: (s: VoiceSelection) => void }) {
  const activity = useVoiceActivity(366);
  const { data: status } = useDictation();
  const state = stateOf(status);
  const days = activity.data?.days;
  const total = days ? Object.values(days).reduce((n, c) => n + c, 0) : undefined;
  const dayCount = days ? Object.keys(days).length : undefined;
  const page = pageOf(selected);
  return (
    <aside className={cn("vx-side siso-rim", live(state.key) ? "is-working" : "is-idle")} aria-label="Voice">
      <div className="vx-brand">
        <LivingIcon name="siso-voice" size={26} variant="glyph" active={state.key === "listening"} />
        <h1>Voice</h1>
        <span className={cn("vx-pill", `is-${state.key}`, `tone-${state.tone}`)} title={state.help ? `${state.line} ${state.help}` : state.line} data-testid="voice-pill"><span className="vx-dot" aria-hidden="true" />{state.word}</span>
      </div>
      <nav aria-label="Voice pages" className="vx-nav">
        {PAGES.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-current={page === id ? "page" : undefined} onClick={() => onSelect(id)} className="vx-nav-row">
            <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>{label}</span>
            {id === "history" && total !== undefined && <b>{formatGrouped(total)}</b>}
          </button>
        ))}
      </nav>
      <div className="vx-section-label">Days{dayCount !== undefined && <b>{dayCount} spoken</b>}</div>
      <div className="vx-cal">
        {!days && !activity.error && <div className="vx-faint">Reading your days…</div>}
        {activity.error && <div role="status" className="vx-faint">History is not readable: {activity.error}</div>}
        {days && <VoiceCalendar days={days} selected={isDay(selected) ? selected : undefined} onSelect={onSelect} />}
      </div>
      <footer className="vx-foot">
        <span>{status?.owner === "agent-base" ? "Right ⌥ · Agent Base" : "Right ⌥ · SISO Voice"}</span>
        <span>{status?.owner === "agent-base" ? (status.bar === false ? "Bar hidden" : "Bar on") : <VoiceHealth />}</span>
      </footer>
    </aside>
  );
}

const NAMES: Record<string, string> = { "com.siso.voice.runtime": "SISO Voice", "com.siso.voice-sync": "Sync", "com.siso.agent-base.voice": "Voice helper" };

/** "up" (every service as it should be), "kicked" (one was down and the node restarted it), "down", or "unknown". */
export function voiceHealth(s: VoiceStatus | null): "up" | "kicked" | "down" | "unknown" {
  if (!s?.watching || s.services.length === 0) return "unknown";
  if (s.services.every((x) => x.ok)) return s.services.some((x) => x.lastKickOk && Date.now() - Date.parse(x.lastKick ?? "") < 10 * 60_000) ? "kicked" : "up";
  return "down";
}

/** SISO Voice's launchd services while it still holds the hotkey (t-0271): a word, and "Restart" when one is down. */
function VoiceHealth() {
  const [refreshN, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, error } = useVoiceStatus(undefined, 30_000, refreshN);
  const health = error ? "offline" : !data ? "loading" : voiceHealth(data);
  const words = { loading: "…", up: "running", kicked: "restarted", down: "down", unknown: "not watched", offline: "node not answering" }[health];
  const detail = data?.services.map((x) => `${NAMES[x.label] ?? x.label}: ${x.ok ? "running" : "not running"}`).join("\n");
  return (
    <span className="vx-health" title={detail} data-testid="voice-health" data-health={health}>
      SISO Voice {words}
      {health === "down" && (
        <button type="button" disabled={busy} aria-label="Restart SISO Voice" data-testid="voice-restart" onClick={async () => { setBusy(true); try { await voiceRestart(); } catch { /* the word says it */ } setBusy(false); setRefresh((n) => n + 1); }}>
          <RotateCcwIcon size={11} aria-hidden="true" className={busy ? "vx-spin" : undefined} />
        </button>
      )}
    </span>
  );
}

const TITLE: Record<string, string> = { home: "Voice", history: "History", stats: "Stats", dictionary: "Dictionary", settings: "Settings" };
const SUB: Record<string, string> = {
  history: "Everything you have said, newest first, from SISO Voice and Agent Base.",
  stats: "How much you talk instead of type.",
  dictionary: "Teach it your names and words, and fix what it mishears.",
  settings: "The bar, the hotkey, and how your words are written.",
};

export function VoiceMain({ selected }: { selected: VoiceSelection }) {
  const day = isDay(selected) ? selected : undefined;
  const page = day ? "day" : TITLE[pageOf(selected)] ? pageOf(selected) : "home";
  return (
    <div className="vx-main" data-testid="voice-main">
      <div className="vx-page">
        {page !== "home" && (
          <header className="vx-head">
            <h1>{day ? dayLabel(day) : TITLE[page]}</h1>
            <p>{day ? parseLong(day) : SUB[page]}</p>
          </header>
        )}
        {page === "home" ? <VoiceHome /> : page === "stats" ? <VoiceStats /> : page === "dictionary" ? <VoiceDictionary /> : page === "settings" ? <><BarAndHotkey /><GroqKeyCard /><DiagnosticsGate /><VoiceSettings /></> : <VoiceHistory key={day ?? "all"} day={day} />}
      </div>
    </div>
  );
}

/**
 * The native bar, drawn in CSS: what he will see floating over his apps. Only the real live bar moves (its waves on
 * transform); the sample of "while you talk" is drawn still, so an idle page animates nothing (9 Oct, the 2-core ask).
 */
function BarPicture({ state, sample = false }: { state: string; sample?: boolean }) {
  const on = live(state);
  const off = !on && state !== "idle";
  const n = on ? 34 : 13;
  return (
    <div className={cn("vx-bar", on ? `is-${state}` : off ? "is-off" : "is-idle", sample && "is-sample")} aria-hidden="true">
      <i className="vx-bar-dot" />
      <span className="vx-bar-wave">
        {Array.from({ length: n }, (_, i) => {
          const t = i / (n - 1);
          // The resting trace is a soft hump; the still sample is a frozen voice; a live one breathes (CSS, a beat apart).
          const rest = 2 + 6 * Math.sin(Math.PI * t) ** 2 * (0.6 + 0.4 * Math.sin(i * 1.7));
          const said = 3 + 17 * t * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.3)));
          return <span key={i} style={{ ["--i" as string]: i, ["--t" as string]: t, height: on && !sample ? undefined : `${(on ? said : rest).toFixed(1)}px` }} />;
        })}
      </span>
      {state === "listening" ? <><em>0:07</em><i className="vx-bar-x" /><i className="vx-bar-stop"><CheckIcon size={13} strokeWidth={3} /></i></> : state === "writing" ? <em className="is-word">Writing…</em> : off ? <em className="is-word">Off</em> : <kbd>⌥</kbd>}
    </div>
  );
}

const OFF_CAPTION: Record<string, string> = { down: "The bar is not showing", connecting: "The bar is starting", access: "The bar waits for access", error: "The last take failed", trouble: "The bar is not hearing you" };

/** The hero's stage: the bar waiting and a still picture of it while he talks; while he really talks, the live one. */
function BarStage({ state }: { state: VoiceState }) {
  if (live(state.key)) return <div className="vx-hero-stage"><figure><BarPicture state={state.key} /><figcaption>{state.key === "listening" ? "Listening now" : "Writing it out"}</figcaption></figure></div>;
  if (OFF_CAPTION[state.key]) return <div className="vx-hero-stage"><figure><BarPicture state={state.key} /><figcaption>{OFF_CAPTION[state.key]}</figcaption></figure></div>;
  return (
    <div className="vx-hero-stage">
      <figure><BarPicture state="idle" /><figcaption>Waiting, anywhere you put it</figcaption></figure>
      <figure><BarPicture state="listening" sample /><figcaption>While you talk</figcaption></figure>
    </div>
  );
}

const bridge = () => (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;

function VoiceHome() {
  const { data: status, error: statusError } = useDictation();
  const { data: stats } = useVoiceStats();
  const latest = useSharedState<{ entries: VoiceEntry[] }>("/api/voice/history?limit=6", 15_000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const state = stateOf(status);
  const ours = status?.owner === "agent-base";
  // While a take is live, read the helper every second so "written" shows within a second, not five; idle, the 5 s poll.
  useEffect(() => {
    if (!live(state.key)) return;
    const t = window.setInterval(() => void refresh(STATUS, true), 1000);
    return () => clearInterval(t);
  }, [state.key]);
  // The node itself not answering is the one thing the state above cannot say.
  const alert = statusError && !status ? `Agent Base's node is not answering: ${statusError}` : statusError || "";
  const move = async () => {
    setBusy(true); setNote(null);
    try { await post(`/api/dictation/owner`, { owner: "agent-base" }); setNote({ ok: true, text: "Voice now runs in Agent Base. Press right ⌥ anywhere." }); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); void refresh(STATUS); }
  };
  return (
    <div className="vx-home">
      <section className={cn("vx-hero siso-rim", live(state.key) ? "is-working" : "is-idle", `tone-${state.tone}`)} data-testid="voice-hero" data-state={state.key} data-tone={state.tone}>
        <BarStage state={state} />
        <div className="vx-hero-copy">
          <span className="vx-kicker">Voice · {state.word}</span>
          <h2 role={state.tone === "bad" ? "alert" : "status"}>{ours ? state.line : "Talk anywhere on your Mac. Your words land where your cursor is."}</h2>
          <p className={cn(ours && state.help && state.tone !== "live" && "vx-help")}>{ours
            ? state.help ?? HOWTO
            : "Move your hotkey into Agent Base and the bar above floats over every app. SISO Voice stops; you can switch back in Settings."}</p>
          {!ours && (
            <button type="button" className="vx-primary" disabled={!status || busy || status.switching} onClick={() => void move()}>
              {busy || status?.switching ? "Moving your hotkey…" : "Run voice in Agent Base"}
            </button>
          )}
          {ours && <VoiceCheck status={status} />}
          {note && <p role={note.ok ? "status" : "alert"} className={cn("vx-note", !note.ok && "is-bad")}>{note.text}</p>}
          {alert && !note && <p role="alert" className="vx-note is-bad">{alert}</p>}
        </div>
        <dl className="vx-numbers">
          <div><dt>Today</dt><dd>{stats ? formatGrouped(stats.wordsToday) : "—"}<small> words</small></dd></div>
          <div><dt>Streak</dt><dd>{stats ? stats.streakDays : "—"}<small> days</small></dd></div>
          <div><dt>All time</dt><dd>{stats ? formatGrouped(stats.totalWords) : "—"}<small> words</small></dd></div>
        </dl>
      </section>
      <section className="vx-latest" aria-label="Latest dictations">
        <div className="vx-section-label is-page">Latest{latest.data && latest.data.entries.length > 0 && <Recent entries={latest.data.entries} />}</div>
        {!latest.data && <p className="vx-faint">{latest.error ? `History is not readable: ${latest.error}` : "Reading…"}</p>}
        {latest.data?.entries.length === 0 && <p className="vx-faint">Nothing yet. Press right ⌥ and say something.</p>}
        <ul>{latest.data?.entries.map((e) => <Said key={e.id} entry={e} />)}</ul>
      </section>
    </div>
  );
}

/** How a dictation went: cleaned up and typed ("ok"), typed as said because the cleanup was down ("raw"), or failed. */
function healthOf(e: VoiceEntry): "ok" | "raw" | "failed" {
  const s = (e.status ?? "").toLowerCase();
  if (s === "fallback") return "raw";
  if (/fail|error/.test(s)) return "failed";
  return "ok";
}
const HEALTH_WORD = { ok: "Cleaned up and typed", raw: "Typed as said: the cleanup was not available", failed: "Did not finish" } as const;

/** One line over the list: how many, how they went, how long since the last. */
function Recent({ entries }: { entries: VoiceEntry[] }) {
  const n = { ok: 0, raw: 0, failed: 0 };
  for (const e of entries) n[healthOf(e)] += 1;
  const parts = [`${entries.length} recent`, n.ok && `${n.ok} cleaned up`, n.raw && `${n.raw} kept as said`, n.failed && `${n.failed} failed`, `last ${timeAgo(entries[0].timestamp)}`].filter(Boolean);
  return <b data-testid="voice-recent-summary" className={cn(n.failed ? "is-bad" : n.raw ? "is-warn" : undefined)}>{parts.join(" · ")}</b>;
}

/** A long one stays one line until he opens it. */
const LONG_WORDS = 40;

function Said({ entry }: { entry: VoiceEntry }) {
  const [done, setDone] = useState("");
  const [open, setOpen] = useState(false);
  const health = healthOf(entry);
  const long = entry.words > LONG_WORDS || entry.text.length > 240;
  const copy = async () => { try { await navigator.clipboard.writeText(entry.text); setDone("Copied"); } catch { setDone("Copy was blocked"); } };
  const paste = async () => {
    try {
      const ipc = bridge();
      if (!ipc) throw new Error("Paste again works in the desktop app");
      await ipc.invoke("dictation_paste", { text: entry.text, bundleId: entry.bundleId });
      setDone(`Pasted into ${entry.app}`);
    } catch (e) { setDone((e as Error).message || "Could not paste"); }
  };
  return (
    <li className={cn("vx-said", open && "is-open")} data-testid="dictation-entry" data-health={health}>
      <i className="vx-said-dot" title={HEALTH_WORD[health]} aria-label={HEALTH_WORD[health]} role="img" />
      <div className="vx-said-meta">
        <b>{entry.app || "Unknown app"}</b><time dateTime={entry.timestamp}>{timeAgo(entry.timestamp)}</time><span>{formatGrouped(entry.words)} words</span>
        {health !== "ok" && <span className={cn("vx-said-flag", `is-${health}`)}>{health === "raw" ? "kept as said" : "failed"}</span>}
        {done && <em>{done}</em>}
      </div>
      <p>{entry.text}</p>
      {long && <button type="button" className="vx-said-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Show less" : `Show all · ${formatGrouped(entry.words)} words`}</button>}
      <div className="vx-said-actions">
        <button type="button" aria-label={`Copy what you said in ${entry.app || "this app"}`} title="Copy" onClick={() => void copy()}><CopyIcon size={13} aria-hidden="true" /></button>
        {entry.bundleId && <button type="button" aria-label={`Paste again into ${entry.app}`} title={`Paste again into ${entry.app}`} onClick={() => void paste()}><ArrowUpRightIcon size={13} aria-hidden="true" /></button>}
      </div>
    </li>
  );
}

/** Settings' first card: where the hotkey runs, the floating bar, the keys and the macOS permissions. */
function BarAndHotkey() {
  const { data: status } = useDictation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ours = status?.owner === "agent-base";
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); void refresh(STATUS); } };
  const fresh = !!status && Date.now() - status.native.updatedAt < 30_000;
  return (
    <section className="vx-card" aria-label="The bar and the hotkey">
      <header><h2>The bar and the hotkey</h2><p>One app holds your hotkey at a time.</p></header>
      <div className="vx-rows">
        <div className="vx-row">
          <div><b>Voice runs in</b><small>{ours ? "Agent Base: the bar, the hotkey and your record, in one app." : "The old SISO Voice app. Move it here to retire it."}</small></div>
          <div className="vx-seg" role="group" aria-label="Voice runs in">
            {(["siso-voice", "agent-base"] as const).map((id) => (
              <button key={id} type="button" aria-pressed={status?.owner === id} disabled={!status || busy || status.switching} onClick={() => void act(() => post("/api/dictation/owner", { owner: id }))}>
                {id === "agent-base" ? "Agent Base" : "SISO Voice"}
              </button>
            ))}
          </div>
        </div>
        <div className="vx-row">
          <div><b>Show the voice bar</b><small>Floats over every app. Drag it anywhere; right-click it to put it back at the top.</small></div>
          <button type="button" role="switch" aria-checked={status?.bar !== false} aria-label="Show the voice bar" className="vx-switch" disabled={!status || busy} onClick={() => void act(() => post("/api/dictation/bar", { bar: status?.bar === false }))}><i /></button>
        </div>
        <div className="vx-row">
          <div><b>Keys</b><small>Tap to start and again to finish, or hold to talk while held.</small></div>
          <span className="vx-keys"><kbd>right ⌥</kbd> tap · <kbd>fn</kbd> hold</span>
        </div>
        {ours && (
          <div className="vx-row">
            <div><b>macOS permissions</b><small>{status?.native.error || "Accessibility (to paste) and the microphone."}</small></div>
            <span className={cn("vx-state", fresh && status?.native.registered && status.native.permission ? "is-good" : "is-bad")}>
              {!fresh ? "Helper not running" : status?.native.registered && status.native.permission ? "Allowed" : "Needed"}
            </span>
          </div>
        )}
      </div>
      {error && <p role="alert" className="vx-note is-bad">{error}</p>}
    </section>
  );
}

/** GET /api/dictation/diagnostics (dictation.ts `diagnostics`): never his words, only how each take went. */
type Diagnostics = {
  health: NonNullable<DictationStatus["health"]>;
  native: DictationStatus["native"];
  takes: Array<{ at: string; id: string; app: string; seconds: number; peakDb: number | null; outcome: string; ms: number; retry: boolean; error?: string }>;
  queue: Array<{ id: string; at: string; app: string; tries: number; next: string | null; kb: number }>;
  log: string[];
};
const DIAGNOSTICS = "/api/dictation/diagnostics";

/**
 * Your Groq key (9 Oct, VOICE; docs/voice/STANDALONE.md): bring your own. The node asks Groq before saving and never
 * sends the key back; this card only ever knows whether one is saved.
 */
function GroqKeyCard() {
  const { data } = useSharedState<{ saved: boolean; source: "env" | "file" | null }>("/api/voice/key", 60_000);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const call = async (method: "POST" | "DELETE") => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/voice/key", { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ key }) : undefined });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "The key was not saved");
      setKey("");
      setNote({ ok: true, text: method === "POST" ? (body.envWins ? "Saved. GROQ_API_KEY is set on this machine and is used first." : "Groq accepted it. Saved on this Mac.") : "Removed." });
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); void refresh("/api/voice/key"); void refresh(STATUS); }
  };
  return (
    <section className="vx-card" aria-label="Your Groq key" data-testid="voice-key">
      <header className="vx-card-head">
        <div><h2>Your Groq key</h2><p>Voice turns speech into text with Groq, on your own key. Get one at console.groq.com/keys.</p></div>
        <span className={cn("vx-state", data?.saved ? "is-good" : "is-bad")} data-saved={String(!!data?.saved)}>{!data ? "…" : data.saved ? (data.source === "env" ? "From GROQ_API_KEY" : "Saved") : "No key"}</span>
      </header>
      <form className="vx-key" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void call("POST"); }}>
        <input type="password" autoComplete="off" spellCheck={false} placeholder={data?.saved ? "New key, gsk_…" : "gsk_…"} aria-label="Groq key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button type="submit" className="vx-ghost" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Check and save"}</button>
        {data?.source === "file" && <button type="button" className="vx-ghost" disabled={busy} onClick={() => void call("DELETE")}>Remove</button>}
      </form>
      <small className="vx-key-note">Kept on this Mac only, readable by you alone. It is checked with Groq before it is saved and never shown again.</small>
      {note && <p role={note.ok ? "status" : "alert"} className={cn("vx-note", !note.ok && "is-bad")}>{note.text}</p>}
    </section>
  );
}

function DiagnosticsGate() {
  const { data: status } = useDictation();
  return status?.owner === "agent-base" ? <DiagnosticsCard /> : null;
}

/**
 * Settings' second card (9 Oct, VOICE step 4): the self-check, the mic, the hotkey tap, recordings waiting for Groq with
 * a Retry now, the last takes with how loud each was, and the helper's log. Copy report gives all of it, without words.
 */
function DiagnosticsCard() {
  const { data: d, error: readError } = useSharedState<Diagnostics>(DIAGNOSTICS, 15_000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const retry = async () => {
    setBusy(true); setNote(null);
    try { const after = await post<Diagnostics>("/api/dictation/retry", {}); setNote({ ok: after.queue.length === 0, text: after.queue.length ? `${after.queue.length} still waiting; Groq did not take ${after.queue.length === 1 ? "it" : "them"} yet.` : "Everything waiting is in History now." }); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); void refresh(DIAGNOSTICS); void refresh(STATUS); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ at: new Date().toISOString(), ...d }, null, 2)); setNote({ ok: true, text: "Report copied. It has no words you said." }); }
    catch { setNote({ ok: false, text: "Copy was blocked" }); }
  };
  const fresh = !!d && Date.now() - d.native.updatedAt < 30_000;
  const tap = !fresh ? "Helper not checking in" : d.native.tap === false ? "Off: the hotkey cannot hear keys" : d.native.tap ? "Listening for keys" : "Unknown";
  return (
    <section className="vx-card" aria-label="Diagnostics" data-testid="voice-diagnostics">
      <header className="vx-card-head">
        <div><h2>Diagnostics</h2><p>How each take went, never what you said.</p></div>
        <button type="button" className="vx-ghost" disabled={!d} onClick={() => void copy()}>Copy report</button>
      </header>
      {!d && <p className="vx-faint">{readError ? `Diagnostics are not readable: ${readError}` : "Reading…"}</p>}
      {d && (
        <div className="vx-rows">
          <div className="vx-row">
            <div><b>Self-check</b><small>{d.health.level === "ok" ? "Nothing wrong found." : d.health.line}</small></div>
            <span className={cn("vx-state", d.health.level === "ok" ? "is-good" : "is-bad")} data-level={d.health.level}>{d.health.level === "ok" ? "Working" : d.health.level === "warn" ? "Look" : "Not hearing"}</span>
          </div>
          <div className="vx-row">
            <div><b>Microphone</b><small>{d.native.device || "No input device reported"}{d.native.mic && d.native.mic !== "authorized" ? ` · access ${d.native.mic}` : ""}</small></div>
            <span className={cn("vx-state", d.native.mic === "denied" ? "is-bad" : d.native.mic && "is-good")}>{d.native.mic === "denied" ? "Blocked" : d.native.mic ? "Allowed" : "—"}</span>
          </div>
          <div className="vx-row">
            <div><b>Hotkey</b><small>{tap}{d.native.issue ? ` · last fix: ${d.native.issue}` : ""}</small></div>
            <span className={cn("vx-state", fresh && d.native.tap !== false ? "is-good" : "is-bad")}>{fresh && d.native.tap !== false ? "Live" : "Down"}</span>
          </div>
          <div className="vx-row" data-testid="voice-queue">
            <div><b>Waiting for Groq</b><small>{d.queue.length ? d.queue.map((q) => `${q.app} · ${timeAgo(q.at)} · ${q.tries} ${q.tries === 1 ? "try" : "tries"}`).join(" · ") : "Nothing waiting. A take Groq misses is kept and retried every minute."}</small></div>
            <button type="button" className="vx-ghost" disabled={busy || !d.queue.length} onClick={() => void retry()}>{busy ? "Retrying…" : d.queue.length ? `Retry ${d.queue.length} now` : "Retry now"}</button>
          </div>
          {note && <p role={note.ok ? "status" : "alert"} className={cn("vx-note", !note.ok && "is-bad")}>{note.text}</p>}
          <div className="vx-takes">
            <b>Last takes</b>
            {d.takes.length === 0 ? <small>None since the node started.</small> : (
              <table>
                <thead><tr><th>When</th><th>App</th><th>Length</th><th>Loudest</th><th>Took</th><th>Result</th></tr></thead>
                <tbody>{d.takes.slice(0, 8).map((t) => (
                  <tr key={`${t.id}-${t.at}`} data-outcome={t.outcome}>
                    <td>{timeAgo(t.at)}</td><td>{t.app}</td><td>{t.seconds.toFixed(1)} s</td><td>{t.peakDb == null ? "—" : `${t.peakDb} dB`}</td><td>{(t.ms / 1000).toFixed(1)} s</td>
                    <td className={cn(t.outcome === "written" || t.outcome === "duplicate" ? "is-good" : "is-bad")}>{t.outcome === "written" ? (t.retry ? "Written on retry" : "Written") : t.outcome === "duplicate" ? "Already in" : t.outcome === "silent" ? "Silent" : t.outcome === "no-speech" ? "No speech" : t.outcome === "queued" ? "Waiting" : "Refused"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <details className="vx-log">
            <summary>Helper log · last {d.log.length} lines</summary>
            <pre>{d.log.length ? d.log.join("\n") : "The helper has not written anything yet."}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

function parseLong(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
