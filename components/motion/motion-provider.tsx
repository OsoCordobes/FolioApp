"use client";

/**
 * Folio · MotionProvider
 *
 * Wrap del client tree con framer-motion lazy:
 *   - LazyMotion features={domMax} → carga las layout features (necesarias
 *     para shared elements vía layoutId). +5 KB sobre domAnimation, pero es
 *     el killer feature del SideArt v2 ("$221k" Calendario → "$1.2M" Finanzas).
 *   - strict={true} → lanza runtime error si alguien usa <motion.*> en vez
 *     de <m.*>. Combinado con el ESLint guard, el bundle no se infla.
 *   - MotionConfig reducedMotion="user" → todos los componentes FM respetan
 *     prefers-reduced-motion del sistema automáticamente.
 *
 * Montar en cada pública route que use el SideArt o cualquier componente
 * que importe `m` o `AnimatePresence`. NO se monta global en root layout
 * porque inflaría el bundle de páginas server-only que no necesitan motion.
 */

import { LazyMotion, MotionConfig, domMax } from "framer-motion";
import type { ReactNode } from "react";

interface MotionProviderProps {
  children: ReactNode;
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
