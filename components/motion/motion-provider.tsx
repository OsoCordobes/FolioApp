"use client";

/**
 * Folio · MotionProvider
 *
 * Wrap del client tree con framer-motion lazy:
 *   - LazyMotion features={domAnimation}: animación y gestos simples.
 *     El acceso actual no usa drag, layout ni shared elements; no descarga
 *     las features del carrusel anterior.
 *   - strict={true} → lanza runtime error si alguien usa <motion.*> en vez
 *     de <m.*>. Combinado con el ESLint guard, el bundle no se infla.
 *   - MotionConfig reducedMotion="user" → todos los componentes FM respetan
 *     prefers-reduced-motion del sistema automáticamente.
 *
 * Montar en cada pública route que use el SideArt o cualquier componente
 * que importe `m` o `AnimatePresence`. NO se monta global en root layout
 * porque inflaría el bundle de páginas server-only que no necesitan motion.
 */

import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import type { ReactNode } from "react";

interface MotionProviderProps {
  children: ReactNode;
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
