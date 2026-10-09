import { type ReactNode, useState } from "react";
import { foldLines, type StatusId } from "../../lib/browser-setup";

export type Line = { id: StatusId; tone: "lost" | "warn" | "info"; body: ReactNode };

/** The sidebar's status lines (arc-edges §1 #6): one row each, worst first, two at most and then "+N more". */
export function StatusLines(props: { lines: Line[] }) {
  const [open, setOpen] = useState(false);
  const { shown, more } = foldLines(props.lines, open);
  if (!props.lines.length) return null;
  return (
    <div className="ab-browser__lines">
      {shown.map((l) => <div key={l.id} className="ab-browser__line" data-tone={l.tone} data-line={l.id}>{l.body}</div>)}
      {more > 0 && <button type="button" className="ab-browser__line-more" aria-expanded={false} onClick={() => setOpen(true)}>+{more} more</button>}
    </div>
  );
}
