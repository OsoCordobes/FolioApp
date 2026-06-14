/**
 * Folio · especialidades · quiropraxia · schema + derivaciones (server-safe).
 *
 * Acá vive todo lo que NO es React de la herramienta quiropráctica:
 *   - v1 (LEGACY, NO se borra): `EstadoVertebra` + `quiropraxiaToolDataSchema`
 *     (`{ v: 1, vertebras: [{id, estado}] }`), `extractVertebras`,
 *     `deriveSpineState` + `SpineState`. Siguen leyendo las sesiones viejas
 *     persistidas con tool_id `quiropraxia.spine.v1`.
 *   - v2 (Workstream 6, shape de ESCRITURA activo, tool_id
 *     `quiropraxia.ficha.v2`): `quiropraxiaToolDataV2Schema` — ficha
 *     reestructurada (vista posterior/lateral, técnica+listado por vértebra,
 *     postura/palpaciones/leg-check/termografía/notas libres). Las radiografías
 *     NO viven en toolData: son filas documento_clinico (tipo RADIOGRAFIA).
 *   - `parseQuiropraxiaToolData` / `migrateV1ToV2` — discriminan y migran un
 *     toolData persistido (v2 → v1 → vacío) para el Tool y los snapshots.
 *   - `resumenSesionQuiropraxia(toolData)` — string de resumen por sesión
 *     (HistorialReciente / TabSesiones): discrimina v1 (formato histórico
 *     "C4, L5 ajustadas") de v2 ("3 vértebras con notas").
 *   - `mirrorVertebrasV2(data)` — espejo legacy vertebras_json (solo GIN/M14)
 *     desde una ficha v2: vértebras con contenido → estado "ajustada".
 *
 * Server-safe: lo importan lib/db/* (reader/writer) y el Tool client.
 */

import { z } from "zod";

import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Estados de vértebra (v1 legacy) ────────────────────────────────────────

export const ESTADOS_VERTEBRA = ["normal", "leve", "moderado", "severo", "ajustada"] as const;

export type EstadoVertebra = (typeof ESTADOS_VERTEBRA)[number];

export function normalizeEstadoVertebra(raw: string | undefined): EstadoVertebra {
  const v = (raw ?? "").toLowerCase();
  if (v === "leve" || v === "moderado" || v === "severo" || v === "ajustada") return v;
  return "normal";
}

// ─── toolData v1 (LEGACY · tool_id = quiropraxia.spine.v1) ─────────────────

// .strict(): claves desconocidas RECHAZAN en vez de stripearse. Sin esto, un
// payload de OTRA herramienta podría "parsear OK" reducido a un objeto casi
// vacío y persistirse con el tool_id equivocado (corrupción silenciosa de
// PHI). El writer (lib/db/sesiones.ts) depende de este rechazo cross-tool;
// invariante cubierta en tests/unit/especialidades-meta.test.ts.
//
// Workstream 6: este schema YA NO es el shape de escritura (lo es v2 abajo),
// pero se conserva intacto para LEER las sesiones quiro pre-v2. No se borra.
export const quiropraxiaToolDataSchema = z.object({
  v: z.literal(1),
  vertebras: z.array(
    z.object({
      id: z.string(),
      estado: z.enum(ESTADOS_VERTEBRA),
    }),
  ),
}).strict();

export type QuiropraxiaToolData = z.infer<typeof quiropraxiaToolDataSchema>;

// ─── toolData v2 (ACTIVO · tool_id = quiropraxia.ficha.v2, Workstream 6) ───

/** Vistas del mapa vertebral de la ficha v2. */
export const VISTAS_QUIRO = ["posterior", "lateral"] as const;
export type VistaQuiro = (typeof VISTAS_QUIRO)[number];

/** Modos del leg check (revisión de longitud de piernas). */
export const LEG_CHECK_MODOS = ["supino", "prono_extension", "prono_flexion"] as const;
export type LegCheckModo = (typeof LEG_CHECK_MODOS)[number];

// .strict() igual que v1: un payload de cardio/psico (u otra tool) RECHAZA y
// no degrada a un objeto válido pelado — el writer depende de esto para no
// persistir PHI ajena con el tool_id de quiropraxia (tests cross-tool).
export const quiropraxiaToolDataV2Schema = z.object({
  v: z.literal(2),
  /** Vista activa del mapa vertebral; default posterior (la hoja de trabajo). */
  vista: z.enum(VISTAS_QUIRO).default("posterior"),
  /**
   * Notas por vértebra: técnica de ajuste + listado. SIN `estado` (la
   * clasificación de 5 niveles de v1 se retiró). Una vértebra sin contenido no
   * necesita figurar acá; el writer espeja a vertebras_json solo las que tienen
   * texto (mirrorVertebrasV2).
   */
  vertebras: z
    .array(
      z.object({
        id: z.string(),
        tecnicaAjuste: z.string().max(500).optional(),
        listado: z.string().max(500).optional(),
      }),
    )
    .max(40)
    .optional(),
  /** Análisis postural: trazos libres sobre el torso de espaldas + nota. */
  postura: z
    .object({
      strokes: z.array(z.array(z.object({ x: z.number(), y: z.number() })).min(2)).max(200),
      nota: z.string().max(1000).optional(),
    })
    .optional(),
  palpacionEstatica: z.string().max(2000).optional(),
  palpacionDinamica: z.string().max(2000).optional(),
  legCheck: z
    .object({
      modo: z.enum(LEG_CHECK_MODOS),
      supinoNota: z.string().max(1000).optional(),
      pronoExtensionNota: z.string().max(1000).optional(),
      pronoFlexionNota: z.string().max(1000).optional(),
    })
    .optional(),
  tecnicaAjuste: z.string().max(2000).optional(),
  termografia: z.string().max(2000).optional(),
  notasLibres: z.string().max(5000).optional(),
}).strict();

export type QuiropraxiaToolDataV2 = z.infer<typeof quiropraxiaToolDataV2Schema>;

// ─── Migración v1 → v2 + parseo discriminado ────────────────────────────────

/**
 * Migra un toolData v1 (o cualquier shape con `vertebras: [{id, estado}]`) a v2.
 * El `estado` de v1 NO se traslada a un campo editable de v2 (la clasificación
 * de 5 niveles se retiró); cada vértebra v1 mapea a `{ id }` pelado. La UI puede
 * surfacear el estado v1 como un badge legacy read-only si lo necesita, pero el
 * objeto v2 resultante solo lleva `{ id }`. vista por defecto = "posterior".
 *
 * Tolerante: un input que no parsee como v1 igual produce un v2 vacío válido
 * (extractVertebras filtra ids no-string), así que es seguro llamarla sobre el
 * historial entero sin chequear el shape antes.
 */
export function migrateV1ToV2(v1: unknown): QuiropraxiaToolDataV2 {
  const vertebras = extractVertebras(v1)
    .map((vert) => ({ id: vert.id }))
    // dedup por id (v1 no garantizaba unicidad estricta) — primera ocurrencia.
    .filter((vert, i, arr) => arr.findIndex((o) => o.id === vert.id) === i);
  return {
    v: 2,
    vista: "posterior",
    ...(vertebras.length > 0 ? { vertebras } : {}),
  };
}

/**
 * Discrimina un toolData persistido (descifrado + JSON.parse) entre v2, v1 o
 * vacío. Intenta v2 primero (shape de escritura actual), luego v1 (legacy), y
 * si ninguno parsea devuelve `{ kind: "empty" }` (sesión sin tool / corrupta /
 * de otra herramienta — el caller arranca un borrador v2 limpio).
 */
export function parseQuiropraxiaToolData(
  value: unknown,
):
  | { kind: "v2"; data: QuiropraxiaToolDataV2 }
  | { kind: "v1"; data: QuiropraxiaToolData }
  | { kind: "empty" } {
  const asV2 = quiropraxiaToolDataV2Schema.safeParse(value);
  if (asV2.success) return { kind: "v2", data: asV2.data };
  const asV1 = quiropraxiaToolDataSchema.safeParse(value);
  if (asV1.success) return { kind: "v1", data: asV1.data };
  return { kind: "empty" };
}

/**
 * Extracción laxa de la lista de vértebras de un toolData v1 desconocido.
 * Tolera estados fuera del enum (data legacy de vertebras_json) — el caller
 * decide si normaliza. Devuelve [] si el shape no es v1-quiro.
 *
 * Workstream 6 (VERIFICADO): solo lee de un shape v1, gateado por `v !== 2`. Un
 * toolData v2 (cuyas vértebras NO tienen `estado`) NO debe pasar por acá a
 * `deriveSpineState`: si lo hiciera, `estado: undefined` normalizaría a
 * "normal" (no a "ajustada"), así que NO pintaría el mapa lateral legacy con
 * estados inventados — pero igual lo cortamos en la raíz para no acumular ids
 * v2 en el mapa acumulado. Un v2 → [].
 */
export function extractVertebras(toolData: unknown): Array<{ id: string; estado?: string }> {
  if (toolData === null || typeof toolData !== "object") return [];
  // Gate explícito: un toolData v2 no aporta estados al mapa acumulado legacy.
  if ((toolData as { v?: unknown }).v === 2) return [];
  const vertebras = (toolData as { vertebras?: unknown }).vertebras;
  if (!Array.isArray(vertebras)) return [];
  const out: Array<{ id: string; estado?: string }> = [];
  for (const v of vertebras) {
    if (v === null || typeof v !== "object") continue;
    const id = (v as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") continue;
    const estado = (v as { estado?: unknown }).estado;
    out.push({ id, estado: typeof estado === "string" ? estado : undefined });
  }
  return out;
}

/**
 * Espejo legacy de una ficha v2 hacia vertebras_json (vista M14 + índice gin —
 * se retira en Fase F). Solo las vértebras con contenido (tecnicaAjuste o
 * listado no vacíos) se reflejan, mapeadas a estado "ajustada" (la única señal
 * binaria que el índice legacy entiende). El writer SIEMPRE necesita un array
 * (columna NOT NULL DEFAULT [] con CHECK jsonb_typeof = 'array'); esta función
 * nunca devuelve undefined.
 */
export function mirrorVertebrasV2(
  data: QuiropraxiaToolDataV2,
): Array<{ id: string; estado: "ajustada" }> {
  const out: Array<{ id: string; estado: "ajustada" }> = [];
  for (const v of data.vertebras ?? []) {
    const tieneContenido =
      (v.tecnicaAjuste != null && v.tecnicaAjuste.trim() !== "") ||
      (v.listado != null && v.listado.trim() !== "");
    if (tieneContenido) out.push({ id: v.id, estado: "ajustada" });
  }
  return out;
}

// ─── Derivación del estado acumulado del mapa (v1 legacy) ────────────────────

export interface SpineState {
  /** Estado por vértebra: primera ocurrencia ganadora (historial DESC). */
  vertebrasEstado: Record<string, EstadoVertebra>;
  /** Fecha (YYYY-MM-DD) de esa primera ocurrencia, por vértebra. */
  ultimoAjuste: Record<string, string>;
}

/**
 * Reconstruye el estado del mapa vertebral desde el historial (más reciente
 * primero): para cada vértebra, manda la sesión MÁS RECIENTE que la mencione.
 * Lógica idéntica a la que vivía en lib/db/paciente-ficha.ts (líneas 188-200)
 * pre-Fase B — el snapshot visual de una org quiro v1 no cambia.
 *
 * Workstream 6: una sesión v2 aporta extractVertebras([]) → no contribuye al
 * mapa acumulado (gate `v === 2` en extractVertebras). El mapa lateral legacy
 * sigue mostrando solo lo que cargaron las sesiones v1.
 */
export function deriveSpineState(historial: ToolHistorialEntry[]): SpineState {
  const vertebrasEstado: Record<string, EstadoVertebra> = {};
  const ultimoAjuste: Record<string, string> = {};
  for (const entry of historial) {
    for (const v of extractVertebras(entry.toolData)) {
      const estado = normalizeEstadoVertebra(v.estado);
      if (!vertebrasEstado[v.id]) {
        vertebrasEstado[v.id] = estado;
        ultimoAjuste[v.id] = entry.fecha;
      }
    }
  }
  return { vertebrasEstado, ultimoAjuste };
}

// ─── Resumen por sesión ─────────────────────────────────────────────────────

/**
 * Resumen de una sesión quiro para el historial. Discrimina por versión del
 * toolData:
 *   - v2: cuenta de vértebras con contenido (tecnicaAjuste|listado): "3
 *     vértebras con notas" / "1 vértebra con notas" / "Sin notas vertebrales".
 *   - v1 / legacy (vertebras_json): formato histórico exacto "C4, L5 ajustadas"
 *     / "Sin notas vertebrales" (pinneado por tests/unit — NO cambiar). Usa
 *     extractVertebras (tolerante: estados legacy fuera del enum igual cuentan,
 *     mismo output que el reader pre-Workstream 6).
 *   - vacío / otra tool: "Sin notas vertebrales".
 */
export function resumenSesionQuiropraxia(toolData: unknown): string {
  // v2 primero: shape de escritura actual. extractVertebras corta los v2 (gate
  // `v === 2`), así que un v2 cae al branch v1 con 0 ids — por eso se chequea
  // explícito acá antes.
  if (toolData !== null && typeof toolData === "object" && (toolData as { v?: unknown }).v === 2) {
    const parsed = quiropraxiaToolDataV2Schema.safeParse(toolData);
    if (parsed.success) {
      const n = mirrorVertebrasV2(parsed.data).length;
      if (n === 0) return "Sin notas vertebrales";
      return `${n} ${n === 1 ? "vértebra" : "vértebras"} con notas`;
    }
    return "Sin notas vertebrales";
  }
  // v1 / legacy: extracción tolerante (idéntica al reader pre-Workstream 6).
  const ids = extractVertebras(toolData).map((v) => v.id);
  return ids.length > 0 ? `${ids.join(", ")} ajustadas` : "Sin notas vertebrales";
}
