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

import {
  elegirPlantillasVigentes,
  type PlantillaConsentimientoRow,
  type PlantillaVigente,
} from "@/lib/consentimientos/helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getPacienteSession } from "./paciente-session";
import { firmaPathMatchesFicha } from "./portal-consentimientos";
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

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL DEL PACIENTE (Fase 3 · P6) — ver / firmar consentimientos
// ═══════════════════════════════════════════════════════════════════════════════
//
// Espejo, del lado paciente, del flujo staff de arriba. El paciente logueado
// (getPacienteSession → paciente_cuenta_actual() → auth.uid()) puede, sobre una ficha
// `paciente` SUYA (linkeada por cuenta_id), FIRMAR un consentimiento: mismo
// canvas→PNG→Storage + trigger de inmutabilidad (M07) + evidencia legal ip/UA que el
// profesional, pero con la RLS del paciente (M85: consentimiento_insert_portal +
// "consentimientos-firmados portal write") como frontera.
//
// PRINCIPIO ANTI-IDOR: el pacienteId llega por argumento PERO se valida contra la
// sesión (debe estar en session.pacientes) y la RLS del INSERT (paciente_owns) lo
// re-valida — doble gate. La org y el tipo del consentimiento se DERIVAN de la sesión
// y de la plantilla, NUNCA del cliente. El paciente sólo puede firmar plantillas
// GLOBALES (plantilla_select_global_or_own, M04: un no-member sólo ve las globales).

const createPortalSchema = z.object({
  pacienteId: z.string().uuid(),
  plantillaId: z.string().uuid(),
  firmaStoragePath: z
    .string()
    .regex(/^consentimientos-firmados\/[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+$/),
});

/**
 * Plantillas de consentimiento que el PACIENTE puede firmar desde el portal:
 * SÓLO las globales (M68 seed — incluye TELEMEDICINA, que necesita T4). Un paciente
 * no es member ⇒ la RLS plantilla_select_global_or_own (M04) sólo le devuelve las de
 * organization_id NULL; las custom de una org NO le llegan (y no debe firmarlas por
 * el portal — esas son del flujo staff). Resuelve UNA por tipo (mayor versión).
 */
export async function listPlantillasConsentimientoPortal(): Promise<
  Result<PlantillaVigente[]>
> {
  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plantilla_consentimiento")
    .select("id, organization_id, tipo, version, titulo, texto_markdown")
    .is("reemplazado_por", null)
    .is("organization_id", null); // sólo globales (defensa explícita además de la RLS)

  if (error) {
    return err("db_error", "No pudimos cargar las plantillas de consentimiento.", error.message);
  }

  const vigentes = elegirPlantillasVigentes((data ?? []) as PlantillaConsentimientoRow[]);
  if (vigentes.length === 0) {
    return err(
      "not_found",
      "No hay plantillas de consentimiento disponibles. Contactá a tu consultorio.",
    );
  }
  return ok(vigentes);
}

/**
 * Registra un consentimiento firmado DESDE EL PORTAL. Asume que el PNG del canvas ya
 * está en Storage (la Server Action lo subió con el cliente anon del paciente, bajo
 * la policy "consentimientos-firmados portal write" de M85) y pasa el path acá.
 *
 * Seguridad (anti-IDOR, doble gate):
 *   1. Gate app: pacienteId debe ser una de SUS fichas linkeadas (session.pacientes).
 *      De ahí sale organizationId — NUNCA del cliente. El path de la firma debe
 *      apuntar a esa MISMA org y paciente (evita cruzar un binario a otra ficha).
 *   2. Gate RLS: el INSERT corre bajo consentimiento_insert_portal (M85: paciente_owns
 *      + org coherente + no-revocado). Si el pacienteId no es suyo, el WITH CHECK lo
 *      rechaza aunque el gate app fallara.
 * El `tipo` se resuelve de la plantilla (global, legible por el paciente). Se registra
 * ip/user_agent para la evidencia legal (audit AAIP), igual que el flujo staff.
 * NO se acepta firmado_por_tutor_id por el portal: el firmante es el titular de la
 * cuenta (un tutor firma desde el flujo staff del consultorio).
 */
export async function createConsentimientoPortal(
  input: z.infer<typeof createPortalSchema>,
): Promise<Result<{ id: string }>> {
  const parsed = createPortalSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del consentimiento inválidos.", parsed.error.message);
  }
  const session = await getPacienteSession();
  if (!session.ok) return session;

  // Gate app (anti-IDOR): la ficha debe estar linkeada a la cuenta del paciente.
  const ficha = session.data.pacientes.find(
    (p) => p.pacienteId === parsed.data.pacienteId,
  );
  if (!ficha) {
    return err("not_found", "Esa ficha no está vinculada a tu cuenta.");
  }
  const organizationId = ficha.organizationId;

  // El path de la firma debe apuntar a la MISMA org y paciente (el data layer y la
  // Server Action lo arman server-side con estos ids; este check es cinturón sobre
  // un path que ya pasó el regex del schema).
  if (
    !firmaPathMatchesFicha(
      parsed.data.firmaStoragePath,
      organizationId,
      parsed.data.pacienteId,
    )
  ) {
    return err("validation", "El archivo de la firma no corresponde a tu ficha.");
  }

  const supabase = await createSupabaseServerClient();

  // Resolver tipo desde la plantilla (sólo globales le llegan por RLS). Debe existir
  // y ser global (organization_id NULL) — el paciente no firma plantillas custom.
  const { data: plantilla, error: plantillaErr } = await supabase
    .from("plantilla_consentimiento")
    .select("tipo, organization_id")
    .eq("id", parsed.data.plantillaId)
    .is("reemplazado_por", null)
    .maybeSingle();
  if (plantillaErr) {
    return err("db_error", "No pudimos validar la plantilla.", plantillaErr.message);
  }
  const plantillaRow = plantilla as { tipo: string; organization_id: string | null } | null;
  if (!plantillaRow) {
    return err("not_found", "Plantilla no encontrada.");
  }
  if (plantillaRow.organization_id !== null) {
    return err("forbidden", "Esta plantilla no se puede firmar desde el portal.");
  }

  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerStore.get("user-agent") ?? null;

  const { data, error } = await supabase
    .from("consentimiento")
    .insert({
      organization_id: organizationId,
      paciente_id: parsed.data.pacienteId,
      plantilla_id: parsed.data.plantillaId,
      tipo: plantillaRow.tipo,
      firma_storage_path: parsed.data.firmaStoragePath,
      firmado_por_tutor_id: null,
      ip,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó el consentimiento.");
  return ok({ id: data.id });
}
