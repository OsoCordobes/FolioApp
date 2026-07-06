/**
 * Folio · instrumentos · GAD-7 (Generalized Anxiety Disorder, ansiedad).
 *
 * 7 ítems, opciones 0–3 ("En las últimas 2 semanas…"). Total 0–21. Bandas
 * estándar: 0–4 mínima, 5–9 leve, 10–14 moderada, 15–21 severa. Tamizaje, NO
 * diagnóstico. Ítems es-AR adaptados al voseo (mismos que
 * psicologia.escalas.v1 — ver lib/especialidades/psicologia/schema.ts).
 */

import type { InstrumentoDef, OpcionRespuesta, ScoreInstrumento } from "../types";
import { bandaPorCorte, sumaLikert } from "./_shared";

export const GAD7_LEN = 7;

const OPCIONES: readonly OpcionRespuesta[] = [
  { label: "Para nada", valor: 0 },
  { label: "Varios días", valor: 1 },
  { label: "Más de la mitad de los días", valor: 2 },
  { label: "Casi todos los días", valor: 3 },
];

const ENUNCIADOS = [
  "Sentirte nervioso/a, ansioso/a o muy alterado/a",
  "No poder dejar de preocuparte o no poder controlar la preocupación",
  "Preocuparte demasiado por diferentes cosas",
  "Dificultad para relajarte",
  "Estar tan inquieto/a que te cuesta quedarte quieto/a",
  "Enojarte o irritarte con facilidad",
  "Sentir miedo, como si algo terrible fuera a pasar",
] as const;

const BANDA_LABELS: Record<string, string> = {
  minima: "mínima",
  leve: "leve",
  moderada: "moderada",
  severa: "severa",
};

/**
 * Puntúa el GAD-7. `respuestas` = `number[]` de 7 enteros 0–3, en orden.
 * Devuelve `null` si la escala está incompleta o inválida.
 */
export function scoreGad7(respuestas: unknown): ScoreInstrumento | null {
  const total = sumaLikert(respuestas, GAD7_LEN, 0, 3);
  if (total === null) return null;

  const banda = bandaPorCorte(total, [
    { hasta: 4, id: "minima" },
    { hasta: 9, id: "leve" },
    { hasta: 14, id: "moderada" },
    { hasta: Infinity, id: "severa" },
  ]);

  const etiqueta = BANDA_LABELS[banda];
  return {
    total,
    banda,
    interpretacion: `Ansiedad ${etiqueta} (tamizaje, no diagnóstico)`,
  };
}

export const gad7: InstrumentoDef = {
  id: "gad7.v1",
  nombre: "GAD-7",
  descripcion: "Tamizaje de ansiedad generalizada (7 ítems). No reemplaza el criterio clínico.",
  dominio: "salud_mental",
  consigna:
    "En las últimas 2 semanas, ¿con qué frecuencia te molestó cada uno de estos problemas?",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado) => ({ enunciado })),
  bandas: [
    { id: "minima", label: "Mínima" },
    { id: "leve", label: "Leve" },
    { id: "moderada", label: "Moderada" },
    { id: "severa", label: "Severa" },
  ],
  score: scoreGad7,
};
