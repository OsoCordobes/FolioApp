"use client";

/**
 * Folio · usePhaseSequence
 *
 * Reemplaza chains de `setTimeout` encadenados en los slides del SideArt con
 * un hook reusable. Recibe un array de timings (ms desde T0) y devuelve el
 * `phase` actual (0 = inicial, length = final).
 *
 * Garantías:
 *   - Cleanup automático de todos los timers al desmontar o al cambiar `active`.
 *   - Reset a `phase: 0` cuando `active: false` (slide salió de viewport).
 *   - Respeta `prefers-reduced-motion: reduce`: salta directo al phase final
 *     (todos los `is-on`, `is-checked`, `is-done` activos sin esperar).
 *
 * Uso:
 *   const PHASES_AGENDA = [900, 1200, 1500, 1800, 2700, 4000] as const;
 *   const phase = usePhaseSequence(PHASES_AGENDA, active);
 *
 *   {phase >= 1 && <CheckRow1 />}
 *   {phase >= 2 && <CheckRow2 />}
 *   ...
 *
 * IMPORTANTE: `timingsMs` DEBE definirse a nivel module (no inline en render)
 * para estabilidad referencial del useEffect. Sino, cada render reinicia los
 * timers y la animación nunca avanza.
 */

import { useEffect, useState } from "react";

import { prefersReducedMotion } from "./use-reduced-motion";

interface PhaseSequenceOpts {
  /** Si true, los timers se cancelan al desactivar y phase vuelve a 0. Default true. */
  resetOnInactive?: boolean;
  /** Si true y el user prefiere reduced motion, salta al phase final. Default true. */
  respectReducedMotion?: boolean;
}

export function usePhaseSequence(
  timingsMs: readonly number[],
  active: boolean,
  opts: PhaseSequenceOpts = {},
): number {
  const { resetOnInactive = true, respectReducedMotion = true } = opts;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      if (resetOnInactive) setPhase(0);
      return;
    }

    // Reduced motion → skip-to-end. El UI muestra el estado final inmediato.
    if (respectReducedMotion && prefersReducedMotion()) {
      setPhase(timingsMs.length);
      return;
    }

    setPhase(0);
    const timers = timingsMs.map((ms, i) =>
      window.setTimeout(() => setPhase(i + 1), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [active, timingsMs, resetOnInactive, respectReducedMotion]);

  return phase;
}
