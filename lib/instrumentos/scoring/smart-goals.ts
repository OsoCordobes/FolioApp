/**
 * Folio · instrumentos · objetivos SMART (Specific, Measurable, Achievable,
 * Relevant, Time-bound).
 *
 * NO es una escala de tamizaje: es una planilla estructurada para definir y
 * seguir objetivos terapéuticos/rehabilitación con los cinco criterios SMART.
 * El "score" cuenta cuántos criterios cumple el objetivo (0–5, `total`) y la
 * banda refleja la calidad/completitud del objetivo:
 *   0–2 criterios → incompleto · 3–4 → parcial · 5 → completo (SMART pleno).
 * El `estado` del objetivo (en_curso / logrado / pausado) viaja como flag para
 * el seguimiento. Función pura; el texto libre del objetivo NUNCA se loguea.
 *
 * `respuestas` = objeto estructurado:
 *   { texto: string, especifico, medible, alcanzable, relevante, temporal:
 *     boolean, estado: "en_curso"|"logrado"|"pausado" }
 */

import type { InstrumentoDef, ScoreInstrumento } from "../types";

/** Los cinco criterios SMART, en orden. */
export const CRITERIOS_SMART = [
  "especifico",
  "medible",
  "alcanzable",
  "relevante",
  "temporal",
] as const;

export type CriterioSmart = (typeof CRITERIOS_SMART)[number];

export const CRITERIO_LABELS: Record<CriterioSmart, string> = {
  especifico: "Específico",
  medible: "Medible",
  alcanzable: "Alcanzable",
  relevante: "Relevante",
  temporal: "Con plazo",
};

export const ESTADOS_OBJETIVO = ["en_curso", "logrado", "pausado"] as const;
export type EstadoObjetivo = (typeof ESTADOS_OBJETIVO)[number];

export const ESTADO_OBJETIVO_LABELS: Record<EstadoObjetivo, string> = {
  en_curso: "En curso",
  logrado: "Logrado",
  pausado: "Pausado",
};

/** Flag con el estado del objetivo (para tendencias/seguimiento). */
export const SMART_FLAG_ESTADO: Record<EstadoObjetivo, string> = {
  en_curso: "objetivo_en_curso",
  logrado: "objetivo_logrado",
  pausado: "objetivo_pausado",
};

const BANDA_LABELS: Record<string, string> = {
  incompleto: "incompleto",
  parcial: "parcial",
  completo: "SMART pleno",
};

interface SmartInput {
  texto: string;
  especifico: boolean;
  medible: boolean;
  alcanzable: boolean;
  relevante: boolean;
  temporal: boolean;
  estado: EstadoObjetivo;
}

/** Valida y normaliza el input estructurado del objetivo SMART, o `null`. */
function normalizar(respuestas: unknown): SmartInput | null {
  if (respuestas === null || typeof respuestas !== "object" || Array.isArray(respuestas)) {
    return null;
  }
  const o = respuestas as Record<string, unknown>;

  if (typeof o.texto !== "string" || o.texto.trim().length === 0) return null;
  if (typeof o.estado !== "string" || !ESTADOS_OBJETIVO.includes(o.estado as EstadoObjetivo)) {
    return null;
  }
  for (const c of CRITERIOS_SMART) {
    if (typeof o[c] !== "boolean") return null;
  }

  return {
    texto: o.texto,
    especifico: o.especifico as boolean,
    medible: o.medible as boolean,
    alcanzable: o.alcanzable as boolean,
    relevante: o.relevante as boolean,
    temporal: o.temporal as boolean,
    estado: o.estado as EstadoObjetivo,
  };
}

/**
 * Puntúa un objetivo SMART. Devuelve `null` si el objetivo es inválido
 * (sin texto o estado fuera de catálogo o criterios no booleanos). `total` =
 * cantidad de criterios SMART cumplidos (0–5); banda por completitud; flag con
 * el estado del objetivo.
 */
export function scoreSmartGoal(respuestas: unknown): ScoreInstrumento | null {
  const g = normalizar(respuestas);
  if (g === null) return null;

  const cumplidos = CRITERIOS_SMART.filter((c) => g[c]).length;

  const banda = cumplidos <= 2 ? "incompleto" : cumplidos <= 4 ? "parcial" : "completo";

  return {
    total: cumplidos,
    banda,
    interpretacion: `Objetivo SMART ${BANDA_LABELS[banda]} (${cumplidos}/5 criterios) · ${ESTADO_OBJETIVO_LABELS[g.estado]}`,
    flags: [SMART_FLAG_ESTADO[g.estado]],
  };
}

export const smartGoals: InstrumentoDef = {
  id: "smart_goals.v1",
  nombre: "Objetivos SMART",
  descripcion:
    "Planilla estructurada de objetivos terapéuticos (Específico, Medible, Alcanzable, Relevante, con plazo).",
  dominio: "objetivos",
  consigna: "Definí el objetivo y marcá qué criterios SMART cumple.",
  items: [
    { enunciado: "Objetivo (texto libre)" },
    { enunciado: CRITERIO_LABELS.especifico },
    { enunciado: CRITERIO_LABELS.medible },
    { enunciado: CRITERIO_LABELS.alcanzable },
    { enunciado: CRITERIO_LABELS.relevante },
    { enunciado: CRITERIO_LABELS.temporal },
  ],
  bandas: [
    { id: "incompleto", label: "Incompleto" },
    { id: "parcial", label: "Parcial" },
    { id: "completo", label: "SMART pleno" },
  ],
  score: scoreSmartGoal,
};
