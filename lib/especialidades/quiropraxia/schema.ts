/**
 * Folio · especialidades · quiropraxia · schema + derivaciones (server-safe).
 *
 * Acá vive todo lo que NO es React de la herramienta quiropráctica:
 *   - `EstadoVertebra` + schema zod del toolData (`{ v: 1, vertebras: [...] }`).
 *   - `deriveSpineState(historial)` — reconstruye el estado acumulado del mapa
 *     vertebral a partir del historial de sesiones (movido de
 *     lib/db/paciente-ficha.ts para que lo compartan reader y Tool).
 *   - `resumenSesionQuiropraxia(toolData)` — string de resumen para
 *     HistorialReciente / TabSesiones ("C4, L5 ajustadas").
 *
 * Server-safe: lo importan lib/db/* (reader/writer) y el Tool client.
 */

import { z } from "zod";

import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Estados de vértebra ────────────────────────────────────────────────────

export const ESTADOS_VERTEBRA = ["normal", "leve", "moderado", "severo", "ajustada"] as const;

export type EstadoVertebra = (typeof ESTADOS_VERTEBRA)[number];

export function normalizeEstadoVertebra(raw: string | undefined): EstadoVertebra {
  const v = (raw ?? "").toLowerCase();
  if (v === "leve" || v === "moderado" || v === "severo" || v === "ajustada") return v;
  return "normal";
}

// ─── toolData (sesion.tool_data_cifrado, tool_id = quiropraxia.spine.v1) ───

// .strict(): claves desconocidas RECHAZAN en vez de stripearse. Sin esto, un
// payload de OTRA herramienta podría "parsear OK" reducido a un objeto casi
// vacío y persistirse con el tool_id equivocado (corrupción silenciosa de
// PHI). El writer (lib/db/sesiones.ts) depende de este rechazo cross-tool;
// invariante cubierta en tests/unit/especialidades-meta.test.ts.
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

/**
 * Extracción laxa de la lista de vértebras de un toolData desconocido.
 * Tolera estados fuera del enum (data legacy de vertebras_json) — el caller
 * decide si normaliza. Devuelve [] si el shape no es quiro.
 */
export function extractVertebras(toolData: unknown): Array<{ id: string; estado?: string }> {
  if (toolData === null || typeof toolData !== "object") return [];
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

// ─── Derivación del estado acumulado del mapa ───────────────────────────────

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
 * pre-Fase B — el snapshot visual de una org quiro no cambia.
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
 * Resumen de una sesión quiro para el historial. Reproduce el formato del
 * reader pre-Fase B: "C4, L5 ajustadas" / "Sin notas vertebrales".
 */
export function resumenSesionQuiropraxia(toolData: unknown): string {
  const ids = extractVertebras(toolData).map((v) => v.id);
  return ids.length > 0 ? `${ids.join(", ")} ajustadas` : "Sin notas vertebrales";
}
