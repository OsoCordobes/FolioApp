import type { CSSProperties } from "react";

/**
 * Folio · Landing — stagger de los reveals scroll-driven (`.fl-reveal`).
 *
 * Desplaza el inicio del animation-range vía la custom property
 * `--fl-reveal-range` (con animation-timeline: view() los delays temporales
 * no aplican). 5% por ítem, cap en 25%. Compartido por las secciones del
 * landing (features, security, pricing, faq).
 */
export function revealRange(index: number): CSSProperties {
  return { "--fl-reveal-range": `${Math.min(index * 5, 25)}%` } as CSSProperties;
}
