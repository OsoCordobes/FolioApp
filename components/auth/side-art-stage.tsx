"use client";

/**
 * Folio · SideArt · Stage v3
 *
 * Wrapper que renderiza UN slide a la vez con transición intencional según
 * la pareja (fromIdx → toIdx). El sprint 1 dejó una transición default
 * direction-aware (crossfade + scale + blur + spring x). Sprint 2 mantiene
 * la default para parejas genéricas y agrega 3 overrides custom para
 * parejas semánticamente especiales:
 *
 *   • 0 → 1 (Cero → 15 horas)        → slide-up-numeric (verticalidad
 *                                       respeta que ambos son cifras)
 *   • 2 → 3 ($312k → 7s)             → slow-fade (cambio de eje narrativo
 *                                       perdiste/ganás — necesita respiro)
 *   • 4 ↔ 0 (3ª sesión → Cero loop)  → cinematic-blur (reset de ciclo,
 *                                       no un next slide)
 *
 * Reduced-motion: TODOS los overrides se anulan a un fallback minimal
 * (opacity-only) cuando el user prefiere reduced-motion. El sistema sigue
 * legible sin transform/blur que puedan disparar el reflejo vestibular.
 */

import { AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import type { Variants } from "framer-motion";

import { MDiv } from "@/components/motion/m";
import { EASE } from "@/components/auth/motion-tokens";

interface SideArtStageProps {
  slideKey: string;
  /** Dirección del cambio: 1 = forward (next), -1 = backward (prev). */
  direction: 1 | -1;
  /** Índice anterior y actual — usados para seleccionar variant. */
  fromIdx: number;
  toIdx: number;
  /** Si el sistema debe respetar prefers-reduced-motion en variants. */
  reducedMotion?: boolean;
  children: ReactNode;
  className?: string;
}

// ─── Variants ───────────────────────────────────────────────────────────────

/**
 * Default direction-aware (la del sprint 1).
 * Crossfade + scale + blur + spring x. Para parejas sin override custom.
 */
const defaultDirectionAware: Variants = {
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
      opacity: { duration: 0.32, ease: EASE.tension },
      scale:   { duration: 0.42, ease: EASE.tension },
      x:       { type: "spring", stiffness: 320, damping: 34, mass: 0.9 },
      filter:  { duration: 0.36, ease: EASE.arrive },
    },
  },
  exit: (dir: 1 | -1) => ({
    opacity: 0,
    scale: 0.98,
    x: dir * -24,
    filter: "blur(4px)",
    transition: { duration: 0.24, ease: EASE.depart },
  }),
};

/**
 * Override 0 → 1 (Cero → 15 horas).
 * Ambos slides son afirmaciones de número — la default lateral (x: ±24)
 * corta el hilo conceptual. Override vertical: el número sube desde abajo,
 * el espectador siente que las cifras vienen de un mismo lugar conceptual.
 */
const slideUpNumeric: Variants = {
  enter: { opacity: 0, y: 32, filter: "blur(4px)" },
  center: {
    opacity: 1, y: 0, filter: "blur(0px)",
    transition: {
      opacity: { duration: 0.38, ease: EASE.arrive },
      y:       { duration: 0.42, ease: EASE.arrive },
      filter:  { duration: 0.32, ease: EASE.arrive },
    },
  },
  exit: {
    opacity: 0, y: -32, filter: "blur(4px)",
    transition: { duration: 0.24, ease: EASE.depart },
  },
};

/**
 * Override 2 → 3 (Plata → Siete).
 * Cambio de eje narrativo: "lo que perdés" → "lo que ganás". Merece
 * un respiro antes del cronómetro de 7 segundos. Pure cross-fade sin
 * geometría — calmar antes del clímax operacional.
 */
const slowFade: Variants = {
  enter: { opacity: 0 },
  center: {
    opacity: 1,
    transition: { duration: 0.6, ease: EASE.arrive },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.4, ease: EASE.depart },
  },
};

/**
 * Override 4 ↔ 0 (Tercera → Cero loop, también reverso 0 → Tercera).
 * Es el reset del ciclo — debe sentirse como "volver al inicio", no como
 * "next slide". Scale invertida (entra grande en lugar de chico), blur
 * deep, duración ~1 segundo. Cinematográfico.
 */
const cinematicBlur: Variants = {
  enter: { opacity: 0, scale: 1.04, filter: "blur(12px)" },
  center: {
    opacity: 1, scale: 1, filter: "blur(0px)",
    transition: {
      duration: 0.96,
      ease: EASE.arrive,
    },
  },
  exit: {
    opacity: 0, scale: 0.96, filter: "blur(8px)",
    transition: { duration: 0.48, ease: EASE.depart },
  },
};

/**
 * Reduced motion fallback — anula TODOS los overrides custom. Solo opacity,
 * sin scale, blur, x, y. Respeta el reflejo vestibular sin perder el
 * cambio de slide.
 */
const reducedMotionFallback: Variants = {
  enter: { opacity: 0 },
  center: {
    opacity: 1,
    transition: { duration: 0.16, ease: "linear" },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.12, ease: "linear" },
  },
};

// ─── Variant selector ───────────────────────────────────────────────────────

function getSlideVariants(fromIdx: number, toIdx: number, reduced: boolean): Variants {
  if (reduced) return reducedMotionFallback;

  const key = `${fromIdx}->${toIdx}`;
  // Custom overrides:
  if (key === "0->1") return slideUpNumeric;          // Cero → 15 horas
  if (key === "2->3") return slowFade;                // Plata → Siete
  if (key === "4->0" || key === "0->4") return cinematicBlur; // wraparound y reverso
  // Default direction-aware para todo lo demás.
  return defaultDirectionAware;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SideArtStage({
  slideKey,
  direction,
  fromIdx,
  toIdx,
  reducedMotion = false,
  children,
  className,
}: SideArtStageProps) {
  const variants = getSlideVariants(fromIdx, toIdx, reducedMotion);

  return (
    <AnimatePresence mode="popLayout" custom={direction} initial={false}>
      <MDiv
        key={slideKey}
        custom={direction}
        variants={variants}
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
