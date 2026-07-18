/**
 * Folio · instrumentos · Borg RPE (Rating of Perceived Exertion, escala 6–20).
 *
 * Escala original de Borg (1970): un único valor entero 6–20 que estima el
 * esfuerzo percibido durante el ejercicio (6 ≈ reposo total, 20 ≈ esfuerzo
 * máximo). Diseñada para que ×10 aproxime la frecuencia cardíaca. Bandas de
 * interpretación es-AR:
 *   6–8 muy ligero · 9–11 ligero · 12–14 moderado · 15–17 intenso · 18–20 máximo.
 * A diferencia de las escalas Likert sumadas, el instrumento tiene un solo
 * ítem: `respuestas` es el número directamente (o `[n]`, tolerado). Seguimiento,
 * NO diagnóstico.
 */

import type { InstrumentoDef, OpcionRespuesta, ScoreInstrumento } from "../types";
import { bandaPorCorte } from "./_shared";

export const BORG_MIN = 6;
export const BORG_MAX = 20;

/** Anclas verbales estándar de la escala Borg 6–20 (es-AR). */
const ANCLAS: Record<number, string> = {
  6: "Sin esfuerzo",
  7: "Extremadamente suave",
  9: "Muy suave",
  11: "Suave",
  13: "Algo intenso",
  15: "Intenso",
  17: "Muy intenso",
  19: "Extremadamente intenso",
  20: "Esfuerzo máximo",
};

/** Opciones 6..20 con sus anclas verbales (para un select en la UI). */
const OPCIONES: readonly OpcionRespuesta[] = Array.from(
  { length: BORG_MAX - BORG_MIN + 1 },
  (_, i) => {
    const valor = BORG_MIN + i;
    const ancla = ANCLAS[valor];
    return { label: ancla ? `${valor} — ${ancla}` : String(valor), valor };
  },
);

const BANDA_LABELS: Record<string, string> = {
  muy_ligero: "muy ligero",
  ligero: "ligero",
  moderado: "moderado",
  intenso: "intenso",
  maximo: "máximo",
};

/** Normaliza la respuesta a un entero Borg válido, o `null`. Acepta `n` o `[n]`. */
function normalizarBorg(respuestas: unknown): number | null {
  const raw = Array.isArray(respuestas) ? respuestas[0] : respuestas;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < BORG_MIN || raw > BORG_MAX) {
    return null;
  }
  return raw;
}

/**
 * Puntúa la escala Borg. `respuestas` = un entero 6–20 (o `[n]`). Devuelve
 * `null` si no hay un valor válido. `total` = el valor Borg elegido.
 */
export function scoreBorg(respuestas: unknown): ScoreInstrumento | null {
  const valor = normalizarBorg(respuestas);
  if (valor === null) return null;

  const banda = bandaPorCorte(valor, [
    { hasta: 8, id: "muy_ligero" },
    { hasta: 11, id: "ligero" },
    { hasta: 14, id: "moderado" },
    { hasta: 17, id: "intenso" },
    { hasta: Infinity, id: "maximo" },
  ]);

  return {
    total: valor,
    banda,
    interpretacion: `Borg ${valor}/20 — esfuerzo percibido ${BANDA_LABELS[banda]}`,
  };
}

export const borg: InstrumentoDef = {
  id: "borg.v1",
  nombre: "Borg RPE",
  descripcion: "Esfuerzo percibido durante el ejercicio (escala 6–20). Seguimiento.",
  dominio: "esfuerzo_percibido",
  consigna: "Indicá el nivel de esfuerzo percibido durante la actividad.",
  opciones: OPCIONES,
  items: [{ enunciado: "Esfuerzo percibido" }],
  bandas: [
    { id: "muy_ligero", label: "Muy ligero" },
    { id: "ligero", label: "Ligero" },
    { id: "moderado", label: "Moderado" },
    { id: "intenso", label: "Intenso" },
    { id: "maximo", label: "Máximo" },
  ],
  score: scoreBorg,
};
