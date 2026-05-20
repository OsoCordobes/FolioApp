/**
 * Folio · SideArt v3 · motion tokens.
 *
 * Constantes de easing + spring para los slides tipográficos del manifesto.
 * Existen para PREVENIR cubic-bezier hardcoded en variants TSX (el pecado
 * original que el sprint 1 atacó con 138 reemplazos en CSS — no queremos
 * recrearlo en JS).
 *
 * 5 easings semánticos según uso, NO según forma matemática:
 *   - arrive  → entradas de elementos (verbos `reveal` y `settle`)
 *   - depart  → salidas / exits (verbo `dim`)
 *   - tension → barras y líneas que se dibujan (verbo `draw` no-cronómetro)
 *   - feel    → spring para micro-énfasis (verbo `pulse`)
 *   - measure → linear obligatorio, sólo para cronómetros literales (slide 4)
 *
 * Mapeo a los tokens CSS del sprint 1 (`public/folio.css` líneas 55–130):
 *   arrive   = var(--ease-emphasized-out) = cubic-bezier(0, 0, .2, 1)
 *   depart   = var(--ease-emphasized-in)  = cubic-bezier(.4, 0, 1, 1)
 *   tension  = var(--ease-emphasized)     = cubic-bezier(.32, .72, 0, 1)
 *   feel     = var(--spring-soft) approx  ≈ spring stiffness 280 damping 26
 *   measure  = "linear" (palabra clave, no token)
 *
 * Exclusiones explícitas: --ease-overshoot, --ease-anticipate, --spring-bouncy,
 * --spring-snap NO se usan en SideArt v3. Los slides son tipografía pura;
 * ningún elemento "celebra" con bounce/overshoot. Si en el futuro un slide
 * necesita uno, primero debe pasar por revisión: probablemente no encaja
 * en el manifesto.
 */

export const EASE = {
  arrive:  [0, 0, 0.2, 1] as const,
  depart:  [0.4, 0, 1, 1] as const,
  tension: [0.32, 0.72, 0, 1] as const,
} as const;

export const SPRING = {
  feel: {
    type: "spring" as const,
    stiffness: 280,
    damping: 26,
    mass: 0.8,
  },
} as const;

/** Duraciones canónicas para variants FM (en segundos, no ms). */
export const DUR = {
  instant: 0.08,
  quick:   0.14,
  snappy:  0.22,
  moderate: 0.32,
  deliberate: 0.48,
  cinematic: 0.72,
  storytelling: 1.2,
} as const;
