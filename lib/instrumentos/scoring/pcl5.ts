/**
 * Folio · instrumentos · PCL-5 (PTSD Checklist for DSM-5).
 *
 * 20 ítems, opciones 0–4 ("En el último mes…"). Total 0–80. Un punto de corte
 * de 33 sugiere PTSD probable (diagnóstico PROVISIONAL que requiere evaluación
 * clínica confirmatoria, p. ej. CAPS-5). Bandas por severidad total:
 *   0–10 mínima · 11–32 subumbral · 33–49 probable PTSD · 50–80 marcado.
 * El corte clínicamente significativo es 33; las otras bandas son orientativas
 * para seguimiento. Tamizaje, NO diagnóstico. Ítems es-AR (síntomas DSM-5).
 */

import type { InstrumentoDef, OpcionRespuesta, ScoreInstrumento } from "../types";
import { bandaPorCorte, sumaLikert } from "./_shared";

export const PCL5_LEN = 20;

/** Punto de corte de PTSD probable (diagnóstico provisional). */
export const PCL5_CORTE_PROBABLE = 33;

/** Flag emitida cuando el total ≥ 33 (PTSD probable, requiere confirmación). */
export const PCL5_FLAG_PROBABLE = "ptsd_probable";

const OPCIONES: readonly OpcionRespuesta[] = [
  { label: "Nada", valor: 0 },
  { label: "Un poco", valor: 1 },
  { label: "Moderadamente", valor: 2 },
  { label: "Bastante", valor: 3 },
  { label: "Muchísimo", valor: 4 },
];

const ENUNCIADOS = [
  "Recuerdos repetidos, molestos e involuntarios de la experiencia estresante",
  "Sueños repetidos y molestos relacionados con la experiencia estresante",
  "Sentir o actuar de repente como si estuvieras volviendo a vivir la experiencia (como si estuviera pasando de nuevo)",
  "Sentirte muy alterado/a cuando algo te recordaba la experiencia estresante",
  "Reacciones físicas intensas cuando algo te recordaba la experiencia (palpitaciones, dificultad para respirar, sudoración)",
  "Evitar recuerdos, pensamientos o sentimientos relacionados con la experiencia estresante",
  "Evitar cosas externas que te recuerdan la experiencia (personas, lugares, conversaciones, actividades, objetos o situaciones)",
  "Dificultad para recordar partes importantes de la experiencia estresante",
  "Tener creencias negativas fuertes sobre vos mismo/a, sobre otras personas o sobre el mundo",
  "Culparte a vos mismo/a o a otras personas por la experiencia estresante o por lo que pasó después",
  "Tener sentimientos negativos intensos como miedo, horror, enojo, culpa o vergüenza",
  "Perder el interés en actividades que antes disfrutabas",
  "Sentirte distante o aislado/a de otras personas",
  "Dificultad para experimentar sentimientos positivos (no poder sentir felicidad o cariño)",
  "Comportamiento irritable, arranques de ira o actuar de forma agresiva",
  "Tomar demasiados riesgos o hacer cosas que podrían lastimarte",
  "Estar muy alerta, en guardia o vigilante",
  "Sentirte sobresaltado/a o asustadizo/a con facilidad",
  "Dificultad para concentrarte",
  "Problemas para dormirte o para seguir durmiendo",
] as const;

const BANDA_LABELS: Record<string, string> = {
  minima: "mínima",
  subumbral: "subumbral",
  probable: "probable PTSD",
  marcado: "sintomatología marcada",
};

/**
 * Puntúa el PCL-5. `respuestas` = `number[]` de 20 enteros 0–4, en orden.
 * Devuelve `null` si la escala está incompleta o inválida. Emite la flag de
 * PTSD probable si el total ≥ 33.
 */
export function scorePcl5(respuestas: unknown): ScoreInstrumento | null {
  const total = sumaLikert(respuestas, PCL5_LEN, 0, 4);
  if (total === null) return null;

  const banda = bandaPorCorte(total, [
    { hasta: 10, id: "minima" },
    { hasta: PCL5_CORTE_PROBABLE - 1, id: "subumbral" }, // 11–32
    { hasta: 49, id: "probable" }, // 33–49
    { hasta: Infinity, id: "marcado" }, // 50–80
  ]);

  const flags = total >= PCL5_CORTE_PROBABLE ? [PCL5_FLAG_PROBABLE] : [];

  return {
    total,
    banda,
    interpretacion:
      total >= PCL5_CORTE_PROBABLE
        ? `PCL-5 ${total}/80 — supera el corte de PTSD probable (≥33). Requiere evaluación clínica confirmatoria; no es diagnóstico.`
        : `PCL-5 ${total}/80 — sintomatología ${BANDA_LABELS[banda]} (tamizaje, no diagnóstico)`,
    ...(flags.length > 0 ? { flags } : {}),
  };
}

export const pcl5: InstrumentoDef = {
  id: "pcl5.v1",
  nombre: "PCL-5",
  descripcion:
    "Tamizaje de estrés postraumático DSM-5 (20 ítems). Corte de PTSD probable ≥33; no reemplaza el criterio clínico.",
  dominio: "salud_mental",
  consigna:
    "En el último mes, ¿cuánto te molestó cada uno de estos problemas en relación con una experiencia muy estresante?",
  opciones: OPCIONES,
  items: ENUNCIADOS.map((enunciado) => ({ enunciado })),
  bandas: [
    { id: "minima", label: "Mínima" },
    { id: "subumbral", label: "Subumbral" },
    { id: "probable", label: "Probable PTSD" },
    { id: "marcado", label: "Sintomatología marcada" },
  ],
  score: scorePcl5,
};
