/**
 * Folio · biblioteca de instrumentos · registry (server-safe, puro).
 *
 * Catálogo central de los instrumentos clínicos versionados. Cada def vive en
 * `scoring/<instrumento>.ts` (ítems es-AR + bandas + `score()` puro); este
 * módulo los reúne, los indexa por `id` y expone helpers de acceso.
 *
 * Aditivo: agregar un instrumento nuevo = importar su def y sumarla a la lista.
 * Los `id` incluyen versión (`dass21.v1`) — una versión nueva es una entrada
 * NUEVA, nunca una edición de la publicada (patrón de dos-ids de quiropraxia).
 *
 * No importa React ni toca la DB. La capa de persistencia (C2,
 * `lib/db/instrumentos.ts`) usa `getInstrumento(id)` para validar y recomputar
 * el score server-side al guardar una respuesta.
 */

import type { DominioInstrumento, InstrumentoDef } from "./types";

import { borg } from "./scoring/borg";
import { cssrs } from "./scoring/cssrs";
import { dass21 } from "./scoring/dass21";
import { gad7 } from "./scoring/gad7";
import { ndi } from "./scoring/ndi";
import { odi } from "./scoring/odi";
import { pcl5 } from "./scoring/pcl5";
import { phq9 } from "./scoring/phq9";
import { smartGoals } from "./scoring/smart-goals";

/**
 * Todos los instrumentos de la biblioteca, en orden de presentación por
 * dominio. El orden acá es el orden por defecto de la UI del catálogo (C3).
 */
export const INSTRUMENTOS: readonly InstrumentoDef[] = [
  // Salud mental
  phq9,
  gad7,
  dass21,
  pcl5,
  // Riesgo
  cssrs,
  // Dolor y función
  ndi,
  odi,
  // Esfuerzo percibido
  borg,
  // Objetivos
  smartGoals,
] as const;

/** Índice por `id` para lookup O(1). */
const POR_ID: ReadonlyMap<string, InstrumentoDef> = new Map(
  INSTRUMENTOS.map((i) => [i.id, i]),
);

/**
 * Devuelve la definición de un instrumento por `id` (p. ej. "dass21.v1"), o
 * `undefined` si no existe en la biblioteca. La capa de DB rechaza ids
 * desconocidos con este `undefined`.
 */
export function getInstrumento(id: string): InstrumentoDef | undefined {
  return POR_ID.get(id);
}

/** Instrumentos de un dominio dado, preservando el orden del catálogo. */
export function instrumentosPorDominio(
  dominio: DominioInstrumento,
): readonly InstrumentoDef[] {
  return INSTRUMENTOS.filter((i) => i.dominio === dominio);
}

/** Todos los ids del catálogo (para tests de integridad y validación). */
export function instrumentoIds(): readonly string[] {
  return INSTRUMENTOS.map((i) => i.id);
}
