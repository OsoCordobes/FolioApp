"use client";

/**
 * Folio · SideArt · Stage
 *
 * Wrapper que renderiza UN slide a la vez con transición direction-aware
 * (crossfade + scale + blur + spring X). Sustituye al opacity+translateY
 * genérico anterior.
 *
 * Coreografía del crossfade:
 *   ENTER (custom: dir 1 = forward, -1 = backward)
 *     - opacity: 0 → 1     (320ms ease-emphasized)
 *     - scale: 0.98 → 1    (420ms ease-emphasized)
 *     - x: dir*24 → 0      (spring 320/34/0.9)
 *     - filter: blur(6px) → blur(0)  (360ms easeOut)
 *   EXIT
 *     - opacity: 1 → 0
 *     - scale: 1 → 0.98
 *     - x: 0 → dir*-24
 *     - filter: blur(0) → blur(4px)  (240ms ease-emphasized-in)
 *
 * AnimatePresence usa mode="popLayout" para mantener overlap durante el
 * crossfade — compatible con shared elements (layoutId, agregado en C13).
 *
 * Lazy mount: el padre (side-art.tsx) solo renderiza [prev, current, next]
 * via visibleSet. Este componente NO se ocupa de eso; recibe el slide y
 * lo wrappea.
 */

import { AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

import { MDiv } from "@/components/motion/m";

interface SideArtStageProps {
  /** Identificador estable del slide actual — usado como key del AnimatePresence. */
  slideKey: string;
  /** Dirección del cambio: 1 = forward (next), -1 = backward (prev). */
  direction: 1 | -1;
  /** Contenido del slide a renderizar. */
  children: ReactNode;
  /** className extra opcional aplicada al wrapper interno (m.div). */
  className?: string;
}

const slideVariants = {
  enter: (dir: 1 | -1) => ({
    opacity: 0,
    scale: 0.98,
    x: dir * 24,
    filter: "blur(6px)",
  }),
  center: {
    opacity: 1,
    scale: 1,
    x: 0,
    filter: "blur(0px)",
    transition: {
      opacity: { duration: 0.32, ease: [0.32, 0.72, 0, 1] as const },
      scale:   { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const },
      x:       { type: "spring" as const, stiffness: 320, damping: 34, mass: 0.9 },
      filter:  { duration: 0.36, ease: "easeOut" as const },
    },
  },
  exit: (dir: 1 | -1) => ({
    opacity: 0,
    scale: 0.98,
    x: dir * -24,
    filter: "blur(4px)",
    transition: {
      duration: 0.24,
      ease: [0.4, 0, 1, 1] as const,
    },
  }),
};

export function SideArtStage({ slideKey, direction, children, className }: SideArtStageProps) {
  return (
    <AnimatePresence mode="popLayout" custom={direction} initial={false}>
      <MDiv
        key={slideKey}
        custom={direction}
        variants={slideVariants}
        initial="enter"
        animate="center"
        exit="exit"
        className={`au2-slide is-active ${className ?? ""}`}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </MDiv>
    </AnimatePresence>
  );
}
