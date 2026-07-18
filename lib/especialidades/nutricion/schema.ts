/**
 * Folio · especialidades · nutrición · schema + derivaciones
 * (server-safe · Fase 2 · N2).
 *
 * Todo lo que NO es React de la herramienta de nutrición. El shape de ESCRITURA
 * es v1 (`nutricion.ficha.v1`): la sesión de nutrición gira alrededor de la
 * ANTROPOMETRÍA longitudinal — peso, talla, circunferencias corporales y
 * pliegues cutáneos medidos a lo largo del tiempo — más un plan alimentario en
 * texto libre y objetivos. El IMC no se persiste: es una DERIVACIÓN pura de
 * peso/talla (nunca se guarda un dato que se pueda recomputar). La curva
 * longitudinal (peso / IMC / cintura) usa el <SerieEvolucion> genérico de la
 * biblioteca (C3), igual que kinesiología reusa el mismo componente. Cifrado
 * app-side en sesion.tool_data_cifrado (M50). PHI: este módulo nunca loguea
 * contenido clínico.
 *
 * A diferencia de kinesiología, nutrición NO embebe instrumentos sumados de
 * lib/instrumentos (la antropometría no es una escala de ítems); reusa la
 * biblioteca sólo por el componente de serie. El plan alimentario y las
 * observaciones son texto libre.
 *
 * Opcional-friendly: una sesión puede cargar sólo el peso, sólo el plan o sólo
 * una circunferencia — todos los campos de contenido son opcionales salvo `v`.
 * `.strict()` en el schema raíz: un payload de OTRA herramienta
 * (quiro/cardio/psico/kinesio) RECHAZA en vez de degradar a `{ v: 1 }` pelado —
 * el writer (lib/db/sesiones.ts) depende de esto para no persistir PHI ajena con
 * el tool_id de nutrición. Server-safe: lo importan lib/db/* (writer valida antes
 * de cifrar) y el Tool client.
 */

import { z } from "zod";

import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Antropometría básica (peso / talla) ──────────────────────────────────────
//
// Peso en kilogramos y talla en centímetros — rangos plausibles amplios (sólo
// descartan lo absurdo, no imponen criterio clínico). Ambos opcionales por
// sesión: el seguimiento nutricional habitual pesa cada control pero mide la
// talla con menos frecuencia. El IMC se DERIVA (no se persiste).

/** Peso corporal en kilogramos (rango plausible amplio). */
export const PESO_KG_MIN = 1;
export const PESO_KG_MAX = 500;
/** Talla en centímetros (rango plausible amplio: pediátrico → adulto alto). */
export const TALLA_CM_MIN = 30;
export const TALLA_CM_MAX = 260;

const pesoSchema = z.number().min(PESO_KG_MIN).max(PESO_KG_MAX);
const tallaSchema = z.number().min(TALLA_CM_MIN).max(TALLA_CM_MAX);

// ─── Circunferencias corporales ───────────────────────────────────────────────
//
// Perímetros habituales del control nutricional (cm). `sitio` es un enum acotado
// que ordena la lectura y evita duplicados por tipeo; el rango es amplio (5–300
// cm) para no rechazar mediciones válidas de cualquier segmento.

export const SITIOS_CIRCUNFERENCIA = [
  "cintura",
  "cadera",
  "cuello",
  "brazo",
  "muslo",
  "pantorrilla",
] as const;

export type SitioCircunferencia = (typeof SITIOS_CIRCUNFERENCIA)[number];

export const SITIO_CIRCUNFERENCIA_LABELS: Record<SitioCircunferencia, string> = {
  cintura: "Cintura",
  cadera: "Cadera",
  cuello: "Cuello",
  brazo: "Brazo",
  muslo: "Muslo",
  pantorrilla: "Pantorrilla",
};

export const CIRCUNFERENCIA_CM_MIN = 5;
export const CIRCUNFERENCIA_CM_MAX = 300;

const circunferenciaSchema = z.object({
  sitio: z.enum(SITIOS_CIRCUNFERENCIA),
  /** Perímetro en centímetros. */
  cm: z.number().min(CIRCUNFERENCIA_CM_MIN).max(CIRCUNFERENCIA_CM_MAX),
});

export type Circunferencia = z.infer<typeof circunferenciaSchema>;

// ─── Pliegues cutáneos ────────────────────────────────────────────────────────
//
// Pliegues del calibre (mm) usados para estimar composición corporal. `sitio`
// enum acotado; rango amplio (1–100 mm). Folio NO estima % de grasa a partir de
// ecuaciones (varían por protocolo — el nutricionista aplica la suya): sólo
// registra y grafica los pliegues crudos.

export const SITIOS_PLIEGUE = [
  "tricipital",
  "bicipital",
  "subescapular",
  "suprailiaco",
  "abdominal",
  "muslo",
] as const;

export type SitioPliegue = (typeof SITIOS_PLIEGUE)[number];

export const SITIO_PLIEGUE_LABELS: Record<SitioPliegue, string> = {
  tricipital: "Tricipital",
  bicipital: "Bicipital",
  subescapular: "Subescapular",
  suprailiaco: "Suprailíaco",
  abdominal: "Abdominal",
  muslo: "Muslo",
};

export const PLIEGUE_MM_MIN = 1;
export const PLIEGUE_MM_MAX = 100;

const pliegueSchema = z.object({
  sitio: z.enum(SITIOS_PLIEGUE),
  /** Espesor del pliegue en milímetros. */
  mm: z.number().min(PLIEGUE_MM_MIN).max(PLIEGUE_MM_MAX),
});

export type Pliegue = z.infer<typeof pliegueSchema>;

// ─── Objetivos nutricionales del tratamiento ──────────────────────────────────

export const ESTADOS_OBJETIVO_NUTRI = ["en_curso", "logrado", "pausado"] as const;

export type EstadoObjetivoNutri = (typeof ESTADOS_OBJETIVO_NUTRI)[number];

export const ESTADO_OBJETIVO_NUTRI_LABELS: Record<EstadoObjetivoNutri, string> = {
  en_curso: "En curso",
  logrado: "Logrado",
  pausado: "Pausado",
};

const objetivoNutriSchema = z.object({
  texto: z.string().min(1).max(500),
  estado: z.enum(ESTADOS_OBJETIVO_NUTRI),
});

export type ObjetivoNutri = z.infer<typeof objetivoNutriSchema>;

// ─── toolData v1 (ACTIVO · tool_id = nutricion.ficha.v1) ──────────────────────
//
// .strict(): claves desconocidas RECHAZAN en vez de stripearse. Como todos los
// campos de contenido son .optional(), sin strict un payload de OTRA herramienta
// (quiro/cardio/psico/kinesio) parsearía OK reducido a `{ v: 1 }` y se
// persistiría con tool_id nutrición — corrupción silenciosa de PHI. El writer
// (lib/db/sesiones.ts) depende de este rechazo cross-tool; invariante cubierta
// en tests/unit/especialidades-meta.test.ts.

export const nutricionToolDataSchema = z
  .object({
    v: z.literal(1),
    /** Peso corporal de esta sesión (kg). */
    peso: pesoSchema.optional(),
    /** Talla de esta sesión (cm) — se mide con menos frecuencia que el peso. */
    talla: tallaSchema.optional(),
    /** Circunferencias corporales medidas en esta sesión. */
    circunferencias: z.array(circunferenciaSchema).max(20).optional(),
    /** Pliegues cutáneos medidos en esta sesión. */
    pliegues: z.array(pliegueSchema).max(20).optional(),
    /** Plan alimentario indicado (texto libre, PHI). */
    planAlimentario: z.string().max(4000).optional(),
    /** Observaciones de la evolución / adherencia (texto libre, PHI). */
    observaciones: z.string().max(2000).optional(),
    /** Objetivos nutricionales del tratamiento. */
    objetivos: z.array(objetivoNutriSchema).max(20).optional(),
  })
  .strict();

export type NutricionToolData = z.infer<typeof nutricionToolDataSchema>;

/**
 * Discrimina un toolData nutrición persistido (descifrado + JSON.parse) entre v1
 * o vacío. Si no parsea devuelve `{ kind: "empty" }` (sesión sin tool / de otra
 * herramienta — el caller arranca un borrador v1 limpio). Espejo del patrón de
 * `parseKinesiologiaToolData` (acá una sola versión — se agregarán más si el
 * shape evoluciona, patrón dos-ids).
 */
export function parseNutricionToolData(
  value: unknown,
): { kind: "v1"; data: NutricionToolData } | { kind: "empty" } {
  const asV1 = nutricionToolDataSchema.safeParse(value);
  if (asV1.success) return { kind: "v1", data: asV1.data };
  return { kind: "empty" };
}

// ─── IMC derivado (nunca persistido) ──────────────────────────────────────────

/** Bandas de IMC (OMS, adultos). Orientativas — no diagnóstico. */
export const BANDAS_IMC = [
  { max: 18.5, label: "Bajo peso", tono: "amber" },
  { max: 25, label: "Normal", tono: "green" },
  { max: 30, label: "Sobrepeso", tono: "amber" },
  { max: Infinity, label: "Obesidad", tono: "red" },
] as const;

export type TonoImc = (typeof BANDAS_IMC)[number]["tono"];

export interface Imc {
  /** IMC (kg/m²) redondeado a un decimal. */
  valor: number;
  /** Banda OMS orientativa. */
  banda: string;
  /** Tono para el chip (mapea a tokens --green/--amber/--red). */
  tono: TonoImc;
}

/**
 * IMC = peso(kg) / talla(m)². Contrato laxo: acepta cualquier par y devuelve null
 * si falta un dato o está fuera de rango plausible (no inventa un IMC absurdo con
 * una talla de 1 cm). Función pura. Orientativo, NO diagnóstico.
 */
export function computeImc(peso: unknown, talla: unknown): Imc | null {
  if (typeof peso !== "number" || !Number.isFinite(peso)) return null;
  if (typeof talla !== "number" || !Number.isFinite(talla)) return null;
  if (peso < PESO_KG_MIN || peso > PESO_KG_MAX) return null;
  if (talla < TALLA_CM_MIN || talla > TALLA_CM_MAX) return null;
  const m = talla / 100;
  const raw = peso / (m * m);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const valor = Math.round(raw * 10) / 10;
  const banda = BANDAS_IMC.find((b) => valor < b.max) ?? BANDAS_IMC[BANDAS_IMC.length - 1];
  return { valor, banda: banda.label, tono: banda.tono };
}

// ─── Extracciones laxas (historial puede traer shapes viejos/ajenos) ──────────

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Peso (kg) de un toolData desconocido dentro de rango plausible, o null. */
export function extractPeso(toolData: unknown): number | null {
  if (toolData === null || typeof toolData !== "object") return null;
  const n = asFiniteNumber((toolData as { peso?: unknown }).peso);
  if (n === null || n < PESO_KG_MIN || n > PESO_KG_MAX) return null;
  return n;
}

/** Talla (cm) de un toolData desconocido dentro de rango plausible, o null. */
export function extractTalla(toolData: unknown): number | null {
  if (toolData === null || typeof toolData !== "object") return null;
  const n = asFiniteNumber((toolData as { talla?: unknown }).talla);
  if (n === null || n < TALLA_CM_MIN || n > TALLA_CM_MAX) return null;
  return n;
}

/**
 * Circunferencias de un toolData desconocido, validadas item a item (las
 * inválidas se descartan en silencio — el historial no debe romper la ficha).
 */
export function extractCircunferencias(toolData: unknown): Circunferencia[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const raw = (toolData as { circunferencias?: unknown }).circunferencias;
  if (!Array.isArray(raw)) return [];
  const out: Circunferencia[] = [];
  for (const c of raw) {
    const parsed = circunferenciaSchema.safeParse(c);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Pliegues de un toolData desconocido, validados item a item (los inválidos se
 * descartan en silencio).
 */
export function extractPliegues(toolData: unknown): Pliegue[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const raw = (toolData as { pliegues?: unknown }).pliegues;
  if (!Array.isArray(raw)) return [];
  const out: Pliegue[] = [];
  for (const p of raw) {
    const parsed = pliegueSchema.safeParse(p);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Objetivos nutricionales de un toolData desconocido, validados item a item (los
 * inválidos se descartan en silencio).
 */
export function extractObjetivosNutri(toolData: unknown): ObjetivoNutri[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const raw = (toolData as { objetivos?: unknown }).objetivos;
  if (!Array.isArray(raw)) return [];
  const out: ObjetivoNutri[] = [];
  for (const o of raw) {
    const parsed = objetivoNutriSchema.safeParse(o);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Circunferencia de cintura (cm) de un toolData desconocido, o null. */
export function extractCintura(toolData: unknown): number | null {
  const cintura = extractCircunferencias(toolData).find((c) => c.sitio === "cintura");
  return cintura ? cintura.cm : null;
}

// ─── Serie de evolución (peso + IMC + cintura) ────────────────────────────────

export interface NutriSeriesPoint {
  /** Fecha de la sesión (YYYY-MM-DD). */
  fecha: string;
  /** Peso corporal (kg), null si no se registró. */
  peso: number | null;
  /** IMC derivado (kg/m²), null si falta peso o talla. */
  imc: number | null;
  /** Circunferencia de cintura (cm), null si no se registró. */
  cintura: number | null;
}

/**
 * Serie cronológica (ASC, la más vieja primero) de peso + IMC + cintura para la
 * curva longitudinal. El historial llega DESC (contrato del slot); las sesiones
 * sin ninguna métrica se omiten. El IMC se DERIVA con computeImc (no se persiste)
 * usando el peso de la sesión y la talla más reciente conocida hasta esa fecha
 * (arrastre: la talla se mide con menos frecuencia que el peso, así que una
 * sesión que sólo pesa igual calcula IMC con la última talla). Función pura.
 */
export function deriveNutriSeries(historial: ToolHistorialEntry[]): NutriSeriesPoint[] {
  // Ordenar el historial a ASC (por fecha, estable) para poder arrastrar la
  // última talla conocida hacia adelante en el tiempo.
  const asc = [...historial].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const out: NutriSeriesPoint[] = [];
  let ultimaTalla: number | null = null;
  for (const entry of asc) {
    const td = entry.toolData;
    const peso = extractPeso(td);
    const tallaSesion = extractTalla(td);
    if (tallaSesion !== null) ultimaTalla = tallaSesion;
    const imc = computeImc(peso, ultimaTalla)?.valor ?? null;
    const cintura = extractCintura(td);
    if (peso === null && imc === null && cintura === null) continue;
    out.push({ fecha: entry.fecha, peso, imc, cintura });
  }
  return out;
}

// ─── Resumen por sesión ───────────────────────────────────────────────────────

/**
 * Resumen es-AR de una sesión de nutrición para el historial:
 *   "72 kg · IMC 24.2 · Cintura 84 cm"
 *   "Plan actualizado · 2 objetivos"
 * Lee v1 (parseNutricionToolData). Shapes desconocidos/vacíos degradan a "Sesión
 * registrada" (mismo copy que el resto del registry — el historial nunca rompe).
 * El texto libre del plan/observaciones NO viaja al resumen (sólo métricas +
 * conteos + un flag "Plan actualizado"). El IMC se deriva de peso+talla de LA
 * MISMA sesión (el resumen es por-sesión: sin talla en la sesión, no hay IMC acá).
 */
export function resumenSesionNutricion(toolData: unknown): string {
  const parsed = parseNutricionToolData(toolData);
  if (parsed.kind === "empty") return "Sesión registrada";

  const { peso, talla, circunferencias, pliegues, planAlimentario, objetivos } = parsed.data;
  const partes: string[] = [];

  if (typeof peso === "number") partes.push(`${peso} kg`);
  const imc = computeImc(peso, talla);
  if (imc) partes.push(`IMC ${imc.valor}`);
  const cintura = circunferencias?.find((c) => c.sitio === "cintura");
  if (cintura) partes.push(`Cintura ${cintura.cm} cm`);

  if (circunferencias && circunferencias.length > 0 && !cintura) {
    partes.push(
      `${circunferencias.length} ${circunferencias.length === 1 ? "circunferencia" : "circunferencias"}`,
    );
  }
  if (pliegues && pliegues.length > 0) {
    partes.push(`${pliegues.length} ${pliegues.length === 1 ? "pliegue" : "pliegues"}`);
  }
  if (typeof planAlimentario === "string" && planAlimentario.trim() !== "") {
    partes.push("Plan actualizado");
  }
  if (objetivos && objetivos.length > 0) {
    partes.push(`${objetivos.length} ${objetivos.length === 1 ? "objetivo" : "objetivos"}`);
  }

  return partes.length > 0 ? partes.join(" · ") : "Sesión registrada";
}
