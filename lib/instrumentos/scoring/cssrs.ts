/**
 * Folio · instrumentos · C-SSRS (Columbia Suicide Severity Rating Scale) —
 * screener de 6 preguntas.
 *
 * Screener de tamizaje de riesgo suicida (versión abreviada de 6 ítems sí/no):
 *   1. Deseo de estar muerto/a.
 *   2. Pensamientos suicidas activos no específicos.
 *   3. Pensamientos suicidas con método (sin plan ni intención de actuar).
 *   4. Intención suicida (sin plan específico).
 *   5. Intención suicida con plan específico.
 *   6. Conducta suicida (alguna vez / en los últimos 3 meses).
 *
 * NO es un puntaje sumado: el nivel de riesgo lo determina la pregunta positiva
 * de MAYOR severidad. Estratificación clínica habitual:
 *   - sin_riesgo: ninguna positiva.
 *   - bajo: ítems 1–2 (ideación pasiva/activa inespecífica).
 *   - moderado: ítem 3 (ideación con método).
 *   - alto: ítems 4–5 (intención, con o sin plan) o ítem 6 (conducta).
 *
 * Cualquier positiva en 4, 5 o 6 emite flags accionables (protocolo de riesgo /
 * plan de seguridad — ver C7). NO es diagnóstico ni reemplaza la evaluación
 * clínica presencial. `respuestas` = `boolean[]` de 6 (índice = nº de pregunta −1).
 */

import type { InstrumentoDef, ScoreInstrumento } from "../types";

export const CSSRS_LEN = 6;

/** Flags accionables (protocolo de riesgo). */
export const CSSRS_FLAG_INTENCION = "intencion_suicida"; // ítems 4–5
export const CSSRS_FLAG_PLAN = "plan_suicida"; // ítem 5
export const CSSRS_FLAG_CONDUCTA = "conducta_suicida"; // ítem 6

const ENUNCIADOS = [
  "¿Deseaste estar muerto/a o poder dormirte y no despertar?",
  "¿Tuviste pensamientos de querer suicidarte?",
  "¿Pensaste en cómo podrías hacerlo (algún método), aunque sin un plan concreto ni intención de hacerlo?",
  "¿Tuviste la intención de actuar sobre esos pensamientos?",
  "¿Empezaste a elaborar o elaboraste un plan específico para suicidarte?",
  "¿Hiciste algo, preparaste algo o hiciste algún intento para terminar con tu vida (alguna vez o en los últimos 3 meses)?",
] as const;

/** Opciones sí/no (valor: 1 = sí, 0 = no) para el renderer. */
const OPCIONES = [
  { label: "No", valor: 0 },
  { label: "Sí", valor: 1 },
] as const;

const BANDA_LABELS: Record<string, string> = {
  sin_riesgo: "sin riesgo detectado",
  bajo: "bajo",
  moderado: "moderado",
  alto: "alto",
};

/** Normaliza a un array de exactamente 6 booleanos, o `null`. */
function normalizar(respuestas: unknown): boolean[] | null {
  if (!Array.isArray(respuestas) || respuestas.length !== CSSRS_LEN) return null;
  const out: boolean[] = [];
  for (const r of respuestas) {
    // Acepta booleanos o 0/1 (el renderer puede emitir cualquiera de los dos).
    if (typeof r === "boolean") out.push(r);
    else if (r === 0 || r === 1) out.push(r === 1);
    else return null;
  }
  return out;
}

/**
 * Puntúa el C-SSRS screener. `respuestas` = `boolean[]` de 6 (o `(0|1)[]`).
 * Devuelve `null` si el screener está incompleto o inválido. El nivel de riesgo
 * lo fija la pregunta positiva de mayor severidad; emite flags para ítems 4–6.
 */
export function scoreCssrs(respuestas: unknown): ScoreInstrumento | null {
  const r = normalizar(respuestas);
  if (r === null) return null;

  // r[0..5] = preguntas 1..6.
  let banda: string;
  if (r[3] || r[4] || r[5]) banda = "alto";
  else if (r[2]) banda = "moderado";
  else if (r[0] || r[1]) banda = "bajo";
  else banda = "sin_riesgo";

  const flags: string[] = [];
  if (r[3] || r[4]) flags.push(CSSRS_FLAG_INTENCION);
  if (r[4]) flags.push(CSSRS_FLAG_PLAN);
  if (r[5]) flags.push(CSSRS_FLAG_CONDUCTA);

  // `total` = cantidad de positivas (útil para una serie de tendencia simple);
  // el nivel de riesgo va en `banda`, no en el total.
  const total = r.filter(Boolean).length;

  const interpretacion =
    banda === "sin_riesgo"
      ? "C-SSRS — sin riesgo detectado en el screener (no reemplaza la evaluación clínica)"
      : `C-SSRS — riesgo ${BANDA_LABELS[banda]}. Requiere evaluación clínica; considerar protocolo de riesgo / plan de seguridad.`;

  return {
    total,
    banda,
    interpretacion,
    ...(flags.length > 0 ? { flags } : {}),
  };
}

export const cssrs: InstrumentoDef = {
  id: "cssrs.v1",
  nombre: "C-SSRS (screener)",
  descripcion:
    "Tamizaje de riesgo suicida, 6 preguntas sí/no. No reemplaza la evaluación clínica.",
  dominio: "riesgo",
  consigna: "Respondé sí o no a cada pregunta según cómo te sentiste últimamente.",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado) => ({ enunciado })),
  bandas: [
    { id: "sin_riesgo", label: "Sin riesgo detectado" },
    { id: "bajo", label: "Bajo" },
    { id: "moderado", label: "Moderado" },
    { id: "alto", label: "Alto" },
  ],
  score: scoreCssrs,
};
