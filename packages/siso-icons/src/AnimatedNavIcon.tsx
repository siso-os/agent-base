import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "./cn";
import type { AnimatedIcon, AnimatedIconHandle } from "./types";

export interface AnimatedNavIconProps {
  icon: AnimatedIcon;
  /** The row is current when it represents the current page. */
  active?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** Drive the icon from its containing link or button; reduced-motion users get a still glyph. */
export function AnimatedNavIcon({ icon: Icon, active = false, size = 18, strokeWidth = 1.7, className }: AnimatedNavIconProps) {
  const glyph = useRef<AnimatedIconHandle>(null);
  const box = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (active && !reduceMotion) glyph.current?.startAnimation();
  }, [active, reduceMotion]);

  useEffect(() => {
    const row = box.current?.closest<HTMLElement>("a, button") ?? box.current;
    if (!row || reduceMotion) return undefined;
    const enter = () => glyph.current?.startAnimation();
    const leave = () => { if (!activeRef.current) glyph.current?.stopAnimation(); };
    row.addEventListener("mouseenter", enter);
    row.addEventListener("mouseleave", leave);
    return () => {
      row.removeEventListener("mouseenter", enter);
      row.removeEventListener("mouseleave", leave);
    };
  }, [reduceMotion]);

  return (
    <span ref={box} className={cn("inline-flex shrink-0 items-center justify-center", className)} aria-hidden="true">
      <Icon ref={glyph} size={size} strokeWidth={strokeWidth} className="flex" />
    </span>
  );
}
