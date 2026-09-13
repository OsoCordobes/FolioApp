import { canExportCompleteClinicalHistory } from "@/lib/auth/clinical-export-scope";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { err, ok, type Result } from "@/lib/db/errors";
import { getActiveSession, type ActiveSession } from "@/lib/db/session";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
/** Call after rendering and audit, immediately before returning bytes. RLS
 * rechecks the patient/vault and optional visit; fresh Auth/MFA + current member
 * then rechecks the delivery authority. No service fallback or billing gate. */
export async function revalidateClinicalDelivery(client: Client, expected: ActiveSession, pacienteId: string, sesionId: string | null = null): Promise<Result<void>> {
  try {
    const patient = await client.from("paciente_completo").select("id,organization_id")
      .eq("id", pacienteId).eq("organization_id", expected.organizationId).maybeSingle();
    if (patient.error || patient.data?.id !== pacienteId || patient.data?.organization_id !== expected.organizationId) {
      return err("forbidden", "No se pudo confirmar el acceso al paciente al finalizar la entrega.");
    }
    if (sesionId) {
      const visit = await client.from("sesion").select("id,paciente_id,organization_id")
        .eq("id", sesionId).eq("paciente_id", pacienteId).eq("organization_id", expected.organizationId).maybeSingle();
      if (visit.error || visit.data?.id !== sesionId || visit.data?.paciente_id !== pacienteId || visit.data?.organization_id !== expected.organizationId) {
        return err("forbidden", "No se pudo confirmar el acceso a la sesión al finalizar la entrega.");
      }
    }
    const final = await getActiveSession();
    if (!final.ok) return final;
    const actual = final.data;
    if (actual.userId !== expected.userId || actual.memberId !== expected.memberId || actual.organizationId !== expected.organizationId ||
        actual.role !== expected.role || actual.esColegiado !== expected.esColegiado ||
        !capabilitiesFor(actual.role, actual.esColegiado).canReadClinical ||
        (!sesionId && !canExportCompleteClinicalHistory(actual.role, actual.esColegiado))) {
      return err("forbidden", "Tus permisos cambiaron durante la entrega. Reintentá con tu acceso actual.");
    }
    return ok(undefined);
  } catch {
    return err("network", "No se pudo verificar el acceso al finalizar la entrega. Intentá nuevamente.");
  }
}
