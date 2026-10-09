// Ported from pqoqubbw/icons (MIT, github.com/pqoqubbw/icons @ 072c38b; licence: ../../LICENSE-pqoqubbw).
// HALO transform: motion/react -> framer-motion, strokeWidth prop added (scripts/port.mjs).
import type { Variants } from 'framer-motion';
import { motion, useAnimation } from 'framer-motion';
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from '../cn';

export interface LaptopMinimalCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LaptopMinimalCheckIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  strokeWidth?: number;
}

const CHECK_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      pathLength: { duration: 0.4, ease: "easeInOut" },
      opacity: { duration: 0.4, ease: "easeInOut" },
    },
  },
};

const LaptopMinimalCheckIcon = forwardRef<
  LaptopMinimalCheckIconHandle,
  LaptopMinimalCheckIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 28, strokeWidth = 2, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;

    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        controls.start("animate");
      }
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        controls.start("normal");
      }
    },
    [controls, onMouseLeave]
  );

  return (
    <div
      className={cn(className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M2 20h20" />
        <rect height="12" rx="2" width="18" x="3" y="4" />
        <motion.path
          animate={controls}
          d="m9 10 2 2 4-4"
          initial="normal"
          style={{ transformOrigin: "center" }}
          variants={CHECK_VARIANTS}
        />
      </svg>
    </div>
  );
});

LaptopMinimalCheckIcon.displayName = "LaptopMinimalCheckIcon";

export { LaptopMinimalCheckIcon };
