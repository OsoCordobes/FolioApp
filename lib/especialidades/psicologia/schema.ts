/**
 * Folio · especialidades · psicología · schema + derivaciones (server-safe).
 *
 * Todo lo que NO es React de la herramienta de psicología (Fase D):
 *   - Schema zod versionado del toolData (`{ v: 1, phq9?, gad7?, registro?,
 *     objetivos? }`) — tool_id `psicologia.escalas.v1`, cifrado app-side en
 *     sesion.tool_data_cifrado.
 *   - Ítems es-AR de PHQ-9 y GAD-7 + `scorePhq9` / `scoreGad7` — desde C4
 *     TOMADOS DE LA BIBLIOTECA `lib/instrumentos` (defs `phq9.v1`/`gad7.v1`):
 *     los enunciados, la consigna, las opciones y los cortes de banda tienen
 *     una única fuente de verdad allí. Este módulo re-exporta esas constantes y
 *     adapta el score de la biblioteca (`ScoreInstrumento`) a la forma corta
 *     que consumen el resumen y las series (`{ total, banda, etiqueta }`).
 *     Siguen siendo tamizaje: el puntaje NO es diagnóstico.
 *   - `deriveScoreSeries(historial)` — serie cronológica de puntajes para la
 *     curva longitudinal del Tool.
 *   - `resumenSesionPsicologia(toolData)` — string de resumen para
 *     HistorialReciente / TabSesiones ("PHQ-9 12 (moderada) · GAD-7 8 (leve)").
 *
 * Opcional-friendly: una sesión puede cargar solo una escala, solo el registro
 * de estado mental o solo objetivos — todos los campos son opcionales salvo
 * `v`. Server-safe: lo importan lib/db/* (writer valida antes de cifrar) y el
 * Tool client. PHI: este módulo nunca loguea contenido clínico.
 *
 * Estabilidad (C4): el tool_id `psicologia.escalas.v1` y el schema NO cambian
 * — no hay migración de datos. Solo cambia DE DÓNDE salen las definiciones de
 * escala (biblioteca en vez de literales duplicados acá).
 */

import { z } from "zod";

import { gad7 as gad7Def, phq9 as phq9Def } from "@/lib/instrumentos";
import { PHQ9_ITEM_IDEACION as PHQ9_ITEM_IDEACION_LIB } from "@/lib/instrumentos/scoring/phq9";
import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Escalas: ítems es-AR y opciones de frecuencia (desde lib/instrumentos) ──
//
// Fuente de verdad única: las defs `phq9.v1` / `gad7.v1` de la biblioteca. Este
// módulo solo las re-exporta con los nombres históricos de psicología para no
// tocar el Tool ni los tests que ya los importan.

export const PHQ9_LEN = phq9Def.items.length;
export const GAD7_LEN = gad7Def.items.length;

/**
 * Consigna compartida por ambas escalas (encabezado del bloque en la UI). Las
 * dos defs comparten la misma consigna; se toma la de PHQ-9.
 */
export const CONSIGNA_ESCALAS =
  phq9Def.consigna ??
  "En las últimas 2 semanas, ¿con qué frecuencia te molestó cada uno de estos problemas?";

/**
 * Opciones 0–3 (mismas para PHQ-9 y GAD-7). El índice ES el puntaje (Likert
 * clásico: `valor` coincide con la posición). Se derivan de las opciones de la
 * def de PHQ-9.
 */
export const OPCIONES_FRECUENCIA: readonly string[] = (phq9Def.opciones ?? []).map(
  (o) => o.label,
);

export const PHQ9_ITEMS: readonly string[] = phq9Def.items.map((i) => i.enunciado);

export const GAD7_ITEMS: readonly string[] = gad7Def.items.map((i) => i.enunciado);

/** Índice (0-based) del ítem 9 del PHQ-9 (ideación) — aviso clínico si > 0. */
export const PHQ9_ITEM_IDEACION = PHQ9_ITEM_IDEACION_LIB;

// ─── Registro estructurado: estado mental (selects cortos) ──────────────────

export const APARIENCIAS = ["cuidada", "descuidada", "extravagante"] as const;
export type Apariencia = (typeof APARIENCIAS)[number];

export const ANIMOS = ["eutimico", "deprimido", "ansioso", "irritable", "expansivo"] as const;
export type Animo = (typeof ANIMOS)[number];

export const AFECTOS = ["congruente", "restringido", "aplanado", "labil", "incongruente"] as const;
export type Afecto = (typeof AFECTOS)[number];

export const PENSAMIENTOS = [
  "lineal",
  "circunstancial",
  "tangencial",
  "acelerado",
  "enlentecido",
  "disgregado",
] as const;
export type Pensamiento = (typeof PENSAMIENTOS)[number];

export const RIESGOS = ["sin_riesgo", "ideacion", "plan"] as const;
export type Riesgo = (typeof RIESGOS)[number];

/** Labels es-AR para selects (el value persiste como enum del schema). */
export const APARIENCIA_LABELS: Record<Apariencia, string> = {
  cuidada: "Cuidada",
  descuidada: "Descuidada",
  extravagante: "Extravagante",
};

export const ANIMO_LABELS: Record<Animo, string> = {
  eutimico: "Eutímico",
  deprimido: "Deprimido",
  ansioso: "Ansioso",
  irritable: "Irritable",
  expansivo: "Expansivo",
};

export const AFECTO_LABELS: Record<Afecto, string> = {
  congruente: "Congruente",
  restringido: "Restringido",
  aplanado: "Aplanado",
  labil: "Lábil",
  incongruente: "Incongruente",
};

export const PENSAMIENTO_LABELS: Record<Pensamiento, string> = {
  lineal: "Lineal y coherente",
  circunstancial: "Circunstancial",
  tangencial: "Tangencial",
  acelerado: "Acelerado",
  enlentecido: "Enlentecido",
  disgregado: "Disgregado",
};

export const RIESGO_LABELS: Record<Riesgo, string> = {
  sin_riesgo: "Sin riesgo",
  ideacion: "Ideación",
  plan: "Plan",
};

// ─── Objetivos terapéuticos ─────────────────────────────────────────────────

export const ESTADOS_OBJETIVO = ["en_curso", "logrado", "pausado"] as const;
export type EstadoObjetivo = (typeof ESTADOS_OBJETIVO)[number];

export const ESTADO_OBJETIVO_LABELS: Record<EstadoObjetivo, string> = {
  en_curso: "En curso",
  logrado: "Logrado",
  pausado: "Pausado",
};

// ─── toolData (sesion.tool_data_cifrado, tool_id = psicologia.escalas.v1) ───

/** Una respuesta de escala: entero 0–3 (índice de OPCIONES_FRECUENCIA). */
const itemEscalaSchema = z.number().int().min(0).max(3);

const registroSchema = z.object({
  apariencia: z.enum(APARIENCIAS).optional(),
  animo: z.enum(ANIMOS).optional(),
  afecto: z.enum(AFECTOS).optional(),
  pensamiento: z.enum(PENSAMIENTOS).optional(),
  riesgo: z.enum(RIESGOS).optional(),
});

const objetivoSchema = z.object({
  texto: z.string().min(1).max(500),
  estado: z.enum(ESTADOS_OBJETIVO),
});

/**
 * Las escalas persisten SOLO completas (longitud exacta, todos los ítems
 * respondidos) — el scoring estándar de PHQ-9/GAD-7 exige el instrumento
 * entero. El borrador del Tool puede tener respuestas parciales en memoria;
 * la UI avisa que una escala incompleta no se puede guardar.
 *
 * .strict(): claves desconocidas RECHAZAN en vez de stripearse. Como todos
 * los campos de contenido son .optional(), sin strict un payload de OTRA
 * herramienta (quiro/cardio) parsearía OK reducido a `{ v: 1 }` y se
 * persistiría con tool_id psico — corrupción silenciosa de PHI. El writer
 * (lib/db/sesiones.ts) depende de este rechazo cross-tool; invariante
 * cubierta en tests/unit/especialidades-meta.test.ts.
 */
export const psicologiaToolDataSchema = z.object({
  v: z.literal(1),
  phq9: z.array(itemEscalaSchema).length(PHQ9_LEN).optional(),
  gad7: z.array(itemEscalaSchema).length(GAD7_LEN).optional(),
  registro: registroSchema.optional(),
  objetivos: z.array(objetivoSchema).max(20).optional(),
}).strict();

export type PsicologiaToolData = z.infer<typeof psicologiaToolDataSchema>;
export type RegistroSesion = z.infer<typeof registroSchema>;
export type Objetivo = z.infer<typeof objetivoSchema>;

// ─── Scoring (delega en lib/instrumentos, adapta a la forma corta de psico) ──
//
// Desde C4 el scoring canónico de PHQ-9/GAD-7 vive en las defs de la biblioteca
// (`phq9.v1` / `gad7.v1`): mismos cortes de banda, misma flag de ideación. Acá
// solo se ADAPTA su `ScoreInstrumento` ({ total, banda, interpretacion, flags? })
// a la forma corta que el resumen y las series de psicología ya consumen
// ({ total, banda, etiqueta }). Sin duplicar cutoffs: una sola fuente de verdad.

export type BandaPhq9 = "minima" | "leve" | "moderada" | "moderadamente_severa" | "severa";
export type BandaGad7 = "minima" | "leve" | "moderada" | "severa";

/**
 * Labels es-AR de las bandas. Se derivan de la def de PHQ-9 (que incluye las 4
 * bandas de GAD-7 más "moderadamente severa"), en minúscula para el resumen
 * ("PHQ-9 12 (moderada)"). Es la única banda extra respecto de GAD-7.
 */
export const BANDA_LABELS: Record<BandaPhq9, string> = Object.fromEntries(
  phq9Def.bandas.map((b) => [b.id, b.label.toLowerCase()]),
) as Record<BandaPhq9, string>;

export interface ScorePhq9 {
  total: number;
  banda: BandaPhq9;
  /** Label es-AR de la banda ("moderadamente severa"). */
  etiqueta: string;
}

export interface ScoreGad7 {
  total: number;
  banda: BandaGad7;
  etiqueta: string;
}

/**
 * Puntaje PHQ-9 (0–27) con bandas estándar (0–4 mínima, 5–9 leve, 10–14
 * moderada, 15–19 moderadamente severa, 20–27 severa). Delega en la def de la
 * biblioteca: acepta input desconocido (el historial trae shapes ajenos) y
 * devuelve null si la escala no está completa o no es válida. Tamizaje, NO
 * diagnóstico.
 */
export function scorePhq9(items: unknown): ScorePhq9 | null {
  const r = phq9Def.score(items);
  if (r === null) return null;
  const banda = r.banda as BandaPhq9;
  return { total: r.total, banda, etiqueta: BANDA_LABELS[banda] };
}

/**
 * Puntaje GAD-7 (0–21) con bandas estándar (0–4 mínima, 5–9 leve, 10–14
 * moderada, 15–21 severa). Mismo contrato laxo que scorePhq9 (delega en la def
 * de la biblioteca).
 */
export function scoreGad7(items: unknown): ScoreGad7 | null {
  const r = gad7Def.score(items);
  if (r === null) return null;
  const banda = r.banda as BandaGad7;
  return { total: r.total, banda, etiqueta: BANDA_LABELS[banda] };
}

// ─── Extracciones laxas (historial puede traer shapes viejos/ajenos) ────────

function rawCampo(toolData: unknown, campo: string): unknown {
  if (toolData === null || typeof toolData !== "object") return undefined;
  return (toolData as Record<string, unknown>)[campo];
}

/**
 * Respuestas laxas de una escala para el borrador del Tool: array de longitud
 * fija con null en lo no respondido. Devuelve null si no hay NINGUNA
 * respuesta válida (escala sin cargar).
 */
export function extractRespuestasEscala(raw: unknown, len: number): Array<number | null> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<number | null> = [];
  for (let i = 0; i < len; i++) {
    const v = raw[i];
    out.push(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null);
  }
  return out.some((v) => v !== null) ? out : null;
}

/** Registro de estado mental laxo: campo a campo, descarta valores fuera de enum. */
export function extractRegistro(raw: unknown): RegistroSesion | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: RegistroSesion = {};
  const set = <K extends keyof RegistroSesion>(k: K, valores: readonly string[]) => {
    const v = r[k];
    if (typeof v === "string" && valores.includes(v)) out[k] = v as RegistroSesion[K];
  };
  set("apariencia", APARIENCIAS);
  set("animo", ANIMOS);
  set("afecto", AFECTOS);
  set("pensamiento", PENSAMIENTOS);
  set("riesgo", RIESGOS);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Objetivos de un toolData desconocido, validados item a item (los inválidos
 * se descartan en silencio — el historial no debe romper la ficha).
 */
export function extractObjetivos(toolData: unknown): Objetivo[] {
  const raw = rawCampo(toolData, "objetivos");
  if (!Array.isArray(raw)) return [];
  const out: Objetivo[] = [];
  for (const o of raw) {
    const parsed = objetivoSchema.safeParse(o);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ─── Serie longitudinal de puntajes ─────────────────────────────────────────

export interface PsicoSeriesPoint {
  /** Fecha de la sesión (YYYY-MM-DD). */
  fecha: string;
  phq9: number | null;
  gad7: number | null;
}

/**
 * Serie cronológica (ASC, la más vieja primero) de puntajes PHQ-9/GAD-7 para
 * la curva longitudinal. El historial llega DESC (contrato del slot); las
 * sesiones sin ninguna escala completa se omiten. Función pura.
 */
export function deriveScoreSeries(historial: ToolHistorialEntry[]): PsicoSeriesPoint[] {
  const out: PsicoSeriesPoint[] = [];
  // DESC → ASC preservando el orden relativo dentro de la misma fecha.
  for (let i = historial.length - 1; i >= 0; i--) {
    const entry = historial[i];
    const phq9 = scorePhq9(rawCampo(entry.toolData, "phq9"))?.total ?? null;
    const gad7 = scoreGad7(rawCampo(entry.toolData, "gad7"))?.total ?? null;
    if (phq9 === null && gad7 === null) continue;
    out.push({ fecha: entry.fecha, phq9, gad7 });
  }
  // Orden defensivo por fecha (sort estable: empates mantienen el orden).
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

// ─── Resumen por sesión ─────────────────────────────────────────────────────

/**
 * Resumen es-AR de una sesión de psicología para el historial:
 *   "PHQ-9 12 (moderada) · GAD-7 8 (leve)"
 *   "PHQ-9 21 (severa) · riesgo: plan"
 *   "Registro de sesión"
 * Shapes desconocidos/vacíos degradan a "Sesión registrada" (mismo copy que
 * el resto del registry — el historial nunca rompe). El puntaje detallado
 * (ítem por ítem) NO viaja al resumen.
 */
export function resumenSesionPsicologia(toolData: unknown): string {
  const parsed = psicologiaToolDataSchema.safeParse(toolData);
  if (!parsed.success) return "Sesión registrada";

  const { phq9, gad7, registro, objetivos } = parsed.data;
  const partes: string[] = [];

  const sPhq9 = scorePhq9(phq9);
  if (sPhq9) partes.push(`PHQ-9 ${sPhq9.total} (${sPhq9.etiqueta})`);
  const sGad7 = scoreGad7(gad7);
  if (sGad7) partes.push(`GAD-7 ${sGad7.total} (${sGad7.etiqueta})`);

  const hayRegistro = registro !== undefined && Object.values(registro).some((v) => v !== undefined);
  const hayObjetivos = objetivos !== undefined && objetivos.length > 0;
  if (partes.length === 0 && (hayRegistro || hayObjetivos)) partes.push("Registro de sesión");

  // Decisión clínica/UX deliberada (documentada en docs/PLAN.md, Fase D):
  // el flag categórico de riesgo se destaca en el resumen del historial por
  // continuidad de cuidado — esconder un indicador de riesgo suicida tras
  // navegación extra aumenta el riesgo de pasarlo por alto. Solo viaja el
  // enum (nunca ítems de escala ni texto libre) y el historial de la ficha
  // solo lo ven roles clínicos (gate server-side en pacientes/[id]/page.tsx
  // + RLS can_read_clinical). Revisitar si el resumen sale de la ficha.
  if (registro?.riesgo === "ideacion") partes.push("riesgo: ideación");
  else if (registro?.riesgo === "plan") partes.push("riesgo: plan");

  return partes.length > 0 ? partes.join(" · ") : "Sesión registrada";
}
