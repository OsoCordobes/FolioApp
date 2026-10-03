import type { SupabaseClient } from "@supabase/supabase-js";

import { err, ok, type Result } from "./errors";

/** Same treating-professional predicate as the agenda: administrative members
 * do not count. Pending invitations live in member_invitation, not member. */
export function isBillableClinicProfessional(member: {
  es_colegiado: boolean;
  deleted_at: string | null;
}): boolean {
  return member.es_colegiado === true && member.deleted_at === null;
}

/** Exact count, with caller's existing RLS/service authority and tenant scope.
 * Never replace a missing/failed count with a fabricated price. */
export async function countClinicProfessionals(
  client: SupabaseClient,
  organizationId: string,
): Promise<Result<number>> {
  const { count, error } = await client
    .from("member")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("es_colegiado", true)
    .is("deleted_at", null);
  if (error) return err("db_error", "Error contando profesionales que atienden.", error.message);
  if (count === null || !Number.isSafeInteger(count) || count < 0) {
    return err("db_error", "No se pudo confirmar la cantidad de profesionales que atienden.");
  }
  return ok(count);
}
