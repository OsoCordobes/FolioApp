"use client";

/**
 * Folio · Auth · hook count-up.
 *
 * Anima un número desde 0 hasta `target` durante `durationMs`, easing
 * easeOutCubic (1 - (1-t)^3). Útil para KPIs y métricas que entran con
 * efecto "contador subiendo".
 *
 * Respeta prefers-reduced-motion: si el user prefiere reduced motion, el
 * valor aparece en `target` inmediatamente sin tween (no time wasted, no
 * RAF loop activo).
 *
 * Resetea a 0 cuando `active` se vuelve true (para retriggerar al activar el
 * slide). Cuando `active: false`, queda en `target` (estado final preservado).
 */

import { useEffect, useState } from "react";

import { prefersReducedMotion } from "./use-reduced-motion";

export function useCountUp(target: number, durationMs: number, active: boolean): number {
  const [val, setVal] = useState<number>(active ? 0 : target);

  useEffect(() => {
    if (!active) {
      setVal(target);
      return;
    }

    // Reduced motion → skip-to-end. Sin RAF, sin tween.
    if (prefersReducedMotion()) {
      setVal(target);
      return;
    }

    let raf: number;
    let start: number | undefined;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    setVal(0);
    const step = (ts: number) => {
      if (start == null) start = ts;
      const t = Math.min(1, (ts - start) / durationMs);
      setVal(target * ease(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, active]);

  return val;
}
