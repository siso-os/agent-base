// uihub: arc:timeline
// Adapted from UI Arc's Timeline RowView: marker/line, aria-expanded + controls, inline detail.
// Uses the app's existing tokens and native disclosure behavior. See ui-hub/activity/ARC-SOURCE.md.
import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type TriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string>;
export function TimelineDisclosure({ expanded, onExpandedChange, marker, summary, detail, hint, triggerProps }: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  marker: ReactNode;
  summary: ReactNode;
  detail: ReactNode;
  hint?: ReactNode;
  triggerProps?: TriggerProps;
}) {
  const id = useId();
  return <div className="tl-item" data-expanded={expanded || undefined}>
    <span className="tl-marker" aria-hidden="true">{marker}</span>
    <button {...triggerProps} type="button" className="tl-row" aria-expanded={expanded} aria-controls={id} onClick={() => onExpandedChange(!expanded)}>
      {summary}<ChevronDown className="tl-chevron" size={13} aria-hidden="true"/>
    </button>
    <div id={id} hidden={!expanded} className="tl-inline-detail">{expanded && detail}</div>
    {hint}
  </div>;
}
