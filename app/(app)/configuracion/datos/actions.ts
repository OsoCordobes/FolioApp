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
 *      Preserves the request for human review of retention and authorized
 *      clinical delivery. No elapsed time triggers automatic deletion.
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

import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { exportPersonalData } from "@/lib/me/personal-export";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";


import type { Result } from "@/lib/db/errors";

interface ExportResult {
  ok: boolean;
  filename?: string;
  data?: unknown;
  error?: string;
}

export async function exportMyDataAction(): Promise<ExportResult> {
  const result = await exportPersonalData();
  if (!result.ok) return { ok: false, error: result.error.message };
  return { ok: true, filename: result.data.filename, data: result.data.payload };
}
interface DeletionResult {
  ok: boolean;
  status?: "manual_review_required";
  error?: string;
}

export async function requestAccountDeletionAction(
  reason?: string,
): Promise<DeletionResult> {
  const supabase = await createSupabaseServerClient();
  const verified = await verifyMfaSession(supabase);
  if (!verified.ok) return { ok: false, error: verified.error.message };
  const { user } = verified.data;

  const service = createSupabaseServiceClient();
  const now = new Date();

  const { data: updated, error } = await service
    .from("profile")
    .update({
      deletion_requested_at: now.toISOString(),
      deletion_reason: reason ?? null,
    })
    .eq("id", user.id).select("id").maybeSingle();

  if (error || !updated) return { ok: false, error: "No se pudo registrar la solicitud de baja." };

  revalidatePath("/configuracion/datos");
  revalidatePath("/mis-datos");
  return { ok: true, status: "manual_review_required" };
}

export async function cancelAccountDeletionAction(): Promise<Result<void>> {
  const supabase = await createSupabaseServerClient();
  const verified = await verifyMfaSession(supabase);
  if (!verified.ok) return verified;
  const { user } = verified.data;

  const service = createSupabaseServiceClient();
  const { data: updated, error } = await service
    .from("profile")
    .update({ deletion_requested_at: null, deletion_reason: null })
    .eq("id", user.id).select("id").maybeSingle();

  if (error || !updated) {
    return { ok: false, error: { code: "db_error", message: "No se pudo cancelar la solicitud de baja." } };
  }

  revalidatePath("/configuracion/datos");
  revalidatePath("/mis-datos");
  return { ok: true, data: undefined };
}



