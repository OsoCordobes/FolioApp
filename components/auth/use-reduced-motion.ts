"use client";

/**
 * Folio · useReducedMotion
 *
 * Hook reactivo a la media query `prefers-reduced-motion: reduce`. Devuelve
 * `true` cuando el sistema operativo o navegador del usuario tiene la
 * preferencia activada — por ej. macOS · Settings → Accessibility → Display →
 * Reduce motion; Windows 11 · Settings → Accessibility → Visual effects →
 * Animation effects OFF.
 *
 * Se actualiza en runtime sin reload: si el user cambia la preferencia
 * mientras la app está abierta, los componentes que usan este hook
 * re-renderean automáticamente.
 *
 * Usado por hooks no-FM (`useCountUp`, `usePhaseSequence`) y componentes que
 * deciden coreografías condicionales. Framer-motion tiene su propio
 * `useReducedMotion` exportado; preferimos uno propio para no acoplar archivos
 * non-FM a la lib.
 */

import { useEffect, useState } from "react";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MEDIA_QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Helper síncrono (no-hook) para chequear la preferencia desde código
 * imperativo (useEffect, callbacks). NO triggea re-render. Usar `useReducedMotion`
 * cuando el componente necesita reaccionar a cambios; usar este cuando el
 * chequeo es one-shot dentro de un effect.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}
