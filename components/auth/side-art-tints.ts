"use client";

/**
 * Folio · SideArt v3 tints
 *
 * Cada slide del carousel aplica un className tint al <aside class="au2-art">
 * que tinta sutilmente el background glow + grid del SideArt. La interpolación
 * entre tints es CSS-only (transition: background 720ms) — no se anima la
 * variable CSS directamente sino el `background` resuelto.
 *
 * Tints semánticos (v3 manifest):
 *   - cero     → 0% accent (manifiesto silencio cromático del slide 1)
 *   - horas    → base brass + sutil verdoso (productividad recuperada)
 *   - plata    → base brass + ámbar cálido (cierre financiero)
 *   - siete    → base brass + slate frío (decisión, acción)
 *   - tercera  → base brass + púrpura sutil (memoria, IA premium)
 */

export const TINT_CLASSES = [
  "au2-art--tint-cero",
  "au2-art--tint-horas",
  "au2-art--tint-plata",
  "au2-art--tint-siete",
  "au2-art--tint-tercera",
] as const;

export type TintClass = (typeof TINT_CLASSES)[number];

export function tintClassFor(idx: number): TintClass {
  const n = TINT_CLASSES.length;
  return TINT_CLASSES[((idx % n) + n) % n];
}
