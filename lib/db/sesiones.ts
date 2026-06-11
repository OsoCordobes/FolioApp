/**
 * Folio · queries y mutations de Sesion (SOAP + tool de especialidad + lock).
 *
 * Writer ÚNICO de sesion.tool_id / tool_data_cifrado (M50). El toolData se
 * valida contra el schema del registry (lib/especialidades/meta.ts) ANTES de
 * cifrar. Para quiropraxia, vertebras_json se espeja como hasta ahora (compat
 * con la vista sesion_con_enmiendas M14 + índice gin — se retira en Fase F).
 */

import { z } from "zod";

import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import {
  ESPECIALIDADES_META,
  getEspecialidadMetaByToolId,
} from "@/lib/especialidades/meta";
import type { QuiropraxiaToolData } from "@/lib/especialidades/quiropraxia/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

const vertebraEstadoSchema = z.enum(["normal", "leve", "moderado", "severo", "ajustada"]);

const soapSchema = z.object({
  s: z.string().max(5000).optional(),
  o: z.string().max(5000).optional(),
  a: z.string().max(5000).optional(),
  p: z.string().max(5000).optional(),
});

const upsertSesionSchema = z.object({
  turnoId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  soap: soapSchema.optional(),
  vertebras: z.array(z.object({
    id: z.string().regex(/^[CTL][0-9]{1,2}$/),
    estado: vertebraEstadoSchema,
  })).optional(),
  /** Id de herramienta del registry (sesion.tool_id, M50). */
  toolId: z.string().min(1).optional(),
  /** Payload de la herramienta — se valida contra el schema del registry. */
  toolData: z.unknown().optional(),
  evaAntes: z.number().int().min(0).max(10).nullable().optional(),
  evaDespues: z.number().int().min(0).max(10).nullable().optional(),
  notas: z.string().max(10000).optional(),
});

export type UpsertSesionInput = z.infer<typeof upsertSesionSchema>;

// ─── IDOR guard (puro, testeable) ──────────────────────────────────────
//
// F-AUTH: decide si un turno (leído de DB) habilita escribir la sesión que el
// cliente pidió. Pura a propósito — sin I/O — para fijar las invariantes en un
// test unitario sin mockear Supabase. La lectura del turno la hace el caller
// (upsertSesion) bajo RLS; acá solo se evalúa el resultado.
//
//   - turno inexistente o de otra org           → forbidden (IDOR cross-tenant)
//   - turno.paciente_id != pacienteId del input → forbidden (turno↔paciente)
//   - coincide todo                              → ok
export type TurnoOwnershipRow = {
  organization_id: string;
  paciente_id: string;
} | null;

export type TurnoOwnershipVerdict =
  | { ok: true }
  | { ok: false; code: "forbidden"; message: string };

export function checkTurnoOwnership(
  turno: TurnoOwnershipRow,
  activeOrgId: string,
  pacienteId: string,
): TurnoOwnershipVerdict {
  if (!turno || turno.organization_id !== activeOrgId) {
    return { ok: false, code: "forbidden", message: "Ese turno no pertenece a tu organización." };
  }
  if (turno.paciente_id !== pacienteId) {
    return { ok: false, code: "forbidden", message: "El turno no corresponde a ese paciente." };
  }
  return { ok: true };
}

// ─── Upsert (crear o actualizar pre-lock) ──────────────────────────────

export async function upsertSesion(input: UpsertSesionInput): Promise<Result<{ id: string }>> {
  const parsed = upsertSesionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de sesión inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const d = parsed.data;

  // F-AUTH (IDOR / defensa en profundidad): turnoId y pacienteId vienen del
  // caller (cliente). El INSERT/UPDATE estampa session.organizationId y la RLS
  // + el trigger sesion_same_org_guard rechazan en DB un turno/paciente ajeno,
  // pero validamos app-side ANTES de cifrar/escribir para no confiar en IDs del
  // cliente y para que cualquier futuro caller de upsertSesion herede el guard.
  // Una sola lectura confirma (1) turno ∈ org activa y (2) turno.paciente_id ==
  // pacienteId (el trigger M09 garantiza turno.paciente_id en la misma org).
  const { data: turnoRow, error: turnoErr } = await supabase
    .from("turno")
    .select("organization_id, paciente_id")
    .eq("id", d.turnoId)
    .maybeSingle();
  if (turnoErr) {
    return err("db_error", "No pudimos validar el turno.", turnoErr.message);
  }
  const ownership = checkTurnoOwnership(
    turnoRow as TurnoOwnershipRow,
    session.data.organizationId,
    d.pacienteId,
  );
  if (!ownership.ok) {
    return err(ownership.code, ownership.message);
  }

  // ¿Ya existe sesion para este turno?
  const { data: existing } = await supabase
    .from("sesion")
    .select("id, locked_at")
    .eq("turno_id", d.turnoId)
    .maybeSingle();

  if (existing && existing.locked_at) {
    return err("locked", "La sesión está bloqueada. Creá una enmienda en su lugar.");
  }

  // ── Tool de especialidad (M50) ────────────────────────────────────────
  // Callers legacy mandan solo `vertebras` → construimos el toolData quiro.
  let toolId: string | null = d.toolId ?? null;
  let toolData: unknown = d.toolData ?? null;
  if (!toolId && d.vertebras) {
    toolId = ESPECIALIDADES_META.quiropraxia.toolId;
    toolData = { v: 1, vertebras: d.vertebras } satisfies QuiropraxiaToolData;
  }

  // Espejo legacy de quiropraxia (vista M14 + índice gin; se retira en Fase F).
  let vertebrasEspejo: Array<{ id: string; estado: string }> = d.vertebras ?? [];

  if (toolId) {
    const meta = getEspecialidadMetaByToolId(toolId);
    if (!meta) {
      return err("validation", `toolId desconocido para el registry: ${toolId}.`);
    }
    const parsedTool = meta.schema.safeParse(toolData);
    if (!parsedTool.success) {
      return err(
        "validation",
        `toolData inválido para ${meta.nombre}.`,
        parsedTool.error.message,
      );
    }
    toolData = parsedTool.data;
    if (meta.slug === "quiropraxia") {
      vertebrasEspejo = (toolData as QuiropraxiaToolData).vertebras;
    }
  }

  const payload = {
    organization_id: session.data.organizationId,
    turno_id: d.turnoId,
    paciente_id: d.pacienteId,
    soap_s_cifrado: encryptColumn(d.soap?.s ?? null),
    soap_o_cifrado: encryptColumn(d.soap?.o ?? null),
    soap_a_cifrado: encryptColumn(d.soap?.a ?? null),
    soap_p_cifrado: encryptColumn(d.soap?.p ?? null),
    notas_cifrado: encryptColumn(d.notas ?? null),
    vertebras_json: vertebrasEspejo,
    tool_id: toolId,
    tool_data_cifrado: toolData == null ? null : encryptColumn(JSON.stringify(toolData)),
    eva_antes: d.evaAntes ?? null,
    eva_despues: d.evaDespues ?? null,
  };

  if (existing) {
    const { error } = await supabase.from("sesion").update(payload).eq("id", existing.id);
    if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
    return ok({ id: existing.id });
  }

  const { data, error } = await supabase
    .from("sesion")
    .insert(payload)
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó la sesión.");
  return ok({ id: data.id });
}

// ─── Lock (al cerrar turno) ────────────────────────────────────────────

export async function lockSesion(sesionId: string): Promise<Result<void>> {
  if (!z.string().uuid().safeParse(sesionId).success) {
    return err("validation", "ID de sesión inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sesion")
    .update({
      locked_at: new Date().toISOString(),
      locked_by_id: session.data.memberId,
    })
    .eq("id", sesionId)
    .is("locked_at", null);                          // idempotente

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  return ok(undefined);
}

// ─── Enmendar (post-lock) ─────────────────────────────────────────────

export async function addEnmienda(
  sesionId: string,
  motivo: string,
  texto: string,
): Promise<Result<{ id: string }>> {
  if (motivo.length < 10) {
    return err("validation", "El motivo debe tener al menos 10 caracteres.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sesion_enmienda")
    .insert({
      organization_id: session.data.organizationId,
      sesion_id: sesionId,
      autor_id: session.data.memberId,
      motivo,
      texto_correccion_cifrado: encryptColumn(texto)!,
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó la enmienda.");
  return ok({ id: data.id });
}

// ─── Leer sesion + enmiendas (vista sesion_con_enmiendas) ─────────────

export async function getSesionCompleta(sesionId: string): Promise<Result<Record<string, unknown>>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sesion_con_enmiendas")
    .select("*")
    .eq("id", sesionId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("not_found", "Sesión no encontrada.");

  const row = data as Record<string, unknown>;
  // tryDecrypt (no decryptColumn crudo): un campo corrupto no debe tirar una
  // excepción que escape el contrato Result y tumbe la vista de la sesión —
  // degrada ese campo a null y reporta a Sentry.
  return ok({
    ...row,
    soap: {
      s: tryDecrypt(row.soap_s_cifrado as Buffer | null, "sesion.soap_s"),
      o: tryDecrypt(row.soap_o_cifrado as Buffer | null, "sesion.soap_o"),
      a: tryDecrypt(row.soap_a_cifrado as Buffer | null, "sesion.soap_a"),
      p: tryDecrypt(row.soap_p_cifrado as Buffer | null, "sesion.soap_p"),
    },
    notas: tryDecrypt(row.notas_cifrado as Buffer | null, "sesion.notas"),
  });
}
