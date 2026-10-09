import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { usePersisted } from "@siso/shell";

/**
 * One section: a heading that folds, with a count on its right; remembered per section (`panel.fold.<id>`). Folded, `peek`
 * draws one line under the head so a closed panel still reads (SPEC-PANEL-CARDS §3); `onOpen` adds a › that opens the
 * section's page in the panel (it does not also fold).
 */
/**
 * Cards (ui-hub right-panel, Shaan 4 Oct ~17:40: "it's a cool idea just not cleanly implemented"): inside the panel's
 * dashboard every section is a card with one tap target. A section with a page opens it; one without folds its body.
 * The peek line stays under the head; no chevrons, no separate ›. A section that passes `widget` shows that instead of
 * its peek (Shaan 4 Oct ~21:00: "there's a bunch of dead space on that page"): a small live picture, not one line.
 */
export const FoldCards = createContext(false);

export function Fold({ id, title, note, open: initial, tone, head, peek, widget, onOpen, children, testid }: { id: string; title: ReactNode; note?: ReactNode; open: boolean; tone?: "needs"; head?: ReactNode; peek?: ReactNode; widget?: ReactNode; onOpen?: () => void; children: ReactNode; testid?: string }) {
  const [open, setOpen] = usePersisted(`panel.fold.${id}`, initial);
  const cards = useContext(FoldCards);
  if (cards)
    return (
      <section className={`ab-fold is-card${tone ? ` is-${tone}` : ""}${widget ? " is-widget" : ""}`} data-testid={testid ?? `fold-${id}`} data-open={!onOpen && open}>
        <button type="button" className="ab-fold__head" aria-expanded={onOpen ? undefined : open} onClick={() => (onOpen ? onOpen() : setOpen(!open))}>
          <span className="ab-fold__title">{title}</span>
          {head}
          {note !== undefined && <span className="ab-fold__note">{note}</span>}
        </button>
        {widget ? <div className="ab-fold__widget">{widget}</div> : !onOpen && open ? <div className="ab-fold__body">{children}</div> : peek && <div className="ab-fold__peek" data-testid="fold-peek">{peek}</div>}
      </section>
    );
  return (
    <section className={`ab-fold${tone ? ` is-${tone}` : ""}`} data-testid={testid ?? `fold-${id}`} data-open={open}>
      <div className="ab-fold__headrow">
        <button type="button" className="ab-fold__head" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          <span className="ab-fold__title">{title}</span>
          {!open && head}
          {note !== undefined && <span className="ab-fold__note">{note}</span>}
        </button>
        {onOpen && (
          <button type="button" className="ab-fold__page" aria-label="Open its page" title="Open its page" data-testid="fold-page" onClick={(e) => (e.stopPropagation(), onOpen())}>
            <ChevronRightIcon aria-hidden="true" />
          </button>
        )}
      </div>
      {!open && peek && (
        <div className="ab-fold__peek" data-testid="fold-peek">
          {peek}
        </div>
      )}
      {open && <div className="ab-fold__body">{children}</div>}
    </section>
  );
}
