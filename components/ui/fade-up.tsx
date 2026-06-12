"use client";

import { motion, useReducedMotion } from "framer-motion";

import { motion as motionTokens } from "@/lib/design-tokens";

export function FadeUp({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{
        duration: motionTokens.durationSlow / 1000,
        ease: [...motionTokens.easeOutSmooth],
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}
