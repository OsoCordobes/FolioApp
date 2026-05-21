"use server";

/**
 * Folio · /configuracion/datos · Habeas Data actions (Ley 25.326 art. 14-16).
 *
 * Two flows:
 *   1. exportMyDataAction — assemble all of the user's data + their orgs'
 *      paciente data + sesion/turno history into a JSON blob, return it
 *      as a download. Implements art. 15 (right of access + portability).
 *   2. requestAccountDeletionAction — set profile.deletion_requested_at.
 *      The /api/cron/account-purge cron processes profiles >30 days
 *      since the request. Implements art. 16 (right of erasure).
 *
 * Both gated on `auth.getUser()` — the user can only export / delete
 * THEIR OWN data, never another user's.
 */

import { revalidatePath } from "next/cache";

import { decryptColumn } from "@/lib/crypto";
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
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  const service = createSupabaseServiceClient();

  // Profile (decrypted)
  const { data: profile } = await service
    .from("profile")
    .select(
      "id, email, nombre_cifrado, apellido_cifrado, matricula, consent_pii_signed_at, consent_pii_text_version, deletion_requested_at, created_at, updated_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  // Member rows + the orgs the user is OWNER of
  const { data: members } = await service
    .from("member")
    .select("id, organization_id, role, es_colegiado, accepted_at, deleted_at, created_at, organization(*)")
    .eq("profile_id", user.id);

  // For each org I own, dump pacientes + their sesiones + turnos.
  const ownerOrgIds = (members ?? [])
    .filter((m: { role: string; deleted_at: unknown }) => m.role === "OWNER" && m.deleted_at === null)
    .map((m: { organization_id: string }) => m.organization_id);

  const orgsData: Record<string, unknown> = {};
  for (const orgId of ownerOrgIds) {
    const { data: pacientes } = await service
      .from("paciente_identidad")
      .select("*")
      .eq("organization_id", orgId);
    const { data: turnos } = await service
      .from("turno")
      .select("*")
      .eq("organization_id", orgId);
    const { data: sesiones } = await service
      .from("sesion")
      .select("*")
      .eq("organization_id", orgId);
    orgsData[orgId] = {
      pacientes: decryptPacienteRows(pacientes ?? []),
      turnos,
      sesiones: decryptSesionRows(sesiones ?? []),
    };
  }

  return {
    ok: true,
    filename: `folio-export-${user.id}-${new Date().toISOString().slice(0, 10)}.json`,
    data: {
      exported_at: new Date().toISOString(),
      user_id: user.id,
      profile: profile ? decryptProfileRow(profile) : null,
      members: members ?? [],
      orgs: orgsData,
      note: "Ley 25.326 art. 15 — Export of personal data + clinical history of orgs you own. PII fields are decrypted.",
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

function decryptProfileRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    nombre: decryptColumn(row.nombre_cifrado as Buffer | string | null),
    apellido: decryptColumn(row.apellido_cifrado as Buffer | string | null),
    nombre_cifrado: undefined,
    apellido_cifrado: undefined,
  };
}

function decryptPacienteRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    nombre: decryptColumn(row.nombre_cifrado as Buffer | string | null),
    apellido: decryptColumn(row.apellido_cifrado as Buffer | string | null),
    numero_doc: decryptColumn(row.numero_doc_cifrado as Buffer | string | null),
    email: decryptColumn(row.email_cifrado as Buffer | string | null),
    telefono: decryptColumn(row.telefono_cifrado as Buffer | string | null),
    domicilio_calle: decryptColumn(row.domicilio_calle_cifrado as Buffer | string | null),
    domicilio_numero: decryptColumn(row.domicilio_numero_cifrado as Buffer | string | null),
    nombre_cifrado: undefined,
    apellido_cifrado: undefined,
    numero_doc_cifrado: undefined,
    email_cifrado: undefined,
    telefono_cifrado: undefined,
    domicilio_calle_cifrado: undefined,
    domicilio_numero_cifrado: undefined,
  }));
}

function decryptSesionRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    soap_s: decryptColumn(row.soap_s_cifrado as Buffer | string | null),
    soap_o: decryptColumn(row.soap_o_cifrado as Buffer | string | null),
    soap_a: decryptColumn(row.soap_a_cifrado as Buffer | string | null),
    soap_p: decryptColumn(row.soap_p_cifrado as Buffer | string | null),
    notas: decryptColumn(row.notas_cifrado as Buffer | string | null),
    soap_s_cifrado: undefined,
    soap_o_cifrado: undefined,
    soap_a_cifrado: undefined,
    soap_p_cifrado: undefined,
    notas_cifrado: undefined,
  }));
}
