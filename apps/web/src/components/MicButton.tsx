import { RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { clock, useVoice, warmMic, type VoiceHow } from "../lib/voice";
import { TalkOrb } from "./TalkOrb";
import { SpeakToggle } from "./SpeakToggle";
import { useSpeakOn } from "../lib/speak";
import { unlockAudio } from "../lib/speak";
import "./VoiceOrb.css";

/** A press held at least this long is push-to-talk: letting go sends. A shorter one is a tap: tap again to send. */
const HOLD_MS = 350;
/** How long the tick shows once the words have landed. */
const DONE_MS = 900;

/**
 * The voice orb (t-0100's mic, made the violet Grok orb of SPEC-CHAT-HUD §1 in t-0271; Shaan 3 Oct: "make that orb a
 * way nicer UI ... super fast super nice super clean"): tap, speak, tap again; or hold, speak, let go (the pointer, or
 * Space with the orb focused). The words go to `onText`. The orb swells and glows with his level and shows a live
 * equaliser while it listens; a pill above it shows the time, who the words are for, and Esc to throw them away.
 * Problems (no key, mic blocked, the node down) show in the same pill in plain words until dismissed, with "Try again"
 * when the recording is still in hand. The mic is warm after the first take (lib/voice.ts), and the pointer arriving
 * warms it, so a press starts listening at once. The level is written straight to `--lvl` on this element each frame:
 * no renders while he talks. `active` false (its chat went out of view) ends a take and keeps the words as a draft.
 *
 * Voice lane, 9 Oct: a press shows on the very next frame (data-press, written straight to the element on pointerdown,
 * before the mic has opened); the words landing show a brief tick (data-done); Esc while it listens is the mic's, even
 * with the agent's panel open (data-esc-own); `working` says the words go into the agent's current turn.
 */
export function MicButton({ onText, disabled, note, variant = "chat", label = "Talk", hotkey, to, toName, active = true, readAloudMenu = false, working = false }: { onText: (text: string, how: VoiceHow) => void; disabled?: boolean; note?: string | null; variant?: "chat" | "face"; label?: string; hotkey?: (e: KeyboardEvent) => boolean; /** who the words are for (an agent id; the face listens to "zero") */ to?: string; /** their name, for the pill */ toName?: string; /** false while its page is hidden */ active?: boolean; readAloudMenu?: boolean; /** the agent is mid-turn: the words go into that turn */ working?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const speakOn = useSpeakOn();
  const menuHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("pointerdown", away); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [menuOpen]);
  useEffect(() => () => { if (menuHold.current) clearTimeout(menuHold.current); }, []);
  const root = useRef<HTMLSpanElement>(null);
  /** The words just landed: a tick on the orb for a moment (DONE_MS), then rest. */
  const [done, setDone] = useState(false);
  const landed = (text: string, how: VoiceHow) => {
    setDone(true);
    onText(text, how);
  };
  const v = useVoice(landed, { to, onLevel: (l) => root.current?.style.setProperty("--lvl", l.toFixed(3)) });
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), DONE_MS);
    return () => clearTimeout(t);
  }, [done]);
  // The press, on the element itself: no render between his finger and the orb answering.
  const pressTimer = useRef(0);
  const press = (on: boolean) => {
    clearTimeout(pressTimer.current);
    if (on) root.current?.setAttribute("data-press", "");
    else pressTimer.current = window.setTimeout(() => root.current?.removeAttribute("data-press"), 120);
  };
  useEffect(() => {
    clearTimeout(pressTimer.current);
    root.current?.removeAttribute("data-press");
  }, [v.phase, v.error]);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  const hot = useRef(hotkey);
  hot.current = hotkey;
  const vr = useRef(v);
  vr.current = v;
  /** When the current press went down (0: no press held). */
  const held = useRef(0);
  /** A Space press was handled here, so the click the browser makes from it is not a second press. */
  const spaced = useRef(false);
  // The pill's clock: one render a second while listening.
  const [, tick] = useState(0);
  useEffect(() => {
    if (v.phase !== "listening") return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [v.phase]);

  /** A press goes down: idle starts listening, listening sends. Anything else (opening, writing) waits. */
  const down = () => {
    const now = vr.current.current();
    unlockAudio(); // a press is a gesture: the speaker may play after it
    setDone(false);
    if (now === "listening") {
      held.current = 0;
      vr.current.stop();
    } else if (now === "idle") {
      held.current = Date.now();
      void vr.current.start();
    }
  };
  /** A press comes up: held long enough while listening, it was push-to-talk, so it sends. */
  const up = () => {
    const t = held.current;
    held.current = 0;
    if (!t || vr.current.current() !== "listening") return;
    if (Date.now() - Math.max(t, vr.current.listeningSince()) >= HOLD_MS) vr.current.stop();
  };

  // Hold Space in an empty chat box (ui-hub ideas r2 #6, "talk into the rim"): ChatView sends down/up for its own mic.
  useEffect(() => {
    if (!to) return;
    const on = (e: Event) => { const d = (e as CustomEvent<{ to?: string; press?: "down" | "up" }>).detail; if (d?.to !== to) return; if (d.press === "down") down(); else if (held.current) up(); };
    window.addEventListener("siso-mic-hold", on);
    return () => window.removeEventListener("siso-mic-hold", on);
  });
  useEffect(() => {
    if (to) window.dispatchEvent(new CustomEvent("siso-mic-phase", { detail: { to, phase: v.phase } }));
  }, [v.phase, to]);
  useEffect(() => {
    if (!hotkey) return;
    // A key that presses this mic from anywhere in the window (the face's ⌘⇧Space); held, it is push-to-talk.
    const key = (e: KeyboardEvent) => {
      if (!hot.current?.(e)) return;
      e.preventDefault();
      if (!e.repeat) down();
    };
    const keyUp = (e: KeyboardEvent) => e.code === "Space" && held.current && up();
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", keyUp);
    };
  }, [!hotkey]);
  useEffect(() => {
    if (v.phase !== "listening" && v.phase !== "starting") return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc here only drops the recording: it must not also reach the chat (Esc stops the agent) or close a panel.
      e.preventDefault();
      e.stopPropagation();
      v.cancel();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [v.phase]);
  // Its page went out of view mid-take (another agent's tab): stop listening, keep the words in that chat's box.
  useEffect(() => {
    if (!active && (v.current() === "listening" || v.current() === "starting")) v.park();
  }, [active]);

  const listening = v.phase === "listening" || v.phase === "starting";
  const writing = v.phase === "writing";
  const idleLabel = variant === "chat" ? `${label} · microphone` : label;
  const title = v.phase === "starting" ? "Opening the microphone… Esc stops" : listening ? "Send what you said · Esc throws it away" : writing ? "Writing it down…" : `${idleLabel} · tap, or hold to talk`;
  const shown = done && v.phase === "idle" && !v.error;
  return (
    <span ref={root} className={`siso-mic is-${variant}`} data-phase={v.phase} data-error={v.error ? "true" : undefined} data-done={shown ? "" : undefined} data-working={working || undefined} data-esc-own={listening ? "" : undefined}>
      {(listening || writing || v.error || note) && (
        <span className={`siso-mic__pill${v.error ? " is-error" : ""}${listening ? " is-live" : ""}${writing ? " is-writing" : ""}`} role={v.error ? "alert" : "status"} data-testid="mic-status">
          {v.error ? (
            <>
              <span className="siso-mic__msg">{v.error}</span>
              {v.canRetry && (
                <button type="button" className="siso-mic__retry" aria-label="Try again" title="Send the same recording again" onClick={v.retry} data-testid="mic-retry">
                  <RotateCcwIcon size={12} />
                  <span>Try again</span>
                </button>
              )}
              <button type="button" aria-label="Dismiss" onClick={v.clearError}>
                <XIcon size={12} />
              </button>
            </>
          ) : writing ? (
            <>
              <span className="siso-mic__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="siso-mic__msg">Writing it down…{toName && <span className="siso-mic__to"> → {toName}</span>}</span>
            </>
          ) : listening ? (
            <>
              <span className="siso-mic__bars" aria-hidden="true">
                {[0.55, 1, 0.75, 0.9, 0.6].map((b, i) => (
                  <i key={i} style={{ "--b": b } as CSSProperties} />
                ))}
              </span>
              <span className="siso-mic__msg">
                {v.phase === "starting" ? "Opening the mic…" : `Listening ${clock(Date.now() - v.since)}`}
                {toName && v.phase === "listening" && <span className="siso-mic__to"> → {toName}</span>}
              </span>
              <span className="siso-mic__hint">{v.phase === "starting" ? "esc" : working ? "into its current turn · esc" : "tap to send · esc"}</span>
              <button type="button" aria-label="Throw away" title="Throw away · Esc" onClick={v.cancel}>
                <XIcon size={12} />
              </button>
            </>
          ) : (
            <span className="siso-mic__msg">{note}</span>
          )}
        </span>
      )}
      {readAloudMenu && <div className="siso-orb__menu" role="menu" aria-label="Voice options" hidden={!menuOpen}><span>Read replies aloud</span><SpeakToggle /></div>}
      {readAloudMenu && speakOn && <i className="siso-orb__speak-dot" aria-label="Read aloud on" />}
      <TalkOrb
        phase={v.error ? "error" : shown ? "ready" : v.phase}
        size={variant === "face" ? "compact" : "small"}
        showDetails={false}
        paused={!active}
        disabled={disabled || writing}
        buttonProps={{
          onContextMenu: readAloudMenu ? e => { e.preventDefault(); setMenuOpen(v => !v); } : undefined,
          "aria-label": listening ? "Stop and send" : label,
          "aria-pressed": listening,
          "aria-busy": writing || undefined,
          title,
          onPointerEnter: () => void warmMic(),
          onPointerDown: (e) => {
            if (e.button !== 0) return;
            press(true);
            // Keep the pointer, so letting go outside the orb still ends a hold.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* a pointer the browser no longer tracks: the press still counts */
            }
            // The long press opens the read-aloud menu on touch only: a mouse has right-click, and its hold is push-to-talk.
            if (readAloudMenu && e.pointerType === "touch" && vr.current.current() === "idle") {
              longPressed.current = false;
              menuHold.current = setTimeout(() => { menuHold.current = null; longPressed.current = true; setMenuOpen(true); }, 500);
            } else down();
          },
          onPointerUp: () => {
            press(false);
            if (menuHold.current) { clearTimeout(menuHold.current); menuHold.current = null; down(); held.current = 0; }
            else if (!longPressed.current) up();
            longPressed.current = false;
          },
          onPointerCancel: () => { press(false); if (menuHold.current) clearTimeout(menuHold.current); menuHold.current = null; up(); },
          onKeyDown: (e) => {
            if (e.key !== " ") return;
            e.preventDefault();
            spaced.current = true;
            if (!e.repeat) press(true), down();
          },
          onKeyUp: (e) => {
            if (e.key !== " ") return;
            e.preventDefault();
            press(false);
            up();
            // A browser that still makes a click from this Space does it now, inside the keyup; after that, clicks count.
            window.setTimeout(() => (spaced.current = false), 0);
          },
          // The pointer and Space are handled above; a click with no pointer behind it (Enter, assistive tech) toggles.
          onClick: (e) => {
            if (spaced.current) return void (spaced.current = false);
            if (e.detail === 0) down();
          },
          "data-testid": "mic",
        }}
      />
    </span>
  );
}
