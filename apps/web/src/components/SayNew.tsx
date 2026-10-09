import { useRef, useState } from "react";
import { SendIcon, XIcon } from "lucide-react";
import { WorkspaceChoices } from "./WorkspaceChoices";
import type { WorkspaceChoice } from "../lib/agents";
import { MicButton } from "./MicButton";
import "./SayNew.css";

export type SaidStart = { name?: string; project?: string | null; why?: string; error?: string };

/**
 * t-0139 (Shaan: "I don't like selecting projects I should be able to just tell the agent and he knows what project is
 * in"): a new agent from his words alone, said (the mic starts it at once) or typed. The node names it and finds its
 * project; or he hands the words to Agent Zero to place and start.
 */
export function SayNew({ onSay, onAskZero, onClose }: { onSay: (words: string, choice?: WorkspaceChoice) => Promise<SaidStart>; onAskZero?: (words: string) => Promise<string | null>; onClose: () => void }) {
  const [choice,setChoice]=useState<WorkspaceChoice>({repo:"",workspace:{type:"isolated"}});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; text: string }>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote(null);
    try {
      const n = await fn().catch(() => ({ ok: false, text: "No answer from the node." }));
      setNote(n);
      if (n.ok) setText("");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const start = (words: string) =>
    words.trim() &&
    run(async () => {
      const r = await onSay(words.trim(), choice);
      if (r.error || !r.name) return { ok: false, text: r.error ?? "It did not start." };
      return { ok: true, text: r.project ? `Starting ${r.name} in ${r.project}.` : `Starting ${r.name}; ${r.why ?? "no project fits"}, so Agent Zero places it.` };
    });
  const ask = () =>
    text.trim() &&
    onAskZero &&
    run(async () => {
      const why = await onAskZero(text.trim());
      return why ? { ok: false, text: why } : { ok: true, text: "Agent Zero has it: it's on the task list." };
    });
  return (
    <div className="ab-saynew" data-testid="say-new" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <form
        className="ab-saynew__form"
        onSubmit={(e) => {
          e.preventDefault();
          void start(text);
        }}
      >
        <MicButton label="Say what the new agent is for" disabled={busy} onText={(said) => (setText(said), void start(said))} />
        <input autoFocus aria-label="What the new agent is for" data-testid="say-new-input" placeholder="Say what it's for" value={text} disabled={busy} maxLength={2000} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="ab-saynew__go" data-testid="say-new-start" aria-label="Start it" title="Start it" disabled={busy || !text.trim() || !choice.repo || choice.workspace.type==='shared' && !choice.workspace.reason.trim()}>
          <SendIcon size={13} />
        </button>
        <button type="button" className="ab-saynew__x" aria-label="Close" title="Close · Esc" onClick={onClose}>
          <XIcon size={13} />
        </button>
      </form>
      <WorkspaceChoices value={choice} onChange={setChoice} disabled={busy} />
      <div className="ab-saynew__foot">
        {note ? (
          <p className={note.ok ? "is-ok" : "is-err"} data-testid="say-new-note" role="status">
            {note.text}
          </p>
        ) : (
          <p>{busy ? "Starting…" : "Choose where this chat will work."}</p>
        )}
        {onAskZero && (
          <button type="button" data-testid="say-new-ask" disabled={busy || !text.trim()} onClick={() => void ask()}>
            Ask Agent Zero
          </button>
        )}
      </div>
    </div>
  );
}
