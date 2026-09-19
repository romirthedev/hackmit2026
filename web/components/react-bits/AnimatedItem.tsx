'use client';
// Extracted from React Bits AnimatedList. See SOURCE.md and LICENSE.md.
import { useRef, type ReactNode, type MouseEventHandler } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
interface AnimatedItemProps {
  children: ReactNode;
  delay?: number;
  index: number;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

const AnimatedItem: React.FC<AnimatedItemProps> = ({
  children,
  delay = 0,
  index,
  onMouseEnter,
  onClick,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.1, once: true });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      data-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      initial={reduced ? false : { scale: 0.985, opacity: 0 }}
      animate={
        inView || reduced
          ? { scale: 1, opacity: 1 }
          : { scale: 0.985, opacity: 0 }
      }
      transition={{ duration: 0.2, delay }}
      className="animated-recording"
    >
      {children}
    </motion.div>
  );
};

export default AnimatedItem;
