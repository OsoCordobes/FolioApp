import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Re-read every request; directory and profile fields alone never grant a page. */
export async function personalPageEnabledForOrg(service: ServiceClient, input: {
  organizationId: string; organizationTipo: string; memberId: string;
}): Promise<boolean> {
  if (input.organizationTipo !== "CLINICA") return false;
  const { data: member, error: memberError } = await service.from("member")
    .select("id, es_colegiado, deleted_at, accepted_at, invited_by_id")
    .eq("id", input.memberId).eq("organization_id", input.organizationId).maybeSingle();
  if (memberError || !member || !member.es_colegiado || member.deleted_at ||
      (member.accepted_at === null && member.invited_by_id !== null)) return false;
  const { data: consent, error: consentError } = await service.from("member_miniweb_consent")
    .select("enabled").eq("id", input.memberId).eq("organization_id", input.organizationId).maybeSingle();
  return !consentError && consent?.enabled === true;
}
