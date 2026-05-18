/**
 * Folio · queries y mutations de Sesion (SOAP + vertebras + lock).
 */

import { z } from "zod";

import { decryptColumn, encryptColumn } from "@/lib/crypto";
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
  evaAntes: z.number().int().min(0).max(10).nullable().optional(),
  evaDespues: z.number().int().min(0).max(10).nullable().optional(),
  notas: z.string().max(10000).optional(),
});

export type UpsertSesionInput = z.infer<typeof upsertSesionSchema>;

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

  // ¿Ya existe sesion para este turno?
  const { data: existing } = await supabase
    .from("sesion")
    .select("id, locked_at")
    .eq("turno_id", d.turnoId)
    .maybeSingle();

  if (existing && existing.locked_at) {
    return err("locked", "La sesión está bloqueada. Creá una enmienda en su lugar.");
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
    vertebras_json: d.vertebras ?? [],
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
  return ok({
    ...row,
    soap: {
      s: decryptColumn(row.soap_s_cifrado as Buffer | null),
      o: decryptColumn(row.soap_o_cifrado as Buffer | null),
      a: decryptColumn(row.soap_a_cifrado as Buffer | null),
      p: decryptColumn(row.soap_p_cifrado as Buffer | null),
    },
    notas: decryptColumn(row.notas_cifrado as Buffer | null),
  });
}
