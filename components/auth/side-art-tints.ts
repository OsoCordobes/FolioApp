"use client";

/**
 * Folio · SideArt tints
 *
 * Cada slide del carousel aplica un className tint al `<aside class="au2-art">`
 * que tinta sutilmente el background glow + grid del SideArt. La interpolación
 * entre tints es CSS-only (`transition: background 720ms`) — no se anima la
 * variable CSS directamente sino el `background` resuelto.
 *
 * Tints semánticos:
 *   - agenda     → brass puro (default, mañana calma)
 *   - calendario → +verdoso (productivo, "todo trabaja")
 *   - finanzas   → +ámbar cálido (cierre del día)
 *   - reagenda   → +slate frío (decision moment)
 *   - ia         → +púrpura sutil (IA brand)
 *
 * Las reglas CSS viven en public/folio.css cerca del bloque .au2-art-glow.
 * Este archivo solo exporta las constantes para el componente que las aplica.
 *
 * Las reglas CSS se agregan en C12 (background tints). En este punto del
 * sprint (C7 split) las clases existen para que side-art.tsx pueda
 * referenciarlas, pero no tienen estilos asociados todavía — son no-op.
 */

export const TINT_CLASSES = [
  "au2-art--tint-agenda",
  "au2-art--tint-calendario",
  "au2-art--tint-finanzas",
  "au2-art--tint-reagenda",
  "au2-art--tint-ia",
] as const;

export type TintClass = (typeof TINT_CLASSES)[number];

export function tintClassFor(idx: number): TintClass {
  const n = TINT_CLASSES.length;
  return TINT_CLASSES[((idx % n) + n) % n];
}
