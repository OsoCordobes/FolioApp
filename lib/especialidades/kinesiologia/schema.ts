/**
 * Folio · especialidades · kinesiología/fisioterapia · schema + derivaciones
 * (server-safe · Fase 2 · N1).
 *
 * Todo lo que NO es React de la herramienta de kinesiología:
 *   - Schema zod versionado del toolData. El shape de ESCRITURA es v1
 *     (`kinesiologia.ficha.v1`): motivo de consulta, mediciones de rango de
 *     movilidad (ROM) por región, tests ortopédicos con resultado, objetivos
 *     funcionales, y los instrumentos de OUTCOME EMBEBIDOS que kinesiología
 *     reusa de la biblioteca `lib/instrumentos` — NDI (cervical), ODI (lumbar) y
 *     Borg RPE (esfuerzo percibido) — persistidos como sus respuestas crudas
 *     (el score canónico se recomputa con la def de la biblioteca, nunca se
 *     duplica el cutoff acá) + un dolor EVA/VAS 0–10 (escala visual analógica,
 *     medición puntual, no un instrumento sumado de la biblioteca). Cifrado
 *     app-side en sesion.tool_data_cifrado (M50). PHI: este módulo nunca loguea
 *     contenido clínico.
 *   - `deriveKinesioSeries(historial)` — serie cronológica de dolor EVA + scores
 *     NDI/ODI + Borg para la curva longitudinal del Tool (SerieEvolucion de C3).
 *   - `resumenSesionKinesiologia(toolData)` — string de resumen para
 *     HistorialReciente / TabSesiones ("EVA 6/10 · NDI 24 · 2 tests").
 *
 * Instrumentos EMBEBIDOS, no duplicados: NDI/ODI se persisten como `number[]`
 * (una respuesta 0–5 por ítem, longitud exacta) y se puntúan con `scoreNdi` /
 * `scoreOdi` de la biblioteca; Borg como un único entero 6–20 puntuado con
 * `scoreBorg`. El schema exige el instrumento COMPLETO (misma regla que
 * PHQ-9/GAD-7 en psicología: una escala de tamizaje sólo puntúa entera); el
 * borrador del Tool tolera respuestas parciales en memoria y la UI avisa la
 * incompletitud.
 *
 * Opcional-friendly: una sesión puede cargar sólo el motivo, sólo un ROM o sólo
 * el dolor — todos los campos son opcionales salvo `v`. `.strict()` en el schema
 * raíz: un payload de OTRA herramienta (quiro/cardio/psico) RECHAZA en vez de
 * degradar a `{ v: 1 }` pelado — el writer (lib/db/sesiones.ts) depende de esto
 * para no persistir PHI ajena con el tool_id de kinesiología.
 * Server-safe: lo importan lib/db/* (writer valida antes de cifrar) y el Tool
 * client.
 */

import { z } from "zod";

import { ndi as ndiDef } from "@/lib/instrumentos/scoring/ndi";
import { odi as odiDef } from "@/lib/instrumentos/scoring/odi";
import { borg as borgDef } from "@/lib/instrumentos/scoring/borg";
import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Instrumentos de outcome embebidos (de lib/instrumentos, sin duplicar) ────

export const NDI_LEN = ndiDef.items.length;
export const ODI_LEN = odiDef.items.length;

/** Id versionado del NDI (== instrumento_id de la biblioteca; futuro C2 opcional). */
export const NDI_INSTRUMENTO_ID = ndiDef.id;
export const ODI_INSTRUMENTO_ID = odiDef.id;
export const BORG_INSTRUMENTO_ID = borgDef.id;

/** Dolor EVA / VAS: escala visual analógica 0–10 (medición puntual, no sumada). */
export const EVA_MIN = 0;
export const EVA_MAX = 10;

// ─── Rango de movilidad (ROM) ─────────────────────────────────────────────────
//
// Regiones articulares habituales en kinesiología. Se registra el grado de
// movimiento activo (0–360°, rango generoso para no rechazar mediciones válidas
// de articulaciones amplias) por región; el dato clínico se interpreta contra el
// rango normal de referencia, que NO se hardcodea acá (varía por articulación y
// por criterio). El campo es opcional por región — una sesión puede medir sólo
// una zona.

export const REGIONES_ROM = [
  "cervical",
  "hombro",
  "codo",
  "muneca",
  "columna_dorsolumbar",
  "cadera",
  "rodilla",
  "tobillo",
] as const;

export type RegionRom = (typeof REGIONES_ROM)[number];

export const REGION_ROM_LABELS: Record<RegionRom, string> = {
  cervical: "Cervical",
  hombro: "Hombro",
  codo: "Codo",
  muneca: "Muñeca",
  columna_dorsolumbar: "Columna dorsolumbar",
  cadera: "Cadera",
  rodilla: "Rodilla",
  tobillo: "Tobillo",
};

/** Grados plausibles de un ROM activo (rango amplio: sólo descarta lo absurdo). */
export const ROM_GRADOS_MIN = 0;
export const ROM_GRADOS_MAX = 360;

const romMedicionSchema = z.object({
  region: z.enum(REGIONES_ROM),
  /** Grados de movimiento activo medido (0–360). */
  grados: z.number().int().min(ROM_GRADOS_MIN).max(ROM_GRADOS_MAX),
  /** Detalle libre: movimiento evaluado, dolor al final del rango, etc. */
  nota: z.string().max(500).optional(),
});

export type RomMedicion = z.infer<typeof romMedicionSchema>;

// ─── Tests ortopédicos ────────────────────────────────────────────────────────
//
// Test ortopédico con resultado categórico. `nombre` es texto libre (el
// vademécum de tests es enorme y específico por región — no se enumera): el
// profesional escribe el test (Neer, Lachman, Lasègue…). El resultado es un
// enum acotado que ordena la lectura y colorea el chip.

export const RESULTADOS_TEST = ["positivo", "negativo", "dudoso"] as const;

export type ResultadoTest = (typeof RESULTADOS_TEST)[number];

export const RESULTADO_TEST_LABELS: Record<ResultadoTest, string> = {
  positivo: "Positivo",
  negativo: "Negativo",
  dudoso: "Dudoso",
};

const testOrtopedicoSchema = z.object({
  /** Nombre del test (texto libre: Neer, Lachman, Lasègue, etc.). */
  nombre: z.string().min(1).max(120),
  /** Resultado categórico. */
  resultado: z.enum(RESULTADOS_TEST),
  /** Observación opcional (lado, maniobra, hallazgo). */
  nota: z.string().max(500).optional(),
});

export type TestOrtopedico = z.infer<typeof testOrtopedicoSchema>;

// ─── Objetivos funcionales del tratamiento ────────────────────────────────────

export const ESTADOS_OBJETIVO_KINE = ["en_curso", "logrado", "pausado"] as const;

export type EstadoObjetivoKine = (typeof ESTADOS_OBJETIVO_KINE)[number];

export const ESTADO_OBJETIVO_KINE_LABELS: Record<EstadoObjetivoKine, string> = {
  en_curso: "En curso",
  logrado: "Logrado",
  pausado: "Pausado",
};

const objetivoKineSchema = z.object({
  texto: z.string().min(1).max(500),
  estado: z.enum(ESTADOS_OBJETIVO_KINE),
});

export type ObjetivoKine = z.infer<typeof objetivoKineSchema>;

// ─── Instrumentos de outcome embebidos: schemas de persistencia ───────────────
//
// Los instrumentos se persisten como respuestas CRUDAS, completas (longitud
// exacta), y se puntúan con la def de la biblioteca (nunca se guarda el score en
// el toolData — se recomputa). Una respuesta parcial NO se persiste (el borrador
// del Tool la tolera en memoria; la UI avisa). Mismo criterio que PHQ-9/GAD-7.

/** Respuesta NDI: 10 enteros 0–5, completos. */
const ndiRespuestasSchema = z.array(z.number().int().min(0).max(5)).length(NDI_LEN);
/** Respuesta ODI: 10 enteros 0–5, completos. */
const odiRespuestasSchema = z.array(z.number().int().min(0).max(5)).length(ODI_LEN);
/** Respuesta Borg RPE: un único entero 6–20. */
const borgRespuestaSchema = z.number().int().min(6).max(20);
/** Dolor EVA/VAS: un único entero 0–10. */
const evaSchema = z.number().int().min(EVA_MIN).max(EVA_MAX);

// ─── toolData v1 (ACTIVO · tool_id = kinesiologia.ficha.v1) ───────────────────
//
// .strict(): claves desconocidas RECHAZAN en vez de stripearse. Como todos los
// campos de contenido son .optional(), sin strict un payload de OTRA herramienta
// (quiro/cardio/psico) parsearía OK reducido a `{ v: 1 }` y se persistiría con
// tool_id kinesiología — corrupción silenciosa de PHI. El writer
// (lib/db/sesiones.ts) depende de este rechazo cross-tool; invariante cubierta
// en tests/unit/especialidades-meta.test.ts.

export const kinesiologiaToolDataSchema = z
  .object({
    v: z.literal(1),
    /** Motivo de consulta / cuadro actual (texto libre, PHI). */
    motivo: z.string().max(2000).optional(),
    /** Mediciones de rango de movilidad por región. */
    rom: z.array(romMedicionSchema).max(20).optional(),
    /** Tests ortopédicos realizados en la sesión. */
    tests: z.array(testOrtopedicoSchema).max(20).optional(),
    /** Objetivos funcionales del tratamiento. */
    objetivos: z.array(objetivoKineSchema).max(20).optional(),
    /** Dolor EVA/VAS 0–10 de esta sesión (escala visual analógica). */
    dolorEva: evaSchema.optional(),
    /** Instrumento NDI (discapacidad cervical) completo. */
    ndi: ndiRespuestasSchema.optional(),
    /** Instrumento ODI (discapacidad lumbar) completo. */
    odi: odiRespuestasSchema.optional(),
    /** Escala Borg RPE (esfuerzo percibido) — un único valor 6–20. */
    borg: borgRespuestaSchema.optional(),
  })
  .strict();

export type KinesiologiaToolData = z.infer<typeof kinesiologiaToolDataSchema>;

/**
 * Discrimina un toolData kinesiología persistido (descifrado + JSON.parse) entre
 * v1 o vacío. Si no parsea devuelve `{ kind: "empty" }` (sesión sin tool / de
 * otra herramienta — el caller arranca un borrador v1 limpio). Espejo del patrón
 * de `parseCardiologiaToolData` / `parsePsicologiaToolData` (acá una sola
 * versión — se agregarán más si el shape evoluciona, patrón dos-ids).
 */
export function parseKinesiologiaToolData(
  value: unknown,
): { kind: "v1"; data: KinesiologiaToolData } | { kind: "empty" } {
  const asV1 = kinesiologiaToolDataSchema.safeParse(value);
  if (asV1.success) return { kind: "v1", data: asV1.data };
  return { kind: "empty" };
}

// ─── Scoring embebido (delega en lib/instrumentos, no duplica cutoffs) ────────

/**
 * Puntaje NDI (0–50 crudo) con la def de la biblioteca. Contrato laxo: acepta
 * input desconocido (el historial trae shapes ajenos) y devuelve null si el
 * instrumento no está completo. Seguimiento funcional, NO diagnóstico.
 */
export function scoreNdiKine(respuestas: unknown): number | null {
  return ndiDef.score(respuestas)?.total ?? null;
}

/** Puntaje ODI (porcentaje 0–100) con la def de la biblioteca. Contrato laxo. */
export function scoreOdiKine(respuestas: unknown): number | null {
  return odiDef.score(respuestas)?.total ?? null;
}

/** Valor Borg (6–20) con la def de la biblioteca. Contrato laxo. */
export function scoreBorgKine(respuesta: unknown): number | null {
  return borgDef.score(respuesta)?.total ?? null;
}

// ─── Extracciones laxas (historial puede traer shapes viejos/ajenos) ──────────

function asFiniteInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Dolor EVA de un toolData desconocido (0–10 entero), o null. */
export function extractDolorEva(toolData: unknown): number | null {
  if (toolData === null || typeof toolData !== "object") return null;
  const raw = (toolData as { dolorEva?: unknown }).dolorEva;
  const n = asFiniteInt(raw);
  if (n === null || n < EVA_MIN || n > EVA_MAX) return null;
  return n;
}

/**
 * Mediciones de ROM de un toolData desconocido, validadas item a item (las
 * inválidas se descartan en silencio — el historial no debe romper la ficha).
 */
export function extractRom(toolData: unknown): RomMedicion[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const raw = (toolData as { rom?: unknown }).rom;
  if (!Array.isArray(raw)) return [];
  const out: RomMedicion[] = [];
  for (const r of raw) {
    const parsed = romMedicionSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Tests ortopédicos de un toolData desconocido, validados item a item (los
 * inválidos se descartan en silencio).
 */
export function extractTests(toolData: unknown): TestOrtopedico[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const raw = (toolData as { tests?: unknown }).tests;
  if (!Array.isArray(raw)) return [];
  const out: TestOrtopedico[] = [];
  for (const t of raw) {
    const parsed = testOrtopedicoSchema.safeParse(t);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Objetivos funcionales de un toolData desconocido, validados item a item (los
 * inválidos se descartan en silencio).
 */
export function extractObjetivosKine(toolData: unknown): ObjetivoKine[] {
  if (toolData === null || typeof toolData !== "object") return [];
  const raw = (toolData as { objetivos?: unknown }).objetivos;
  if (!Array.isArray(raw)) return [];
  const out: ObjetivoKine[] = [];
  for (const o of raw) {
    const parsed = objetivoKineSchema.safeParse(o);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Respuestas laxas de un instrumento embebido (NDI/ODI) para el borrador del
 * Tool: array de longitud fija con null en lo no respondido. Devuelve null si no
 * hay NINGUNA respuesta válida (instrumento sin cargar). Espejo de
 * extractRespuestasEscala de psicología, con rango 0–5.
 */
export function extractRespuestasInstrumento(
  raw: unknown,
  len: number,
): Array<number | null> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<number | null> = [];
  for (let i = 0; i < len; i++) {
    const v = raw[i];
    out.push(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5 ? v : null);
  }
  return out.some((v) => v !== null) ? out : null;
}

/** Respuesta laxa de Borg para el borrador: entero 6–20 o null. Acepta `n` o `[n]`. */
export function extractRespuestaBorg(raw: unknown): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === "number" && Number.isInteger(v) && v >= 6 && v <= 20) return v;
  return null;
}

// ─── Serie de evolución (dolor EVA + scores NDI/ODI + Borg) ───────────────────

export interface KinesioSeriesPoint {
  /** Fecha de la sesión (YYYY-MM-DD). */
  fecha: string;
  /** Dolor EVA 0–10 (null si no se registró). */
  eva: number | null;
  /** Score NDI crudo 0–50 (null si no se completó). */
  ndi: number | null;
  /** Score ODI porcentaje 0–100 (null si no se completó). */
  odi: number | null;
  /** Valor Borg 6–20 (null si no se registró). */
  borg: number | null;
}

/**
 * Serie cronológica (ASC, la más vieja primero) de dolor EVA + scores NDI/ODI +
 * Borg para la curva longitudinal. El historial llega DESC (contrato del slot);
 * las sesiones sin ninguna métrica se omiten. Los scores NDI/ODI se recomputan
 * con la def de la biblioteca (contrato laxo). Función pura.
 */
export function deriveKinesioSeries(historial: ToolHistorialEntry[]): KinesioSeriesPoint[] {
  const out: KinesioSeriesPoint[] = [];
  // DESC → ASC preservando el orden relativo dentro de la misma fecha.
  for (let i = historial.length - 1; i >= 0; i--) {
    const entry = historial[i];
    const td = entry.toolData;
    const eva = extractDolorEva(td);
    const ndi = scoreNdiKine(
      td !== null && typeof td === "object" ? (td as Record<string, unknown>).ndi : undefined,
    );
    const odi = scoreOdiKine(
      td !== null && typeof td === "object" ? (td as Record<string, unknown>).odi : undefined,
    );
    const borg = scoreBorgKine(
      td !== null && typeof td === "object" ? (td as Record<string, unknown>).borg : undefined,
    );
    if (eva === null && ndi === null && odi === null && borg === null) continue;
    out.push({ fecha: entry.fecha, eva, ndi, odi, borg });
  }
  // Orden defensivo por fecha (sort estable: empates mantienen el orden).
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

// ─── Resumen por sesión ───────────────────────────────────────────────────────

/**
 * Resumen es-AR de una sesión de kinesiología para el historial:
 *   "EVA 6/10 · NDI 24 · 2 tests"
 *   "ODI 40 % · Borg 13 · 1 objetivo"
 * Lee v1 (parseKinesiologiaToolData). Shapes desconocidos/vacíos degradan a
 * "Sesión registrada" (mismo copy que el resto del registry — el historial nunca
 * rompe). El texto libre del motivo, las notas de ROM/tests y los objetivos NO
 * viajan al resumen (sólo conteos + scores agregados).
 */
export function resumenSesionKinesiologia(toolData: unknown): string {
  const parsed = parseKinesiologiaToolData(toolData);
  if (parsed.kind === "empty") return "Sesión registrada";

  const { motivo, rom, tests, objetivos, dolorEva, ndi, odi, borg } = parsed.data;
  const partes: string[] = [];

  if (typeof dolorEva === "number") partes.push(`EVA ${dolorEva}/10`);

  const ndiTotal = scoreNdiKine(ndi);
  if (ndiTotal !== null) partes.push(`NDI ${ndiTotal}`);
  const odiTotal = scoreOdiKine(odi);
  if (odiTotal !== null) partes.push(`ODI ${odiTotal} %`);
  const borgTotal = scoreBorgKine(borg);
  if (borgTotal !== null) partes.push(`Borg ${borgTotal}`);

  if (rom && rom.length > 0) partes.push(`${rom.length} ${rom.length === 1 ? "ROM" : "ROM"}`);
  if (tests && tests.length > 0) partes.push(`${tests.length} ${tests.length === 1 ? "test" : "tests"}`);
  if (objetivos && objetivos.length > 0) {
    partes.push(`${objetivos.length} ${objetivos.length === 1 ? "objetivo" : "objetivos"}`);
  }

  if (partes.length === 0 && typeof motivo === "string" && motivo.trim() !== "") {
    partes.push("Motivo registrado");
  }

  return partes.length > 0 ? partes.join(" · ") : "Sesión registrada";
}
