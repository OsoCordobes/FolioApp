/**
 * Folio · especialidades · cardiología · schema + derivaciones (server-safe).
 *
 * Todo lo que NO es React de la herramienta cardiológica (Fase D + C5):
 *   - Schema zod versionado del toolData. El shape de ESCRITURA es v2
 *     (`cardiologia.cv.v2`): panel con vitales extra (peso/talla/SatO₂/glucemia)
 *     además de TA/FC/factores. El shape v1 (`cardiologia.cv.v1`) se conserva
 *     INTACTO para LEER sesiones viejas (patrón de dos-ids de quiropraxia).
 *     Ambos cifrados app-side en sesion.tool_data_cifrado.
 *   - `scoreRiesgoCV(factores, edad?)` — clasificación ORIENTATIVA de riesgo
 *     cardiovascular por conteo de factores (simplificación de las tablas
 *     OMS/OPS). No es diagnóstico ni reemplaza el criterio clínico. Los scores
 *     validados (CHA₂DS₂-VASc, HAS-BLED, SCORE2) viven en ./scores.ts.
 *   - `deriveCardioSeries(historial)` — serie cronológica de TA/FC para la
 *     curva de evolución del Tool (lee v1 y v2 por nombre de campo).
 *   - `resumenSesionCardiologia(toolData)` — string de resumen para
 *     HistorialReciente / TabSesiones ("TA 130/85 · FC 72 · riesgo moderado").
 *
 * Opcional-friendly: una sesión puede cargar solo TA, solo factores o solo un
 * estudio — todos los campos del payload son opcionales salvo `v`. Aditivo: v2
 * sólo AGREGA vitales; nada de v1 se retira ni se afloja (.strict() intacto).
 * Server-safe: lo importan lib/db/* (writer valida antes de cifrar) y el Tool
 * client. PHI: este módulo nunca loguea contenido clínico.
 */

import { z } from "zod";

import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Factores de riesgo ─────────────────────────────────────────────────────

export const FACTORES_RIESGO = [
  "tabaquismo",
  "diabetes",
  "dislipemia",
  "hta",
  "antecedentesFamiliares",
  "sedentarismo",
] as const;

export type FactorRiesgo = (typeof FACTORES_RIESGO)[number];

export const FACTOR_LABELS: Record<FactorRiesgo, string> = {
  tabaquismo: "Tabaquismo",
  diabetes: "Diabetes",
  dislipemia: "Dislipemia",
  hta: "Hipertensión arterial",
  antecedentesFamiliares: "Antecedentes familiares",
  sedentarismo: "Sedentarismo",
};

// ─── Estudios complementarios ───────────────────────────────────────────────

export const TIPOS_ESTUDIO = [
  "ECG",
  "Ecocardiograma",
  "Ergometría",
  "Holter",
  "Laboratorio",
] as const;

export type TipoEstudio = (typeof TIPOS_ESTUDIO)[number];

export const CONCLUSIONES_ESTUDIO = ["normal", "anormal", "requiere_seguimiento"] as const;

export type ConclusionEstudio = (typeof CONCLUSIONES_ESTUDIO)[number];

/** Labels es-AR para chips/selects (el value persiste como enum del schema). */
export const CONCLUSION_LABELS: Record<ConclusionEstudio, string> = {
  normal: "Normal",
  anormal: "Anormal",
  requiere_seguimiento: "Requiere seguimiento",
};

// ─── Rangos plausibles del panel (validación + hint de UI) ──────────────────
//
// C5 · v2 agrega vitales extra (peso/talla/SatO₂/glucemia). Los tres primeros
// (TA/FC) ya existían en v1 y NO cambian sus rangos; los nuevos son aditivos.
// `RANGOS_PANEL` es el set del shape de ESCRITURA (v2); `CampoVital` deriva de
// él. El schema v1 (más abajo) queda intacto con sus tres vitales originales.

export const RANGOS_PANEL = {
  taSistolica: { min: 50, max: 300, unidad: "mmHg" },
  taDiastolica: { min: 30, max: 200, unidad: "mmHg" },
  fc: { min: 20, max: 300, unidad: "lpm" },
  // ── Vitales extra (v2, aditivos) ──
  peso: { min: 20, max: 400, unidad: "kg" },
  talla: { min: 50, max: 250, unidad: "cm" },
  satO2: { min: 50, max: 100, unidad: "%" },
  glucemia: { min: 20, max: 800, unidad: "mg/dL" },
} as const;

export type CampoVital = keyof typeof RANGOS_PANEL;

/** Vitales presentes en el shape v1 (TA/FC) — subset estable, nunca cambia. */
export const CAMPOS_VITALES_V1 = ["taSistolica", "taDiastolica", "fc"] as const;

/** Vitales agregados en v2 (además de los de v1). */
export const CAMPOS_VITALES_V2_EXTRA = ["peso", "talla", "satO2", "glucemia"] as const;

/** Labels es-AR cortos por vital (para inputs/hints — el value persiste crudo). */
export const VITAL_LABELS: Record<CampoVital, string> = {
  taSistolica: "TA sist. (mmHg)",
  taDiastolica: "TA diast. (mmHg)",
  fc: "FC (lpm)",
  peso: "Peso (kg)",
  talla: "Talla (cm)",
  satO2: "SatO₂ (%)",
  glucemia: "Glucemia (mg/dL)",
};

// ─── toolData: piezas compartidas entre v1 y v2 ─────────────────────────────

const factoresSchema = z.object({
  tabaquismo: z.boolean().optional(),
  diabetes: z.boolean().optional(),
  dislipemia: z.boolean().optional(),
  hta: z.boolean().optional(),
  antecedentesFamiliares: z.boolean().optional(),
  sedentarismo: z.boolean().optional(),
});

/** Campo vital entero opcional con el rango plausible de `RANGOS_PANEL`. */
function vitalSchema(campo: CampoVital) {
  return z.number().int().min(RANGOS_PANEL[campo].min).max(RANGOS_PANEL[campo].max).optional();
}

const estudioSchema = z.object({
  tipo: z.enum(TIPOS_ESTUDIO),
  /** Fecha del estudio (YYYY-MM-DD) — puede diferir de la fecha de la sesión. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hallazgos: z.string().max(2000),
  conclusion: z.enum(CONCLUSIONES_ESTUDIO),
});

// ─── toolData v1 (LEGACY · tool_id = cardiologia.cv.v1) ─────────────────────
//
// Shape ORIGINAL: panel con TA/FC/factores + estudios. YA NO es el shape de
// escritura (lo es v2), pero se conserva INTACTO para LEER las sesiones cardio
// pre-v2. No se edita ni se borra (regla aditiva / patrón dos-ids de quiro).

const panelV1Schema = z.object({
  taSistolica: vitalSchema("taSistolica"),
  taDiastolica: vitalSchema("taDiastolica"),
  fc: vitalSchema("fc"),
  factores: factoresSchema.optional(),
});

// .strict(): claves desconocidas RECHAZAN en vez de stripearse. Como todos
// los campos de contenido son .optional(), sin strict un payload de OTRA
// herramienta (quiro/psico) parsearía OK reducido a `{ v: 1 }` y se
// persistiría con tool_id cardio — corrupción silenciosa de PHI. El writer
// (lib/db/sesiones.ts) depende de este rechazo cross-tool; invariante
// cubierta en tests/unit/especialidades-meta.test.ts.
export const cardiologiaToolDataSchema = z.object({
  v: z.literal(1),
  panel: panelV1Schema.optional(),
  estudios: z.array(estudioSchema).max(30).optional(),
}).strict();

// ─── toolData v2 (ACTIVO · tool_id = cardiologia.cv.v2, C5) ─────────────────
//
// ADITIVO sobre v1: el panel suma vitales extra (peso/talla/SatO₂/glucemia).
// factores y estudios no cambian. `v: z.literal(2)` + .strict() igual que v1:
// un payload de OTRA herramienta (o v1 pelado) RECHAZA — el writer depende de
// esto para no persistir PHI ajena con el tool_id de cardiología.

const panelV2Schema = z.object({
  taSistolica: vitalSchema("taSistolica"),
  taDiastolica: vitalSchema("taDiastolica"),
  fc: vitalSchema("fc"),
  peso: vitalSchema("peso"),
  talla: vitalSchema("talla"),
  satO2: vitalSchema("satO2"),
  glucemia: vitalSchema("glucemia"),
  factores: factoresSchema.optional(),
});

export const cardiologiaToolDataV2Schema = z.object({
  v: z.literal(2),
  panel: panelV2Schema.optional(),
  estudios: z.array(estudioSchema).max(30).optional(),
}).strict();

export type CardiologiaToolData = z.infer<typeof cardiologiaToolDataSchema>;
export type CardiologiaToolDataV2 = z.infer<typeof cardiologiaToolDataV2Schema>;
export type PanelCV = z.infer<typeof panelV2Schema>;
export type FactoresCV = z.infer<typeof factoresSchema>;
export type EstudioCardio = z.infer<typeof estudioSchema>;

/**
 * Discrimina un toolData cardio persistido (descifrado + JSON.parse) entre v2,
 * v1 o vacío. Intenta v2 primero (shape de escritura actual), luego v1 (legacy);
 * si ninguno parsea devuelve `{ kind: "empty" }` (sesión sin tool / de otra
 * herramienta — el caller arranca un borrador v2 limpio). Espejo del patrón de
 * `parseQuiropraxiaToolData`.
 */
export function parseCardiologiaToolData(
  value: unknown,
):
  | { kind: "v2"; data: CardiologiaToolDataV2 }
  | { kind: "v1"; data: CardiologiaToolData }
  | { kind: "empty" } {
  const asV2 = cardiologiaToolDataV2Schema.safeParse(value);
  if (asV2.success) return { kind: "v2", data: asV2.data };
  const asV1 = cardiologiaToolDataSchema.safeParse(value);
  if (asV1.success) return { kind: "v1", data: asV1.data };
  return { kind: "empty" };
}

// ─── Score de riesgo CV (orientativo) ───────────────────────────────────────

export type NivelRiesgoCV = "bajo" | "moderado" | "alto";

export interface RiesgoCV {
  nivel: NivelRiesgoCV;
  /** Etiqueta es-AR lista para UI — siempre marca "(orientativo)". */
  etiqueta: string;
}

/**
 * Clasificación ORIENTATIVA de riesgo cardiovascular por conteo de factores —
 * simplificación de la estratificación OMS/OPS (que además usa tablas por TA,
 * colesterol, sexo y edad exacta). Reglas:
 *
 *   conteo = factores presentes (true) + 1 si edad >= 60
 *   0–1 → bajo · 2–3 → moderado · >=4 → alto
 *
 * NO es una herramienta diagnóstica ni reemplaza el criterio clínico — la UI
 * la presenta siempre como "orientativo". Función pura, sin side effects.
 */
export function scoreRiesgoCV(
  factores: Partial<Record<FactorRiesgo, boolean>> | null | undefined,
  edad?: number,
): RiesgoCV {
  let conteo = 0;
  if (factores) {
    for (const f of FACTORES_RIESGO) {
      if (factores[f] === true) conteo += 1;
    }
  }
  if (typeof edad === "number" && Number.isFinite(edad) && edad >= 60) conteo += 1;

  const nivel: NivelRiesgoCV = conteo <= 1 ? "bajo" : conteo <= 3 ? "moderado" : "alto";
  const nombre = nivel === "bajo" ? "bajo" : nivel === "moderado" ? "moderado" : "alto";
  return { nivel, etiqueta: `Riesgo ${nombre} (orientativo)` };
}

// ─── Extracciones laxas (historial puede traer shapes viejos/ajenos) ────────

function asFiniteInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Panel laxo de un toolData desconocido: tolera shapes parciales o ajenos
 * (devuelve null si no hay panel con al menos un vital numérico).
 */
function extractPanelVitals(
  toolData: unknown,
): { taS: number | null; taD: number | null; fc: number | null } | null {
  if (toolData === null || typeof toolData !== "object") return null;
  const panel = (toolData as { panel?: unknown }).panel;
  if (panel === null || typeof panel !== "object") return null;
  const p = panel as { taSistolica?: unknown; taDiastolica?: unknown; fc?: unknown };
  const taS = asFiniteInt(p.taSistolica);
  const taD = asFiniteInt(p.taDiastolica);
  const fc = asFiniteInt(p.fc);
  if (taS === null && taD === null && fc === null) return null;
  return { taS, taD, fc };
}

/**
 * Estudios de un toolData desconocido, validados item a item (los inválidos
 * se descartan en silencio — el historial no debe romper la ficha).
 */
export function extractEstudios(toolData: unknown): EstudioCardio[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const estudios = (toolData as { estudios?: unknown }).estudios;
  if (!Array.isArray(estudios)) return [];
  const out: EstudioCardio[] = [];
  for (const e of estudios) {
    const parsed = estudioSchema.safeParse(e);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ─── Serie de evolución TA/FC ───────────────────────────────────────────────

export interface CardioSeriesPoint {
  /** Fecha de la sesión (YYYY-MM-DD). */
  fecha: string;
  taS: number | null;
  taD: number | null;
  fc: number | null;
}

/**
 * Serie cronológica (ASC, la más vieja primero) de TA/FC para la curva de
 * evolución. El historial llega DESC (contrato del slot); las sesiones sin
 * panel o sin ningún vital numérico se omiten. Función pura.
 */
export function deriveCardioSeries(historial: ToolHistorialEntry[]): CardioSeriesPoint[] {
  const out: CardioSeriesPoint[] = [];
  // DESC → ASC preservando el orden relativo dentro de la misma fecha.
  for (let i = historial.length - 1; i >= 0; i--) {
    const entry = historial[i];
    const vitals = extractPanelVitals(entry.toolData);
    if (!vitals) continue;
    out.push({ fecha: entry.fecha, ...vitals });
  }
  // Orden defensivo por fecha (sort estable: empates mantienen el orden).
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

// ─── Resumen por sesión ─────────────────────────────────────────────────────

/**
 * Resumen es-AR de una sesión cardiológica para el historial:
 *   "TA 130/85 · FC 72 · riesgo moderado"
 *   "Ergometría: requiere seguimiento"
 *   "TA 130/85 · 3 estudios"
 * Lee v1 y v2 (parseCardiologiaToolData): los campos del resumen (TA/FC,
 * factores, estudios) son comunes a ambos shapes, así que el copy no cambia
 * entre versiones. Shapes desconocidos/vacíos degradan a "Sesión registrada"
 * (mismo copy que el placeholder pre-Fase D — el historial nunca rompe).
 */
export function resumenSesionCardiologia(toolData: unknown): string {
  const parsed = parseCardiologiaToolData(toolData);
  if (parsed.kind === "empty") return "Sesión registrada";

  const { panel, estudios } = parsed.data;
  const partes: string[] = [];

  if (panel) {
    const { taSistolica, taDiastolica, fc, factores } = panel;
    if (taSistolica != null && taDiastolica != null) {
      partes.push(`TA ${taSistolica}/${taDiastolica}`);
    } else if (taSistolica != null) {
      partes.push(`TA sist. ${taSistolica}`);
    } else if (taDiastolica != null) {
      partes.push(`TA diast. ${taDiastolica}`);
    }
    if (fc != null) partes.push(`FC ${fc}`);
    const hayFactores = factores && FACTORES_RIESGO.some((f) => factores[f] === true);
    if (hayFactores) partes.push(`riesgo ${scoreRiesgoCV(factores).nivel}`);
  }

  if (estudios && estudios.length === 1) {
    const e = estudios[0];
    partes.push(`${e.tipo}: ${CONCLUSION_LABELS[e.conclusion].toLowerCase()}`);
  } else if (estudios && estudios.length > 1) {
    partes.push(`${estudios.length} estudios`);
  }

  return partes.length > 0 ? partes.join(" · ") : "Sesión registrada";
}
