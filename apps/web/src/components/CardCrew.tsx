import type { ReactNode } from "react";

/**
 * The crew inside a pinned card's second line (Shaan, 5 Oct: "i would have thought they should be in the card ... remove
 * where it says working nothing needs you and you could just put the agents there"; "agents show running even though
 * they're not running"). Only agents working now get a face; everyone else is one quiet "+N".
 */
export function CardCrew({ faces, quiet, quietTitle, onQuiet, empty }: { faces: ReactNode[]; quiet: number; quietTitle: string; onQuiet?: () => void; empty?: ReactNode }) {
  if (!faces.length && !quiet) return <>{empty}</>;
  return (
    <span className="ab-card-crew" data-testid="card-crew">
      {faces}
      {quiet > 0 && (onQuiet
        ? <button type="button" className="ab-card-crew__quiet" data-testid="card-crew-quiet" title={quietTitle} onClick={(e) => (e.stopPropagation(), onQuiet())}>{faces.length ? `+${quiet}` : `${quiet} quiet`}</button>
        : <span className="ab-card-crew__quiet" title={quietTitle}>{faces.length ? `+${quiet}` : `${quiet} quiet`}</span>)}
    </span>
  );
}
