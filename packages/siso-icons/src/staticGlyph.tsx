import { forwardRef, useImperativeHandle } from "react";
import type { LucideIcon } from "lucide-react";
import type { AnimatedIcon, AnimatedIconHandle, AnimatedIconProps } from "./types";

/** Adapt a static Lucide glyph to the icon bank's no-op animation handle. */
export function staticGlyph(Icon: LucideIcon): AnimatedIcon {
  const Glyph = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
    ({ size = 18, strokeWidth = 2, className, ...props }, ref) => {
      useImperativeHandle(ref, () => ({ startAnimation() {}, stopAnimation() {} }));
      return <div className={className} {...props}><Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" /></div>;
    },
  );
  Glyph.displayName = `StaticGlyph(${Icon.displayName ?? "icon"})`;
  return Glyph;
}
