// Ported from pqoqubbw/icons (MIT, github.com/pqoqubbw/icons @ 072c38b; licence: ../../LICENSE-pqoqubbw).
// HALO transform: motion/react -> framer-motion, strokeWidth prop added (scripts/port.mjs).
import { motion, useAnimation } from 'framer-motion';
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from '../cn';

export interface CompassIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CompassIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  strokeWidth?: number;
}

const CompassIcon = forwardRef<CompassIconHandle, CompassIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, strokeWidth = 2, ...props }, ref) => {
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
          <circle cx="12" cy="12" r="10" />
          <motion.polygon
            animate={controls}
            points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 15,
            }}
            variants={{
              normal: {
                rotate: 0,
              },
              animate: {
                rotate: 360,
              },
            }}
          />
        </svg>
      </div>
    );
  }
);

CompassIcon.displayName = "CompassIcon";

export { CompassIcon };
