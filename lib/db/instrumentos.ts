/**
 * Folio · queries y mutations de instrumento_respuesta (biblioteca de escalas).
 *
 * Writer ÚNICO de instrumento_respuesta (M73). Guarda UNA aplicación de un
 * instrumento validado (lib/instrumentos) a un paciente:
 *
 *   1. valida `instrumentoId` contra el registry (getInstrumento) — un id
 *      desconocido RECHAZA (no se inserta basura sin scoring canónico);
 *   2. computa el score SERVER-SIDE con la def del registry (nunca se confía en
 *      un score del cliente) — el snapshot { total, banda } se derivan de las
 *      respuestas crudas, no del payload;
 *   3. cifra las respuestas crudas app-side (encryptColumn, PHI) y persiste el
 *      snapshot en CLARO (score_total/banda) para series longitudinales baratas
 *      (SerieEvolucion, C3, no descifra N filas por render).
 *
 * El contrato de scoring es LAXO (la def devuelve null si las respuestas están
 * incompletas/inválidas): un instrumento sin completar SE PUEDE guardar
 * (score_total/banda quedan NULL) — es válido para un borrador o una
 * pre-admisión parcial. Lo que NO se acepta es un `instrumentoId` desconocido.
 *
 * Tenancy: el insert se ancla al organization_id de la sesión activa; RLS
 * (instrumento_respuesta_insert_clinical, M73) + el trigger
 * instrumento_respuesta_same_org_guard cubren tenancy y coherencia
 * paciente↔sesión. El INSERT está gateado por user_role_in IN (OWNER,
 * PROFESIONAL, DIRECTOR) — mismo predicado que el intake avanzado (M60).
 *
 * Convenciones espejadas de lib/db/paciente-intake.ts + lib/db/sesiones.ts.
 */

import { z } from "zod";

import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import { getInstrumento } from "@/lib/instrumentos/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

// ─── Input ─────────────────────────────────────────────────────────────────

export type CompletadoPor = "profesional" | "paciente";

export interface SaveRespuestaInput {
  pacienteId: string;
  /** NULL / ausente = aplicación de pre-admisión (sin sesión asociada). */
  sesionId?: string | null;
  /** Id versionado de la def, p. ej. "dass21.v1" (validado contra el registry). */
  instrumentoId: string;
  /**
   * Respuestas crudas — OPACAS acá. Su shape lo conoce la def del instrumento
   * (number[] / boolean[] / objeto estructurado); `score()` las valida. Se
   * serializan y cifran app-side (PHI).
   */
  respuestas: unknown;
  /** Quién completó el instrumento (profesional o paciente). Default profesional. */
  completadoPor?: CompletadoPor;
}

const saveRespuestaSchema = z.object({
  pacienteId: z.string().uuid(),
  sesionId: z.string().uuid().nullable().optional(),
  instrumentoId: z.string().min(1).max(80),
  respuestas: z.unknown(),
  completadoPor: z.enum(["profesional", "paciente"]).optional(),
});

// ─── Snapshot de score (puro, testeable) ─────────────────────────────────────

/**
 * Snapshot en claro que se persiste junto a las respuestas cifradas. `total` y
 * `banda` son NULL cuando el instrumento está incompleto/inválido (contrato
 * laxo de la def) — la fila se guarda igual (borrador / pre-admisión parcial).
 */
export interface ScoreSnapshot {
  scoreTotal: number | null;
  banda: string | null;
}

export type ComputeScoreVerdict =
  | { ok: true; version: number; snapshot: ScoreSnapshot }
  | { ok: false; code: "validation"; message: string };

/**
 * Deriva el snapshot { scoreTotal, banda } SERVER-SIDE a partir del id del
 * instrumento + las respuestas crudas, usando la def canónica del registry
 * (lib/instrumentos). Puro a propósito — sin DB, sin crypto — para fijar el
 * cómputo del score en un test unitario sin FOLIO_ENC_KEY ni Supabase.
 *
 *   - id desconocido en el registry     → validation (no se persiste basura sin
 *                                          scoring canónico);
 *   - respuestas incompletas/inválidas  → ok con snapshot { null, null } (la def
 *                                          devolvió null; la fila es un borrador
 *                                          válido);
 *   - respuestas completas              → ok con snapshot { total, banda } de la
 *                                          def (nunca del cliente).
 *
 * La versión numérica se deriva del sufijo del id (`dass21.v1` → 1); si el id no
 * lleva sufijo `.vN`, cae a 1 (defensivo — todos los ids del registry lo llevan).
 */
export function computeScoreSnapshot(
  instrumentoId: string,
  respuestas: unknown,
): ComputeScoreVerdict {
  const def = getInstrumento(instrumentoId);
  if (!def) {
    return { ok: false, code: "validation", message: "Instrumento desconocido." };
  }
  const version = parseVersionFromId(def.id);
  // Scoring canónico server-side (contrato laxo: null si incompleto/inválido).
  const score = def.score(respuestas);
  const snapshot: ScoreSnapshot = score
    ? { scoreTotal: score.total, banda: score.banda }
    : { scoreTotal: null, banda: null };
  return { ok: true, version, snapshot };
}

/** Extrae la versión numérica del sufijo `.vN` del id (`dass21.v1` → 1). */
export function parseVersionFromId(id: string): number {
  const m = /\.v(\d+)$/.exec(id);
  if (!m) return 1;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// ─── Save (crear una aplicación de instrumento) ──────────────────────────────

export async function saveRespuesta(
  input: SaveRespuestaInput,
): Promise<Result<{ id: string }>> {
  const parsed = saveRespuestaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la respuesta inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  // Valida el id + computa el score server-side (nunca se confía en un score del
  // cliente). Un id desconocido rechaza ANTES de tocar la DB.
  const scored = computeScoreSnapshot(d.instrumentoId, d.respuestas);
  if (!scored.ok) {
    return err(scored.code, scored.message);
  }

  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // organization_id va en cada insert para que la RLS (org activa) + el trigger
  // same-org validen la fila. Las respuestas crudas se serializan y cifran
  // app-side (PHI); el snapshot { total, banda } va en claro (derivado) para
  // series longitudinales.
  const { data, error } = await supabase
    .from("instrumento_respuesta")
    .insert({
      organization_id: session.data.organizationId,
      paciente_id: d.pacienteId,
      sesion_id: d.sesionId ?? null,
      instrumento_id: d.instrumentoId,
      instrumento_version: scored.version,
      respuestas_cifrado: encryptColumn(JSON.stringify(d.respuestas ?? null)),
      score_total: scored.snapshot.scoreTotal,
      banda: scored.snapshot.banda,
      completado_por: d.completadoPor ?? "profesional",
    })
    .select("id")
    .single();

  if (error || !data) {
    const mapped = error
      ? mapSupabaseError(error)
      : { code: "db_error" as const, message: "No se guardó la respuesta del instrumento." };
    return err(mapped.code, mapped.message, error?.message);
  }

  return ok({ id: data.id });
}

// ─── Listado por paciente (series longitudinales) ────────────────────────────

/**
 * Una respuesta de instrumento para la UI. `respuestas` viene DESCIFRADO +
 * JSON.parse tolerante (corrupción degrada a null, no rompe el listado — mismo
 * criterio conservador con PHI que paciente-ficha). `scoreTotal`/`banda` son el
 * snapshot en claro (no requieren descifrar) — suficientes para SerieEvolucion.
 */
export interface RespuestaInstrumento {
  id: string;
  instrumentoId: string;
  instrumentoVersion: number;
  sesionId: string | null;
  scoreTotal: number | null;
  banda: string | null;
  completadoPor: CompletadoPor;
  createdAt: string;
  lockedAt: string | null;
  /** Respuestas crudas descifradas (o null si el ciphertext está corrupto). */
  respuestas: unknown;
}

interface RespuestaRow {
  id: string;
  instrumento_id: string;
  instrumento_version: number;
  sesion_id: string | null;
  respuestas_cifrado: string | null;
  score_total: number | null;
  banda: string | null;
  completado_por: CompletadoPor;
  created_at: string;
  locked_at: string | null;
}

/**
 * Lista las respuestas de instrumentos de un paciente, ASC por created_at (orden
 * natural de una serie longitudinal). Si `instrumentoId` se pasa, filtra a ese
 * instrumento (una sola serie); sin él, trae todas. RLS scopea por org + rol
 * clínico. Un ciphertext corrupto degrada `respuestas` a null sin romper el
 * listado (tryDecrypt).
 */
export async function listRespuestasPaciente(
  pacienteId: string,
  instrumentoId?: string,
): Promise<Result<RespuestaInstrumento[]>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("instrumento_respuesta")
    .select(
      "id, instrumento_id, instrumento_version, sesion_id, respuestas_cifrado, score_total, banda, completado_por, created_at, locked_at",
    )
    .eq("paciente_id", pacienteId)
    .eq("organization_id", session.data.organizationId)
    .order("created_at", { ascending: true });
  if (instrumentoId) {
    query = query.eq("instrumento_id", instrumentoId);
  }

  const { data, error } = await query;
  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const rows = (data ?? []) as unknown as RespuestaRow[];
  const out: RespuestaInstrumento[] = rows.map((r) => ({
    id: r.id,
    instrumentoId: r.instrumento_id,
    instrumentoVersion: r.instrumento_version,
    sesionId: r.sesion_id,
    scoreTotal: r.score_total,
    banda: r.banda,
    completadoPor: r.completado_por,
    createdAt: r.created_at,
    lockedAt: r.locked_at,
    respuestas: parseRespuestas(r.respuestas_cifrado),
  }));
  return ok(out);
}

/**
 * Descifra + JSON.parse del respuestas_cifrado. Tolerante: ciphertext corrupto o
 * JSON inválido degradan a null (el listado sigue mostrando score_total/banda en
 * claro). No loguea contenido (PHI) — tryDecrypt ya reporta el fallo categórico.
 */
function parseRespuestas(cifrado: string | null): unknown {
  if (cifrado == null) return null;
  const plain = tryDecrypt(cifrado, "instrumento.respuestas");
  if (plain == null) return null;
  try {
    return JSON.parse(plain) as unknown;
  } catch {
    // PHI: no loguear en producción (linkage a datos clínicos). Degrada a null.
    return null;
  }
}
