"use client";

/**
 * Folio · Auth · hook count-up.
 *
 * Port fiel de useCountUp en folio/auth.jsx (líneas 38-55). Anima un número
 * desde 0 hasta `target` durante `durationMs`, easing cubic-bezier(.2,.8,.2,1)
 * (equivalente a 1 - (1-t)^3). Resetea a 0 cuando `active` se vuelve true.
 */

import { useEffect, useState } from "react";

export function useCountUp(target: number, durationMs: number, active: boolean): number {
  const [val, setVal] = useState<number>(active ? 0 : target);
  useEffect(() => {
    if (!active) {
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
