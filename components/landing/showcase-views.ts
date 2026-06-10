/**
 * Folio · Landing — metadata de las vistas del showcase (#showcase) (Fase B · B3).
 *
 * Módulo liviano SIN "use client" ni imports pesados: lo comparten
 *   - product-showcase.tsx (wrapper liviano — renderiza el skeleton/placeholder
 *     con los mismos labels/captions para reservar altura idéntica, CLS ~0), y
 *   - product-showcase-carousel.tsx (island pesado con framer-motion, cargado
 *     vía next/dynamic recién cuando la sección se acerca al viewport).
 *
 * Los ids matchean los tints `--slide-tint` definidos en el CSS del showcase
 * (.fl-showcase-stage[data-view="…"]) y el mapa id → slide del carousel.
 */

export type ShowcaseViewId = "agenda" | "calendario" | "finanzas";

export interface ShowcaseView {
  id: ShowcaseViewId;
  /** Label corto del tab. */
  tab: string;
  /** Caption de 1 línea bajo el label. */
  caption: string;
}

export const SHOWCASE_VIEWS: readonly ShowcaseView[] = [
  {
    id: "agenda",
    tab: "Tu día",
    caption: "Folio te arma la agenda y las fichas antes de que llegues.",
  },
  {
    id: "calendario",
    tab: "Calendario",
    caption: "Reservas, cobros y recordatorios corren solos mientras atendés.",
  },
  {
    id: "finanzas",
    tab: "Finanzas",
    caption: "Recaudado, sesiones y tu mejor día — el mes en una mirada.",
  },
];

/** Auto-advance del carousel (~6s por vista; se pausa en hover/focus/interacción). */
export const SHOWCASE_AUTO_ADVANCE_MS = 6000;
