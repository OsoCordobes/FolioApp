/**
 * Folio · instrumentos · NDI (Neck Disability Index, discapacidad cervical).
 *
 * 10 secciones, cada una 0–5. Total 0–50; el porcentaje de discapacidad es
 * total × 2 (0–100 %). Bandas por total crudo (Vernon & Mior):
 *   0–4 ninguna · 5–14 leve · 15–24 moderada · 25–34 severa · 35–50 completa.
 * El cambio mínimo detectable es ~5 puntos (10 %). Función de seguimiento
 * funcional, NO diagnóstico. Ítems es-AR (dominios estándar del NDI).
 */

import type { InstrumentoDef, OpcionRespuesta, ScoreInstrumento } from "../types";
import { bandaPorCorte, sumaLikert } from "./_shared";

export const NDI_LEN = 10;

const OPCIONES: readonly OpcionRespuesta[] = [
  { label: "0 — sin dificultad", valor: 0 },
  { label: "1 — dificultad mínima", valor: 1 },
  { label: "2 — dificultad moderada", valor: 2 },
  { label: "3 — dificultad importante", valor: 3 },
  { label: "4 — dificultad severa", valor: 4 },
  { label: "5 — imposible / máxima", valor: 5 },
];

const ENUNCIADOS = [
  "Intensidad del dolor de cuello",
  "Cuidado personal (lavarse, vestirse, etc.)",
  "Levantar objetos",
  "Lectura",
  "Dolores de cabeza",
  "Concentración",
  "Trabajo",
  "Conducir",
  "Dormir",
  "Actividades recreativas",
] as const;

const BANDA_LABELS: Record<string, string> = {
  ninguna: "ninguna",
  leve: "leve",
  moderada: "moderada",
  severa: "severa",
  completa: "completa",
};

/**
 * Puntúa el NDI. `respuestas` = `number[]` de 10 enteros 0–5, en orden.
 * Devuelve `null` si el cuestionario está incompleto o inválido. `total` es el
 * puntaje crudo (0–50); la interpretación reporta también el porcentaje (×2).
 */
export function scoreNdi(respuestas: unknown): ScoreInstrumento | null {
  const total = sumaLikert(respuestas, NDI_LEN, 0, 5);
  if (total === null) return null;

  const banda = bandaPorCorte(total, [
    { hasta: 4, id: "ninguna" },
    { hasta: 14, id: "leve" },
    { hasta: 24, id: "moderada" },
    { hasta: 34, id: "severa" },
    { hasta: Infinity, id: "completa" },
  ]);

  const porcentaje = total * 2;
  return {
    total,
    banda,
    interpretacion: `NDI ${total}/50 (${porcentaje} %) — discapacidad cervical ${BANDA_LABELS[banda]}`,
  };
}

export const ndi: InstrumentoDef = {
  id: "ndi.v1",
  nombre: "NDI",
  descripcion: "Índice de discapacidad cervical (10 secciones). Seguimiento funcional.",
  dominio: "dolor_funcion",
  consigna:
    "Marcá, en cada sección, la afirmación que mejor describe tu situación en este momento.",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado) => ({ enunciado })),
  bandas: [
    { id: "ninguna", label: "Ninguna" },
    { id: "leve", label: "Leve" },
    { id: "moderada", label: "Moderada" },
    { id: "severa", label: "Severa" },
    { id: "completa", label: "Completa" },
  ],
  score: scoreNdi,
};
