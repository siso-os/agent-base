// Ported from pqoqubbw/icons (MIT, github.com/pqoqubbw/icons @ 072c38b; licence: ../../LICENSE-pqoqubbw).
// HALO transform: motion/react -> framer-motion, strokeWidth prop added (scripts/port.mjs).
import type { Variants } from 'framer-motion';
import { motion, useAnimation } from 'framer-motion';
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from '../cn';

export interface MessageCircleMoreIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MessageCircleMoreIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  strokeWidth?: number;
}

const DOT_VARIANTS: Variants = {
  normal: {
    opacity: 1,
  },
  animate: (custom: number) => ({
    opacity: [1, 0, 0, 1, 1, 0, 0, 1],
    transition: {
      opacity: {
        times: [
          0,
          0.1,
          0.1 + custom * 0.1,
          0.1 + custom * 0.1 + 0.1,
          0.5,
          0.6,
          0.6 + custom * 0.1,
          0.6 + custom * 0.1 + 0.1,
        ],
        duration: 1.5,
      },
    },
  }),
};

const MessageCircleMoreIcon = forwardRef<
  MessageCircleMoreIconHandle,
  MessageCircleMoreIconProps
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
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <motion.path
          animate={controls}
          custom={0}
          d="M8 12h.01"
          variants={DOT_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={1}
          d="M12 12h.01"
          variants={DOT_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={2}
          d="M16 12h.01"
          variants={DOT_VARIANTS}
        />
      </svg>
    </div>
  );
});

MessageCircleMoreIcon.displayName = "MessageCircleMoreIcon";

export { MessageCircleMoreIcon };
