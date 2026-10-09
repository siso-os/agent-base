import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import "./OrgTour.css";

export type OrgTourStep = { node: string; say: string };

type OrgTourProps = {
  onStep: (node: string | null) => void;
  onClose: () => void;
  onAsk?: (question: string, node: string) => Promise<string | void> | string | void;
};

export function OrgTour({ onStep, onClose, onAsk }: OrgTourProps) {
  const [steps, setSteps] = useState<OrgTourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let current = true;
    fetch("/api/org/tour", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Tour unavailable (${response.status})`);
        return response.json() as Promise<OrgTourStep[]>;
      })
      .then((result) => { if (current) setSteps(Array.isArray(result) ? result : []); })
      .catch((error: unknown) => { if (current) setAnswer(error instanceof Error ? error.message : "Tour unavailable."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const close = () => { onStep(null); onClose(); };
  const move = (next: number) => {
    if (next >= steps.length) { close(); return; }
    const bounded = Math.max(0, next);
    setIndex(bounded);
    setAnswer("");
    onStep(steps[bounded]?.node ?? null);
  };
  useEffect(() => {
    onStep(steps[index]?.node ?? null);
    return () => onStep(null);
  }, [steps, index, onStep]);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || !onAsk || !steps[index]) return;
    setAsking(true);
    setAnswer("");
    try {
      const response = await onAsk(question.trim(), steps[index].node);
      if (typeof response === "string") setAnswer(response);
      setQuestion("");
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "I couldn't send that question.");
    } finally { setAsking(false); }
  };

  return (
    <aside className="org-tour" aria-label="Walk me through the org chart" aria-live="polite">
      <header className="org-tour__head"><b>Agent Zero · Org tour</b><button type="button" aria-label="Close tour" onClick={close}><X size={16} /></button></header>
      <div className="org-tour__body">
        {loading ? <p>Gathering the org facts…</p> : steps.length ? <p>{answer || steps[index]?.say}</p> : <p>{answer || "There are no org steps to show yet."}</p>}
        {onAsk && steps.length > 0 && <form className="org-tour__ask" onSubmit={ask}>
          <label htmlFor="org-tour-question">Or ask Agent Zero about this step</label>
          <div><input id="org-tour-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`Ask about ${steps[index]?.node}…`} /><button type="submit" disabled={asking || !question.trim()}>{asking ? "Asking…" : "Ask"}</button></div>
        </form>}
      </div>
      <footer className="org-tour__foot">
        <button type="button" onClick={() => move(index - 1)} disabled={loading || index === 0}><ArrowLeft size={14} /> Back</button>
        <div className="org-tour__progress" aria-label={`${steps.length ? index + 1 : 0} of ${steps.length}`}>
          {steps.map((step, i) => <button key={`${step.node}-${i}`} type="button" aria-label={`Go to step ${i + 1}`} aria-current={i === index ? "step" : undefined} onClick={() => move(i)} />)}
          <span>{steps.length ? `${index + 1} of ${steps.length}` : "0 of 0"}</span>
        </div>
        <button type="button" onClick={() => move(index + 1)} disabled={loading || !steps.length}>{index === steps.length - 1 ? "Done" : "Next"}<ArrowRight size={14} /></button>
      </footer>
    </aside>
  );
}
