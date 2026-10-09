import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { useOutsideClose } from "./useOutsideClose";

/**
 * One choice. `icon` sits before the label (Shaan, 2 Oct: "They need icons"). `items` makes it open a second list in
 * place, with a back row ("move should just be one move and then you click it. It has more options").
 */
export type MenuItem = { label: ReactNode; icon?: ReactNode; onSelect?: () => void; items?: MenuItem[]; disabled?: boolean; current?: boolean; danger?: boolean; key?: string };

/** A raised list of choices. Disabled items say why in their label ("· later"), never vanish. */
export function MenuList({ items, empty, className, onBack, title }: { items: MenuItem[]; empty?: ReactNode; className?: string; onBack?: () => void; title?: ReactNode }) {
  return (
    <div role="menu" className={cn("siso-menu flex w-52 flex-col rounded-lg border border-border bg-raised p-1 shadow-xl", className)}>
      {onBack && (
        <button
          type="button"
          role="menuitem"
          className="siso-menu__item siso-menu__back"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
        >
          <ChevronLeftIcon aria-hidden="true" />
          <span>{title ?? "Back"}</span>
        </button>
      )}
      {items.length === 0 && empty && <div className="px-2 py-1.5 text-xs text-muted-foreground">{empty}</div>}
      {items.map((it, i) => (
        <button
          key={it.key ?? i}
          role="menuitem"
          type="button"
          disabled={it.disabled}
          aria-current={it.current || undefined}
          aria-haspopup={it.items ? "menu" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            it.onSelect?.();
          }}
          className={cn("siso-menu__item", it.disabled && "is-disabled", it.current && "is-current", it.danger && "is-danger")}
        >
          {it.icon !== undefined && <span className="siso-menu__icon">{it.icon}</span>}
          <span className="siso-menu__label">{it.label}</span>
          {it.items && <ChevronRightIcon className="siso-menu__more" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/**
 * A button that opens a MenuList under it. The list is drawn in a portal at a fixed position, so no scrolling or
 * clipped parent (the side nav, the tab strip) can cut it off. `onOpenChange` lets a parent keep hover-only controls
 * visible while the menu is open (the pointer has left the row to reach the menu).
 */
export function MenuButton(props: {
  label: string;
  children: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  empty?: ReactNode;
  align?: "left" | "right";
  className?: string;
  menuClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenRaw] = useState(false);
  const [stack, setStack] = useState<{ title: ReactNode; items: MenuItem[] }[]>([]);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const { onOpenChange } = props;
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenRaw(v);
      setStack([]);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );
  const closeMenu = useCallback(() => setOpen(false), [setOpen]);
  useOutsideClose(ref, open, closeMenu, menuRef);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const place = () => {
      const r = ref.current!.getBoundingClientRect();
      setPos(props.align === "left" ? { top: r.bottom + 4, left: r.left } : { top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [open, props.align, closeMenu]);
  const root = typeof props.items === "function" ? (open ? props.items() : []) : props.items;
  const level = stack.at(-1);
  const items = (level?.items ?? root).map((it) => ({
    ...it,
    onSelect: it.items ? () => setStack((s) => [...s, { title: it.label, items: it.items! }]) : it.onSelect && (() => (setOpen(false), it.onSelect!())),
  }));
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={props.label}
        title={props.label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={props.className}
      >
        {props.children}
      </button>
      {open &&
        createPortal(
          <span ref={menuRef} className="siso-menu-layer" style={pos} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <MenuList className={props.menuClassName} empty={props.empty} items={items} title={level?.title} onBack={level ? () => setStack((s) => s.slice(0, -1)) : undefined} />
          </span>,
          document.body,
        )}
    </span>
  );
}
