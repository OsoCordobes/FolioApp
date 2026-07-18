/**
 * Folio · instrumentos · PHQ-9 (Patient Health Questionnaire, depresión).
 *
 * 9 ítems, opciones 0–3 ("En las últimas 2 semanas…"). Total 0–27. Bandas
 * estándar: 0–4 mínima, 5–9 leve, 10–14 moderada, 15–19 moderadamente severa,
 * 20–27 severa. El ítem 9 (ideación) emite una flag si > 0. Tamizaje, NO
 * diagnóstico. Ítems es-AR adaptados al voseo (mismos que psicología.escalas.v1
 * para continuidad — ver lib/especialidades/psicologia/schema.ts).
 */

import type { InstrumentoDef, OpcionRespuesta, ScoreInstrumento } from "../types";
import { bandaPorCorte, sumaLikert } from "./_shared";

export const PHQ9_LEN = 9;

/** Índice (0-based) del ítem de ideación — flag clínica si > 0. */
export const PHQ9_ITEM_IDEACION = 8;

/** Flag emitida cuando el ítem 9 (ideación) es > 0. */
export const PHQ9_FLAG_IDEACION = "ideacion_item9";

const OPCIONES: readonly OpcionRespuesta[] = [
  { label: "Para nada", valor: 0 },
  { label: "Varios días", valor: 1 },
  { label: "Más de la mitad de los días", valor: 2 },
  { label: "Casi todos los días", valor: 3 },
];

const ENUNCIADOS = [
  "Poco interés o placer en hacer las cosas",
  "Sentirte decaído/a, deprimido/a o sin esperanza",
  "Problemas para dormirte, para seguir durmiendo o dormir demasiado",
  "Sentirte cansado/a o con poca energía",
  "Poco apetito o comer en exceso",
  "Sentirte mal con vos mismo/a — o sentir que sos un fracaso o que les fallaste a tu familia o a vos mismo/a",
  "Dificultad para concentrarte en cosas como leer el diario o mirar televisión",
  "Moverte o hablar tan lento que otras personas lo pudieron haber notado — o lo contrario: estar tan inquieto/a o agitado/a que te moviste mucho más de lo habitual",
  "Pensar que estarías mejor muerto/a o en lastimarte de alguna manera",
] as const;

const BANDA_LABELS: Record<string, string> = {
  minima: "mínima",
  leve: "leve",
  moderada: "moderada",
  moderadamente_severa: "moderadamente severa",
  severa: "severa",
};

/**
 * Puntúa el PHQ-9. `respuestas` = `number[]` de 9 enteros 0–3, en orden.
 * Devuelve `null` si la escala está incompleta o inválida. Emite la flag de
 * ideación si el ítem 9 > 0.
 */
export function scorePhq9(respuestas: unknown): ScoreInstrumento | null {
  const total = sumaLikert(respuestas, PHQ9_LEN, 0, 3);
  if (total === null) return null;

  const banda = bandaPorCorte(total, [
    { hasta: 4, id: "minima" },
    { hasta: 9, id: "leve" },
    { hasta: 14, id: "moderada" },
    { hasta: 19, id: "moderadamente_severa" },
    { hasta: Infinity, id: "severa" },
  ]);

  const flags: string[] = [];
  const item9 = (respuestas as number[])[PHQ9_ITEM_IDEACION];
  if (item9 > 0) flags.push(PHQ9_FLAG_IDEACION);

  const etiqueta = BANDA_LABELS[banda];
  return {
    total,
    banda,
    interpretacion: `Depresión ${etiqueta} (tamizaje, no diagnóstico)`,
    ...(flags.length > 0 ? { flags } : {}),
  };
}

export const phq9: InstrumentoDef = {
  id: "phq9.v1",
  nombre: "PHQ-9",
  descripcion: "Tamizaje de depresión (9 ítems). No reemplaza el criterio clínico.",
  dominio: "salud_mental",
  consigna:
    "En las últimas 2 semanas, ¿con qué frecuencia te molestó cada uno de estos problemas?",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado) => ({ enunciado })),
  bandas: [
    { id: "minima", label: "Mínima" },
    { id: "leve", label: "Leve" },
    { id: "moderada", label: "Moderada" },
    { id: "moderadamente_severa", label: "Moderadamente severa" },
    { id: "severa", label: "Severa" },
  ],
  score: scorePhq9,
};
