import { useEffect, type RefObject } from "react";

/** Close a menu or popover when a press lands outside `ref` (and `also`, e.g. a menu drawn in a portal), or on Escape. */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, also?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !also?.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [ref, also, open, close]);
}
