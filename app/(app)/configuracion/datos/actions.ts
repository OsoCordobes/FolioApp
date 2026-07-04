"use server";

/**
 * Folio · /configuracion/datos · Habeas Data actions (Ley 25.326 art. 14-16).
 *
 * Two flows:
 *   1. exportMyDataAction — assemble the user's OWN personal data (profile,
 *      memberships, org settings, subscription) into a JSON blob, return it
 *      as a download. Implements art. 14 (right of access) + art. 16
 *      (portability).
 *   2. requestAccountDeletionAction — set profile.deletion_requested_at.
 *      The /api/cron/account-purge cron processes profiles >30 days
 *      since the request. Implements the right of erasure.
 *
 * Scope del export — MISMO criterio que /api/me/export (route canónica):
 *   - PHI de pacientes NO se exporta: los datos clínicos no son datos
 *     personales *del profesional* titular ARCO — son del paciente, cuyo
 *     responsable (data controller) es el profesional tratante. El paciente
 *     ejerce su derecho de acceso vía el profesional (o soporte).
 *   - Columnas *_cifrado NUNCA se dumpean crudas (bytes AES inútiles y
 *     riesgosos): la PII propia se descifra app-side; los secretos
 *     (certificado AFIP, tokens) se omiten directamente.
 *
 * Both gated on `auth.getUser()` — the user can only export / delete
 * THEIR OWN data, never another user's.
 */

import { revalidatePath } from "next/cache";

import { tryDecrypt } from "@/lib/crypto";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { SUPPORT_EMAIL } from "@/lib/support";

import type { Result } from "@/lib/db/errors";

interface ExportResult {
  ok: boolean;
  filename?: string;
  data?: unknown;
  error?: string;
}

/**
 * Columnas explícitas de `organization` para el export: configuración y datos
 * del negocio del titular. Deliberadamente EXCLUYE `certificado_arca_cifrado`
 * (secreto AFIP — mismo criterio que /api/me/export: los secretos no se
 * exportan) y columnas internas sin valor para el titular.
 */
const ORGANIZATION_EXPORT_COLUMNS =
  "id, slug, nombre, tipo, rubro, ciudad, provincia, timezone, moneda, " +
  "cuit, razon_social, condicion_iva, telefono_publico, direccion_completa, " +
  "instagram_handle, bio, opt_out_analytics, opt_out_public_listing, " +
  "listar_en_directorio, created_at, updated_at";

export async function exportMyDataAction(): Promise<ExportResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  const service = createSupabaseServiceClient();

  // Profile (PII propia, descifrada para el titular)
  const { data: profile } = await service
    .from("profile")
    .select(
      "id, email, nombre_cifrado, apellido_cifrado, matricula, consent_pii_signed_at, consent_pii_text_version, deletion_requested_at, created_at, updated_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  // Memberships + configuración de cada org (columnas explícitas: sin
  // certificado AFIP cifrado ni otros secretos).
  const { data: members } = await service
    .from("member")
    .select(
      `id, organization_id, role, es_colegiado, accepted_at, deleted_at, created_at, organization(${ORGANIZATION_EXPORT_COLUMNS})`,
    )
    .eq("profile_id", user.id);

  // Suscripción de las orgs del titular (datos de facturación propios).
  const { data: suscripciones } = await service
    .from("suscripcion")
    .select(
      "id, organization_id, estado, monto_cents, moneda, fecha_alta, proxima_cobro, fecha_cancelacion, created_at",
    )
    .in(
      "organization_id",
      (members ?? []).map((m: { organization_id: string }) => m.organization_id),
    );

  return {
    ok: true,
    filename: `folio-export-${user.id}-${new Date().toISOString().slice(0, 10)}.json`,
    data: {
      exported_at: new Date().toISOString(),
      ley_25326_basis: "art. 14 (derecho de acceso) — art. 16 (portabilidad implícita)",
      user_id: user.id,
      profile: profile ? decryptProfileRow(profile) : null,
      members: members ?? [],
      suscripciones: suscripciones ?? [],
      notas: [
        "Este export contiene los datos personales del titular del profile y la configuración de sus organizaciones.",
        `Los datos clínicos de pacientes (PHI) NO están incluidos porque no son datos personales del profesional titular ARCO: el responsable de esos datos es el profesional tratante en su rol de data controller bajo Ley 25.326. Los pacientes pueden ejercer su derecho de acceso solicitándolo al profesional o, subsidiariamente, a ${SUPPORT_EMAIL}.`,
        "Tokens OAuth, certificados AFIP y secretos se omiten por seguridad.",
        "Para ejercer derecho de rectificación: Configuración → Cuenta. Para supresión: Configuración → Eliminar cuenta.",
      ],
    },
  };
}

interface DeletionResult {
  ok: boolean;
  scheduledFor?: string;
  error?: string;
}

export async function requestAccountDeletionAction(
  reason?: string,
): Promise<DeletionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  const service = createSupabaseServiceClient();
  const now = new Date();
  const scheduledFor = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { error } = await service
    .from("profile")
    .update({
      deletion_requested_at: now.toISOString(),
      deletion_reason: reason ?? null,
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuracion/datos");
  return { ok: true, scheduledFor: scheduledFor.toISOString() };
}

export async function cancelAccountDeletionAction(): Promise<Result<void>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: { code: "auth_required", message: "Sesión expirada." } };
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("profile")
    .update({ deletion_requested_at: null, deletion_reason: null })
    .eq("id", user.id);

  if (error) {
    return { ok: false, error: { code: "db_error", message: error.message } };
  }

  revalidatePath("/configuracion/datos");
  return { ok: true, data: undefined };
}

// ─── helpers ────────────────────────────────────────────────────────────
//
// tryDecrypt en vez de decryptColumn crudo: un ciphertext corrupto no debe
// abortar el export Habeas Data completo — degrada ese campo a null (queda
// en Sentry).

function decryptProfileRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    nombre: tryDecrypt(row.nombre_cifrado as Buffer | string | null, "export.profile.nombre"),
    apellido: tryDecrypt(row.apellido_cifrado as Buffer | string | null, "export.profile.apellido"),
    nombre_cifrado: undefined,
    apellido_cifrado: undefined,
  };
}
