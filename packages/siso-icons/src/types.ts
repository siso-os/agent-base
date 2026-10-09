import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from "react";

/** Every icon exposes the same handle: play its motion or settle back to rest. */
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface AnimatedIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  strokeWidth?: number;
}

export type AnimatedIcon = ForwardRefExoticComponent<AnimatedIconProps & RefAttributes<AnimatedIconHandle>>;
