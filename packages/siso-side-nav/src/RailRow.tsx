/**
 * A live item in the SISO rail (an agent, a job): mark, name and one status word on the first line, what it is doing
 * on the second, actions on hover. Styled by rail-extras.css in the CRM nav link's materials.
 *
 * Reorder by dragging, as in herdr: `SortableRail` wraps a list; a drag starts after the pointer moves 5 px, so a
 * plain click still opens the row (the same sensor rule T3 Code's sidebar uses).
 */
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@siso/shell";
import { createContext, memo, useContext, type KeyboardEvent, type ReactNode } from "react";
import { StatusWord, type RowStatus } from "./StatusRow";

export const SortableOn = createContext(false);

export function SortableRail({ ids, onReorder, children }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode }) {
  // Pointer only: Enter and Space stay "open this row" rather than starting a keyboard drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <SortableOn.Provider value={true}>{children}</SortableOn.Provider>
      </SortableContext>
    </DndContext>
  );
}

/** Any block that drags as one item inside a SortableRail (a one-row project, say); its own rows stay still. */
export function SortableItem({ id, children }: { id: string; children: ReactNode }) {
  const s = useSortable({ id });
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }} {...s.listeners}>
      <SortableOn.Provider value={false}>{children}</SortableOn.Provider>
    </div>
  );
}

type RowProps = {
  id: string;
  name: string;
  sub?: ReactNode;
  mark?: ReactNode;
  status?: RowStatus | null;
  /** Shown in the status slot when there is no status (an age). */
  quiet?: ReactNode;
  /** A small right-hand value on the second line (context %). */
  meta?: ReactNode;
  active?: boolean;
  /** Dimmed until hovered (shelved or idle). */
  dim?: boolean;
  actions?: ReactNode;
  holdActions?: boolean;
  onOpen: () => void;
  ariaLabel?: string;
};

function RowBody(p: RowProps & { dragging?: boolean; handle?: Record<string, unknown>; setRef?: (el: HTMLElement | null) => void; style?: React.CSSProperties }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    p.onOpen();
  };
  return (
    <div
      ref={p.setRef}
      style={p.style}
      role="button"
      tabIndex={0}
      aria-label={p.ariaLabel ?? (p.status ? `${p.name}, ${p.status.label}` : p.name)}
      aria-current={p.active ? "page" : undefined}
      data-testid="rail-row"
      data-item={p.id}
      className={cn("siso-rail-row", p.active && "is-active", p.dragging && "is-dragging", p.dim && "is-quiet", p.holdActions && "is-held")}
      onClick={p.onOpen}
      onKeyDown={onKey}
      {...p.handle}
    >
      <span className="siso-rail-row__mark">{p.mark}</span>
      <span className="siso-rail-row__name">{p.name}</span>
      <span className="siso-rail-row__right">
        <span className="siso-rail-row__status">{p.status ? <StatusWord status={p.status} /> : <span className="siso-rail-row__meta">{p.quiet}</span>}</span>
        {p.actions && <span className={cn("siso-rail-row__actions", p.holdActions && "is-held")}>{p.actions}</span>}
      </span>
      <span className="siso-rail-row__sub">{p.sub}</span>
      <span className="siso-rail-row__meta">{p.meta}</span>
    </div>
  );
}

function SortableRow(p: RowProps) {
  const s = useSortable({ id: p.id });
  return (
    <RowBody
      {...p}
      setRef={s.setNodeRef}
      dragging={s.isDragging}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      handle={{ ...s.listeners }}
    />
  );
}

export const RailRow = memo(function RailRow(p: RowProps) {
  return useContext(SortableOn) ? <SortableRow {...p} /> : <RowBody {...p} />;
});
