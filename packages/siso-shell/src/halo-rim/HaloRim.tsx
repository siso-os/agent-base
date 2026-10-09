import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";
import "./halo-rim.css";

export type HaloRimState = "idle" | "working" | "voice";

/**
 * The Halo rim (Agent Base R1.19; Shaan 3 Oct 00:30: "that chat ui is perfect beautiful ... i would love to save how it
 * works"): a rounded glass box whose 1.5 px rim is a gradient ring in `hue`. Working, the ring is a conic gradient that
 * turns once every 6 s; idle, it rests as a diagonal gradient; voice turns it violet and faster. Anything inside that
 * carries `data-phase="listening"` (a mic) also switches it to voice. Reduced motion stops the turning. Knows nothing
 * about chats or agents: put any content in it. See README.md beside this file.
 */
export function HaloRim({ state = "idle", hue, glow = true, className, style, children, ...rest }: { state?: HaloRimState; hue?: string; glow?: boolean; children?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const css = hue ? ({ ...style, "--rim-hue": hue } as CSSProperties) : style;
  return (
    <div {...rest} className={cn("siso-rim", `is-${state}`, !glow && "no-glow", className)} data-state={state} style={css}>
      {children}
    </div>
  );
}
