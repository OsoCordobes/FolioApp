import type { CSSProperties } from "react";

/**
 * Folio · Landing — stagger de los reveals scroll-driven (`.fl-reveal`).
 *
 * Desplaza el inicio del animation-range vía la custom property
 * `--fl-reveal-range` (con animation-timeline: view() los delays temporales
 * no aplican). 6% por ítem, cap en 30% — paso un pelín mayor para que el
 * escalonado se lea como secuencia con el range de reveal ahora más largo
 * (entry 0%→80%). Compartido por las secciones del landing.
 */
export function revealRange(index: number): CSSProperties {
  return { "--fl-reveal-range": `${Math.min(index * 6, 30)}%` } as CSSProperties;
}
