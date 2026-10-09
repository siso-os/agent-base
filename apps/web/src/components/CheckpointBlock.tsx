import { Check, ChevronRight, CircleX, LoaderCircle } from "lucide-react";
import type { Checkpoint } from "../lib/checkpoint";
import "./CheckpointBlock.css";

const STATE_LABEL: Record<string, string> = { done: "Done", "in-progress": "In progress", blocked: "Blocked" };

export function CheckpointBlock({ checkpoint }: { checkpoint: Checkpoint }) {
  return <section className="checkpoint" aria-label={checkpoint.summary}>
    <div className="checkpoint__summary">{checkpoint.summary}</div>
    <div className="checkpoint__rows">
      {checkpoint.sections.map((section, index) => <details className="checkpoint__row" key={`${section.title}-${index}`}>
        <summary>
          <ChevronRight className="checkpoint__chevron" size={14} aria-hidden="true" />
          {section.state === "done" && <Check className="checkpoint__state checkpoint__state--done" size={13} aria-label={STATE_LABEL.done} />}
          {section.state === "in-progress" && <LoaderCircle className="checkpoint__state checkpoint__state--in-progress" size={13} aria-label={STATE_LABEL["in-progress"]} />}
          {section.state === "blocked" && <CircleX className="checkpoint__state checkpoint__state--blocked" size={13} aria-label={STATE_LABEL.blocked} />}
          <span className="checkpoint__title">{section.title}</span>
          {section.state && <span className="checkpoint__state-label">{STATE_LABEL[section.state]}</span>}
        </summary>
        {section.body && <div className="checkpoint__body">{section.body}</div>}
      </details>)}
    </div>
  </section>;
}

export function LongPrompt({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= 12) return <div className="checkpoint-prompt">{text}</div>;
  return <details className="checkpoint-prompt checkpoint-prompt--long">
    <summary><span>{lines.slice(0, 3).join("\n")}</span><span className="checkpoint-prompt__more">{lines.length - 3} more lines</span></summary>
    <div className="checkpoint-prompt__full">{text}</div>
  </details>;
}
