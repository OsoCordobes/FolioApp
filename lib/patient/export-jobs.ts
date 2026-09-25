import "server-only";

import { canExportCompleteClinicalHistory } from "@/lib/auth/clinical-export-scope";
import { err, ok, type Result } from "@/lib/db/errors";
import type { ActiveSession } from "@/lib/db/session";
import { createSupabaseServiceClient, type createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidateClinicalDelivery } from "./export-authorization";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export interface ExportJobIdentity {
  job_id: string;
  organization_id: string;
  paciente_id: string;
  actor_user_id: string;
  actor_member_id: string;
  source_fingerprint: string;
  state: "pending" | "leased" | "ready" | "failed" | "expired";
  revision: number;
  expires_at: string;
}

/** A caller must supply the authenticated session and RLS client from the same
 * request. The service client is only used after this current-authority check.
 * B06b2 will derive the fingerprint/count from a verified source inventory;
 * neither field may be accepted from HTTP input. */
export async function beginExportPackageJob(
  client: Client,
  session: ActiveSession,
  input: { pacienteId: string; idempotencyKey: string; verifiedInventoryFingerprint: string; expectedEntries: number },
): Promise<Result<string>> {
  if (!UUID.test(input.pacienteId) || !UUID.test(input.idempotencyKey) ||
      !SHA256.test(input.verifiedInventoryFingerprint) ||
      !Number.isSafeInteger(input.expectedEntries) || input.expectedEntries < 1 || input.expectedEntries > 10000) {
    return err("validation", "No se pudo iniciar la entrega clínica.");
  }
  if (!canExportCompleteClinicalHistory(session.role, session.esColegiado)) {
    return err("forbidden", "No tenés permiso para entregar la historia clínica completa.");
  }
  const current = await revalidateClinicalDelivery(client, session, input.pacienteId);
  if (!current.ok) return current;
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_begin", {
      p_actor: session.userId,
      p_member: session.memberId,
      p_org: session.organizationId,
      p_patient: input.pacienteId,
      p_idempotency: input.idempotencyKey,
      p_fingerprint: input.verifiedInventoryFingerprint,
      p_expected_entries: input.expectedEntries,
    });
    if (error || typeof data !== "string" || !UUID.test(data)) {
      return err("db_error", "No se pudo confirmar el trabajo de exportación. Consultá su estado antes de reintentar.");
    }
    return ok(data);
  } catch {
    return err("network", "No se pudo confirmar el trabajo de exportación. Consultá su estado antes de reintentar.");
  }
}

/** Authorization for preparing or inspecting a job, not permission to deliver
 * bytes. B06b2 routes must additionally require state=ready and recheck this
 * authority before AND after reading each private fragment. An expired job
 * is never downloadable even if cleanup has not yet run. */
export async function authorizeExportPackageJob(
  client: Client, session: ActiveSession, job: ExportJobIdentity,
  now = Date.now(),
): Promise<Result<void>> {
  if (job.actor_user_id !== session.userId || job.actor_member_id !== session.memberId ||
      job.organization_id !== session.organizationId ||
      !UUID.test(job.paciente_id) || !SHA256.test(job.source_fingerprint) ||
      !Number.isSafeInteger(job.revision) || job.revision < 0 ||
      !Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at) <= now ||
      job.state === "expired" || job.state === "failed" ||
      !canExportCompleteClinicalHistory(session.role, session.esColegiado)) {
    return err("forbidden", "La entrega ya no está autorizada.");
  }
  return revalidateClinicalDelivery(client, session, job.paciente_id);
}

/** Inspect first after an uncertain create/claim response. A stale revision
 * cannot acquire a new lease, and a still-active lease cannot be stolen. */
export async function readExportPackageJob(
  client: Client, session: ActiveSession, jobId: string,
): Promise<Result<ExportJobIdentity>> {
  if (!UUID.test(jobId) || !canExportCompleteClinicalHistory(session.role, session.esColegiado)) {
    return err("forbidden", "La entrega ya no está autorizada.");
  }
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_read", {
      p_id: jobId, p_actor: session.userId,
    });
    const job = Array.isArray(data) && data.length === 1 ? data[0] as ExportJobIdentity : null;
    if (error || !job) return err("not_found", "No se encontró una entrega vigente.");
    const authorized = await authorizeExportPackageJob(client, session, job);
    return authorized.ok ? ok(job) : authorized;
  } catch {
    return err("network", "No se pudo verificar el estado de la entrega.");
  }
}

export async function claimExportPackageJob(
  client: Client, session: ActiveSession, jobId: string, expectedRevision: number,
): Promise<Result<{ leaseToken: string; revision: number }>> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return err("validation", "La versión del trabajo es inválida.");
  }
  const current = await readExportPackageJob(client, session, jobId);
  if (!current.ok) return current;
  if (current.data.revision !== expectedRevision ||
      !["pending", "leased"].includes(current.data.state)) {
    return err("conflict", "El trabajo cambió. Consultá su estado antes de reintentar.");
  }
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_claim", {
      p_id: jobId, p_actor: session.userId, p_revision: expectedRevision,
    });
    const lease = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !lease || !UUID.test(String(lease.lease_token)) ||
        !Number.isSafeInteger(lease.revision) || lease.revision !== expectedRevision + 1) {
      return err("conflict", "No se pudo confirmar la toma del trabajo. Consultá su estado antes de reintentar.");
    }
    const final = await revalidateClinicalDelivery(client, session, current.data.paciente_id);
    if (!final.ok) return final;
    return ok({ leaseToken: lease.lease_token as string, revision: lease.revision as number });
  } catch {
    return err("network", "No se pudo confirmar la toma del trabajo. Consultá su estado antes de reintentar.");
  }
}
