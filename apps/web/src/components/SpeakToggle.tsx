import { Volume2Icon, VolumeOffIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { clearSpeakProblem, setSpeaking, stopSpeaking, useSpeakingNow, useSpeakOn, useSpeakProblem } from "../lib/speak";

/**
 * The speaker toggle beside the voice orb (t-0270): on, the open chat reads each finished reply aloud (Groq's voice,
 * macOS say as the fallback). Off, the mic, or Esc stops it at once. One switch for every chat, remembered. When a reply
 * cannot be read (the node down, no voice at all, the window refusing sound) a pill above it says why, in plain words.
 */
export function SpeakToggle() {
  const on = useSpeakOn();
  const speaking = useSpeakingNow();
  const problem = useSpeakProblem();
  useEffect(() => {
    if (!speaking) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc here only stops the voice: the reply is finished, so it must not also reach the chat (Esc there stops the agent).
      e.preventDefault();
      e.stopImmediatePropagation();
      stopSpeaking();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [speaking]);
  // A problem says itself for a while, then goes (the next reply tries again).
  useEffect(() => {
    if (!problem) return;
    const t = window.setTimeout(clearSpeakProblem, 12_000);
    return () => clearTimeout(t);
  }, [problem]);
  const title = speaking ? "Reading the reply aloud · Esc or click stops it" : on ? "Replies are read aloud · click to stop" : "Read replies aloud";
  return (
    <span className="siso-speak-wrap">
      {problem && on && (
        <span className="siso-mic__pill is-error" role="alert" data-testid="speak-status">
          <span className="siso-mic__msg">{problem}</span>
          <button type="button" aria-label="Dismiss" onClick={clearSpeakProblem}>
            <XIcon size={12} />
          </button>
        </span>
      )}
      <button
        type="button"
        className="siso-speak"
        aria-pressed={on}
        aria-label={speaking ? "Stop reading aloud" : on ? "Stop reading replies aloud" : "Read replies aloud"}
        title={title}
        data-speaking={speaking}
        data-error={problem && on ? "true" : undefined}
        data-testid="speak"
        onClick={() => (speaking ? stopSpeaking() : setSpeaking(!on))}
      >
        {on ? <Volume2Icon size={15} /> : <VolumeOffIcon size={15} />}
      </button>
    </span>
  );
}
