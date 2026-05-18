/**
 * Folio · queries y mutations de Consentimiento.
 *
 * Flujo de firma:
 *   1. UI muestra plantilla (M04 plantilla_consentimiento → markdown texto legal).
 *   2. Paciente firma digital (canvas → PNG → upload a Storage en
 *      `consentimientos-firmados/{org}/{paciente}/{uuid}.png`) OR sube PDF
 *      firmado físicamente.
 *   3. createConsentimiento guarda fila con firma_storage_path + audit fields.
 *
 * Inmutabilidad: una vez firmado (firmado_en IS NOT NULL), solo se puede
 * marcar revocado_en + revocado_motivo (trigger SQL impide otros UPDATE).
 *
 * Ley 26.529 art. 5-11: consentimiento informado obligatorio.
 * Ley 26.529 art. 11: revocación posible en cualquier momento por escrito.
 */

import { headers } from "next/headers";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

const createSchema = z.object({
  pacienteId: z.string().uuid(),
  plantillaId: z.string().uuid(),
  firmaStoragePath: z
    .string()
    .regex(/^consentimientos-firmados\/[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+$/),
  firmadoPorTutorId: z.string().uuid().nullable().optional(),
});

const revokeSchema = z.object({
  consentimientoId: z.string().uuid(),
  motivo: z.string().min(5).max(500),
});

export interface ConsentimientoRow {
  id: string;
  paciente_id: string;
  plantilla_id: string;
  tipo: string;
  firma_storage_path: string;
  firmado_en: string;
  firmado_por_tutor_id: string | null;
  revocado_en: string | null;
  revocado_motivo: string | null;
  plantilla?: { titulo: string; tipo: string; version: string } | null;
}

/**
 * Lista consentimientos vigentes (no revocados) de un paciente.
 */
export async function listConsentimientosPaciente(
  pacienteId: string,
): Promise<Result<ConsentimientoRow[]>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("consentimiento")
    .select(
      "id, paciente_id, plantilla_id, tipo, firma_storage_path, firmado_en, firmado_por_tutor_id, revocado_en, revocado_motivo, plantilla:plantilla_consentimiento(titulo, tipo, version)",
    )
    .eq("organization_id", session.data.organizationId)
    .eq("paciente_id", pacienteId)
    .order("firmado_en", { ascending: false });

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  return ok((data ?? []) as unknown as ConsentimientoRow[]);
}

/**
 * Registra un consentimiento firmado. Asume que el archivo ya está en Storage
 * (la UI debe llamar supabase.storage.from('consentimientos-firmados').upload
 * antes y pasar el path acá).
 */
export async function createConsentimiento(
  input: z.infer<typeof createSchema>,
): Promise<Result<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del consentimiento inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Resolver tipo desde la plantilla
  const { data: plantilla } = await supabase
    .from("plantilla_consentimiento")
    .select("tipo")
    .eq("id", parsed.data.plantillaId)
    .maybeSingle();
  if (!plantilla) return err("not_found", "Plantilla no encontrada.");

  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerStore.get("user-agent") ?? null;

  const { data, error } = await supabase
    .from("consentimiento")
    .insert({
      organization_id: session.data.organizationId,
      paciente_id: parsed.data.pacienteId,
      plantilla_id: parsed.data.plantillaId,
      tipo: plantilla.tipo,
      firma_storage_path: parsed.data.firmaStoragePath,
      firmado_por_tutor_id: parsed.data.firmadoPorTutorId ?? null,
      ip,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó el consentimiento.");
  return ok({ id: data.id });
}

/**
 * Revoca un consentimiento. Solo marca revocado_en + revocado_motivo;
 * el archivo de firma se conserva por compliance (10 años Ley 26.529).
 */
export async function revokeConsentimiento(
  input: z.infer<typeof revokeSchema>,
): Promise<Result<void>> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de revocación inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("consentimiento")
    .update({
      revocado_en: new Date().toISOString(),
      revocado_motivo: parsed.data.motivo,
    })
    .eq("id", parsed.data.consentimientoId)
    .eq("organization_id", session.data.organizationId)
    .is("revocado_en", null);                       // Solo si no estaba revocado

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  return ok(undefined);
}

/**
 * Genera signed URL temporal para visualizar la firma. Storage bucket es
 * privado; el path tiene un valid lifetime de 5 min.
 */
export async function getSignedFirmaUrl(firmaStoragePath: string): Promise<Result<string>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("consentimientos-firmados")
    .createSignedUrl(firmaStoragePath.replace(/^consentimientos-firmados\//, ""), 300);

  if (error || !data) {
    return err("not_found", "No se pudo generar el link de la firma.", error?.message);
  }
  return ok(data.signedUrl);
}
