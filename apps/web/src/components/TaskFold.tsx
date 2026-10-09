import { useEffect, useId, useState, type ReactNode } from 'react';
import './TaskFold.css';
/** The approved 240ms task-group fold; hidden descendants cannot receive keyboard focus. */
export function TaskFold({ open, children }: { open: boolean; children: ReactNode }) {
  const id=useId();
  const [seen, setSeen] = useState(open);
  useEffect(() => { if (open) setSeen(true); }, [open]);
  return <div id={id} className="ab-task-fold" data-open={open} inert={!open} aria-hidden={!open}><div>{open || seen ? children : null}</div></div>;
}
