/**
 * Folio · especialidades · psicología · schema + derivaciones (server-safe).
 *
 * Todo lo que NO es React de la herramienta de psicología (Fase D):
 *   - Schema zod versionado del toolData (`{ v: 1, phq9?, gad7?, registro?,
 *     objetivos? }`) — tool_id `psicologia.escalas.v1`, cifrado app-side en
 *     sesion.tool_data_cifrado.
 *   - Ítems es-AR de PHQ-9 y GAD-7 (traducción estándar adaptada al voseo) +
 *     `scorePhq9` / `scoreGad7` — funciones puras que puntúan SOLO escalas
 *     completas, con las bandas de severidad estándar de cada instrumento.
 *     Son herramientas de tamizaje: el puntaje NO es diagnóstico.
 *   - `deriveScoreSeries(historial)` — serie cronológica de puntajes para la
 *     curva longitudinal del Tool.
 *   - `resumenSesionPsicologia(toolData)` — string de resumen para
 *     HistorialReciente / TabSesiones ("PHQ-9 12 (moderada) · GAD-7 8 (leve)").
 *
 * Opcional-friendly: una sesión puede cargar solo una escala, solo el registro
 * de estado mental o solo objetivos — todos los campos son opcionales salvo
 * `v`. Server-safe: lo importan lib/db/* (writer valida antes de cifrar) y el
 * Tool client. PHI: este módulo nunca loguea contenido clínico.
 */

import { z } from "zod";

import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Escalas: ítems es-AR y opciones de frecuencia ──────────────────────────

export const PHQ9_LEN = 9;
export const GAD7_LEN = 7;

/** Consigna compartida por ambas escalas (encabezado del bloque en la UI). */
export const CONSIGNA_ESCALAS =
  "En las últimas 2 semanas, ¿con qué frecuencia te molestó cada uno de estos problemas?";

/** Opciones 0–3 (mismas para PHQ-9 y GAD-7). El índice ES el puntaje. */
export const OPCIONES_FRECUENCIA = [
  "Para nada",
  "Varios días",
  "Más de la mitad de los días",
  "Casi todos los días",
] as const;

export const PHQ9_ITEMS = [
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

export const GAD7_ITEMS = [
  "Sentirte nervioso/a, ansioso/a o muy alterado/a",
  "No poder dejar de preocuparte o no poder controlar la preocupación",
  "Preocuparte demasiado por diferentes cosas",
  "Dificultad para relajarte",
  "Estar tan inquieto/a que te cuesta quedarte quieto/a",
  "Enojarte o irritarte con facilidad",
  "Sentir miedo, como si algo terrible fuera a pasar",
] as const;

/** Índice (0-based) del ítem 9 del PHQ-9 (ideación) — aviso clínico si > 0. */
export const PHQ9_ITEM_IDEACION = 8;

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
 */
export const psicologiaToolDataSchema = z.object({
  v: z.literal(1),
  phq9: z.array(itemEscalaSchema).length(PHQ9_LEN).optional(),
  gad7: z.array(itemEscalaSchema).length(GAD7_LEN).optional(),
  registro: registroSchema.optional(),
  objetivos: z.array(objetivoSchema).max(20).optional(),
});

export type PsicologiaToolData = z.infer<typeof psicologiaToolDataSchema>;
export type RegistroSesion = z.infer<typeof registroSchema>;
export type Objetivo = z.infer<typeof objetivoSchema>;

// ─── Scoring (puro, solo escalas completas) ─────────────────────────────────

export type BandaPhq9 = "minima" | "leve" | "moderada" | "moderadamente_severa" | "severa";
export type BandaGad7 = "minima" | "leve" | "moderada" | "severa";

export const BANDA_LABELS: Record<BandaPhq9, string> = {
  minima: "mínima",
  leve: "leve",
  moderada: "moderada",
  moderadamente_severa: "moderadamente severa",
  severa: "severa",
};

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

/** Suma laxa: null salvo array de longitud exacta con TODOS enteros 0–3. */
function totalEscala(items: unknown, len: number): number | null {
  if (!Array.isArray(items) || items.length !== len) return null;
  let total = 0;
  for (const item of items) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 3) return null;
    total += item;
  }
  return total;
}

/**
 * Puntaje PHQ-9 (0–27) con bandas estándar: 0–4 mínima, 5–9 leve, 10–14
 * moderada, 15–19 moderadamente severa, 20–27 severa. Acepta input
 * desconocido (historial puede traer shapes ajenos): devuelve null si la
 * escala no está completa o no es válida. Tamizaje, NO diagnóstico.
 */
export function scorePhq9(items: unknown): ScorePhq9 | null {
  const total = totalEscala(items, PHQ9_LEN);
  if (total === null) return null;
  const banda: BandaPhq9 =
    total <= 4 ? "minima"
    : total <= 9 ? "leve"
    : total <= 14 ? "moderada"
    : total <= 19 ? "moderadamente_severa"
    : "severa";
  return { total, banda, etiqueta: BANDA_LABELS[banda] };
}

/**
 * Puntaje GAD-7 (0–21) con bandas estándar: 0–4 mínima, 5–9 leve, 10–14
 * moderada, 15–21 severa. Mismo contrato laxo que scorePhq9.
 */
export function scoreGad7(items: unknown): ScoreGad7 | null {
  const total = totalEscala(items, GAD7_LEN);
  if (total === null) return null;
  const banda: BandaGad7 =
    total <= 4 ? "minima" : total <= 9 ? "leve" : total <= 14 ? "moderada" : "severa";
  return { total, banda, etiqueta: BANDA_LABELS[banda] };
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
