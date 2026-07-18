/**
 * Folio · instrumentos · DASS-21 (Depression Anxiety Stress Scales, forma corta).
 *
 * 21 ítems, opciones 0–3 ("Durante la última semana…"). Tres subescalas de 7
 * ítems cada una; el puntaje de cada subescala se SUMA y se MULTIPLICA POR 2
 * para equipararlo al DASS-42 original. Bandas estándar por subescala (después
 * de ×2):
 *
 *   Depresión: 0–9 normal · 10–13 leve · 14–20 moderado · 21–27 severo · 28+ ext. severo
 *   Ansiedad:  0–7 normal · 8–9 leve · 10–14 moderado · 15–19 severo · 20+ ext. severo
 *   Estrés:    0–14 normal · 15–18 leve · 19–25 moderado · 26–33 severo · 34+ ext. severo
 *
 * Asignación de ítems (1-based, orden estándar de Lovibond & Lovibond):
 *   Depresión: 3, 5, 10, 13, 16, 17, 21
 *   Ansiedad:  2, 4, 7, 9, 15, 19, 20
 *   Estrés:    1, 6, 8, 11, 12, 14, 18
 *
 * Tamizaje, NO diagnóstico. `total` global = suma de las tres subescalas (0–126,
 * ya ×2); banda global = la severidad más alta entre las tres subescalas.
 */

import type {
  InstrumentoDef,
  OpcionRespuesta,
  ScoreInstrumento,
  ScoreSubescala,
} from "../types";
import { bandaPorCorte, sumaLikert } from "./_shared";

export const DASS21_LEN = 21;

const OPCIONES: readonly OpcionRespuesta[] = [
  { label: "No me ocurrió", valor: 0 },
  { label: "Me ocurrió en algún grado o durante parte del tiempo", valor: 1 },
  { label: "Me ocurrió bastante o durante buena parte del tiempo", valor: 2 },
  { label: "Me ocurrió mucho o la mayor parte del tiempo", valor: 3 },
];

/** Enunciados es-AR en orden 1..21 (índice 0 = ítem 1). */
const ENUNCIADOS = [
  "Me costó mucho relajarme", // 1 · estrés
  "Me di cuenta de que tenía la boca seca", // 2 · ansiedad
  "No podía sentir ningún sentimiento positivo", // 3 · depresión
  "Se me hizo difícil respirar (p. ej. respiración acelerada, falta de aire sin haber hecho esfuerzo)", // 4 · ansiedad
  "Se me hizo difícil tomar la iniciativa para hacer cosas", // 5 · depresión
  "Reaccioné de forma exagerada ante las situaciones", // 6 · estrés
  "Sentí temblores (p. ej. en las manos)", // 7 · ansiedad
  "Sentí que estaba gastando mucha energía nerviosa", // 8 · estrés
  "Me preocupé por situaciones en las que podía tener pánico o quedar en ridículo", // 9 · ansiedad
  "Sentí que no tenía nada por qué ilusionarme", // 10 · depresión
  "Me sentí agitado/a", // 11 · estrés
  "Se me hizo difícil relajarme", // 12 · estrés
  "Me sentí triste y con la moral por el suelo", // 13 · depresión
  "No toleré nada que me impidiera seguir con lo que estaba haciendo", // 14 · estrés
  "Sentí que estaba al borde del pánico", // 15 · ansiedad
  "No fui capaz de entusiasmarme por nada", // 16 · depresión
  "Sentí que valía poco como persona", // 17 · depresión
  "Sentí que estaba bastante irritable/susceptible", // 18 · estrés
  "Sentí los latidos de mi corazón sin haber hecho un esfuerzo físico (p. ej. taquicardia, palpitaciones)", // 19 · ansiedad
  "Sentí miedo sin razón aparente", // 20 · ansiedad
  "Sentí que la vida no tenía sentido", // 21 · depresión
] as const;

/** Índices 0-based de cada subescala (ítems 1-based del comentario superior). */
const IDX_DEPRESION = [2, 4, 9, 12, 15, 16, 20]; // 3,5,10,13,16,17,21
const IDX_ANSIEDAD = [1, 3, 6, 8, 14, 18, 19]; // 2,4,7,9,15,19,20
const IDX_ESTRES = [0, 5, 7, 10, 11, 13, 17]; // 1,6,8,11,12,14,18

const SUB_ID_TO_IDX = ["depresion", "ansiedad", "estres"] as const;
type SubId = (typeof SUB_ID_TO_IDX)[number];

const IDX_POR_SUB: Record<SubId, readonly number[]> = {
  depresion: IDX_DEPRESION,
  ansiedad: IDX_ANSIEDAD,
  estres: IDX_ESTRES,
};

const NOMBRE_POR_SUB: Record<SubId, string> = {
  depresion: "Depresión",
  ansiedad: "Ansiedad",
  estres: "Estrés",
};

/** Cortes por subescala sobre el puntaje YA multiplicado por 2. */
const CORTES_POR_SUB: Record<SubId, ReadonlyArray<{ hasta: number; id: string }>> = {
  depresion: [
    { hasta: 9, id: "normal" },
    { hasta: 13, id: "leve" },
    { hasta: 20, id: "moderado" },
    { hasta: 27, id: "severo" },
    { hasta: Infinity, id: "extremadamente_severo" },
  ],
  ansiedad: [
    { hasta: 7, id: "normal" },
    { hasta: 9, id: "leve" },
    { hasta: 14, id: "moderado" },
    { hasta: 19, id: "severo" },
    { hasta: Infinity, id: "extremadamente_severo" },
  ],
  estres: [
    { hasta: 14, id: "normal" },
    { hasta: 18, id: "leve" },
    { hasta: 25, id: "moderado" },
    { hasta: 33, id: "severo" },
    { hasta: Infinity, id: "extremadamente_severo" },
  ],
};

const BANDA_LABELS: Record<string, string> = {
  normal: "normal",
  leve: "leve",
  moderado: "moderado",
  severo: "severo",
  extremadamente_severo: "extremadamente severo",
};

/** Orden de severidad para elegir la banda global (la más alta). */
const SEVERIDAD_ORDEN = ["normal", "leve", "moderado", "severo", "extremadamente_severo"];

/**
 * Puntúa el DASS-21. `respuestas` = `number[]` de 21 enteros 0–3, en orden 1..21.
 * Cada subescala suma sus 7 ítems y se multiplica por 2. Devuelve `null` si la
 * escala está incompleta o inválida. `total` global = suma de las tres
 * subescalas (ya ×2); banda global = la severidad máxima entre subescalas.
 */
export function scoreDass21(respuestas: unknown): ScoreInstrumento | null {
  // Valida el array completo (21 enteros 0–3) usando la suma global; el valor
  // en sí no se usa para el total, sólo confirma la validez del array.
  if (sumaLikert(respuestas, DASS21_LEN, 0, 3) === null) return null;
  const arr = respuestas as number[];

  const subescalas: ScoreSubescala[] = [];
  let total = 0;
  let peorIdx = 0;

  for (const subId of SUB_ID_TO_IDX) {
    let bruto = 0;
    for (const i of IDX_POR_SUB[subId]) bruto += arr[i];
    const subTotal = bruto * 2;
    const banda = bandaPorCorte(subTotal, CORTES_POR_SUB[subId]);
    subescalas.push({
      id: subId,
      nombre: NOMBRE_POR_SUB[subId],
      total: subTotal,
      banda,
      etiqueta: BANDA_LABELS[banda],
    });
    total += subTotal;
    const idx = SEVERIDAD_ORDEN.indexOf(banda);
    if (idx > peorIdx) peorIdx = idx;
  }

  const bandaGlobal = SEVERIDAD_ORDEN[peorIdx];
  return {
    total,
    banda: bandaGlobal,
    interpretacion: `DASS-21 — severidad máxima ${BANDA_LABELS[bandaGlobal]} (tamizaje, no diagnóstico)`,
    subescalas,
  };
}

export const dass21: InstrumentoDef = {
  id: "dass21.v1",
  nombre: "DASS-21",
  descripcion:
    "Tamizaje de depresión, ansiedad y estrés (21 ítems, 3 subescalas). No reemplaza el criterio clínico.",
  dominio: "salud_mental",
  consigna:
    "Durante la última semana, indicá en qué medida te ocurrió cada una de estas afirmaciones.",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado, i) => {
    const subId = SUB_ID_TO_IDX.find((s) => IDX_POR_SUB[s].includes(i));
    return { enunciado, subescala: subId };
  }),
  subescalas: [
    { id: "depresion", nombre: "Depresión" },
    { id: "ansiedad", nombre: "Ansiedad" },
    { id: "estres", nombre: "Estrés" },
  ],
  bandas: [
    { id: "normal", label: "Normal" },
    { id: "leve", label: "Leve" },
    { id: "moderado", label: "Moderado" },
    { id: "severo", label: "Severo" },
    { id: "extremadamente_severo", label: "Extremadamente severo" },
  ],
  score: scoreDass21,
};
