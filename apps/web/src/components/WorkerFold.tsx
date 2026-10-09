import { useState, type ReactNode } from "react";
import { SortableOn } from "@siso/side-nav";
import "./WorkerFold.css";

type Fold = { open: boolean; count: number; onToggle: () => void };

/** Remembers each owner's worker visibility independently. */
export function WorkerFold({
  owner,
  count,
  children,
  renderOwner,
}: {
  owner: string;
  count: number;
  children: ReactNode;
  renderOwner: (fold: Fold) => ReactNode;
}) {
  const key = `ab.fold.${owner}`;
  const [open, setOpen] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "false") === true;
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // The fold still works for this session when storage is unavailable.
    }
  };

  return (
    <>
      <div className="ab-worker-owner">
        {renderOwner({ open, count, onToggle: toggle })}
      </div>
      {open && (
        <div className="ab-worker-fold" role="group" aria-label={`${owner}'s workers`}>
          <SortableOn.Provider value={false}>{children}</SortableOn.Provider>
        </div>
      )}
    </>
  );
}
