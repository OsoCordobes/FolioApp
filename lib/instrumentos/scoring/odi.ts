/**
 * Folio · instrumentos · ODI (Oswestry Disability Index, lumbalgia).
 *
 * 10 secciones, cada una 0–5. El índice es un PORCENTAJE: (suma / máximo posible)
 * × 100. Con las 10 secciones respondidas el máximo es 50, así que
 * porcentaje = total × 2. Bandas por porcentaje (Fairbank):
 *   0–20 mínima · 21–40 moderada · 41–60 severa · 61–80 incapacitante · 81–100 máxima.
 * Seguimiento funcional, NO diagnóstico. Ítems es-AR (secciones estándar del
 * ODI). Esta versión puntúa sólo el cuestionario completo (10 secciones); la UI
 * (C3) puede permitir omitir la sección de vida sexual ajustando el denominador,
 * pero el scoring canónico exige las 10 para un resultado determinista.
 */

import type { InstrumentoDef, OpcionRespuesta, ScoreInstrumento } from "../types";
import { bandaPorCorte, sumaLikert } from "./_shared";

export const ODI_LEN = 10;

const OPCIONES: readonly OpcionRespuesta[] = [
  { label: "0 — sin limitación", valor: 0 },
  { label: "1 — limitación mínima", valor: 1 },
  { label: "2 — limitación moderada", valor: 2 },
  { label: "3 — limitación importante", valor: 3 },
  { label: "4 — limitación severa", valor: 4 },
  { label: "5 — limitación máxima", valor: 5 },
];

const ENUNCIADOS = [
  "Intensidad del dolor",
  "Cuidado personal (lavarse, vestirse)",
  "Levantar objetos",
  "Caminar",
  "Estar sentado/a",
  "Estar de pie",
  "Dormir",
  "Vida sexual (si aplica)",
  "Vida social",
  "Viajar / desplazarse",
] as const;

const BANDA_LABELS: Record<string, string> = {
  minima: "mínima",
  moderada: "moderada",
  severa: "severa",
  incapacitante: "incapacitante",
  maxima: "máxima",
};

/**
 * Puntúa el ODI. `respuestas` = `number[]` de 10 enteros 0–5, en orden.
 * Devuelve `null` si el cuestionario está incompleto o inválido. `total` es el
 * porcentaje (0–100), redondeado; la banda se resuelve sobre ese porcentaje.
 */
export function scoreOdi(respuestas: unknown): ScoreInstrumento | null {
  const bruto = sumaLikert(respuestas, ODI_LEN, 0, 5);
  if (bruto === null) return null;

  // Con las 10 secciones respondidas el máximo es 50 → porcentaje = bruto × 2.
  const porcentaje = Math.round((bruto / (ODI_LEN * 5)) * 100);

  const banda = bandaPorCorte(porcentaje, [
    { hasta: 20, id: "minima" },
    { hasta: 40, id: "moderada" },
    { hasta: 60, id: "severa" },
    { hasta: 80, id: "incapacitante" },
    { hasta: Infinity, id: "maxima" },
  ]);

  return {
    total: porcentaje,
    banda,
    interpretacion: `ODI ${porcentaje} % — discapacidad ${BANDA_LABELS[banda]}`,
  };
}

export const odi: InstrumentoDef = {
  id: "odi.v1",
  nombre: "ODI",
  descripcion: "Índice de discapacidad de Oswestry (10 secciones, lumbalgia). Seguimiento funcional.",
  dominio: "dolor_funcion",
  consigna:
    "Marcá, en cada sección, la afirmación que mejor describe tu situación en este momento.",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado) => ({ enunciado })),
  bandas: [
    { id: "minima", label: "Mínima" },
    { id: "moderada", label: "Moderada" },
    { id: "severa", label: "Severa" },
    { id: "incapacitante", label: "Incapacitante" },
    { id: "maxima", label: "Máxima" },
  ],
  score: scoreOdi,
};
